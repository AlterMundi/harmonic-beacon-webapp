# go2rtc Local Development

Local go2rtc setup for meditation streaming during development.

## Prerequisites

- [go2rtc](https://github.com/AlexxIT/go2rtc/releases) binary (v1.9.14+)
- FFmpeg installed (`sudo apt install ffmpeg`)

## Setup

1. Download go2rtc binary:
```bash
wget -O go2rtc https://github.com/AlexxIT/go2rtc/releases/download/v1.9.14/go2rtc_linux_amd64
chmod +x go2rtc
```

2. Start go2rtc:
```bash
cd go2rtc
./go2rtc
```

3. In another terminal, start Next.js:
```bash
npm run dev
```

## Configuration

`go2rtc.yaml` has pre-configured streams pointing to `../public/audio/meditations/`:

| Stream | File |
|--------|------|
| meditation-amor | amor.m4a |
| meditation-humanosfera | humanosfera.m4a |
| meditation-la_mosca | la_mosca.m4a |

## Ports

- **1984** - go2rtc API + Web UI (http://localhost:1984)
- **8555** - WebRTC connections

## Testing

1. Open http://localhost:3000/meditation
2. Click any meditation card
3. Browser console should show:
   - "Received meditation audio track from go2rtc"
   - "WebRTC connection established with go2rtc"

## Notes

- The binary is `.gitignore`d - download it locally
- In production, go2rtc runs in Docker (see `deploy/go2rtc/`)
- Production uses pre-transcoded `.ogg` files with `#audio=copy`; dev uses runtime FFmpeg with `#audio=opus`
