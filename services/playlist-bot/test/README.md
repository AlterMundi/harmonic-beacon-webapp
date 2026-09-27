# Native playlist lifecycle rehearsal

The default suite skips the native case without an explicit isolated endpoint.
A skipped case is not qualification. This uses fixture-only credentials and
allows remote unmute only in the disposable test server; never enable it on
production as a test prerequisite.

From the repository root, with dependencies installed for playlist-bot:

```bash
docker run -d --name hb-playlist-native-test \
  -p 127.0.0.1:27880:7880 \
  -p 127.0.0.1:27881:7881 \
  -p 127.0.0.1:27882:7882/udp \
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

This verifies real SDK publication/mute/unpublish/replacement snapshots. It does
not measure PCM, audible continuity, crossfade or bot reconnect recovery; those
still require the full media rehearsal before claiming event readiness.
