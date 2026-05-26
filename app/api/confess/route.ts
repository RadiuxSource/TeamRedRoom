import { NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

type ConfessionRequest = {
  confession?: unknown;
  instagramId?: unknown;
};

// Process heavy Telegram/image work off the request path to keep API responses fast.
let forwardQueue: Promise<void> = Promise.resolve();

function enqueueTelegramForward(payload: {
  adminHtml: string;
  confession: string;
  instagramId: string;
  sendImage: boolean;
}) {
  forwardQueue = forwardQueue
    .then(async () => {
      await sendTelegramMessage(payload);
    })
    .catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[confess] Background forward failed:", reason);
    });
}

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

  // Compact NGL-like admin HTML
  const html: string[] = [];
  html.push(`📨 <b>SHCS_Tea</b>`);
  html.push(`<i>New confession — SHCS_Tea</i>`);
  html.push(`<pre>${escapeHtml(confession)}</pre>`);
  html.push(`<i>Instagram: ${instagramId ? escapeHtml(`@${instagramId}`) : '—'} • ${escapeHtml(now)}</i>`);

  const messagePayload = html.join("\n");

  // Queue forwarding work and return immediately for a fast UX.
  enqueueTelegramForward({
    adminHtml: messagePayload,
    confession,
    instagramId,
    sendImage: true,
  });

  return NextResponse.json({ message: "Confession received. Processing now." }, { status: 202 });
}