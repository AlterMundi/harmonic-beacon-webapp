// Polls the external safety statuses while the load child runs. On the first
// failed or stale check it aborts exactly once, promptly and deterministically,
// and never prints status contents or error details. stop() parks the guard:
// no further tick runs and an in-flight check that later rejects emits no
// abort and never invokes onAbort.
export function startStatusGuard({
  check,
  onAbort,
  intervalMs = 2_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  writeImpl = (line) => process.stderr.write(line),
}) {
  let aborted = false;
  let stopped = false;
  let busy = false;
  const abort = () => {
    // A check that was already in flight when stop() ran must never emit an
    // abort or invoke onAbort: the load child has already exited by then and
    // the wrapper is shutting down cleanly.
    if (aborted || stopped) return;
    aborted = true;
    clearIntervalImpl(timer);
    writeImpl('Smoke safety status became stale or failed; aborting without printing sensitive details.\n');
    onAbort();
  };
  const tick = () => {
    if (aborted || stopped || busy) return;
    busy = true;
    Promise.resolve()
      .then(check)
      .catch(abort)
      .finally(() => { busy = false; });
  };
  const timer = setIntervalImpl(tick, intervalMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearIntervalImpl(timer);
    },
    get aborted() {
      return aborted;
    },
    get stopped() {
      return stopped;
    },
  };
}
