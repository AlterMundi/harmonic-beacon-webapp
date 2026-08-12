# Self-hosted application fonts

These files remove the release-time dependency on `fonts.gstatic.com` while
preserving the existing typography:

| Family | Source file | Local SHA-256 |
| --- | --- | --- |
| Cormorant Garamond variable, normal 400–600 | `cormorant-garamond/CormorantGaramond-wght.woff2` | `e4c3c3eb566c07afee0b54301b984dc3e5e7e1dd1218a528e61133ed84a7647d` |
| Cormorant Garamond variable, italic 400–600 | `cormorant-garamond/CormorantGaramond-Italic-wght.woff2` | `14d1519ed9320432e1782e0b90435647827937a41222e99531f449c981090303` |
| Syne variable, normal 400–700 | `syne/Syne-wght.woff2` | `3426a96623df5fba636f48774ae899f5b9136b67a8418f49c04d110cf30a585b` |
| Space Mono regular 400 | `space-mono/SpaceMono-Regular.woff2` | `76ba939dbd8fe9d6cb0519633d0e92878e21e6c8cb6cd635f67fc344c242a4c9` |
| Space Mono bold 700 | `space-mono/SpaceMono-Bold.woff2` | `2ef5a6968e7045c138da05c95e583025c967b698a3c2bd3d9ea177ba7209934b` |

Upstream is the Google Fonts repository at commit
`038b637da7b3fd956a4ed93ffc607c3d5e4ce172`. The original TTF files were
subset locally with fontTools 4.57.0 to Latin/Latin Extended plus punctuation
and emitted as WOFF2. Each family is licensed under the SIL Open Font License
1.1; the upstream `OFL.txt` text is retained next to each family (with trailing
whitespace normalized for the repository gate).

Do not replace these binaries implicitly during dependency upgrades. Update
the provenance, hashes, licenses and visual/browser acceptance together.
