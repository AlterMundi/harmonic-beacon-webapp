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

Listener, Live and Account serve a byte-pinned local snapshot of the canonical
web component rather than executing JavaScript supplied at runtime by another
origin. The source is `AlterMundi/harmonicbeacon.com` commit
`ed7421616429681a37836f4698c73cf01799b75e`; the vendored
`public/assets/hb-global-nav.js` SHA-256 is
`4a8a18fea07e279c0f757abd3be61bd715b0c6e647e6bc389d84c228c312e691`.
The local light-DOM markup remains the accessible, same-destination fallback.
Both implementations keep Account out of the primary destination list and
expose it from the user-icon menu only on staging while the production Account
authority remains unavailable. The host may supply only the boolean
`data-account-signed-in` hint; no name, email, subject, cookie or token enters
the asset. The enhanced navigation renders both the Beacon mark and user glyph
locally; it does not embed Account in an iframe or fetch a cross-origin image.

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
