// =====================================================================
// GlowGrid · Edge Function "analyze-report"
// Dipanggil database (pg_net) saat ada laporan baru, dan oleh cron untuk
// laporan yang tertunda. Hanya memproses laporan berstatus AI "pending"
// atau "failed", jadi panggilan berulang tidak menghabiskan kuota.
//
// Secret yang dibutuhkan (Supabase → Edge Functions → Secrets):
//   GROQ_API_KEY   : API key dari console.groq.com
//   GROQ_MODELS    : (opsional) daftar model dipisah koma
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { analyzeWithGroq } from "./logic.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Gunakan POST" }, 405);

  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) return json({ error: "GROQ_API_KEY belum diatur" }, 503);   // laporan tetap jalan dengan skor algoritma
  const models = (Deno.env.get("GROQ_MODELS") || "").split(",").map((s) => s.trim()).filter(Boolean);

  let reportId: string | null = null;
  try { const body = await req.json(); reportId = typeof body?.report_id === "string" ? body.report_id : null; } catch { /* body kosong */ }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: claimed, error: claimError } = await sb.rpc("ai_claim", { p_report_id: reportId, p_limit: 5 });
  if (claimError) return json({ error: claimError.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const row of (claimed as Array<string | { ai_claim: string }>) || []) {
    const id = typeof row === "string" ? row : row.ai_claim;
    try {
      const { data: ctx, error } = await sb.rpc("ai_context", { p_report_id: id });
      if (error || !ctx) throw new Error(error?.message || "Laporan tidak ditemukan");
      const { result, model } = await analyzeWithGroq(ctx, { apiKey, models });
      const { error: saveError } = await sb.rpc("ai_save", { p_report_id: id, p_result: result, p_model: model });
      if (saveError) throw new Error(saveError.message);
      results.push({ id, ok: true, model, urgensi: result.urgensi });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sb.rpc("ai_fail", { p_report_id: id, p_error: message });
      results.push({ id, ok: false, error: message });
    }
  }
  return json({ processed: results.length, results });
});
