/**
 * Test execution module
 *
 * Provides the generic Playwright runner for Phase 1.
 */

export {
  runPlaywrightTests,
  type RunOptions,
  type RunMetadata,
  type ProcessResult,
  type CleanupResult,
} from './runner.js';
export { generateRunId } from './run-id.js';
export { resolvePlaywrightCli } from './playwright-cli.js';
export {
  launchPlaywrightProcess,
  ProcessStartupError,
  type ProcessLaunchOptions,
} from './process-manager.js';
export {
  terminateProcessTree,
  isWindows,
  hasProcessExited,
  type CleanupOptions,
} from './process-cleanup.js';
