# Native playlist lifecycle rehearsal

The default suite skips the native case without an explicit isolated endpoint.
A skipped case is not qualification. This uses fixture-only credentials and
allows remote unmute only in the disposable test server; never enable it on
production as a test prerequisite.

From the repository root, with dependencies installed for playlist-bot:

```bash
docker run -d --name hb-playlist-native-test \
  -p 127.0.0.1:27880:27880 \
  -p 127.0.0.1:27881:27881 \
  -p 127.0.0.1:27882:27882/udp \
  -v "$PWD/services/playlist-bot/test/native-livekit.yaml:/etc/livekit.yaml:ro" \
  livekit/livekit-server@sha256:189f7c81b704a36642bc5c7e2d3e1ae83744627c11978a23a251bf19fbec64e0 \
  --config /etc/livekit.yaml
LIVEKIT_NATIVE_TEST_URL=ws://127.0.0.1:27880 \
LIVEKIT_NATIVE_TEST_API_KEY=hb-native-test \
LIVEKIT_NATIVE_TEST_API_SECRET=native-test-only-secret-at-least-32 \
  services/playlist-bot/node_modules/.bin/tsx --test \
  services/playlist-bot/test/beaconAvailability.integration.test.ts
docker stop hb-playlist-native-test
docker rm hb-playlist-native-test
```

If the name or ports are occupied, inspect ownership rather than stopping an
unrelated container. Cleanup only the container created by this rehearsal;
retain the image. The test disconnects its participants and disposes SDK resources.

The snapshot case verifies native SDK publication/mute/unpublish/replacement.
For actual decoded PCM, first run `npm run build --prefix services/playlist-bot`,
then run the same opt-in command targeting `test/bedAudio.integration.test.ts`.
It launches the compiled bot with a temporary synthetic sine WAV and observes
its received PCM through another native participant. It covers connection
without publication, publication without frames, audible source, zero PCM,
server mute/unmute, unpublish and full bot reconnect. The suite requires local
FFmpeg. Its finally block stops the bot, disconnects clients and deletes only
its temporary recording. Retain the server until both cases finish.

The fixture advertises the same RTC ports that Docker publishes; signaling
alone can pass even when advertised media ports are unreachable. Do not accept
a WS connection as evidence of received audio.

The bot now subscribes only to audio publications of `beacon01`. It retains
level timestamps, never samples or recordings: RMS at least 32 PCM16 units
(about -60 dBFS) is audible, with a 3-second grace for short pauses, then the
existing 2-second bed fade. A new or replacement publication starts unproven;
missing frames and sustained digital silence restore fallback. Mute/unpublish
invalidate old level evidence immediately. Other participants never drive the
fallback decision. These are explicit continuity defaults, not a claim that
all artistic quiet passages can be distinguished from a failed source.

Local native tests do not replace acceptance of the exact immutable image over
the staging TLS origin, browser playback, or recovery of the installed stack.
