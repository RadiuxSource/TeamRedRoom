import os
from flask import Flask, request, jsonify
import requests
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import tempfile
import textwrap
import os

app = Flask(__name__)

BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
CHAT_ID = os.environ.get('TELEGRAM_LOG_CHAT_ID')

if not BOT_TOKEN or not CHAT_ID:
    app.logger.warning('TELEGRAM_BOT_TOKEN or TELEGRAM_LOG_CHAT_ID not set; forwarder will return 500 until configured')

TELEGRAM_SEND_URL = 'https://api.telegram.org/bot{token}/sendMessage'


def parse_bool(value):
    if value is True:
        return True
    if value is False or value is None:
        return False
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)


@app.route('/forward', methods=['POST'])
def forward():
    if not BOT_TOKEN or not CHAT_ID:
        return jsonify({'error': 'server missing TELEGRAM_BOT_TOKEN or TELEGRAM_LOG_CHAT_ID'}), 500

    data = request.get_json(force=True)

    # support either text-only or structured payloads
    text = data.get('text')
    confession = data.get('confession')
    instagram = data.get('instagramId')
    admin_html = data.get('adminHtml') or data.get('html')
    instagram = (data.get('instagramId') or '').strip().lstrip('@')
    show_instagram = bool(instagram)
    send_image = data.get('sendImage') or data.get('generate_image')

    if admin_html:
        payload = {
            'chat_id': CHAT_ID,
            'text': admin_html,
            'disable_web_page_preview': True,
            'parse_mode': 'HTML'
        }
        resp = requests.post(TELEGRAM_SEND_URL.format(token=BOT_TOKEN), json=payload, timeout=10)
        try:
            resp.raise_for_status()
        except Exception:
            return jsonify({'error': 'telegram admin log error', 'detail': resp.text}), 500

    if send_image:
        # Generate an image (vertical story size)
        width, height = 1080, 1920
        # create gradient background (blue -> orange)
        base = Image.new('RGB', (width, height), '#ffffff')
        draw = ImageDraw.Draw(base)
        for y in range(height):
            # simple linear blend
            t = y / height
            # blue to orange
            r = int((1 - t) * 30 + t * 255)
            g = int((1 - t) * 120 + t * 130)
            b = int((1 - t) * 220 + t * 50)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

        # load font
        font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
        if not os.path.exists(font_path):
            font_path = None

        try:
            title_font = ImageFont.truetype(font_path, 56) if font_path else ImageFont.load_default()
            body_font = ImageFont.truetype(font_path, 48) if font_path else ImageFont.load_default()
        except Exception:
            title_font = ImageFont.load_default()
            body_font = ImageFont.load_default()

        # draw logo if available
        logo_path = os.path.abspath(os.path.join(os.getcwd(), '..', '..', 'public', 'logo.jpg'))
        y_offset = 80
        if os.path.exists(logo_path):
            try:
                logo = Image.open(logo_path).convert('RGBA')
                logo.thumbnail((220, 220))
                lx = (width - logo.width) // 2
                base.paste(logo, (lx, y_offset), logo)
                y_offset += logo.height + 30
            except Exception:
                y_offset += 30
        else:
            y_offset += 20

        # Title is always SHCS_Tea
        name = 'SHCS_Tea'
        w, h = draw.textsize(name, font=title_font)
        draw.text(((width - w) / 2, y_offset), name, font=title_font, fill=(255, 255, 255))
        y_offset += h + 24

        # Confession text - wrap
        max_width = width - 160
        wrapper = textwrap.TextWrapper(width=28)
        text_to_draw = confession or text or ''
        # approximate wrap using font metrics
        lines = []
        words = text_to_draw.split()
        line = ''
        for word in words:
            test = (line + ' ' + word).strip()
            wtest, _ = draw.textsize(test, font=body_font)
            if wtest <= max_width:
                line = test
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)

        for ln in lines[:40]:
            wln, hln = draw.textsize(ln, font=body_font)
            draw.text(((width - wln) / 2, y_offset), ln, font=body_font, fill=(255, 255, 255))
            y_offset += hln + 8

        if show_instagram and instagram:
            handle = f"@{instagram}"
            handle_font = ImageFont.truetype(font_path, 36) if font_path else body_font
            wh, hh = draw.textsize(handle, font=handle_font)
            handle_y = height - hf - 150
            draw.text(((width - wh) / 2, handle_y), handle, font=handle_font, fill=(14, 65, 128))

        # footer timestamp
        import datetime
        ts = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
        footer = f"{ts}"
        wf, hf = draw.textsize(footer, font=title_font)
        draw.text(((width - wf) / 2, height - hf - 80), footer, font=title_font, fill=(255, 255, 255))

        # save to temp file
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
        base.convert('RGB').save(tmp.name, format='JPEG', quality=90)
        tmp.flush()

        # send as photo
        files = {'photo': open(tmp.name, 'rb')}
        data = {'chat_id': CHAT_ID, 'caption': 'SHCS_Tea'}
        resp = requests.post('https://api.telegram.org/bot{}/sendPhoto'.format(BOT_TOKEN), data=data, files=files)

        try:
            resp.raise_for_status()
        except Exception:
            detail = resp.text
            return jsonify({'error': 'telegram photo error', 'detail': detail}), 500

        return jsonify({'ok': True})

    # fallback: text-only
    if not text:
        return jsonify({'error': 'missing text field'}), 400

    payload = {
        'chat_id': CHAT_ID,
        'text': text,
        'disable_web_page_preview': True,
        'parse_mode': 'HTML'
    }

    resp = requests.post(TELEGRAM_SEND_URL.format(token=BOT_TOKEN), json=payload, timeout=10)

    try:
        resp.raise_for_status()
    except Exception as e:
        return jsonify({'error': 'telegram error', 'detail': resp.text}), 500

    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))