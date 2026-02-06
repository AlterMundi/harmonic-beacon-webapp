# Testing go2rtc + Next.js Integration

## Quick Start

### 1. Start go2rtc

```bash
cd go2rtc
# Download binary if not present
wget -O go2rtc https://github.com/AlexxIT/go2rtc/releases/download/v1.9.14/go2rtc_linux_amd64
chmod +x go2rtc
./go2rtc
```

Verify at http://localhost:1984 - you should see the go2rtc web interface.

### 2. Start Next.js dev server

```bash
npm run dev
```

### 3. Test the integration

1. Open http://localhost:3000/meditation
2. Click on any meditation (e.g., "La Mosca")
3. Check browser console for:
   - "Received meditation audio track from go2rtc"
   - "Meditation playing via go2rtc"
   - "WebRTC connection established with go2rtc"

## API Testing

### List meditations

```bash
curl http://localhost:3000/api/meditations
```

### Create a meditation stream

```bash
curl -X POST http://localhost:3000/api/meditations \
  -H "Content-Type: application/json" \
  -d '{"meditationId": "amor"}'
```

### Verify stream in go2rtc

```bash
curl http://localhost:1984/api/streams
```

## Docker Testing

```bash
# Build and start both services
docker compose build
docker compose up -d

# Verify health
curl -f http://localhost:3003
curl -f http://127.0.0.1:1984/api

# Check streams
curl http://127.0.0.1:1984/api/streams

# View logs
docker compose logs -f
```

## Troubleshooting

### go2rtc not starting
- Check if port 1984 or 8555 is in use: `lsof -i :1984`
- Verify FFmpeg is installed: `ffmpeg -version`

### No audio playing
- Check browser console for errors
- Verify meditation files exist in `public/audio/meditations/`
- Check go2rtc logs for FFmpeg errors

### WebRTC connection fails
- Check ports 8555 (WebRTC) and 1984 (API) are accessible
- Check CORS settings in `go2rtc.yaml`
