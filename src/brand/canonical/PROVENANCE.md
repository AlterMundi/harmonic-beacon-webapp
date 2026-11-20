# Harmonic Beacon brand snapshot

This directory pins the minimum canonical brand material needed by Listener
and Live without requiring another repository during CI or at runtime.

## Brand source

- Repository: `AlterMundi/harmonicbeacon.com`
- Commit: `0052e5f45a108b6069fc11e4c6565f4da4f77d9f` (PR #61)
- Tokens: the `:root` block of `assets/hb-brand.css`
- Historical mark: superseded by the selected curve below.
- Human guide: `docs/brand/BRANDING.md`

`hb-brand-root.css` is a byte-preserving extraction of the canonical root
block, preceded only by its local provenance comment. It is deliberately not
imported: the source properties are unnamespaced and would collide with the
application's experimental design tokens. `src/styles/hb-brand.css` maps this
snapshot to the `--hb-*` namespace. `hb-mark.ts` contains the exact canonical
path consumed directly by the React mark.

The upstream files and all vendored artifacts are SHA-256 pinned in
`manifest.json`. The brand contract test validates the artifacts, the mapping,
and the path. Updating the brand requires an explicit snapshot, provenance,
manifest and visual-review update together.

## Global navigation

Listener, Live and Account serve a byte-pinned local derivative of the canonical
web component rather than executing JavaScript supplied at runtime by another
origin. The navigation behavior remains from `AlterMundi/harmonicbeacon.com` commit
`6bd32262318e9a1faf6f4fc54b85b96f856544df`; the logo-only derivative is version `beacon-mark-7e8f789341ed1db5` (SHA-256
`3d3916d26d97b5e8591887bebcb349e83bccd6b5fb0c24efd18d1d63fd5cccb1`). No other upstream navigation behavior was adopted.
The local light-DOM markup remains the accessible, same-destination fallback.
Both implementations keep Account out of the primary destination list and
expose it from the user-icon menu automatically on staging. Production remains
hidden until the product server supplies the presence-only
`data-account-available` capability after its Account RP is enabled. The host
may also supply only the boolean `data-account-signed-in` hint; no name, email,
subject, cookie or token enters the asset. A product may provide its own
same-origin light-DOM menu through the canonical `account-menu` slot; the asset
does not read or transmit its content.
The enhanced navigation renders both the Beacon mark and user glyph locally;
it does not embed Account in an iframe or fetch a cross-origin image.

## Font source and license

Both families are covered by the SIL Open Font License 1.1; the relevant
`OFL.txt` is stored beside each family.

- Cormorant Garamond variable normal and italic WOFF2 assets are the existing
  application-approved files from `upstream/early-birds`, produced from the
  Google Fonts repository at commit
  `038b637da7b3fd956a4ed93ffc607c3d5e4ce172` with fontTools 4.57.0. They cover
  weights 400–600 and Latin/Latin Extended plus punctuation.
- Inter is the official Google Fonts `v20` Latin variable WOFF2 asset, pinned
  from
  `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2`.
  The application exposes only the approved 300–600 weight range. Its OFL text
  is pinned from the Google Fonts repository commit above, with trailing
  whitespace normalized for the repository gate.

No font, analytics or decorative brand asset is fetched at runtime. The global
navigation is served as the byte-pinned local snapshot described above.

## Selected curve update — 2026-11-20

Sai requested the new Beacon symbol on all Beacon websites. `manifest.json`
pins the source geometry and human selection. The transparent SVG, React path
and navigation path share that geometry. The small-screen stroke is 10 units
in the unchanged 200×200 square viewBox. Colors and fonts are unchanged.
The geometry follows the selected photographed curve; its physical frequency
ratio is unknown. The isolated lower-right sparkle is not part of the mark.

The vendored generator is unchanged. From this directory, reproduce variants
with `python3 render_mark.py --geometry beacon-mark-geometry.json --out /tmp/beacon-mark-check`.
Its optional `--sync-consumers` switch belongs to the upstream Home repository
and must not be used in this app checkout. Existing typography/token snapshots retain their original
provenance above. No PsicopoMPo, HIT or AlterMundi identity is replaced.
