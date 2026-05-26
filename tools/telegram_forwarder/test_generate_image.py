from PIL import Image, ImageDraw, ImageFont
import os

def find_font():
    candidates = [
        '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
        '/usr/share/fonts/truetype/emoji/NotoColorEmoji.ttf',
        '/usr/share/fonts/truetype/seguiemj/SegoeUIEmoji.ttf',
        '/usr/share/fonts/truetype/SegoeUIEmoji.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def generate(text, outpath='emoji_test.jpg'):
    width, height = 1080, 720
    img = Image.new('RGB', (width, height), (30, 30, 30))
    draw = ImageDraw.Draw(img)

    font_path = find_font()
    if font_path:
        try:
            font = ImageFont.truetype(font_path, 56)
        except Exception:
            font = ImageFont.load_default()
    else:
        font = ImageFont.load_default()

    lines = text.split('\n')
    y = 60
    for line in lines:
        w, h = draw.textsize(line, font=font)
        draw.text(((width - w) / 2, y), line, font=font, fill=(255, 255, 255))
        y += h + 16

    img.save(outpath, quality=90)
    print('Wrote', outpath)


if __name__ == '__main__':
    sample = 'Hello world! 🌟🚀\nEmoji test: 👍❤️😂'
    out = os.path.join(os.path.dirname(__file__), 'emoji_test.jpg')
    generate(sample, out)
