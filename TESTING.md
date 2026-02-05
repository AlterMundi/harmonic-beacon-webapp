# Testing go2rtc + Next.js Integration

## Quick Start

### 1. Start go2rtc

```bash
cd go2rtc
./start.sh
```

You should see:
```
Starting go2rtc...
Web UI: http://localhost:1984
WebRTC: port 8555
```

### 2. Verify go2rtc is running

Open http://localhost:1984 in your browser. You should see the go2rtc web interface.

### 3. Start Next.js dev server

In a new terminal:

```bash
npm run dev
```

### 4. Test the integration

1. Open http://localhost:3000/meditation
2. Click on any meditation (e.g., "La Mosca")
3. Check browser console for logs:
   - "✓ Received meditation audio track from go2rtc"
   - "✓ Meditation playing via go2rtc"
   - "✓ WebRTC connection established with go2rtc"

## API Testing

### List meditations

```bash
curl http://localhost:3000/api/meditations
```

Expected response:
```json
{
  "meditations": [
    {
      "id": "amor",
      "name": "El Amor",
      "fileName": "amor.m4a",
      "streamName": "meditation-amor"
    },
    ...
  ]
}
```

### Create a meditation stream

```bash
curl -X POST http://localhost:3000/api/meditations \
  -H "Content-Type: application/json" \
  -d '{"meditationId": "amor"}'
```

Expected response:
```json
{
  "success": true,
  "streamName": "meditation-amor",
  "meditationId": "amor",
  "name": "El Amor"
}
```

### Verify stream in go2rtc

```bash
curl http://localhost:1984/api/streams
```

You should see `meditation-amor` in the list.

## Troubleshooting

### go2rtc not starting

- Check if port 1984 or 8555 is already in use
- Verify FFmpeg is installed: `ffmpeg -version`

### No audio playing

- Check browser console for errors
- Verify meditation files exist in `public/audio/meditations/`
- Check go2rtc logs for FFmpeg errors

### WebRTC connection fails

- Check if ports 8555 (WebRTC) and 1984 (API) are accessible
- Try disabling browser extensions
- Check CORS settings

## Architecture Flow

```
User clicks meditation
  ↓
Next.js calls /api/meditations (POST)
  ↓
API calls go2rtc to create FFmpeg stream
  ↓
go2rtc starts streaming meditation file
  ↓
Client fetches WebRTC offer from go2rtc
  ↓
Client establishes WebRTC connection
  ↓
Audio plays in browser
```

## Next Steps

- [ ] Test all three meditation files
- [ ] Verify beacon + meditation play simultaneously
- [ ] Test audio mix slider
- [ ] Check performance/resource usage
- [ ] Deploy to production server
