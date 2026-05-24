import * as PImage from 'pureimage';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = Math.round(size * 1.38);
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= maxHeight) {
      return { size, lines, lineHeight };
    }
  }

  ctx.font = `${minSize}pt ${fontFamily}`;
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = Math.round(minSize * 1.38);
  return { size: minSize, lines, lineHeight };
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
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillText(line, width / 2 + 2, y + 2);
    ctx.fillStyle = 'rgba(22,28,38,0.98)';
    ctx.fillText(line, width / 2, y);
    y += confessionFit.lineHeight;
  }

  if (handleLine) {
    ctx.font = `${handleFontSize}pt ${bodyFont}`;
    const handleY = cardY + cardSize - 62;
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillText(handleLine, width / 2 + 2, handleY + 2);
    ctx.fillStyle = 'rgba(14,65,128,0.98)';
    ctx.fillText(handleLine, width / 2, handleY);
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
