// Castle Hill Hub — "Ask" tab and document-photo reading.
// Deploy:  supabase functions deploy ask
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  // Only signed-in Hub members may use this.
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return reply(401, { error: "Not signed in" });
  const { data: member } = await sb.from("members").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!member) return reply(403, { error: "Not a Hub member" });

  let body: { mode?: string; prompt?: string; images?: { media_type: string; data: string }[] };
  try { body = await req.json(); } catch { return reply(400, { error: "Bad JSON" }); }
  const prompt = String(body.prompt ?? "");
  if (!prompt || prompt.length > 400_000) return reply(400, { error: "Missing or oversized prompt" });
  const isJson = body.mode === "json";

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of (body.images ?? []).slice(0, 4)) {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(img.media_type)) continue;
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type as "image/jpeg", data: img.data } });
  }
  content.push({ type: "text", text: isJson ? prompt + "\n\nReply with only the JSON object, no other text." : prompt });

  try {
    const msg = await anthropic.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: isJson ? "low" : "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      // deno-lint-ignore no-explicit-any
      ...({ fallbacks: "default" } as any),
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal") return reply(200, { text: "I can't help with that one.", json: null });
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!isJson) return reply(200, { text });
    const m = text.match(/\{[\s\S]*\}/);
    let json = null;
    try { json = m ? JSON.parse(m[0]) : null; } catch { json = null; }
    return reply(200, { json });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply(429, { error: "Rate limited" });
    if (e instanceof Anthropic.AuthenticationError) return reply(500, { error: "Anthropic API key is missing or invalid" });
    if (e instanceof Anthropic.APIError) return reply(502, { error: `Claude API error ${e.status}` });
    return reply(500, { error: "Unexpected error" });
  }
});
