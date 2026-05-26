import * as PImage from 'pureimage';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

type RichToken = {
  kind: 'text' | 'space' | 'emoji' | 'newline';
  value: string;
};

const TWEMOJI_BASE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const emojiBitmapCache = new Map<string, Promise<any | null>>();

function isEmojiCluster(cluster: string) {
  return /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{20E3}\u{FE0F}\u{200D}]/u.test(cluster);
}

function toEmojiCodePointString(emoji: string) {
  return Array.from(emoji)
    .map((character) => character.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .join('-');
}

function tokenizeRichText(text: string): RichToken[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const tokens: RichToken[] = [];
  let textBuffer = '';

  const flushText = () => {
    if (textBuffer) {
      tokens.push({ kind: 'text', value: textBuffer });
      textBuffer = '';
    }
  };

  for (const { segment } of segmenter.segment(text)) {
    if (segment === '\n') {
      flushText();
      tokens.push({ kind: 'newline', value: segment });
      continue;
    }

    if (/^\s+$/u.test(segment)) {
      flushText();
      tokens.push({ kind: 'space', value: segment });
      continue;
    }

    if (isEmojiCluster(segment)) {
      flushText();
      tokens.push({ kind: 'emoji', value: segment });
      continue;
    }

    textBuffer += segment;
  }

  flushText();
  return tokens;
}

function measureTokenWidth(ctx: any, token: RichToken, fontSize: number) {
  if (token.kind === 'emoji') {
    return Math.round(fontSize * 1.15);
  }

  return ctx.measureText(token.value).width;
}

function wrapRichText(ctx: any, text: string, maxWidth: number, fontSize: number) {
  const tokens = tokenizeRichText(text);
  const lines: RichToken[][] = [];
  let currentLine: RichToken[] = [];
  let currentWidth = 0;

  const commitLine = () => {
    while (currentLine.length && currentLine[0].kind === 'space') {
      currentLine.shift();
    }

    while (currentLine.length && currentLine[currentLine.length - 1].kind === 'space') {
      currentLine.pop();
    }

    lines.push(currentLine);
    currentLine = [];
    currentWidth = 0;
  };

  for (const token of tokens) {
    if (token.kind === 'newline') {
      commitLine();
      continue;
    }

    if (token.kind === 'space' && currentLine.length === 0) {
      continue;
    }

    const tokenWidth = measureTokenWidth(ctx, token, fontSize);

    if (currentLine.length > 0 && currentWidth + tokenWidth > maxWidth) {
      commitLine();
      if (token.kind === 'space') {
        continue;
      }
    }

    currentLine.push(token);
    currentWidth += tokenWidth;
  }

  if (currentLine.length) {
    commitLine();
  }

  return lines;
}

async function loadEmojiBitmap(emoji: string) {
  const codePointString = toEmojiCodePointString(emoji);

  if (!codePointString) {
    return null;
  }

  if (!emojiBitmapCache.has(codePointString)) {
    emojiBitmapCache.set(
      codePointString,
      (async () => {
        try {
          const response = await fetch(`${TWEMOJI_BASE_URL}/${codePointString}.png`);
          if (!response.ok) {
            return null;
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          return await PImage.decodePNGFromStream(Readable.from([buffer]) as any);
        } catch (error) {
          console.warn('Emoji bitmap load failed', error);
          return null;
        }
      })()
    );
  }

  return emojiBitmapCache.get(codePointString) as Promise<any | null>;
}

function wrapText(ctx: any, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

function fitSingleLineFontSize(
  ctx: any,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  fontFamily: string,
) {
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `${size}pt ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }
  }

  return minSize;
}

function fitWrappedFontSize(
  ctx: any,
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxSize: number,
  minSize: number,
  fontFamily: string,
) {
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `${size}pt ${fontFamily}`;
    const lines = wrapRichText(ctx, text, maxWidth, size);
    const lineHeight = Math.round(Math.max(size * 1.38, size * 1.22));
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= maxHeight) {
      return { size, lines, lineHeight };
    }
  }

  ctx.font = `${minSize}pt ${fontFamily}`;
  const lines = wrapRichText(ctx, text, maxWidth, minSize);
  const lineHeight = Math.round(Math.max(minSize * 1.38, minSize * 1.22));
  return { size: minSize, lines, lineHeight };
}

async function drawRichLine(
  ctx: any,
  line: RichToken[],
  x: number,
  baselineY: number,
  fontSize: number,
  fontFamily: string,
) {
  const emojiSize = Math.round(fontSize * 1.15);
  let cursorX = x;

  for (const token of line) {
    if (token.kind === 'emoji') {
      const bitmap = await loadEmojiBitmap(token.value);

      if (bitmap) {
        ctx.drawImage(
          bitmap,
          0,
          0,
          bitmap.width,
          bitmap.height,
          cursorX,
          baselineY - Math.round(emojiSize * 0.82),
          emojiSize,
          emojiSize
        );
        cursorX += emojiSize;
        continue;
      }
    }

    ctx.font = `${fontSize}pt ${fontFamily}`;

    if (token.kind === 'space') {
      cursorX += ctx.measureText(token.value).width;
      continue;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillText(token.value, cursorX + 2, baselineY + 2);
    ctx.fillStyle = 'rgba(22,28,38,0.98)';
    ctx.fillText(token.value, cursorX, baselineY);
    cursorX += ctx.measureText(token.value).width;
  }
}

function drawRoundedCard(
  ctx: any,
  x: number,
  y: number,
  size: number,
  radius: number,
  fillStyle: string | any,
  strokeStyle: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = strokeStyle;
  ctx.stroke();
  ctx.restore();
}

type ImageOptions = {
  handleBelowConfession?: string;
};

export async function generateConfessionImage(confession: string, options: ImageOptions = {}) {
  const width = 1080;
  const height = 1920;
  const img = PImage.make(width, height);
  const ctx = img.getContext('2d');

  // gradient blue -> orange
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const r = Math.round((1 - t) * 30 + t * 255);
    const g = Math.round((1 - t) * 120 + t * 130);
    const b = Math.round((1 - t) * 220 + t * 50);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, width, 1);
  }

  // load font if available and wait for it to be usable
  const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  let titleFont = 'Sans';
  let bodyFont = 'Sans';
  try {
    const fs = require('fs');
    const exists = fs.existsSync(fontPath);
    if (exists) {
      const reg = (PImage as any).registerFont(fontPath, 'DejaVu');
      try {
        // Attempt to load font but don't hang indefinitely — use timeout fallback
        await Promise.race([
          new Promise<void>((resolve) => {
            try {
              (reg as any).load(() => resolve());
            } catch (err) {
              resolve();
            }
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 1500))
        ]);
        titleFont = 'DejaVu';
        bodyFont = 'DejaVu';
      } catch (e) {}
    }
  } catch (e) {
    // ignore and fall back to default
  }

  const cardSize = 820;
  const cardX = Math.round((width - cardSize) / 2);
  const cardY = Math.round((height - cardSize) / 2);
  const cardRadius = 64;

  const shadowColor = 'rgba(0,0,0,0.28)';
  drawRoundedCard(
    ctx,
    cardX + 14,
    cardY + 18,
    cardSize,
    cardRadius,
    'rgba(0,0,0,0.18)',
    'rgba(0,0,0,0)'
  );

  const cardGradient = ctx.createLinearGradient(cardX, cardY, cardX + cardSize, cardY + cardSize);
  (cardGradient as any).addColorStop(0, 'rgba(255,255,255,0.96)');
  (cardGradient as any).addColorStop(1, 'rgba(255,246,229,0.94)');
  drawRoundedCard(ctx, cardX, cardY, cardSize, cardRadius, cardGradient, 'rgba(255,255,255,0.65)');

  const headline = 'SHCS_Tea';
  const titleMaxWidth = cardSize - 120;
  const titleMaxSize = 78;
  const titleMinSize = 40;
  const titleSize = fitSingleLineFontSize(ctx, headline, titleMaxWidth, titleMaxSize, titleMinSize, titleFont);
  ctx.font = `${titleSize}pt ${titleFont}`;

  // draw name with subtle shadow for readability
  ctx.textAlign = 'center';
  ctx.fillStyle = shadowColor;
  ctx.fillText(headline, width / 2 + 5, cardY + 112 + 5);
  ctx.fillStyle = 'rgba(29,42,68,0.98)';
  ctx.fillText(headline, width / 2, cardY + 112);

  // draw confession text using a size that fits both width and height
  const textMaxWidth = cardSize - 120;
  const textTop = cardY + 190;
  const handleLine = options.handleBelowConfession ? options.handleBelowConfession.trim() : '';
  const footerReserve = handleLine ? 130 : 90;
  const textBottomPadding = 110 + footerReserve;
  const maxTextHeight = cardSize - 190 - textBottomPadding;
  const confessionFit = fitWrappedFontSize(ctx, confession, textMaxWidth, maxTextHeight, 44, 24, bodyFont);
  ctx.font = `${confessionFit.size}pt ${bodyFont}`;
  const confessionLines = confessionFit.lines;
  const handleFontSize = handleLine ? Math.max(24, Math.min(34, Math.floor(confessionFit.size * 0.88))) : 0;
  const handleLineHeight = handleLine ? Math.round(handleFontSize * 1.2) : 0;
  const contentHeight = confessionLines.length * confessionFit.lineHeight + (handleLine ? handleLineHeight : 0);
  const confessionStartY = textTop + Math.max(0, Math.floor((maxTextHeight - contentHeight) / 3));

  let y = confessionStartY;
  for (const line of confessionLines) {
    const lineWidth = line.reduce((total, token) => total + measureTokenWidth(ctx, token, confessionFit.size), 0);
    const startX = width / 2 - lineWidth / 2;
    await drawRichLine(ctx, line, startX, y, confessionFit.size, bodyFont);
    y += confessionFit.lineHeight;
  }

  if (handleLine) {
    const handleTokens = wrapRichText(ctx, handleLine, textMaxWidth, handleFontSize)[0] || [];
    const handleWidth = handleTokens.reduce((total, token) => total + measureTokenWidth(ctx, token, handleFontSize), 0);
    const startX = width / 2 - handleWidth / 2;
    const handleY = cardY + cardSize - 62;
    await drawRichLine(ctx, handleTokens, startX, handleY, handleFontSize, bodyFont);
  }

  // encode to PNG via a temp file and read buffer
  const tmpPath = '/tmp/confession_out.png';
  await new Promise((resolve, reject) => {
    const fs = require('fs');
    const out = fs.createWriteStream(tmpPath);
    PImage.encodePNGToStream(img, out).then(() => {
      out.end();
      resolve(true);
    }).catch((err: any) => {
      reject(err);
    });
  });

  const buffer = require('fs').readFileSync(tmpPath);
  try {
    const outPath = require('path').join(process.cwd(), 'public', 'last_confession.png');
    require('fs').writeFileSync(outPath, buffer);
  } catch (e) {
    // ignore write errors
  }
  // Optionally upload to S3 if configured
  const bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET;
  let s3Url: string | undefined = undefined;
  if (bucket) {
    try {
      const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
      const endpoint = process.env.S3_ENDPOINT; // optional custom endpoint
      const accessKeyId = process.env.S3_KEY || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY;

      const s3client = new S3Client({
        region,
        endpoint: endpoint || undefined,
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
      });

      const keyPrefix = process.env.S3_PREFIX ? `${process.env.S3_PREFIX.replace(/\/+$/,'')}/` : '';
      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `${keyPrefix}confessions/${stamp}_${rand}.png`;

      const putParams: any = {
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/png',
      };
      if (process.env.S3_ACL) putParams.ACL = process.env.S3_ACL;

      const put = new PutObjectCommand(putParams);
      await s3client.send(put);

      if (endpoint) {
        s3Url = `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
      } else {
        s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
      }
      // also write the S3 URL to public/last_confession_url.txt for convenience
      try { require('fs').writeFileSync(require('path').join(process.cwd(), 'public', 'last_confession_url.txt'), s3Url); } catch (e) {}
    } catch (e) {
      // ignore S3 upload errors but keep local buffer
      console.warn('S3 upload failed', e);
    }
  }

  return { buffer, s3Url };
}
