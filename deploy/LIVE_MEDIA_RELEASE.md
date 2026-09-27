# Delivering the qualified #590 app and media images

Nicolás authorized production delivery and the host changes needed to finish
this batch on 27 September. The inferred preventive freeze was withdrawn by
him. There must still be no active event/participant at replacement time.
Live source integrates through `release`; #592 is merged. Account, Listener,
Analytics, worker, database and LiveKit are outside this replacement set.

`hb-live-media-release.py` is an owner-operated root procedure for **these three
fixed image pairs only**. It does not enable runner-controlled deployment or
reactivate legacy workspace Compose. It is the bounded delivery path for this
already qualified batch while OCI activation remains separate work. This
specific procedure supersedes the requirement to bootstrap the entire OCI
transition before delivering #590. No new sudo grant is needed.

Install the reviewed script as root, mode 0755, at
`/usr/local/sbin/hb-live-media-release-590`. Its only inputs are
`staging|production` and `prepare|apply|rollback|recover|status`.
It shares the existing application/migration bridge lock.

1. Verify the release source, existing successful CI and staging receipt in
   #590, the exact images, DB/LiveKit continuity and `hb doctor --service live`.
2. Run `sudo /usr/local/sbin/hb-live-media-release-590 staging prepare`, then
   `staging apply` and `staging rollback`. This rehearses the old images and
   restores the qualified candidate. The old tapestry gets a synthetic seed
   only in staging. Check external media afterward.
3. Run `production prepare`. The root-only snapshot captures effective Docker
   configuration, networks, secrets and exact old images without printing them.
   Preparation refuses a changed base. Review the three image targets with
   `production status`.
4. Run `production apply`. The helper closes app entry by stopping only app,
   repeats DB and participant checks, replaces tapestry, bot and app, and checks
   exact source, image IDs, readiness, heartbeat and the private commerce
   network. Failure attempts bounded restoration; interruption is resumed with
   `production recover`. The durable create intent also covers interruption
   between Docker creation and saving the new container ID.
5. Verify public health/readiness, authenticated entry, tapestry and real PCM.
   Record actual results in #590. If acceptance fails, run `production rollback`
   before allowing an event. It repeats the continuity guard.

No build, pull, migration or database write is performed. Production config,
ports, mounts, networks and flags are retained; only image provenance defaults
are updated. Transaction labels identify recoverable containers. The worker
is retained because its entrypoint, reconciler, grant effects, dependencies,
schema and migrations are unchanged between its deployed source and the image
source; the candidate worker import smoke has passed. Both previous images and
root-only snapshots under `/var/lib/harmonic-beacon/media-release-590/` remain
available for recovery. Never print or attach the private snapshots/state:
create intents contain environment values.

The procedure does not claim OCI registry/signature qualification or generic
future deployment support. Further workflow simplification is a separate
iteration, not a prerequisite to this delivery.
