// ════════════════════════════════════════════════════════════════════════
//  Supabase Edge Function: log-access
//  Пишет строку в public.access_log при входе игрока — для ловли мультиакков.
//
//  ПОЧЕМУ СЕРВЕР: реальный IP берётся из заголовка запроса (x-forwarded-for)
//  на стороне сервера — с клиента его не подделать. user_id тоже берётся из
//  ПРОВЕРЕННОГО токена (getUser), а не из тела запроса, поэтому нельзя
//  записать чужой доступ. Отпечаток браузера (fingerprint) приходит с клиента
//  как подсказка — его подделать можно, поэтому он лишь дополняет IP.
//
//  Вызов:  POST { "fp": "<fingerprint>" }  + заголовок Authorization: Bearer <user JWT>
//
//  Секреты: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — есть в окружении по умолчанию.
// ════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  try {
    if (!SB_URL || !SB_KEY) return json({ error: "service-role окружение не задано" }, 500);

    // ── 1. Кто это — из ПРОВЕРЕННОГО токена, не из тела ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "нет токена" }, 401);

    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const { data: uData, error: uErr } = await sb.auth.getUser(jwt);
    const authUser = uData?.user;
    if (uErr || !authUser) return json({ error: "невалидный токен" }, 401);

    // ── 2. Реальный IP из заголовков (первый в x-forwarded-for — клиент) ──
    const xff = req.headers.get("x-forwarded-for") ?? "";
    const ip = (xff.split(",")[0] || req.headers.get("x-real-ip") || "").trim() || null;
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 400) || null;

    // ── 3. Отпечаток с клиента (подсказка) ──
    const body = await req.json().catch(() => ({}));
    const fp = String(body?.fp ?? "").slice(0, 128) || null;

    // ── 4. Запись (service_role обходит RLS) ──
    const { error: wErr } = await sb.from("access_log").insert({
      user_id: authUser.id,
      email: authUser.email ?? null,
      ip,
      fingerprint: fp,
      user_agent: ua,
    });
    if (wErr) return json({ error: "запись: " + wErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }

  function json(b: unknown, status = 200) {
    return new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
