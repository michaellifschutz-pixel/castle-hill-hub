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
  function showLogin(msg) {
    let bg = document.getElementById("loginbg");
    if (!bg) { bg = document.createElement("div"); bg.id = "loginbg"; document.body.appendChild(bg); }
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
      m.style.color = "var(--green)"; m.textContent = "If that email has an account, a reset link is on its way.";
    };
  }
  function showSetPassword() {
    let bg = document.getElementById("loginbg");
    if (!bg) { bg = document.createElement("div"); bg.id = "loginbg"; document.body.appendChild(bg); }
    bg.innerHTML = `<form id="loginbox"><h2>Set A New Password</h2>
      <label class="f"><span>New Password (12+ characters)</span><input id="np" type="password" minlength="12" autocomplete="new-password" required></label>
      <p class="note" id="np_msg"></p><div class="acts"><button class="btn pri" type="submit">Save Password</button></div></form>`;
    bg.querySelector("#loginbox").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: bg.querySelector("#np").value });
      if (error) { bg.querySelector("#np_msg").textContent = error.message; return; }
      history.replaceState(null, "", location.pathname); bg.remove();
    };
  }
  function userBar(u) {
    let b = document.getElementById("userbar");
    if (!b) { b = document.createElement("div"); b.id = "userbar"; (document.querySelector("header .top") || document.body).appendChild(b); }
    b.innerHTML = `<span class="em">${String(u.email).replace(/[<>&"]/g, "")} · </span><button id="ub_out">Sign Out</button>`;
    b.querySelector("#ub_out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { showSetPassword(); return; }
    if (session && session.user) {
      if (location.hash !== "#setpw") { const bg = document.getElementById("loginbg"); if (bg) bg.remove(); }
      userBar(session.user);
      if (!started) { started = true; readyResolve(session); if (location.hash === "#import") setTimeout(showImport, 300); }
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
    const r = await fetch(C.SUPABASE_URL + "/functions/v1/ask", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: C.SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    });
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
