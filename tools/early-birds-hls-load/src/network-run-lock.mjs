// Exclusive local network-run lock for the ten-client Listener smoke.
//
// Scope and honest limits: this lock serializes wrapper processes on ONE
// generator host, so two concurrent wrappers started on the same trusted host
// can never drive more than the exact ten clients together. It is a local
// filesystem primitive only: it cannot see, let alone stop, a wrapper on a
// different host, so it does NOT cryptographically guarantee a global
// aggregate client limit. A single trusted, authorized generator host remains
// an operational precondition enforced by procedure and host inspection, not
// by this code.
//
// The primitive is atomic creation (O_EXCL), mode 0600, with no secrets in
// the file. A pre-existing lock — active, stale or ambiguous — is refused
// outright: the wrapper never inspects PIDs, never guesses staleness and
// never deletes a lock it did not create. Only the operator may remove a
// leftover lock after verifying no smoke is running. During a run, operators
// must not remove or replace it: release rechecks the exact bytes before
// unlinking, but Node has no portable FD-scoped unlink/flock that can make a
// human replacement between those operations impossible.

import { chmod, open, readFile, unlink } from 'node:fs/promises';

export const NETWORK_RUN_LOCK_KIND = 'harmonic-beacon-listener-smoke-network-run-lock';
/** One host-wide path: production callers cannot select a second lock domain. */
export const NETWORK_RUN_LOCK_PATH = '/tmp/harmonic-beacon-listener-smoke-10-network-run.lock';

function lockContents({ runId, pid, acquiredAtMs }) {
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: NETWORK_RUN_LOCK_KIND,
    runId,
    pid,
    acquiredAt: new Date(acquiredAtMs).toISOString(),
  })}\n`;
}

export async function acquireNetworkRunLock({
  path,
  runId,
  pid = process.pid,
  acquiredAtMs = Date.now(),
}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('network run lock path is required');
  }
  const contents = lockContents({ runId, pid, acquiredAtMs });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      // Stale or ambiguous state is refused, never resolved: deleting or
      // reusing a foreign lock could put two concurrent network runs on the
      // origin. The operator must verify no smoke is running and remove the
      // file manually.
      throw new Error(
        'network run lock already exists on this host; refusing to start: '
        + 'another smoke wrapper may be active. If none is running, verify '
        + 'the lock owner is gone and remove the lock file manually',
      );
    }
    throw new Error(`cannot create network run lock: ${error?.message ?? String(error)}`);
  }
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      let current;
      try {
        current = await readFile(path, 'utf8');
      } catch {
        return; // Already gone; nothing deterministic left to clean up.
      }
      if (current !== contents) {
        // Replaced or foreign lock: it is not ours to remove.
        return;
      }
      await unlink(path);
    },
  };
}
