import {
  Room,
  RoomEvent,
  RemoteParticipant,
  AudioSource,
  AudioFrame,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { spawn, execSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://live.altermundi.net';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';
const BOT_IDENTITY = process.env.BOT_IDENTITY || 'playlist-bot';
const RECORDS_PATH = process.env.BEACON_RECORDS_PATH || '/data/beacon-records';
const BEACON_IDENTITY = 'beacon01';

const SAMPLE_RATE = 48000;
const NUM_CHANNELS = 1;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * NUM_CHANNELS * 2; // 1920

const CROSSFADE_DURATION_MS = 2000;
const CROSSFADE_FRAMES = CROSSFADE_DURATION_MS / FRAME_DURATION_MS; // 100

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RESCAN_INTERVAL_MS = 30000;
const HEARTBEAT_PATH = '/tmp/playlist-bot-heartbeat';
const HEARTBEAT_INTERVAL_MS = 15000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`, ...args);
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

async function createBotToken(): Promise<string> {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: BOT_IDENTITY,
    name: 'Playlist Bot',
    ttl: '24h',
  });

  token.addGrant({
    roomJoin: true,
    room: ROOM_NAME,
    canPublish: true,
    canSubscribe: false,
  });

  return token.toJwt();
}

// ---------------------------------------------------------------------------
// Playlist scanner
// ---------------------------------------------------------------------------

function scanPlaylist(): string[] {
  if (!existsSync(RECORDS_PATH)) {
    log('WARN', `Records path does not exist: ${RECORDS_PATH}`);
    return [];
  }

  const files = readdirSync(RECORDS_PATH)
    .filter((f) => f.endsWith('.ogg'))
    .sort()
    .map((f) => join(RECORDS_PATH, f));

  log('INFO', `Playlist scanned: ${files.length} file(s)`);
  return files;
}

// ---------------------------------------------------------------------------
// FFmpeg audio decoder
// ---------------------------------------------------------------------------

function spawnDecoder(filePath: string) {
  log('INFO', `Decoding: ${filePath}`);
  return spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      '-f', 's16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(NUM_CHANNELS),
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

// ---------------------------------------------------------------------------
// Main bot
// ---------------------------------------------------------------------------

class PlaylistBot {
  private room: Room | null = null;
  private source: AudioSource | null = null;
  private track: LocalAudioTrack | null = null;

  private beaconPresent = false;
  private shouldPublish = false;
  private publishGeneration = 0; // incremented on each start; stale loops exit
  private abortController: AbortController | null = null;

  // Crossfade volume: 1.0 = full, 0.0 = silent
  private volume = 1.0;
  private fadeDirection: 'in' | 'out' | null = null;
  private fadeFramesRemaining = 0;
  private fadeTotalFrames = 0;

  private shuttingDown = false;

  async start(): Promise<void> {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      log('ERROR', 'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
      process.exit(1);
    }

    try {
      execSync('which ffmpeg', { stdio: 'ignore' });
    } catch {
      log('ERROR', 'ffmpeg not found in PATH — install ffmpeg to decode audio files');
      process.exit(1);
    }

    log('INFO', `Playlist bot starting — room=${ROOM_NAME}, identity=${BOT_IDENTITY}`);
    log('INFO', `Records path: ${RECORDS_PATH}`);

    this.setupSignalHandlers();

    // Heartbeat file for Docker healthcheck
    const writeHeartbeat = () => {
      try { writeFileSync(HEARTBEAT_PATH, Date.now().toString()); } catch { /* ignore */ }
    };
    writeHeartbeat();
    setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

    await this.connectWithRetry();
  }

  // -------------------------------------------------------------------------
  // Connection & reconnection
  // -------------------------------------------------------------------------

  private async connectWithRetry(): Promise<void> {
    let attempt = 0;

    while (!this.shuttingDown) {
      try {
        await this.connect();
        attempt = 0;
        // Connection lost — loop will reconnect
      } catch (err) {
        attempt++;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        log('WARN', `Connection attempt ${attempt} failed, retrying in ${delay}ms`, err);
        await sleep(delay);
      }
    }
  }

  private async connect(): Promise<void> {
    const token = await createBotToken();

    this.room = new Room();
    this.setupRoomEvents();

    log('INFO', 'Connecting to LiveKit...');
    await this.room.connect(LIVEKIT_URL, token, {
      autoSubscribe: false,
      dynacast: true,
    });
    log('INFO', `Connected to room: ${this.room.name}`);

    // Create audio source and track
    this.source = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
    this.track = LocalAudioTrack.createAudioTrack('playlist-audio', this.source);

    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;

    await this.room.localParticipant!.publishTrack(this.track, opts);
    log('INFO', 'Audio track published');

    // Check if beacon01 is already in the room
    this.beaconPresent = this.isBeaconInRoom();
    log('INFO', `beacon01 present: ${this.beaconPresent}`);

    if (!this.beaconPresent) {
      this.startPublishing();
    } else {
      // Mute — beacon is live
      this.volume = 0;
    }

    // Wait for disconnect
    await new Promise<void>((resolve) => {
      this.room!.on(RoomEvent.Disconnected, async () => {
        log('WARN', 'Disconnected from room');
        this.stopPublishing();

        // Close native resources before releasing references
        try { await this.source?.close(); } catch { /* ignore */ }

        this.room = null;
        this.source = null;
        this.track = null;
        resolve();
      });
    });
  }

  private setupRoomEvents(): void {
    if (!this.room) return;

    this.room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      log('INFO', `Participant joined: ${p.identity}`);
      if (p.identity === BEACON_IDENTITY) {
        this.beaconPresent = true;
        this.onBeaconPresenceChanged();
      }
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      log('INFO', `Participant left: ${p.identity}`);
      if (p.identity === BEACON_IDENTITY) {
        this.beaconPresent = false;
        this.onBeaconPresenceChanged();
      }
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      log('WARN', 'Reconnecting...');
    });

    this.room.on(RoomEvent.Reconnected, () => {
      log('INFO', 'Reconnected');
      // Re-check beacon presence
      this.beaconPresent = this.isBeaconInRoom();
      this.onBeaconPresenceChanged();
    });
  }

  private isBeaconInRoom(): boolean {
    if (!this.room) return false;
    for (const [, p] of this.room.remoteParticipants) {
      if (p.identity === BEACON_IDENTITY) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Beacon presence → publish/stop decision
  // -------------------------------------------------------------------------

  private onBeaconPresenceChanged(): void {
    if (this.beaconPresent) {
      log('INFO', 'beacon01 is LIVE — fading out playlist');
      this.startFade('out');
    } else {
      log('INFO', 'beacon01 OFFLINE — fading in playlist');
      if (!this.shouldPublish) {
        this.volume = 0;
        this.startPublishing();
      }
      this.startFade('in');
    }
  }

  // -------------------------------------------------------------------------
  // Crossfade
  // -------------------------------------------------------------------------

  private startFade(direction: 'in' | 'out'): void {
    this.fadeDirection = direction;
    // Scale duration based on current volume to avoid discontinuity on interruption
    if (direction === 'in') {
      this.fadeTotalFrames = Math.max(1, Math.round((1 - this.volume) * CROSSFADE_FRAMES));
    } else {
      this.fadeTotalFrames = Math.max(1, Math.round(this.volume * CROSSFADE_FRAMES));
    }
    this.fadeFramesRemaining = this.fadeTotalFrames;
  }

  private applyFade(samples: Int16Array): void {
    if (!this.fadeDirection || this.fadeFramesRemaining <= 0) {
      // Apply static volume
      if (this.volume < 1.0) {
        scaleSamples(samples, this.volume);
      }
      return;
    }

    const progress = 1 - this.fadeFramesRemaining / this.fadeTotalFrames;

    if (this.fadeDirection === 'in') {
      // Lerp from current start volume toward 1.0
      const startVol = 1 - this.fadeTotalFrames / CROSSFADE_FRAMES;
      this.volume = startVol + progress * (1 - startVol);
    } else {
      // Lerp from current start volume toward 0.0
      const startVol = this.fadeTotalFrames / CROSSFADE_FRAMES;
      this.volume = startVol * (1 - progress);
    }

    scaleSamples(samples, this.volume);
    this.fadeFramesRemaining--;

    if (this.fadeFramesRemaining <= 0) {
      if (this.fadeDirection === 'out') {
        this.volume = 0;
        // After fade-out completes, stop the publishing loop
        this.stopPublishing();
      } else {
        this.volume = 1;
      }
      this.fadeDirection = null;
    }
  }

  // -------------------------------------------------------------------------
  // Audio publishing loop
  // -------------------------------------------------------------------------

  private startPublishing(): void {
    if (this.shouldPublish) return;
    this.shouldPublish = true;
    this.publishGeneration++;
    const gen = this.publishGeneration;
    this.abortController = new AbortController();

    this.publishLoop(this.abortController.signal, gen).catch((err) => {
      if (!this.shuttingDown) {
        log('ERROR', 'Publish loop error', err);
      }
    });
  }

  private stopPublishing(): void {
    this.shouldPublish = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async publishLoop(signal: AbortSignal, generation: number): Promise<void> {
    log('INFO', 'Publish loop started');

    while (this.shouldPublish && !signal.aborted && generation === this.publishGeneration) {
      const playlist = scanPlaylist();

      if (playlist.length === 0) {
        log('WARN', 'No .ogg files found, waiting...');
        await sleep(RESCAN_INTERVAL_MS);
        continue;
      }

      for (const file of playlist) {
        if (!this.shouldPublish || signal.aborted || generation !== this.publishGeneration) break;
        await this.publishFile(file, signal);
      }
    }

    log('INFO', 'Publish loop ended');
  }

  private async publishFile(filePath: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.source) return;

    const ffmpeg = spawnDecoder(filePath);
    const onAbort = () => ffmpeg.kill('SIGTERM');
    signal.addEventListener('abort', onAbort, { once: true });

    ffmpeg.stderr!.on('data', (data: Buffer) => {
      log('WARN', `ffmpeg: ${data.toString().trim()}`);
    });

    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of ffmpeg.stdout!) {
        if (!this.shouldPublish || signal.aborted || !this.source) {
          ffmpeg.kill('SIGTERM');
          break;
        }

        buffer = Buffer.concat([buffer, chunk as Buffer]);

        while (buffer.length >= BYTES_PER_FRAME) {
          if (!this.shouldPublish || signal.aborted || !this.source) {
            ffmpeg.kill('SIGTERM');
            return;
          }

          // Copy frame bytes into a fresh buffer to guarantee 2-byte alignment
          const frameBuffer = Buffer.from(buffer.subarray(0, BYTES_PER_FRAME));
          buffer = buffer.subarray(BYTES_PER_FRAME);

          // View as Int16 samples (alignment guaranteed by Buffer.from copy)
          const frameSamples = new Int16Array(
            frameBuffer.buffer,
            frameBuffer.byteOffset,
            SAMPLES_PER_FRAME * NUM_CHANNELS,
          );
          this.applyFade(frameSamples);

          const frame = new AudioFrame(
            frameSamples,
            SAMPLE_RATE,
            NUM_CHANNELS,
            SAMPLES_PER_FRAME,
          );

          try {
            await this.source.captureFrame(frame);
          } catch {
            ffmpeg.kill('SIGTERM');
            return;
          }
        }
      }
    } catch (err) {
      // Stream error (e.g. ffmpeg crashed)
      if (!signal.aborted) {
        log('WARN', `Stream error for ${filePath}`, err);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    // Wait for ffmpeg to exit
    await new Promise<void>((resolve) => {
      if (ffmpeg.exitCode !== null) {
        resolve();
        return;
      }
      ffmpeg.on('close', (code: number | null) => {
        if (code !== 0 && code !== null && !signal.aborted) {
          log('WARN', `ffmpeg exited with code ${code} for ${filePath}`);
        }
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  private setupSignalHandlers(): void {
    const shutdown = async () => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      log('INFO', 'Shutting down...');

      this.stopPublishing();

      try { await this.source?.close(); } catch { /* ignore */ }

      if (this.room) {
        try {
          await this.room.disconnect();
        } catch {
          // ignore
        }
      }

      await dispose();
      log('INFO', 'Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scaleSamples(samples: Int16Array, volume: number): void {
  if (volume === 0) {
    samples.fill(0);
    return;
  }
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(samples[i] * volume);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const bot = new PlaylistBot();
bot.start().catch((err) => {
  log('ERROR', 'Fatal error', err);
  process.exit(1);
});
