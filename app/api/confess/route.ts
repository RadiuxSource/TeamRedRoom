import { NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

type ConfessionRequest = {
  confession?: unknown;
  instagramId?: unknown;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeInstagramId(value: unknown): string {
  const raw = normalizeText(value);

  if (!raw) {
    return "";
  }

  const cleaned = raw.replace(/^@+/, "");
  return cleaned.replace(/\s+/g, "");
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export async function POST(request: Request) {
  let body: ConfessionRequest;

  try {
    body = (await request.json()) as ConfessionRequest;
  } catch {
    return NextResponse.json({ message: "The request body must be valid JSON." }, { status: 400 });
  }

  const confession = normalizeText(body.confession);
  const instagramId = normalizeInstagramId(body.instagramId);
  if (!confession) {
    return NextResponse.json({ message: "Write a confession before sending it." }, { status: 400 });
  }

  if (confession.length > 4000) {
    return NextResponse.json({ message: "The confession is too long for the Telegram template." }, { status: 400 });
  }

  function escapeHtml(str: string) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const now = new Date().toUTCString();
  const showHandleInImage = Boolean(instagramId);

  // Compact NGL-like admin HTML
  const html: string[] = [];
  html.push(`📨 <b>SHCS_Tea</b>`);
  html.push(`<i>New confession — SHCS_Tea</i>`);
  html.push(`<pre>${escapeHtml(confession)}</pre>`);
  html.push(`<i>Instagram: ${instagramId ? escapeHtml(`@${instagramId}`) : '—'} • ${escapeHtml(now)}</i>`);

  const messagePayload = html.join("\n");

  try {
    // Request forwarder to generate an image and post it
    await sendTelegramMessage({
      adminHtml: messagePayload,
      confession,
      instagramId,
      showInstagramId: showHandleInImage,
      sendImage: true
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Telegram error.";
    return NextResponse.json({ message: `Telegram forwarding failed: ${reason}` }, { status: 500 });
  }

  return NextResponse.json({ message: "Confession sent to Telegram." });
}