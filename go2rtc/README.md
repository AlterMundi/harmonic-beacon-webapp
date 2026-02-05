# go2rtc Meditation Streaming

This directory contains the go2rtc binary and configuration for streaming meditation audio files via WebRTC.

## Architecture

```
Meditation Files (*.m4a)
  ↓
go2rtc (FFmpeg processing)
  ↓
WebRTC Streams (Opus codec)
  ↓
Next.js API (/api/meditations)
  ↓
Web Client (AudioContext)
```

## Files

- **go2rtc** - Binary executable (v1.9.14)
- **go2rtc.yaml** - Configuration file
- **start.sh** - Startup script
- **README.md** - This file

## Usage

### Start go2rtc

```bash
./start.sh
```

Access web UI at: http://localhost:1984

### Configuration

Streams are created dynamically via the Next.js API. The `go2rtc.yaml` file contains minimal configuration:

- WebRTC on port 8555
- API on port 1984
- Auto-detect external IP via STUN

### API Integration

The Next.js API (`/api/meditations`) manages stream creation:

1. Client requests meditation
2. API calls go2rtc to create FFmpeg stream
3. go2rtc processes meditation file
4. Client connects via WebRTC

### Adding New Meditations

1. Add `.m4a` file to `public/audio/meditations/`
2. Update metadata in `/src/app/api/meditations/route.ts`
3. Restart Next.js dev server
4. Stream will be created automatically when requested

## Ports

- **1984** - go2rtc API and Web UI
- **8555** - WebRTC connections

## Requirements

- FFmpeg (for audio processing)
- Ports 1984 and 8555 available

## Production Deployment

For production, update `go2rtc.yaml`:

```yaml
webrtc:
  candidates:
    - YOUR_SERVER_IP:8555
```

Or use STUN for dynamic IP detection (already configured).
