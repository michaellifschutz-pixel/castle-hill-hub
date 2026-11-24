// Castle Hill Hub — Team page backend: add, list, change and remove people.
// Only Full Access members may call it. Uses the project's service role key,
// which Supabase provides to Edge Functions automatically; it never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// Readable temporary password: no look-alike characters.
function tempPassword() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, (x) => a[x % a.length]).join("");
}
async function allUsers() {
  const out: { id: string; email?: string; last_sign_in_at?: string }[] = [];
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 200) break;
  }
  return out;
}
const clean = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return reply(401, { error: "Not signed in" });
  const { data: me } = await admin.from("members").select("role").eq("user_id", user.id).maybeSingle();
  if (!me || me.role !== "admin") return reply(403, { error: "Only Full Access members can manage the team" });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Bad request" }); }
  const role = b.role === "depthead" ? "depthead" : "admin";

  try {
    if (b.action === "list") {
      const [{ data: members }, users] = await Promise.all([admin.from("members").select("user_id,email,name,role,dept,added"), allUsers()]);
      const seen = new Map(users.map((u) => [u.id, u.last_sign_in_at ?? null]));
      return reply(200, { me: user.id, members: (members ?? []).map((m) => ({ ...m, last_sign_in_at: seen.get(m.user_id) ?? null })) });
    }

    if (b.action === "add") {
      const email = clean(b.email, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "That email doesn't look right." });
      const name = clean(b.name, 100), dept = role === "depthead" ? clean(b.dept, 60) : "";
      const password = tempPassword();
      let id: string | undefined;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, must_change_password: true } });
      if (error) {
        const existing = (await allUsers()).find((u) => (u.email ?? "").toLowerCase() === email);
        if (!existing) return reply(400, { error: error.message });
        id = existing.id;
        await admin.auth.admin.updateUserById(id, { password, email_confirm: true, user_metadata: { name, must_change_password: true } });
      } else id = data.user.id;
      const { error: e2 } = await admin.from("members").upsert({ user_id: id, email, name, role, dept });
      if (e2) return reply(500, { error: e2.message });
      return reply(200, { email, password });
    }

    const target = clean(b.user_id, 60);
    if (!target) return reply(400, { error: "Missing person" });

    if (b.action === "update") {
      if (target === user.id && role !== "admin") return reply(400, { error: "You can't remove your own Full Access." });
      const { error } = await admin.from("members").update({ role, name: clean(b.name, 100), dept: role === "depthead" ? clean(b.dept, 60) : "" }).eq("user_id", target);
      if (error) return reply(500, { error: error.message });
      return reply(200, { ok: true });
    }
    if (b.action === "reset") {
      const password = tempPassword();
      const { data: u } = await admin.auth.admin.getUserById(target);
      const { error } = await admin.auth.admin.updateUserById(target, { password, email_confirm: true, user_metadata: { ...(u?.user?.user_metadata ?? {}), must_change_password: true } });
      if (error) return reply(500, { error: error.message });
      return reply(200, { email: u?.user?.email, password });
    }
    if (b.action === "remove") {
      if (target === user.id) return reply(400, { error: "You can't remove yourself." });
      const { error } = await admin.auth.admin.deleteUser(target);
      if (error) return reply(500, { error: error.message });
      return reply(200, { ok: true });
    }
    return reply(400, { error: "Unknown action" });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : "Unexpected error" });
  }
});
