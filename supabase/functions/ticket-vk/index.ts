// ════════════════════════════════════════════════════════════════════════
//  Supabase Edge Function: ticket-vk (у тебя задеплоена как dynamic-responder)
//  Шлёт уведомление о тикете в VK (личка или БЕСЕДА) через messages.send,
//  с прикреплением скриншотов (фото загружаются на серверы VK).
//
//  Секреты (Function → Settings → Secrets):
//    VK_TOKEN        — ключ доступа сообщества VK (права «Сообщения сообщества»)
//    VK_PEER_ID      — куда слать:
//                        • личка: твой числовой VK id (сначала напиши боту сам);
//                        • БЕСЕДА: 2000000000 + chat_id (бот должен быть в беседе).
//    VK_API_VERSION  — необязательно, по умолчанию 5.199
//
//  peer_id беседы: вызови функцию с телом { "list": true } → вернётся список
//  бесед с их peer_id; нужный впиши в секрет VK_PEER_ID.
// ════════════════════════════════════════════════════════════════════════

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  console.log(`[ticket-vk] ${req.method} запрос получен`);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const VK_TOKEN = Deno.env.get("VK_TOKEN");
  const VK_PEER_ID = Deno.env.get("VK_PEER_ID");
  const V = Deno.env.get("VK_API_VERSION") ?? "5.199";

  try {
    if (!VK_TOKEN) return json({ error: "VK_TOKEN не задан в секретах функции" }, 500);
    const t = await req.json().catch(() => ({}));

    // ── Режим «показать список бесед» (для разовой настройки peer_id) ──
    if (t.list === true) {
      const r = await vk("messages.getConversations", { access_token: VK_TOKEN, v: V, count: "200", filter: "all" });
      if (r.error) return json({ ok: false, vk: r.error });
      const items = (r.response?.items ?? []).map((it: any) => ({
        peer_id: it.conversation?.peer?.id,
        type: it.conversation?.peer?.type,
        title: it.conversation?.chat_settings?.title ?? "(личка)",
      }));
      return json({ ok: true, conversations: items });
    }

    if (!VK_PEER_ID) return json({ error: "VK_PEER_ID не задан в секретах функции" }, 500);
    console.log("[ticket-vk] тело:", JSON.stringify({ ...t, screenshots: (t.screenshots || []).length + " шт." }));

    // ── Загрузка скриншотов на серверы VK → строка attachment ──
    const atts: string[] = [];
    for (const url of (t.screenshots ?? []).slice(0, 5)) {
      try {
        const a = await vkUploadPhoto(VK_TOKEN, VK_PEER_ID, V, url);
        if (a) { atts.push(a); console.log("[ticket-vk] фото загружено:", a); }
        else console.error("[ticket-vk] фото не загрузилось:", url);
      } catch (e) { console.error("[ticket-vk] ошибка фото:", String(e)); }
    }

    const msg = [
      "🛟 Новый тикет на сайте",
      `Категория: ${t.category ?? "—"}`,
      `От: ${t.user_name ?? "—"}`,
      t.vk_link ? `ВК игрока: ${t.vk_link}` : "",
      "",
      String(t.description ?? "").slice(0, 900),
    ].filter(Boolean).join("\n");

    const sendParams: Record<string, string> = {
      access_token: VK_TOKEN, v: V, peer_id: String(VK_PEER_ID),
      random_id: String(Date.now()), message: msg, dont_parse_links: "1",
    };
    if (atts.length) sendParams.attachment = atts.join(",");

    const data = await vk("messages.send", sendParams);
    console.log("[ticket-vk] ответ VK:", JSON.stringify(data));
    if (data.error) return json({ ok: false, vk: data.error });
    return json({ ok: true, attached: atts.length });
  } catch (e) {
    console.error("[ticket-vk] исключение:", String(e));
    return json({ error: String(e) }, 500);
  }

  async function vk(method: string, params: Record<string, string>) {
    const res = await fetch(`https://api.vk.com/method/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    return await res.json();
  }

  // Загрузить картинку (по публичному URL) на серверы VK как фото для сообщения.
  // Возвращает строку вида photo{owner_id}_{id} для attachment.
  async function vkUploadPhoto(token: string, peerId: string, ver: string, imgUrl: string): Promise<string | null> {
    const up = await vk("photos.getMessagesUploadServer", { access_token: token, v: ver, peer_id: String(peerId) });
    const uploadUrl = up.response?.upload_url;
    if (!uploadUrl) { console.error("[ticket-vk] нет upload_url:", JSON.stringify(up.error || up)); return null; }

    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) { console.error("[ticket-vk] не скачал картинку:", imgRes.status, imgUrl); return null; }
    const blob = await imgRes.blob();

    const fd = new FormData();
    fd.append("photo", blob, "shot.jpg");
    const upRes = await fetch(uploadUrl, { method: "POST", body: fd });
    const upData = await upRes.json();
    if (!upData.photo) { console.error("[ticket-vk] аплоад VK без photo:", JSON.stringify(upData)); return null; }

    const saved = await vk("photos.saveMessagesPhoto", {
      access_token: token, v: ver, photo: upData.photo, server: String(upData.server), hash: upData.hash,
    });
    const p = saved.response?.[0];
    if (!p) { console.error("[ticket-vk] saveMessagesPhoto:", JSON.stringify(saved.error || saved)); return null; }
    return `photo${p.owner_id}_${p.id}`;
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
