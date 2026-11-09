/**
 * Test execution module
 *
 * Provides the generic Playwright runner for Phase 1.
 */

export { runPlaywrightTests, type RunOptions, type RunMetadata } from './runner.js';
export { generateRunId } from './run-id.js';
export { resolvePlaywrightCli } from './playwright-cli.js';
export {
  launchPlaywrightProcess,
  ProcessStartupError,
  type ProcessLaunchOptions,
  type ProcessResult,
} from './process-manager.js';
