// ════════════════════════════════════════════════════════════════════════════
// Cloudflare Worker — загрузчик картинок в R2
// ════════════════════════════════════════════════════════════════════════════
// Браузер делает PUT /<имя-файла> с телом-картинкой и заголовком
// Authorization: Bearer <supabase access token>. Воркер проверяет токен через
// Supabase, валидирует тип/размер и пишет файл в R2-бакет.
//
// ── НАСТРОЙКА (Cloudflare Dashboard) ─────────────────────────────────────────
// 1. R2 → Create bucket → имя, например  ce-images
// 2. В бакете → Settings → Public access → включить r2.dev subdomain.
//    Скопировать публичный URL вида https://pub-xxxxxxxx.r2.dev  → это R2_PUBLIC в core.js
// 3. Workers & Pages → Create → Worker → назвать ce-upload → Deploy.
//    Заменить код воркера на этот файл (Edit code → вставить → Deploy).
//    URL воркера вида https://ce-upload.<логин>.workers.dev  → это R2_UPLOAD в core.js
// 4. Worker → Settings → Variables and Secrets:
//      SB_URL   = https://pgngkkiiopymvrcozvvr.supabase.co   (Variable)
//      SB_ANON  = <твой anon key>                             (Secret)
//      ALLOW_ORIGIN = https://твой-сайт.pages.dev (или домен сайта; для теста '*')
// 5. Worker → Settings → Bindings → Add → R2 bucket:
//      Variable name = BUCKET ,  Bucket = ce-images
// ════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'PUT') return json({ error: 'Method Not Allowed' }, 405, cors);

    // Имя файла из пути. Без вложенных папок и без обхода каталогов.
    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    if (!key || key.includes('/') || key.includes('..')) return json({ error: 'Bad key' }, 400, cors);

    // Авторизация: токен должен быть валидным пользователем Supabase.
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'No token' }, 401, cors);
    const who = await fetch(`${env.SB_URL}/auth/v1/user`, {
      headers: { apikey: env.SB_ANON, Authorization: auth },
    });
    if (!who.ok) return json({ error: 'Unauthorized' }, 401, cors);

    // Тип и размер.
    const ct = request.headers.get('Content-Type') || '';
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(ct)) return json({ error: 'Bad content-type' }, 415, cors);
    const body = await request.arrayBuffer();
    if (body.byteLength > 5 * 1024 * 1024) return json({ error: 'Too large (max 5MB)' }, 413, cors);

    await env.BUCKET.put(key, body, {
      httpMetadata: { contentType: ct, cacheControl: 'public, max-age=31536000, immutable' },
    });
    return json({ ok: true, key }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
