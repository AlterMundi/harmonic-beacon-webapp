# Listener UI fast loop

`earlybirds-staging.harmonicbeacon.com` is the disposable Listener UI
workbench. `listen.harmonicbeacon.com` remains the persistent acceptance
release.

The workbench runs Next development mode on Mona port `13001`, reads source
mirrored onto `/mnt/beacon-data`, and uses hot reload. It deliberately enables
Free For All only inside that disposable process so layout and transport can be
reviewed without account setup. The persistent Listener process on `13000`, its
Free For All state, and every event service remain unchanged.

Start or replace the workbench from the `early-birds` worktree:

```bash
scripts/listener-ui-preview.sh start
```

Keep local edits synchronized while iterating:

```bash
scripts/listener-ui-preview.sh watch
```

Other operations:

```bash
scripts/listener-ui-preview.sh status
scripts/listener-ui-preview.sh logs
scripts/listener-ui-preview.sh stop
```

The fast loop is intentionally disposable. Do not call a visual iteration a
release. Once the team accepts a coherent batch, stop the watch loop and run
one normal checkpoint: focused tests, TypeScript/lint/build, commit, exact-image
Listener deployment, health/readiness and physical playback smoke.

The workbench is not a compatibility target and carries no migration or
rollback promise. Dependency, schema, infrastructure, authentication or audio
signal changes do not belong in this loop; they use the normal isolated
release path.
