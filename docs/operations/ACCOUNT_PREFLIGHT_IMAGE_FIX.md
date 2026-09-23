# Account preflight candidate image

Approved scope: repair PR/CI after delivery run 35813177157 failed before cutover.
The preflight migration check and backup need the candidate image, but the build
previously occurred only later in start.sh. A host without that image attempted
a registry pull instead.

Plan: extract the existing exact-source build/provenance check into a lifecycle
function. Run it inside protected preflight after capturing the prior runtime,
before migration checks or backup. Bind the resulting image ID in durable state;
preflight replay and deploy reject a replaced image. Start.sh verifies that ID
instead of rebuilding, then runs its existing validation.
No dependency on a pre-existing candidate image. No manual build, new helper
verb, migrations during preflight, changed lock, rollback or activation.

Verify cold-image ordering, failed build and wrong baked SHA fail closed, replay
does not repeat build/backup, replaced image fails before cutover, and existing
adapter/lifecycle suites. Legacy terminal states remain readable for rollback;
new deployment requires the candidate image binding. PR/CI only:
installation of a new trusted source/helper and deployment require the applicable
operator authorization for the new revision. Psicopompo login remains OFF.
