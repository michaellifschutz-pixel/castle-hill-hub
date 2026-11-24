/* Castle Hill Hub — standalone backend.
   Gives the Hub page the same `claude.use("db" | "assets" | "sample")` interface it had on claude.ai,
   backed by Supabase (login, database, file storage) and a Supabase Edge Function for the Ask tab. */
(function () {
  const C = window.HUB_CONFIG || {};
  const BUCKET = "hub-files";
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true } });
  window.hubSupabase = sb;

  /* ---------- login ---------- */
  const css = `#loginbg{position:fixed;inset:0;z-index:50;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:16px}
  #loginbox{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:24px;width:min(400px,100%)}
  #loginbox h2{margin:0 0 4px}#loginbox .f input{width:100%}
  #userbar{flex:none;font-size:13px;color:#fff;opacity:.85;white-space:nowrap}
  #userbar button{background:none;border:0;color:#fff;text-decoration:underline;cursor:pointer;font-size:13px;padding:8px 4px;min-height:36px}
  @media(max-width:700px){#userbar .em{display:none}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let readyResolve; const ready = new Promise(r => (readyResolve = r));
  const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function overlay() {
    let bg = document.getElementById("loginbg");
    if (!bg) { bg = document.createElement("div"); bg.id = "loginbg"; document.body.appendChild(bg); }
    return bg;
  }
  function showLogin(msg) {
    const bg = overlay();
    bg.innerHTML = `<form id="loginbox"><h2>Castle Hill Hub</h2><p class="note">Sign in to continue.</p>
      <label class="f"><span>Email</span><input id="lg_e" type="email" autocomplete="username" required></label>
      <label class="f"><span>Password</span><input id="lg_p" type="password" autocomplete="current-password" required></label>
      <p class="note" id="lg_msg" style="color:var(--red)">${msg || ""}</p>
      <div class="acts"><button class="btn pri" type="submit">Sign In</button><button class="btn" type="button" id="lg_reset">Forgot Password</button></div></form>`;
    bg.querySelector("#lg_e").focus();
    bg.querySelector("#loginbox").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: bg.querySelector("#lg_e").value.trim(), password: bg.querySelector("#lg_p").value });
      if (error) bg.querySelector("#lg_msg").textContent = "That email and password didn't work.";
    };
    bg.querySelector("#lg_reset").onclick = async () => {
      const em = bg.querySelector("#lg_e").value.trim(); const m = bg.querySelector("#lg_msg");
      if (!em) { m.textContent = "Type your email first."; return; }
      await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname + "#setpw" });
      m.style.color = "var(--green)"; m.textContent = "If that email has an account, a reset link is on its way. If nothing arrives, ask Michael to reset your password from the Team page.";
    };
  }
  function showSetPassword(first, then) {
    const bg = overlay();
    bg.innerHTML = `<form id="loginbox"><h2>${first ? "Welcome — Choose Your Password" : "Set A New Password"}</h2>
      ${first ? `<p class="note">You signed in with a temporary password. Choose your own to continue.</p>` : ""}
      <label class="f"><span>New Password (12+ characters)</span><input id="np" type="password" minlength="12" autocomplete="new-password" required></label>
      <label class="f"><span>Type It Again</span><input id="np2" type="password" minlength="12" autocomplete="new-password" required></label>
      <p class="note" id="np_msg" style="color:var(--red)"></p><div class="acts"><button class="btn pri" type="submit">Save Password</button></div></form>`;
    bg.querySelector("#np").focus();
    bg.querySelector("#loginbox").onsubmit = async e => {
      e.preventDefault();
      const p1 = bg.querySelector("#np").value, p2 = bg.querySelector("#np2").value;
      if (p1 !== p2) { bg.querySelector("#np_msg").textContent = "The two passwords don't match."; return; }
      const { data: upd, error } = await sb.auth.updateUser({ password: p1, data: { must_change_password: false } });
      if (error) { bg.querySelector("#np_msg").textContent = error.message; return; }
      history.replaceState(null, "", location.pathname); bg.remove();
      if (then) then(upd && upd.user);
    };
  }
  function showNoAccess(email) {
    const bg = overlay();
    bg.innerHTML = `<div id="loginbox"><h2>No Access Yet</h2><p>You're signed in as <b>${escH(email)}</b>, but this login hasn't been given access to the Hub.</p>
      <p class="note">Ask Michael to add you on the Team page.</p><div class="acts"><button class="btn" id="na_out">Sign Out</button></div></div>`;
    bg.querySelector("#na_out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }
  function userBar(u, isAdmin) {
    let b = document.getElementById("userbar");
    if (!b) { b = document.createElement("div"); b.id = "userbar"; (document.querySelector("header .top") || document.body).appendChild(b); }
    b.innerHTML = `<span class="em">${escH(u.email)} · </span>${isAdmin ? `<button id="ub_team">Team</button> · ` : ""}<button id="ub_out">Sign Out</button>`;
    b.querySelector("#ub_out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
    if (isAdmin) b.querySelector("#ub_team").onclick = showTeam;
  }
  let started = false, recovering = false;
  async function enter(session) {
    const u = session.user;
    if (u.user_metadata && u.user_metadata.must_change_password) { showSetPassword(true, nu => { session.user = nu || { ...u, user_metadata: { ...u.user_metadata, must_change_password: false } }; enter(session); }); return; }
    const { data: me } = await sb.from("members").select("role,name,dept").eq("user_id", u.id).maybeSingle();
    if (!me) { showNoAccess(u.email); return; }
    const bg = document.getElementById("loginbg"); if (bg) bg.remove();
    userBar(u, me.role === "admin");
    if (me.role !== "admin") { startTimeOffApp(me, u); return; }
    readyResolve(session);
    if (location.hash === "#import") setTimeout(showImport, 300);
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showSetPassword(false, () => { recovering = false; if (!started && session) { started = true; enter(session); } }); return; }
    if (session && session.user) {
      if (!started && !recovering) { started = true; setTimeout(() => enter(session), 0); }
    } else if (!started) showLogin();
  });

  /* ---------- db ---------- */
  function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
  const db = {
    doc(path) {
      const id = path.split("/")[1];
      return { async set(data) {
        const { error } = await sb.from("hub").upsert({ id, data, updated_at: new Date().toISOString() });
        if (error) throw err(/permission|policy/i.test(error.message) ? "permission_denied" : "unavailable", error.message);
      } };
    },
    collection() {
      return { onSnapshot(cb, onErr) {
        let alive = true;
        const load = async () => {
          const { data, error } = await sb.from("hub").select("id,data");
          if (!alive) return;
          if (error) { onErr && onErr(error); return; }
          cb({ docs: data.map(r => ({ id: r.id, data: () => r.data })), metadata: { fromCache: false } });
        };
        load();
        const ch = sb.channel("hub-changes").on("postgres_changes", { event: "*", schema: "public", table: "hub" }, load).subscribe();
        document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
        return () => { alive = false; sb.removeChannel(ch); };
      } };
    }
  };

  /* ---------- files ---------- */
  const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  const assets = {
    async upload(file) {
      if (file.size > 50 * 1024 * 1024) throw err("too_large");
      const id = hex();
      const { error } = await sb.storage.from(BUCKET).upload(id, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw err("upload_failed", error.message);
      return { id, sizeBytes: file.size };
    }
  };
  const urlCache = {};
  async function signed(id) {
    const c = urlCache[id]; if (c && c.exp > Date.now()) return c.url;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(id, 3600);
    if (error) throw error;
    urlCache[id] = { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 }; return data.signedUrl;
  }
  // The Hub links files as "/_blob/<id>". Open them through short-lived signed links instead.
  document.addEventListener("click", async e => {
    const a = e.target.closest && e.target.closest('a[href^="/_blob/"]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const w = window.open("", "_blank");
    try { const u = await signed(a.getAttribute("href").slice(7)); if (w) w.location = u; else location.href = u; }
    catch (x) { if (w) w.close(); alert("That file couldn't be opened."); }
  }, true);
  new MutationObserver(() => {
    document.querySelectorAll('img[src^="/_blob/"]').forEach(async img => {
      const id = img.getAttribute("src").slice(7); img.removeAttribute("src");
      try { img.src = await signed(id); } catch (x) {}
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });

  /* ---------- Ask (Claude via Edge Function) ---------- */
  async function callAsk(body, signal) {
    const { data: { session } } = await sb.auth.getSession();
    // Supabase may save the function as "ask" or "ask-". Try each.
    let r = null;
    for (const name of ["ask", "ask-"]) {
      try {
        r = await fetch(C.SUPABASE_URL + "/functions/v1/" + name, {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: C.SUPABASE_ANON_KEY },
          body: JSON.stringify(body)
        });
        if (r.status !== 404) break;
      } catch (e) { if (e && e.name === "AbortError") throw e; r = null; }
    }
    if (!r) throw err("unavailable", "Ask isn't set up in Supabase yet.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(r.status === 429 ? "rate_limited" : "unavailable", j.error);
    return j;
  }
  const b64 = f => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(f); });
  async function sample(prompt, opts = {}) {
    const j = await callAsk({ mode: "text", prompt }, opts.signal);
    if (opts.onText) opts.onText({ text: j.text });
    return { text: j.text };
  }
  sample.json = async (prompt, opts = {}) => {
    const images = [];
    for (const f of opts.images || []) images.push({ media_type: f.type, data: await b64(f) });
    const j = await callAsk({ mode: "json", prompt, images }, opts.signal);
    return j.json;
  };
  sample.limits = async () => ({ images: true });

  /* ---------- one-time import ---------- */
  const TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp" };
  function showImport() {
    const bg = document.createElement("div"); bg.id = "loginbg";
    bg.innerHTML = `<div id="loginbox" style="width:min(560px,100%)"><h2>Import Hub Data</h2>
      <p class="note">Choose the <b>private-import</b> folder from the package. It uploads every file and then your records. Safe to run again: files already uploaded are skipped.</p>
      <label class="f"><span>Folder</span><input id="im_dir" type="file" webkitdirectory multiple></label>
      <p id="im_msg" class="note"></p><div class="acts"><button class="btn pri" id="im_go">Start Import</button><button class="btn" id="im_x">Close</button></div></div>`;
    document.body.appendChild(bg);
    const msg = t => (bg.querySelector("#im_msg").textContent = t);
    bg.querySelector("#im_x").onclick = () => { bg.remove(); history.replaceState(null, "", location.pathname); };
    bg.querySelector("#im_go").onclick = async () => {
      const all = [...bg.querySelector("#im_dir").files];
      const dataFile = all.find(f => f.name === "hub-data.json");
      if (!dataFile) { msg("hub-data.json wasn't in that folder. Pick the private-import folder."); return; }
      const files = all.filter(f => /(^|\/)files\/[0-9a-f]{32}\.\w+$/.test(f.webkitRelativePath));
      let done = 0, skipped = 0, failed = [];
      for (const f of files) {
        const id = f.name.split(".")[0], ext = f.name.split(".").pop().toLowerCase();
        const { error } = await sb.storage.from(BUCKET).upload(id, f, { contentType: TYPES[ext] || "application/octet-stream", upsert: false });
        if (error && !/exists|duplicate/i.test(error.message)) failed.push(f.name); else if (error) skipped++;
        done++; msg(`Uploading files… ${done} of ${files.length}`);
      }
      msg("Saving records…");
      const data = JSON.parse(await dataFile.text());
      const rows = Object.entries(data).map(([id, d]) => ({ id, data: d, updated_at: new Date().toISOString() }));
      const { error } = await sb.from("hub").upsert(rows);
      if (error) { msg("Records couldn't be saved: " + error.message); return; }
      msg(`Done. ${files.length - failed.length} files ready (${skipped} were already there)${failed.length ? ", " + failed.length + " failed: " + failed.join(", ") : ""}. ${rows.length} sections saved. Close this window.`);
    };
  }

  /* ---------- Department Head: Time Off only ---------- */
  const TYPES_OFF = ["Vacation", "Personal", "Sick", "Holiday", "Half Day", "Other"];
  const fmtD = s => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
  const todayS = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const pillFor = s => s === "Approved" ? "green" : s === "Denied" ? "grey" : "amber";
  function startTimeOffApp(me, u) {
    document.body.classList.add("dh");
    const st2 = document.createElement("style");
    st2.textContent = `body.dh nav,body.dh .search,body.dh main,body.dh .fab{display:none!important}
      #dhapp{max-width:760px;margin:auto;padding:18px max(4vw,14px) 60px}
      #dhapp .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}@media(max-width:600px){#dhapp .grid2{grid-template-columns:1fr}}
      #dhapp .row{cursor:default}`;
    document.head.appendChild(st2);
    const h1 = document.querySelector("header .top h1"); if (h1) h1.innerHTML = "Castle Hill<small>Time Off</small>";
    const app = document.createElement("section"); app.id = "dhapp"; document.body.insertBefore(app, document.querySelector("main"));
    let items = [], msg = "";
    const load = async () => {
      const { data, error } = await sb.rpc("get_time_off");
      if (error) { app.innerHTML = `<div class="banner" style="display:block">Time off couldn't be loaded. Refresh to try again.</div>`; return; }
      items = data || []; draw();
    };
    function draw() {
      const t = todayS();
      const mine = items.filter(r => r.by === u.id).sort((a, b) => b.start.localeCompare(a.start));
      const off = items.filter(r => r.status !== "Denied" && (r.end || r.start) >= t).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 40);
      const dates = r => fmtD(r.start) + (r.end && r.end !== r.start ? " – " + fmtD(r.end) : "");
      app.innerHTML = `<h2>Hi ${escH((me.name || u.email).split(" ")[0])}</h2><p class="sub">${escH(me.dept || "")}${me.dept ? " · " : ""}Request time off and check on your requests.</p>
        ${msg ? `<p class="pill green" style="white-space:normal;display:inline-block">${escH(msg)}</p>` : ""}
        <h3>Request Time Off</h3>
        <form id="dh_f" class="card" style="padding:4px 16px 14px">
          <div class="grid2"><label class="f"><span>First Day Off</span><input id="dh_s" type="date" required value="${t}"></label>
          <label class="f"><span>Last Day Off</span><input id="dh_e" type="date" required value="${t}"></label></div>
          <label class="f"><span>Type</span><select id="dh_t">${TYPES_OFF.map(x => `<option>${x}</option>`).join("")}</select></label>
          <label class="f"><span>Note For Michael (Optional)</span><input id="dh_r" maxlength="500" placeholder="e.g. Family wedding; Maria covering"></label>
          <p class="note" id="dh_err" style="color:var(--red)"></p>
          <button class="btn pri" type="submit">Send Request</button></form>
        <h3>My Requests</h3>
        <div class="card">${mine.length ? mine.map(r => `<div class="row"><div class="main"><div class="t">${dates(r)}</div><div class="m">${escH(r.type || "")}${r.reason ? " · " + escH(r.reason) : ""}</div></div>
          <span class="pill ${pillFor(r.status)}">${escH(r.status)}</span>${r.status === "Pending" ? `<button class="btn" data-cancel="${escH(r.id)}">Cancel</button>` : ""}</div>`).join("") : `<div class="empty">No requests yet.</div>`}</div>
        <h3>Who's Off · Coming Up</h3>
        <div class="card">${off.length ? off.map(r => `<div class="row"><div class="main"><div class="t">${escH(r.name)}${r.dept ? " · " + escH(r.dept) : ""}</div><div class="m">${dates(r)}</div></div><span class="pill ${pillFor(r.status)}">${r.status === "Pending" ? "Not Yet Approved" : escH(r.status)}</span></div>`).join("") : `<div class="empty">Nobody has time off coming up.</div>`}</div>`;
      app.querySelector("#dh_s").onchange = e => { const en = app.querySelector("#dh_e"); if (en.value < e.target.value) en.value = e.target.value; };
      app.querySelector("#dh_f").onsubmit = async e => {
        e.preventDefault();
        const s = app.querySelector("#dh_s").value, en = app.querySelector("#dh_e").value;
        if (en < s) { app.querySelector("#dh_err").textContent = "The last day is before the first day."; return; }
        const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Sending…";
        const { error } = await sb.rpc("submit_time_off", { p_start: s, p_end: en, p_type: app.querySelector("#dh_t").value, p_reason: app.querySelector("#dh_r").value });
        if (error) { btn.disabled = false; btn.textContent = "Send Request"; app.querySelector("#dh_err").textContent = error.message || "That didn't go through. Try again."; return; }
        msg = "Request sent. Michael will approve or deny it here."; load();
      };
      app.querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => {
        if (!confirm("Cancel this request?")) return;
        await sb.rpc("cancel_time_off", { p_id: b.dataset.cancel }); msg = "Request cancelled."; load();
      });
    }
    app.innerHTML = `<div class="empty">Loading…</div>`;
    load();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  }

  /* ---------- Team page (Full Access only) ---------- */
  const DEPTS_T = ["Nursing", "Admissions", "Business Office", "Dietary", "Housekeeping", "Laundry", "Maintenance", "MDS", "Medical Records", "Recreation", "Rehab", "Social Services", "Staff Education", "HR", "Infection Control", "Administration", "Other"];
  async function teamCall(body) {
    const { data: { session } } = await sb.auth.getSession();
    // The function may be named "team" or "team-" (Supabase sometimes adds a dash). Try each.
    let r = null, lastErr = null;
    for (const name of ["team", "team-"]) {
      try {
        r = await fetch(C.SUPABASE_URL + "/functions/v1/" + name, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: C.SUPABASE_ANON_KEY }, body: JSON.stringify(body)
        });
        if (r.status !== 404) break;
      } catch (e) { lastErr = e; r = null; }
    }
    if (!r) throw new Error("Couldn't reach the Team function in Supabase. Check that Enforce JWT Verification is turned off on it.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || (r.status === 404 ? "The Team function isn't set up in Supabase yet." : "Something went wrong."));
    return j;
  }
  const site = () => location.origin + location.pathname.replace(/index\.html$/, "");
  function showTeam() {
    const bg = overlay();
    bg.style.alignItems = "flex-start"; bg.style.overflow = "auto";
    const box = document.createElement("div"); box.id = "loginbox"; box.style.cssText = "width:min(720px,100%);margin:4vh auto";
    bg.innerHTML = ""; bg.appendChild(box);
    const close = () => { bg.remove(); };
    const roleName = r => r === "depthead" ? "Department Head · Time Off Only" : "Full Access";
    function credsCard(email, password) {
      const text = `You now have access to the Castle Hill Hub.\n\nGo to: ${site()}\nEmail: ${email}\nTemporary password: ${password}\n\nYou'll choose your own password when you first sign in.`;
      return `<div class="card" style="padding:14px 16px;margin:12px 0;background:var(--greenbg)"><b>Send this to ${escH(email)}:</b>
        <pre id="cr_txt" style="white-space:pre-wrap;font:inherit;margin:8px 0">${escH(text)}</pre>
        <div class="acts"><button class="btn pri" id="cr_copy">Copy Message</button><a class="btn" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Castle Hill Hub access")}&body=${encodeURIComponent(text)}">Open In Email</a></div>
        <p class="note">This password isn't shown again. If it's lost, use Reset Password.</p></div>`;
    }
    async function draw(note) {
      box.innerHTML = `<h2>Team</h2><p class="note">Loading…</p>`;
      let list;
      try { list = await teamCall({ action: "list" }); }
      catch (e) { box.innerHTML = `<h2>Team</h2><p style="color:var(--red)">${escH(e.message)}</p><div class="acts"><button class="btn" id="tm_x">Close</button></div>`; box.querySelector("#tm_x").onclick = close; return; }
      const ms = list.members.sort((a, b) => (a.role + (a.name || a.email)).localeCompare(b.role + (b.name || b.email)));
      box.innerHTML = `<h2>Team</h2><p class="note">Who can sign in to the Hub. Full Access sees everything. Department Heads only see Time Off.</p>
        ${note || ""}
        <div class="card">${ms.map(m => `<div class="row" style="cursor:default;flex-wrap:wrap"><div class="main" style="min-width:200px"><div class="t">${escH(m.name || m.email)}${m.user_id === list.me ? " (You)" : ""}</div>
          <div class="m">${escH(m.email)} · ${roleName(m.role)}${m.dept ? " · " + escH(m.dept) : ""} · ${m.last_sign_in_at ? "Last signed in " + new Date(m.last_sign_in_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Hasn't signed in yet"}</div></div>
          ${m.user_id === list.me ? "" : `<button class="btn" data-edit="${m.user_id}">Change</button><button class="btn" data-reset="${m.user_id}">Reset Password</button><button class="btn warn" data-rm="${m.user_id}">Remove</button>`}</div>`).join("")}</div>
        <h3>Add Someone</h3>
        <form id="tm_f" class="card" style="padding:4px 16px 14px">
          <label class="f"><span>Name</span><input id="tm_n" required maxlength="100" placeholder="e.g. Maria Teran"></label>
          <label class="f"><span>Email</span><input id="tm_e" type="email" required maxlength="200"></label>
          <label class="f"><span>Access</span><select id="tm_r"><option value="depthead">Department Head · Time Off Only</option><option value="admin">Full Access · Everything</option></select></label>
          <label class="f" id="tm_dw"><span>Department</span><select id="tm_d">${DEPTS_T.map(d => `<option>${d}</option>`).join("")}</select></label>
          <p class="note" id="tm_err" style="color:var(--red)"></p>
          <div class="acts"><button class="btn pri" type="submit">Add Person</button><button class="btn" type="button" id="tm_x">Close</button></div></form>`;
      box.querySelector("#tm_x").onclick = close;
      const rsel = box.querySelector("#tm_r"); rsel.onchange = () => { box.querySelector("#tm_dw").style.display = rsel.value === "depthead" ? "" : "none"; };
      box.querySelector("#tm_f").onsubmit = async e => {
        e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Adding…";
        const role = rsel.value;
        if (role === "admin" && !confirm("Full Access includes HR documents, Finance and everything else. Continue?")) { btn.disabled = false; btn.textContent = "Add Person"; return; }
        try {
          const r = await teamCall({ action: "add", name: box.querySelector("#tm_n").value, email: box.querySelector("#tm_e").value, role, dept: box.querySelector("#tm_d").value });
          await draw(credsCard(r.email, r.password)); wireCopy();
        } catch (x) { btn.disabled = false; btn.textContent = "Add Person"; box.querySelector("#tm_err").textContent = x.message; }
      };
      box.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
        const m = ms.find(x => x.user_id === b.dataset.rm);
        if (!confirm(`Remove ${m.name || m.email}? They won't be able to sign in any more.`)) return;
        try { await teamCall({ action: "remove", user_id: m.user_id }); draw(); } catch (x) { alert(x.message); }
      });
      box.querySelectorAll("[data-reset]").forEach(b => b.onclick = async () => {
        const m = ms.find(x => x.user_id === b.dataset.reset);
        if (!confirm(`Give ${m.name || m.email} a new temporary password?`)) return;
        try { const r = await teamCall({ action: "reset", user_id: m.user_id }); await draw(credsCard(r.email, r.password)); wireCopy(); } catch (x) { alert(x.message); }
      });
      box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
        const m = ms.find(x => x.user_id === b.dataset.edit);
        const row = b.closest(".row");
        row.innerHTML = `<form style="flex:1" class="ed"><div class="t">${escH(m.name || m.email)}</div>
          <label class="f"><span>Name</span><input class="ed_n" value="${escH(m.name || "")}" maxlength="100"></label>
          <label class="f"><span>Access</span><select class="ed_r"><option value="depthead" ${m.role === "depthead" ? "selected" : ""}>Department Head · Time Off Only</option><option value="admin" ${m.role === "admin" ? "selected" : ""}>Full Access · Everything</option></select></label>
          <label class="f"><span>Department</span><select class="ed_d">${DEPTS_T.map(d => `<option ${d === m.dept ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <div class="acts"><button class="btn pri">Save</button><button class="btn" type="button">Cancel</button></div></form>`;
        row.querySelector("button[type=button]").onclick = () => draw();
        row.querySelector("form").onsubmit = async e => {
          e.preventDefault(); const role = row.querySelector(".ed_r").value;
          if (role === "admin" && m.role !== "admin" && !confirm("Full Access includes HR documents, Finance and everything else. Continue?")) return;
          try { await teamCall({ action: "update", user_id: m.user_id, role, name: row.querySelector(".ed_n").value, dept: row.querySelector(".ed_d").value }); draw(); } catch (x) { alert(x.message); }
        };
      });
    }
    function wireCopy() {
      const c = box.querySelector("#cr_copy"); if (!c) return;
      c.onclick = async () => { try { await navigator.clipboard.writeText(box.querySelector("#cr_txt").textContent); c.textContent = "Copied"; } catch (e) { c.textContent = "Select the text and copy it"; } };
    }
    draw();
  }

  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "sample") return sample;
      throw err("not_granted");
    }
  };
})();
