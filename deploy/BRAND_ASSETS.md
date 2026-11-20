# Logo-only edge asset delivery

This is the appointed owner's manual route for a selected logo-only task under
`docs/ops/OPERATOR_DELEGATION.md` and `DELIVERY_INVARIANTS.md`. It is not an
alternative application/image release, permission change or authentication route.
No application, media, worker, database or event is restarted or changed.

## Scope and source

The current apps render their visible brand through the local, byte-pinned
`public/assets/hb-global-nav.js`. An owner may deliver that reviewed file and
`src/app/favicon.ico` as an immutable static pair on the existing same-origin
Nginx edge. Keep source qualification, exact hashes, the old pair, current
configuration and a bounded recovery receipt. The canonical geometry and human
selection are pinned in `src/brand/canonical/manifest.json`.

For the 2026-11-20 selection, navigation behavior remains byte-identical after
normalizing only `beaconMarkPath`, its source comment and `.mark path` stroke.
Do not substitute the newer Home navigation wholesale: its other UI behavior
is outside this task. The unused React brand component is updated for future
application builds, but is not claimed to have been rebuilt by this delivery.

## Owner transaction

1. Inspect current source, PR/checks, service health, active operations and
   exact edge configuration. Run `hb doctor` for each affected service and
   classify any unrelated catalog gaps. Keep protected image-release transactions
   unchanged. Retain the existing Live staging retirement.
2. Create a root-owned, non-writable immutable directory under
   `/var/lib/harmonic-beacon/brand-assets/<asset-set-sha256>/` containing only
   `hb-global-nav.js`, `favicon.ico` and a public provenance manifest (hashes,
   source revision, prior asset hashes). Never include an environment, cookie,
   credential or application state. Verify public files as the Nginx user.
3. Snapshot the five exact existing HTTPS configurations root-privately:
   Live, Account, Listen and the existing Account/Listen identity staging sites.
   Record SHA-256 preconditions. Modify only exact GET/HEAD locations
   `/assets/hb-global-nav.js` and `/favicon.ico`, using absolute aliases to the
   immutable pair. Preserve HTTP redirects, all other routes, existing security
   headers and deny defaults. Never create a broad `/assets/` or filesystem alias.
   Access logs stay off. Use explicit content types and `max-age=300`, not
   `immutable`, because the stable URI and old query versions remain in use.
4. Hold the existing app-bridge operation lock for each configuration transaction
   and check all precondition hashes before any write. Reject a changed source,
   symlink target, active image transaction or configuration. Write each file
   atomically, retaining its owner/mode. Run `nginx -t`; on failure restore all
   originals before exit. Use a graceful reload, never a stop/restart. A reload
   failure or uncertain result requires readback and recovery, not a blind retry.
5. First exercise apply, exact rollback and forward on the existing Account and
   Listener identity staging. Read back hashes with old/new/no query, GET/HEAD,
   denied POST, headers and unaffected private/unknown routes. Check desktop and
   mobile navigation, account-menu/locale/keyboard behavior and favicon legibility.
   Preserve the production configurations through this rehearsal.
6. Promote the exact rehearsed bytes to the three production origins with the
   same compare-and-set and recovery procedure. Verify TLS HTTP results, exact
   hashes, navigation and health. Record unchanged application/media container IDs
   and source SHAs. This records edge asset delivery, not a new application image.

## Recovery and retirement

Keep a root-private transaction record with before/after configuration hashes,
asset hashes, source/PR, rehearsal and public readbacks. Restore only if the
current configuration still matches that transaction's after hash; a concurrent
operator's later change must not be overwritten. Validate, gracefully reload and
read back the restored bytes. Do not delete retained recovery assets or snapshots.

The temporary exact locations override the application asset. Inventory them in
the owning PR and this host's current operating record. A subsequent application
release must explicitly reconcile them: after staging confirms its in-image bytes
match the selected mark/navigation and favicon, remove only these exact overrides
under the same CAS/rollback procedure. Never allow them to silently shadow a
later navigation/security fix. Keep the old query URL working during the browser
cache transition. Other Beacon websites use their existing owning publication
contracts; this route neither modifies them nor claims their publication.
