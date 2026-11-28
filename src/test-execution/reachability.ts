/**
 * Pre-flight reachability check (Task R4 carry-over, DEC-043), used by `run --release` and `validate`
 * before Playwright starts, so an application that is not running is not recorded as failing tests.
 */

const TIMEOUT_MS = 10_000;

/**
 * Send one HTTP request to the target. Any HTTP response (any status) counts as reachable.
 *
 * @returns null when reachable, otherwise the refusal reason (connection refused, DNS failure, timeout)
 */
export async function checkTargetReachable(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(baseUrl, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.body?.cancel();
    return null;
  } catch {
    return `Target ${baseUrl} is not reachable; start the application and try again`;
  }
}
