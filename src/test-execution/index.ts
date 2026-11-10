/**
 * Test execution module
 *
 * Provides the generic Playwright runner for Phase 1.
 */

export {
  runPlaywrightTests,
  createCollisionSafeRunDirectory,
  persistExecutionLogs,
  type RunOptions,
  type RunMetadata,
  type ProcessResult,
  type CleanupResult,
  type LogPersistenceResult,
  type RunDirectoryResult,
  type CreateRunDirectoryOptions,
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
