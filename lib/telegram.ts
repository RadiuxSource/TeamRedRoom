import { generateConfessionImage } from './image';
import FormData from 'form-data';

type TelegramResponse = {
  ok: boolean;
  description?: string;
};

function getTelegramConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_LOG_CHAT_ID;

  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN.");
  }

  if (!chatId) {
    throw new Error("Missing TELEGRAM_LOG_CHAT_ID.");
  }

  return { botToken, chatId };
}

export async function sendTelegramMessage(text: any) {
  const { botToken, chatId } = getTelegramConfig();
  const forwarder = process.env.TELEGRAM_FORWARDER_URL;

  if (forwarder) {
    const resp = await fetch(forwarder.replace(/\/$/, '') + '/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text)
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Forwarder error: ${resp.status} ${body}`);
    }

    return;
  }

  // if no forwarder, send text directly
  // if the caller requested an image, generate and send it via sendPhoto
  if (typeof text === 'object' && (text as any).sendImage) {
    const payload = text as any;
    let generated: any;
    try {
      generated = await generateConfessionImage(payload.confession || payload.adminHtml || payload.html || '', {
        handleBelowConfession: payload.instagramId ? `@${payload.instagramId}` : undefined,
      });
    } catch (err: any) {
      throw new Error(`Image generation failed: ${err?.message ?? String(err)}`);
    }

    const buffer = generated && generated.buffer ? generated.buffer : undefined;
    const s3Url = generated && generated.s3Url ? generated.s3Url : undefined;

    const captionBase = 'SHCS_Tea';
    const caption = s3Url ? `${captionBase}\n${s3Url}` : captionBase;

    // Always send the admin HTML log separately so admins receive the full details
    // (including the instagramId) even when the image itself omits the handle.
    const adminHtml = payload.adminHtml || payload.html;
    if (adminHtml) {
      try {
        const msgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: adminHtml, disable_web_page_preview: true, parse_mode: 'HTML' })
        });

        const msgJson = await msgResp.json().catch(() => ({}));
        if (!msgResp.ok || !(msgJson && (msgJson as any).ok)) {
          const desc = (msgJson && (msgJson as any).description) || '';
          console.warn('Telegram sendMessage (admin log) failed', msgResp.status, desc);
        }
      } catch (err) {
        console.warn('Telegram sendMessage (admin log) threw', err);
      }
    }

    // If we have an S3 URL, prefer telling Telegram to fetch it (faster, avoids re-upload).
    // If that fails (e.g. S3 URL is private), fall back to uploading the image buffer below.
    if (s3Url) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, photo: s3Url, caption, parse_mode: 'HTML' })
        });

        const payloadJson = await resp.json().catch(() => ({}));
        if (resp.ok && payloadJson && (payloadJson as any).ok) {
          return;
        }

        // if sending by URL failed, log and continue to buffer fallback
        console.warn('Telegram sendPhoto by URL failed, falling back to buffer upload', resp.status, payloadJson?.description);
      } catch (err) {
        console.warn('Telegram sendPhoto by URL threw, falling back to buffer upload', err);
      }
    }

    if (!buffer) {
      throw new Error('No image buffer or S3 URL returned from generateConfessionImage');
    }

    const form = new FormData();
    form.append('chat_id', chatId as string);
    form.append('caption', caption);
    form.append('photo', buffer, { filename: 'confession.png', contentType: 'image/png' } as any);

    // Some environments work better when passing a Buffer body instead of a stream
    const headers = (form as any).getHeaders ? (form as any).getHeaders() : {};
    const bufferBody = (form as any).getBuffer ? (form as any).getBuffer() : undefined;
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: bufferBody as any,
      headers
    });

    const respText = await resp.text().catch(() => '');
    let result: any = {};
    try {
      result = JSON.parse(respText || '{}');
    } catch {}
    if (!resp.ok || !result.ok) {
      throw new Error(result.description ?? `Telegram sendPhoto failed ${resp.status}: ${respText}`);
    }

    return;
  }

  const bodyText = typeof text === 'string' ? text : (text && (text as any).html) || String(text);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: bodyText,
      disable_web_page_preview: true,
      parse_mode: 'HTML'
    })
  });

  const payload = (await response.json().catch(() => ({}))) as TelegramResponse;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram API returned status ${response.status}.`);
  }
}