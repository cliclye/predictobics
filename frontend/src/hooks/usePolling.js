import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Polls `fn` every `intervalMs` milliseconds.
 *
 * Features:
 * - Prevents concurrent executions (skips a tick if the previous is still running)
 * - Pauses automatically when the page is hidden; resumes + re-runs on visibility
 * - Returns `lastRefreshed` (Date | null) so callers can show freshness indicators
 * - Accepts `enabled` to pause polling programmatically
 * - Backwards-compatible: existing callers that ignore the return value still work
 *
 * @param {() => any} fn      Async or sync function to call on each tick
 * @param {number} intervalMs Polling interval in milliseconds
 * @param {{ enabled?: boolean }} options
 * @returns {{ lastRefreshed: Date|null }}
 */
export function usePolling(fn, intervalMs, { enabled = true } = {}) {
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const fnRef = useRef(fn);
  const runningRef = useRef(false);
  const intervalRef = useRef(null);

  // Always call the latest version of fn without resetting the interval
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await fnRef.current();
      setLastRefreshed(new Date());
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function startInterval() {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(run, intervalMs);
    }

    function handleVisibility() {
      if (document.hidden) {
        clearInterval(intervalRef.current);
      } else {
        // Tab became active: restart interval and do an immediate refresh
        startInterval();
        run();
      }
    }

    startInterval();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, intervalMs, run]);

  return { lastRefreshed };
}
