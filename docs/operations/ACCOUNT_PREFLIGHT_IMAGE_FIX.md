# Account preflight candidate image

Approved scope: repair PR/CI after delivery run 35813177157 failed before cutover.
The preflight migration check and backup need the candidate image, but the build
previously occurred only later in start.sh. A host without that image attempted
a registry pull instead.

Plan: extract the existing exact-source build/provenance check into a shared
lifecycle function. Run it inside protected preflight after capturing the prior
runtime, before migration checks or backup. Keep start.sh's build/provenance and
validation via that same function, including its normal build cache behavior.
No dependency on a pre-existing candidate image. No manual build, new helper
verb, migrations during preflight, changed lock, rollback or activation.

Verify cold-image ordering, failed build and wrong baked SHA fail closed, replay
does not repeat build/backup, and existing adapter/lifecycle suites. PR/CI only:
installation of a new trusted source/helper and deployment require the applicable
operator authorization for the new revision. Psicopompo login remains OFF.
