// Polls the external safety statuses while the load child runs. On the first
// failed or stale check it aborts exactly once, promptly and deterministically,
// and never prints status contents or error details.
export function startStatusGuard({
  check,
  onAbort,
  intervalMs = 2_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  writeImpl = (line) => process.stderr.write(line),
}) {
  let aborted = false;
  let busy = false;
  const abort = () => {
    if (aborted) return;
    aborted = true;
    clearIntervalImpl(timer);
    writeImpl('Smoke safety status became stale or failed; aborting without printing sensitive details.\n');
    onAbort();
  };
  const tick = () => {
    if (aborted || busy) return;
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
      clearIntervalImpl(timer);
    },
    get aborted() {
      return aborted;
    },
  };
}
