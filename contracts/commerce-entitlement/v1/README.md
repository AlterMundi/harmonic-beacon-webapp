# commerce-entitlement.v1 shared contract

Both repositories ship this directory byte-for-byte. `SHA256SUMS` covers every
schema, fixture and this README. Real integration remains disabled whenever any
hash differs.

## Command hash

Validate and normalize first, project exactly the material fields enumerated in
`command.schema.json` (excluding `request_id`), serialize RFC 8785 as UTF-8 with
no floats, then return lowercase hex SHA-256. The complete Unicode fixture is
`canonicalization.fixture.json`.

## Credential derivation

PMP derives a code without persisting it in plaintext:

1. Interpret the selected versioned secret as UTF-8 bytes.
2. Build UTF-8 material `grant_id + "|" + base-10 generation`, with the UUID in
   its lowercase canonical form and no whitespace or newline.
3. Compute HMAC-SHA256 and retain the first 20 bytes (160 bits).
4. Encode the bit stream most-significant-bit first, without padding, using the
   exact 32-character alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
5. Split the 32 encoded characters into eight groups of four and return
   `HB1-<group>-<group>-...`.

`credential-derivation.fixture.json` fixes every intermediate byte using a
synthetic, non-production secret. Beacon stores only its independently peppered
digest and last four characters; no API result returns the code or either
secret.
