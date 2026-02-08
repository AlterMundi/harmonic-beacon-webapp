# Meditation Audio Assets

This directory stores meditation audio files on the local development server.

In production, files are stored at `/data/meditations` (bind-mounted volume) and managed via the Provider upload flow in the app.

## Supported Formats
- `.m4a`
- `.mp3`
- `.ogg`

## How It Works

1. Providers upload audio files through the Provider Studio (`/provider/upload`)
2. Admins approve uploads via the Admin Panel (`/admin/moderation`)
3. Approved files are moved to the meditations storage directory
4. The app creates go2rtc streams on-demand via `PUT /api/streams`

Audio files in this directory are `.gitignore`d — they exist only on each environment's storage.
