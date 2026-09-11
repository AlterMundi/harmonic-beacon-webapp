#!/usr/bin/env node

import { createHash } from 'node:crypto';

export const PROOF_SCHEMA = 'listen-delivery-proof.v1';
const SHA256 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function reject(message) { throw new Error(`Listen delivery proof: ${message}`); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function utcMillis(value, label) {
  if (!UTC.test(value ?? '')) reject(`${label} must be canonical UTC RFC3339`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value.replace(/Z$/, '.000Z')) {
    reject(`${label} must be a real UTC instant`);
  }
  return milliseconds;
}
function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject('proof has missing or unexpected fields');
}
function parseStrictFlatJson(raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 3 || raw.length > 65_536) reject('proof bytes are absent or oversized');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { reject('proof is not UTF-8'); }
  const keys = [];
  const keyPattern = /"((?:\\.|[^"\\])*)"\s*:/g;
  for (const match of text.matchAll(keyPattern)) keys.push(JSON.parse(`"${match[1]}"`));
  if (new Set(keys).size !== keys.length) reject('proof contains a duplicate field');
  let value;
  try { value = JSON.parse(text); } catch { reject('proof is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((entry) => entry && typeof entry === 'object')) {
    reject('proof must be one flat object');
  }
  return value;
}

export function validateProof(rawProof, retainedEvidence, options) {
  if (!Buffer.isBuffer(retainedEvidence) || retainedEvidence.length < 1 || retainedEvidence.length > 1_048_576) reject('retained evidence is absent or oversized');
  const kind = options?.kind;
  if (!['authority', 'recipient'].includes(kind)) reject('proof kind is invalid');
  if (!Number.isSafeInteger(options.max_age_seconds) || options.max_age_seconds < 1 || options.max_age_seconds > 86_400) reject('proof max age is invalid');
  const value = parseStrictFlatJson(rawProof);
  const common = ['schema_version', 'purpose', 'issued_at', 'expires_at', 'status', 'evidence_sha256'];
  if (kind === 'authority') {
    exactKeys(value, [...common, 'membership_contract_sha256']);
    if (value.schema_version !== 'listen-authority-proof.v1' || value.purpose !== 'listen-delivery-authority' || value.status !== 'matched') reject('Authority proof identity or purpose is invalid');
    if (!SHA256.test(options.expected_membership_sha256 ?? '') || value.membership_contract_sha256 !== options.expected_membership_sha256) reject('Authority membership digest is mismatched');
  } else {
    exactKeys(value, common);
    if (value.schema_version !== 'listen-recipient-proof.v1' || value.purpose !== 'listen-delivery-alert-recipient' || value.status !== 'verified') reject('recipient proof identity or purpose is invalid');
  }
  if (!SHA256.test(value.evidence_sha256 ?? '') || value.evidence_sha256 !== digest(retainedEvidence)) reject('retained evidence digest is mismatched');

  const now = utcMillis(options.now, 'current time');
  const issued = utcMillis(value.issued_at, 'issued_at');
  const expires = utcMillis(value.expires_at, 'expires_at');
  const maxAge = options.max_age_seconds * 1000;
  if (issued > now || expires <= now || expires <= issued || now - issued > maxAge || expires - issued > maxAge) {
    reject('proof is future-dated, expired, stale, or exceeds its maximum validity');
  }
  return {
    kind,
    proof_sha256: digest(rawProof),
    evidence_sha256: value.evidence_sha256,
    issued_at: value.issued_at,
    expires_at: value.expires_at,
  };
}
