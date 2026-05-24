# TeamRedRoom

Saint Hood Convent Tea and Confessions is a Next.js confession page that forwards submissions to Telegram.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env.local` file with your Telegram settings:

```bash
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_LOG_CHAT_ID=your-log-group-chat-id
# Optional: forwarder URL (e.g. http://localhost:5000)
TELEGRAM_FORWARDER_URL=
```

3. Run the app with `npm run dev`.

## Branding

Drop a logo at `public/logo.jpg` and the page will use it automatically. If the file is not present, the page falls back to a text badge.

## Notes

- Instagram ID is optional.
- The story-line display toggle controls whether the handle is shown publicly in the Telegram template.
- Submissions are forwarded to Telegram. If delivery to the group is unreliable, run the optional Python forwarder (below) and set `TELEGRAM_FORWARDER_URL` in `.env.local`.

## Optional Python forwarder

If Telegram messages are not being delivered reliably from Node/Next, you can run a small Python forwarder service which will accept POSTs and deliver them to Telegram. Start it with:

```bash
cd tools/telegram_forwarder
python3 -m pip install -r requirements.txt
export TELEGRAM_BOT_TOKEN=your-bot-token
export TELEGRAM_LOG_CHAT_ID=your-log-group-chat-id
python app.py
```

Then set `TELEGRAM_FORWARDER_URL` in `.env.local` to `http://localhost:5000` and restart the Next.js app.