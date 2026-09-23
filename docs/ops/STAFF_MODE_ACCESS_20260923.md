# Staff access from participant entry

Owner-approved scope: make an existing staff identity discoverable after entering
Live through the public participant route. Same Account, explicit choice of mode;
no automatic staff session, grants or identity merging.

Plan:
1. Extend the existing local navigation hint with available staff role resolved
   by issuer+subject, independently of whether the session is currently staff.
   No email matching, tokens exposed, writes or new authority. Protected routes
   still revalidate through their existing Account flow.
2. Add a visible compact access strip below global navigation for bound staff:
   role, current mode, staff destination and participant entry. Preserve existing
   alias editing and menu semantics by keeping current staff role separate.
3. Reuse same-tab standard OAuth links; existing room-exit guard must intercept
   departures. Never grant tickets or bypass paid admission. Participant mode
   returns to the public agenda to choose/recover normal admission.
4. Tests: participant-bound admin, ordinary participant, disabled/mismatched
   bindings, staff mode, locale, room-exit cancellation, real Account callback
   switching both ways. Exact candidate CI; app-only delivery if impact allows.
5. Verify no active session before replacement. Coordinate new deployed SHA with
   PMP snapshot receipt; retain old exporter worktree, no cutoff/scheduler change.

Design: existing night/paper/gold tokens and body typography; a quiet horizontal
strip that wraps on mobile. No modal onboarding or menu-only discovery. Role and
mode are distinct labels; controls describe their destination. No new animation.

Authorized delivery follow-up: add root-only retirement of a completed app
bridge transaction, allowing a healthy receipt-bound migration successor;
preserve all recovery material before vacating its state. Reject in-flight,
unknown or unhealthy endpoints. Preserve canonical runtime flags on the next
app-only deployment through digest-bound public profiles. Test refusal and
archive paths before installing reviewed helpers. No migration is introduced.
Direction permits necessary service interruption, but ordinary continuity
checks remain intact; unrelated services remain outside this change.
