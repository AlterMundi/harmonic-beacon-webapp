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

For the isolated PayPal sandbox checkout rehearsal, require an account instead
of Free For All and expose only the PayPal sandbox action in this disposable
process:

```bash
LISTENER_UI_PREVIEW_FREE_FOR_ALL=0 \
LISTENER_UI_PREVIEW_PAYPAL_SANDBOX_CHECKOUT_ENABLED=1 \
scripts/listener-ui-preview.sh start
```

The script refuses the ambiguous combination of checkout plus Free For All.
Because synthetic login is intentionally disabled under `NODE_ENV=development`,
this payment rehearsal runs the persistent Listener's exact built image in a
separate production-mode container on the staging port. Ordinary UI iteration
continues to use Next development mode. Neither path changes the persistent
Listener release or event services.

The payment workbench overrides both accepted Listener auth-base aliases to
`https://earlybirds-staging.harmonicbeacon.com`. OAuth state and session cookies
are host-only, so login must begin and finish on staging. Inheriting the public
Listener auth base would redirect Google to `listen.harmonicbeacon.com`, where
the staging state cookie is deliberately unavailable and the callback fails
closed with `state_mismatch`. The Google OAuth application must therefore keep
the exact staging callback registered alongside the public Listener callback.

For the equivalent isolated Mercado Pago TEST rehearsal, select only Mercado
Pago and keep Free For All disabled:

```bash
LISTENER_UI_PREVIEW_FREE_FOR_ALL=0 \
LISTENER_UI_PREVIEW_MERCADO_PAGO_TEST_CHECKOUT_ENABLED=1 \
scripts/listener-ui-preview.sh start
```

The workbench rejects enabling PayPal and Mercado Pago together so acceptance
evidence always identifies one provider unambiguously.

Keep local edits synchronized while iterating:

```bash
scripts/listener-ui-preview.sh watch
```

To compare an immutable intro artifact without changing the public
Listener or overwriting another artifact, restart only the disposable workbench
with its container path:

```bash
LISTENER_UI_PREVIEW_DROPIN_EN_PATH=/media/artifacts/drop-ins/amara-sol-en-r2-approved-aac320-v1.m4a \
scripts/listener-ui-preview.sh start

LISTENER_UI_PREVIEW_DROPIN_ES_PATH=/media/artifacts/drop-ins/amara-sol-es-r2-approved-aac320-v1.m4a \
scripts/listener-ui-preview.sh start
```

The override accepts only a bounded `.m4a` filename inside the read-only
drop-in artifact directory. The public Listener keeps its independently pinned
path until a revision has explicit human approval and completes the release
checkpoint.

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
