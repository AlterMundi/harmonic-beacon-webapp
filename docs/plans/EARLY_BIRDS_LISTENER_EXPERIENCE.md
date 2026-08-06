# EarlyBirds Listener experience

Status: proposal for product review. This plan changes presentation and
interaction hierarchy only. It must not alter codec, gain, timing, routing,
leases, membership rules or event/LiveKit audio.

## Product intent

The Listener should feel like entering a calm, living acoustic place—not an
operations demo. A new person must understand the product within one screen:
who they are, whether access is active, what will play, how to begin and what is
playing now. Technical truth stays available without dominating the experience.

The visual character is quiet, luminous and spatial. Motion should suggest a
shared continuous signal, never pretend to be a real analyser when it is not.
The interface should reward listening by becoming simpler after playback starts.

## Information architecture

1. **Compact identity rail**: Harmonic Beacon, language, listener name and a
   discreet membership indicator. `TEST` remains visible in staging but is not
   styled as part of the experience.
2. **Beacon stage**: one dominant visual and one sentence explaining the shared
   live point. This surface owns every playback state.
3. **Transport dock**: one obvious primary action plus a secondary mode choice.
   Stop belongs to the same control family and location; volume is always
   reachable. Mobile uses a thumb-friendly bottom dock.
4. **Intro choice**: a small pre-play preference, not a second competing player.
   While the intro plays, show title, elapsed/remaining time and the explicit
   promise “Beacon follows automatically.”
5. **Membership/account details**: progressive disclosure below the listening
   experience. Private content metadata should not duplicate the active
   transport.

## State model shown to the listener

- **Ready**: selected mode and a single unmistakable Play action.
- **Preparing**: short truthful preparation state; controls do not appear dead.
- **Intro playing**: intro identity, progress and “Beacon follows.”
- **Transitioning**: brief handoff state without showing two active sources.
- **Beacon live**: shared-point visual, active state and Stop.
- **Paused/stopped**: preserve the chosen mode and make restart obvious.
- **Reconnecting**: keep intent visible, explain automatic recovery and expose a
  manual retry only after recovery is exhausted.
- **Access/device error**: plain-language cause and one appropriate next action.

## Visual and interaction principles

- One primary accent per state; avoid several equally loud calls to action.
- Large type and negative space carry atmosphere; labels remain concise.
- Use state-driven light, depth and restrained motion. Honour `prefers-reduced-motion`.
- Minimum 48 px targets, keyboard-visible focus, AA contrast and semantic status
  announcements.
- Avoid layout shifts when media metadata arrives. First useful paint must not
  wait for a stream lease.
- Keep ES/EN copy equivalent and test 320, 390, 768, 1024 and 1440 px widths.

## Delivery slices

### UX-1 — coherent transport

- Put intro selection, Play with intro, Beacon-only and Stop in one responsive
  control system.
- Give Stop the same dimensions, typography and affordance as the other actions.
- Remove duplicate or inert controls and make disabled/loading states explicit.

### UX-2 — listening stage

- Recompose the first viewport around a single Beacon stage and transport dock.
- Add distinct ready, intro, transition, live and reconnecting visual states.
- Move account/membership diagnostics out of the primary visual hierarchy.

### UX-3 — intro and content model

- Collapse the duplicated “Private drop-ins” card into the active intro choice.
- Add content details through a drawer/sheet when more than one intro exists.
- Preserve standard seek/progress semantics for drop-ins; the shared Beacon has
  no fake seek timeline.

### UX-4 — polish and acceptance

- Responsive and physical mobile review, keyboard/screen-reader pass, reduced
  motion, slow-network and reconnect states.
- Screenshot review at the target widths and a human listening walkthrough on
  Chrome, Safari/iOS, Firefox and Android.
- Performance budget: no new blocking font/media request and no decorative
  animation that competes with audio stability.

## Acceptance signal

A first-time listener can enter and begin the intended mode in under ten
seconds without explanation; during playback they can always name what is
playing and stop it; no duplicate player or technical status competes with the
experience; every error offers one understandable recovery action; the design
feels intentional on both a phone and a large screen.
