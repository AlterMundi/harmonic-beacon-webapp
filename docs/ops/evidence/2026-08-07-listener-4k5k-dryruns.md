# Listener 4,000 / 5,000 zero-request capacity plans

Date: 2026-08-07

These are distributed **planning** artifacts, not load, throughput or customer
capacity evidence. The HLS harness ran only with `--dry-run`; all fourteen shard
files attest `networkRequestsMade=false` and contain zero runtime measurements.
No manifest URL, signing key, cookie, session or network request was used.

## Inputs and generators

- branch base: `5ae1e030c43c118b5efa749831ba3f8b75fe9a05`;
- profile document SHA-256:
  `06ad500c07d212f7caeccff70a13fad11f3a69730e338cc8f5197408535b7c4e`;
- protected non-production target-policy SHA-256:
  `60cc2a02be737d522e60a14b8c8cbb6d174689dba050f5eb8002c89bc97e740f`;
- external generators: `legion` and `daimonmatrix`, both reporting
  `NTPSynchronized=yes` at planning time;
- raw and collected evidence files: exact mode `0600`;
- durable archives:
  `~/.local/state/harmonic-beacon/listener-load-evidence/20260807-4k5k-zero-request`
  on both generators. The consolidated verifier summaries are retained on
  `legion` at the same path.

The target policy contains no credential or signed URL. It is still kept out of
Git because a high-limit policy is an operator input, not authorization to run.

## Verified plans

| Profile | Clients | Shards | Generators | Plan hash | Summary SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| `origin-media-4000-expansion` | 4,000 | 6 | 2 | `67b68f412789c1ae3ad8e950c49480704d5c06f33b445788272a0a73fb73a3dd` | `9ffee73162898f99d1ebe13925e460acd44628f9d6d198aa0f5c3206a0d98452` |
| `origin-media-5000-critical` | 5,000 | 8 | 2 | `845206f4b8c1e605953a1efd8066b73b9bba87e2487627f3022bd337ec6d44ec` | `022068aa97e6be03f90d205f1907dd856db9e0d9ab1feaf2ecc86fade22b1d3f` |

The 4,000 plan covers indices `0..5`, with local client counts
`667,667,667,667,666,666` and an exact total of 4,000. The 5,000 plan covers
indices `0..7`, with 625 clients per shard and an exact total of 5,000. Every
plan has two distinct generator fingerprints and unique client-ordinal hashes.

Verification command:

```bash
node tools/early-birds-hls-load/verify-planned.mjs \
  --min-generators 2 /secure/collected/<profile>-shard-*.json
```

The committed verifier independently checks the plan hash, input hashes,
complete unique indices, client sum, generator count, ordinal hashes, redaction,
exact source mode and absence of network/runtime activity.

## Gate that remains closed

This record does not authorize the next step. A network run still requires an
explicit monitored window, fresh short-lived signed manifest files, external
decoded canary, target operators and stepwise go/no-go starting at the smallest
approved client count. It must never jump directly to 4,000 or 5,000 and must
never run from `mona`.
