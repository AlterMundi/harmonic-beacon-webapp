# Harmonic Beacon brand snapshot

This directory pins the minimum canonical brand material needed by Listener
and Live without requiring another repository during CI or at runtime.

## Brand source

- Repository: `AlterMundi/harmonicbeacon.com`
- Commit: `0052e5f45a108b6069fc11e4c6565f4da4f77d9f` (PR #61)
- Tokens: the `:root` block of `assets/hb-brand.css`
- Mark: the `MARK` constant of `assets/hb-main.js`
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

The cross-product header is vendored byte-for-byte at
`public/assets/hb-global-nav.js` from `AlterMundi/harmonicbeacon.com` commit
`70400675b807ba90988517eb28871ad81c6ac369`, with SHA-256
`8dce4c2b234ef1369730e839c9d93e1bbc4134c86afb1619b63369981cbb67b0`.
Live serves that reviewed snapshot from its own `/assets/hb-global-nav.js` path;
it never executes navigation JavaScript fetched from another origin with Live
cookies in scope. The local light-DOM links remain an accessible,
same-destination fallback while the component initializes.

The snapshot is intentionally updated, reviewed and deployed rather than
silently tracking upstream. `manifest.json` and the brand contract test pin the
canonical commit, source path, local path and identical digest. A navigation
sync must update the asset, provenance and manifest together.

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

No font, brand source, analytics or navigation script is fetched from another
origin at runtime. The navigation may still display the isolated cross-origin
Account slot and canonical mark; its sandbox prevents the parent navigation
script from reading Account state.
