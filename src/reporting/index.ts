/**
 * Reporting module
 *
 * Exports report parsing, status reconciliation, and related types.
 */

export {
  type TestStatus,
  type TestResult,
  type InterruptedTest,
  type TopLevelError,
  type TestStats,
  type ParsedReport,
  type ReportFilesStatus,
  checkReportFiles,
  parseReportFile,
  parseReportJson,
} from './report-parser.js';

export {
  type RunStatus,
  type ReportStatus,
  type PrimaryReason,
  type FindingCode,
  type Finding,
  type RunResult,
  type ReconciliationInput,
  reconcileRunResult,
  shouldExitNonZero,
} from './status-model.js';
