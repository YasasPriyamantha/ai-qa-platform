/**
 * Usage ledger persistence.
 *
 * Task 3.3a: Persistent usage tracking with atomic writes and concurrency protection.
 *
 * Key principles:
 * - Atomic writes using temp file and rename (Windows-compatible)
 * - Concurrency protection via version-based conflict detection
 * - Explicit user-initiated reset only - never silent reset
 * - No prompts, outputs, keys, or tool arguments in ledger
 * - Record budget window and reset operations
 */

import {
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  openSync,
  closeSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { BudgetState, BudgetWindow } from './budget.js';
import { createInitialBudgetState, isWindowExpired } from './budget.js';

/**
 * Default ledger file path.
 */
export const DEFAULT_LEDGER_PATH = '.qa-platform/usage-ledger.json';

/**
 * Schema version for the ledger file.
 */
export const LEDGER_SCHEMA_VERSION = '1.0';

/**
 * Usage ledger data structure.
 *
 * Contains all persistent usage tracking data.
 * Never contains prompts, outputs, keys, or tool arguments.
 */
export interface UsageLedger {
  /**
   * Schema version for migration support.
   */
  readonly schemaVersion: string;

  /**
   * When the ledger was created.
   */
  readonly createdAt: string;

  /**
   * When the ledger was last updated.
   */
  readonly updatedAt: string;

  /**
   * Version number for optimistic concurrency control.
   * Incremented on every write.
   */
  readonly version: number;

  /**
   * Current budget state.
   */
  readonly budgetState: BudgetState;

  /**
   * Request entries (without sensitive data).
   */
  readonly entries: readonly LedgerEntry[];

  /**
   * Reset history.
   */
  readonly resets: readonly LedgerReset[];

  /**
   * Active reservations (pending reconciliation).
   */
  readonly activeReservations: readonly ActiveReservation[];
}

/**
 * A single usage entry in the ledger.
 *
 * Contains only operational metadata - NO sensitive data.
 */
export interface LedgerEntry {
  /**
   * Platform request ID for correlation.
   */
  readonly platformRequestId: string;

  /**
   * When the request was made.
   */
  readonly timestamp: string;

  /**
   * Provider ID used.
   */
  readonly providerId: string;

  /**
   * Model ID used.
   */
  readonly modelId: string;

  /**
   * Request attempt number.
   */
  readonly attemptNumber: number;

  /**
   * Whether request succeeded.
   */
  readonly success: boolean;

  /**
   * Estimated input tokens (preflight).
   */
  readonly estimatedInputTokens: number;

  /**
   * Maximum output tokens requested.
   */
  readonly maxOutputTokens: number;

  /**
   * Observed input tokens (from provider, or null if unknown).
   */
  readonly observedInputTokens: number | null;

  /**
   * Observed output tokens (from provider, or null if unknown).
   */
  readonly observedOutputTokens: number | null;

  /**
   * Request duration in milliseconds.
   */
  readonly durationMs: number | null;

  /**
   * Error code if failed (safe to log).
   */
  readonly errorCode?: string;
}

/**
 * Record of a budget reset.
 */
export interface LedgerReset {
  /**
   * When the reset was performed.
   */
  readonly timestamp: string;

  /**
   * Reason for the reset.
   */
  readonly reason: ResetReason;

  /**
   * State before reset.
   */
  readonly previousState: BudgetState;

  /**
   * Who/what initiated the reset.
   */
  readonly initiatedBy: string;
}

/**
 * Reasons for budget reset.
 */
export type ResetReason =
  | 'user_requested'
  | 'window_expired'
  | 'budget_config_changed';

/**
 * An active reservation pending reconciliation.
 */
export interface ActiveReservation {
  /**
   * Reservation ID.
   */
  readonly reservationId: string;

  /**
   * Platform request ID.
   */
  readonly platformRequestId: string;

  /**
   * When reserved.
   */
  readonly reservedAt: string;

  /**
   * Input tokens reserved.
   */
  readonly inputReserved: number;

  /**
   * Output tokens reserved.
   */
  readonly outputReserved: number;
}

/**
 * Result of a ledger operation.
 */
export interface LedgerOperationResult {
  /**
   * Whether the operation succeeded.
   */
  readonly success: boolean;

  /**
   * Updated ledger if successful.
   */
  readonly ledger?: UsageLedger;

  /**
   * Error if failed.
   */
  readonly error?: LedgerError;
}

/**
 * Ledger operation error.
 */
export interface LedgerError {
  readonly code: LedgerErrorCode;
  readonly message: string;
  readonly details?: string;
}

/**
 * Ledger error codes.
 */
export type LedgerErrorCode =
  | 'VERSION_CONFLICT'
  | 'FILE_LOCKED'
  | 'WRITE_FAILED'
  | 'READ_FAILED'
  | 'INVALID_SCHEMA'
  | 'CORRUPTED'
  | 'LOCK_ACQUISITION_FAILED'
  | 'LOCK_STALE'
  | 'LOCK_HELD_BY_OTHER';

/**
 * Generate a unique temp file path.
 */
function generateTempPath(basePath: string): string {
  const dir = dirname(basePath);
  const random = randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return join(dir, `ledger-${timestamp}-${random}.tmp`);
}

/**
 * Safely cleanup a temp file.
 */
function cleanupTempFile(tempPath: string): void {
  try {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
  } catch {
    // Cleanup is best-effort
  }
}

/**
 * Lock file content structure.
 */
interface LockFileContent {
  readonly pid: number;
  readonly timestamp: string;
  readonly hostname: string;
}

/**
 * Result of acquiring a ledger lock.
 */
export interface LockAcquisitionResult {
  readonly acquired: true;
  readonly lockPath: string;
  readonly release: () => void;
}

/**
 * Result of a failed lock acquisition.
 */
export interface LockAcquisitionFailure {
  readonly acquired: false;
  readonly error: LedgerError;
}

/**
 * Result type for lock operations.
 */
export type LockResult = LockAcquisitionResult | LockAcquisitionFailure;

/**
 * Default stale lock threshold in milliseconds (5 minutes).
 * Locks older than this are considered stale and can be forcibly removed.
 */
export const DEFAULT_STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Get the lock file path for a ledger.
 */
export function getLockPath(ledgerPath: string): string {
  return ledgerPath + '.lock';
}

/**
 * Check if a lock file is stale.
 *
 * A lock is considered stale if:
 * 1. It's older than the threshold, OR
 * 2. The file cannot be read/parsed
 *
 * @param lockPath - Path to the lock file
 * @param thresholdMs - Stale threshold in milliseconds
 * @returns Object with stale status and optional lock content
 */
export function isLockStale(
  lockPath: string,
  thresholdMs: number = DEFAULT_STALE_LOCK_THRESHOLD_MS
): { stale: boolean; content?: LockFileContent; reason?: string } {
  if (!existsSync(lockPath)) {
    return { stale: false }; // No lock = not stale (doesn't exist)
  }

  try {
    // Check file modification time first (fast check)
    const stats = statSync(lockPath);
    const fileAge = Date.now() - stats.mtimeMs;
    if (fileAge > thresholdMs) {
      return { stale: true, reason: `Lock file is ${Math.round(fileAge / 1000)}s old (threshold: ${Math.round(thresholdMs / 1000)}s)` };
    }

    // Try to read and parse lock content
    const content = readFileSync(lockPath, 'utf-8');
    let lockData: LockFileContent;
    try {
      lockData = JSON.parse(content) as LockFileContent;
    } catch {
      return { stale: true, reason: 'Lock file content is corrupted' };
    }

    // Check timestamp in content
    const lockTimestamp = new Date(lockData.timestamp).getTime();
    if (isNaN(lockTimestamp)) {
      return { stale: true, reason: 'Lock file has invalid timestamp' };
    }

    const contentAge = Date.now() - lockTimestamp;
    if (contentAge > thresholdMs) {
      return { stale: true, content: lockData, reason: `Lock timestamp is ${Math.round(contentAge / 1000)}s old` };
    }

    return { stale: false, content: lockData };
  } catch {
    // If we can't read the file, consider it stale
    return { stale: true, reason: 'Failed to read lock file' };
  }
}

/**
 * Acquire an exclusive lock on the ledger.
 *
 * Uses fs.open with 'wx' flag for atomic exclusive file creation.
 * Implements stale lock detection and cleanup.
 *
 * @param ledgerPath - Path to the ledger file
 * @param staleThresholdMs - Threshold for considering a lock stale
 * @returns Lock acquisition result
 */
export function acquireLedgerLock(
  ledgerPath: string,
  staleThresholdMs: number = DEFAULT_STALE_LOCK_THRESHOLD_MS
): LockResult {
  const lockPath = getLockPath(ledgerPath);
  const dir = dirname(lockPath);

  // Ensure directory exists
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Check for stale lock first
  const staleCheck = isLockStale(lockPath, staleThresholdMs);
  if (staleCheck.stale && existsSync(lockPath)) {
    // Remove stale lock
    try {
      unlinkSync(lockPath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        return {
          acquired: false,
          error: {
            code: 'LOCK_STALE',
            message: `Stale lock exists but cannot be removed: ${error.message}`,
            details: staleCheck.reason,
          },
        };
      }
    }
  }

  // Try to create lock file exclusively
  const lockContent: LockFileContent = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    hostname: hostname(),
  };

  let fd: number;
  try {
    // 'wx' = write exclusive: fails if file exists
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EEXIST') {
      // Lock file exists - check who holds it
      const existingStale = isLockStale(lockPath, staleThresholdMs);
      if (existingStale.content) {
        return {
          acquired: false,
          error: {
            code: 'LOCK_HELD_BY_OTHER',
            message: `Lock held by PID ${existingStale.content.pid} on ${existingStale.content.hostname}`,
            details: `Acquired at: ${existingStale.content.timestamp}`,
          },
        };
      }
      return {
        acquired: false,
        error: {
          code: 'LOCK_ACQUISITION_FAILED',
          message: 'Lock file exists and is held by another process',
        },
      };
    }
    return {
      acquired: false,
      error: {
        code: 'LOCK_ACQUISITION_FAILED',
        message: `Failed to create lock file: ${error.message}`,
        details: error.code,
      },
    };
  }

  // Write lock content and close
  try {
    writeFileSync(fd, JSON.stringify(lockContent, null, 2), 'utf-8');
  } finally {
    closeSync(fd);
  }

  // Return lock with release function
  const release = (): void => {
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Best-effort cleanup
    }
  };

  return {
    acquired: true,
    lockPath,
    release,
  };
}

/**
 * Execute a function while holding the ledger lock.
 *
 * This is the recommended way to perform read-modify-write operations
 * on the ledger with cross-process safety.
 *
 * @param ledgerPath - Path to the ledger file
 * @param operation - Function to execute while holding the lock
 * @param staleThresholdMs - Threshold for considering a lock stale
 * @returns Operation result
 */
export function withLedgerLock<T>(
  ledgerPath: string,
  operation: () => T,
  staleThresholdMs: number = DEFAULT_STALE_LOCK_THRESHOLD_MS
): LedgerOperationResult & { result?: T } {
  const lockResult = acquireLedgerLock(ledgerPath, staleThresholdMs);

  if (!lockResult.acquired) {
    return {
      success: false,
      error: lockResult.error,
    };
  }

  try {
    const result = operation();
    return {
      success: true,
      result,
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'WRITE_FAILED',
        message: `Operation failed: ${(err as Error).message}`,
      },
    };
  } finally {
    lockResult.release();
  }
}

/**
 * Safely perform a read-modify-write operation on the ledger.
 *
 * Combines locking and version-based conflict detection.
 *
 * @param path - Path to the ledger file
 * @param modifier - Function that takes the current ledger and returns the updated ledger
 * @param staleThresholdMs - Threshold for considering a lock stale
 * @returns Operation result with updated ledger
 */
export function modifyLedger(
  path: string,
  modifier: (ledger: UsageLedger) => UsageLedger,
  staleThresholdMs: number = DEFAULT_STALE_LOCK_THRESHOLD_MS
): LedgerOperationResult {
  return withLedgerLock(path, () => {
    const existing = loadLedger(path);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'READ_FAILED',
          message: 'Ledger file does not exist',
        },
      };
    }

    const modified = modifier(existing);
    return saveLedger(modified, existing.version, path);
  }, staleThresholdMs) as LedgerOperationResult;
}

/**
 * Load the usage ledger from disk.
 *
 * @param path - Path to ledger file
 * @returns The ledger or undefined if not found
 * @throws Error if file exists but is invalid/corrupted
 */
export function loadLedger(path: string = DEFAULT_LEDGER_PATH): UsageLedger | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read ledger: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Ledger file is not valid JSON');
  }

  // Validate basic structure
  if (typeof data !== 'object' || data === null) {
    throw new Error('Ledger file has invalid structure');
  }

  const ledger = data as Record<string, unknown>;

  if (ledger.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new Error(
      `Ledger schema version mismatch: expected ${LEDGER_SCHEMA_VERSION}, found ${ledger.schemaVersion}`
    );
  }

  return data as UsageLedger;
}

/**
 * Save the usage ledger to disk atomically.
 *
 * Uses temp file + rename for atomic writes.
 * Uses version-based conflict detection for concurrency safety.
 *
 * @param ledger - Ledger to save
 * @param expectedVersion - Expected version for optimistic locking (or null for new file)
 * @param path - Path to ledger file
 * @returns Operation result
 */
export function saveLedger(
  ledger: UsageLedger,
  expectedVersion: number | null,
  path: string = DEFAULT_LEDGER_PATH
): LedgerOperationResult {
  const dir = dirname(path);
  const tempPath = generateTempPath(path);

  try {
    // Ensure directory exists
    mkdirSync(dir, { recursive: true });

    // Check for version conflict
    const existing = loadLedger(path);
    if (expectedVersion !== null) {
      if (!existing) {
        return {
          success: false,
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Ledger file was deleted since read',
          },
        };
      }
      if (existing.version !== expectedVersion) {
        return {
          success: false,
          error: {
            code: 'VERSION_CONFLICT',
            message: `Version conflict: expected ${expectedVersion}, found ${existing.version}`,
            details: 'Another process updated the ledger. Retry the operation.',
          },
        };
      }
    }

    // Increment version
    const updatedLedger: UsageLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: new Date().toISOString(),
    };

    // Write to temp file
    const content = JSON.stringify(updatedLedger, null, 2);
    writeFileSync(tempPath, content, { encoding: 'utf-8' });

    // Atomic rename
    try {
      renameSync(tempPath, path);
    } catch (err) {
      cleanupTempFile(tempPath);
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EPERM' || error.code === 'EBUSY') {
        return {
          success: false,
          error: {
            code: 'FILE_LOCKED',
            message: 'Ledger file is locked by another process',
            details: error.code,
          },
        };
      }
      throw err;
    }

    return {
      success: true,
      ledger: updatedLedger,
    };
  } catch (err) {
    cleanupTempFile(tempPath);
    return {
      success: false,
      error: {
        code: 'WRITE_FAILED',
        message: `Failed to save ledger: ${(err as Error).message}`,
      },
    };
  }
}

/**
 * Create a new empty ledger.
 *
 * @param budgetWindow - Budget window configuration
 * @returns New empty ledger
 */
export function createEmptyLedger(budgetWindow: BudgetWindow): UsageLedger {
  const now = new Date().toISOString();
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    version: 0,
    budgetState: createInitialBudgetState(budgetWindow),
    entries: [],
    resets: [],
    activeReservations: [],
  };
}

/**
 * Initialize or load the usage ledger.
 *
 * Creates a new ledger if none exists.
 *
 * @param budgetWindow - Budget window for new ledger
 * @param path - Path to ledger file
 * @returns The ledger
 */
export function initializeLedger(
  budgetWindow: BudgetWindow,
  path: string = DEFAULT_LEDGER_PATH
): UsageLedger {
  const existing = loadLedger(path);
  if (existing) {
    return existing;
  }

  const newLedger = createEmptyLedger(budgetWindow);
  const result = saveLedger(newLedger, null, path);
  if (!result.success) {
    throw new Error(`Failed to initialize ledger: ${result.error?.message}`);
  }

  return result.ledger!;
}

/**
 * Add a request entry to the ledger.
 *
 * @param ledger - Current ledger
 * @param entry - Entry to add
 * @returns Updated ledger
 */
export function addLedgerEntry(ledger: UsageLedger, entry: LedgerEntry): UsageLedger {
  // Update budget state counters
  const updatedState: BudgetState = {
    ...ledger.budgetState,
    requestCount: ledger.budgetState.requestCount + 1,
    cumulativeInputTokens: ledger.budgetState.cumulativeInputTokens +
      (entry.observedInputTokens ?? entry.estimatedInputTokens),
    cumulativeOutputTokens: ledger.budgetState.cumulativeOutputTokens +
      (entry.observedOutputTokens ?? entry.maxOutputTokens),
  };

  return {
    ...ledger,
    budgetState: updatedState,
    entries: [...ledger.entries, entry],
  };
}

/**
 * Add an active reservation to the ledger.
 *
 * @param ledger - Current ledger
 * @param reservation - Reservation to add
 * @returns Updated ledger
 */
export function addReservation(
  ledger: UsageLedger,
  reservation: ActiveReservation
): UsageLedger {
  return {
    ...ledger,
    activeReservations: [...ledger.activeReservations, reservation],
  };
}

/**
 * Remove a reservation from the ledger (after reconciliation).
 *
 * @param ledger - Current ledger
 * @param reservationId - ID of reservation to remove
 * @returns Updated ledger
 */
export function removeReservation(
  ledger: UsageLedger,
  reservationId: string
): UsageLedger {
  return {
    ...ledger,
    activeReservations: ledger.activeReservations.filter(
      (r) => r.reservationId !== reservationId
    ),
  };
}

/**
 * Reset the budget state.
 *
 * IMPORTANT: This requires explicit user action.
 * Never call this automatically on process start or after failures.
 *
 * @param ledger - Current ledger
 * @param budgetWindow - Budget window for new period
 * @param reason - Reason for reset
 * @param initiatedBy - Who initiated the reset
 * @returns Updated ledger with reset recorded
 */
export function resetBudget(
  ledger: UsageLedger,
  budgetWindow: BudgetWindow,
  reason: ResetReason,
  initiatedBy: string
): UsageLedger {
  const reset: LedgerReset = {
    timestamp: new Date().toISOString(),
    reason,
    previousState: ledger.budgetState,
    initiatedBy,
  };

  return {
    ...ledger,
    budgetState: createInitialBudgetState(budgetWindow),
    entries: [], // Clear entries for new window
    resets: [...ledger.resets, reset],
    activeReservations: [], // Clear reservations on reset
  };
}

/**
 * Check if the budget window has expired and needs reset.
 *
 * NOTE: This does NOT automatically reset. The caller must explicitly
 * call resetBudget if they want to reset, with 'window_expired' reason.
 *
 * @param ledger - Current ledger
 * @param budgetWindow - Budget window configuration
 * @returns true if window has expired
 */
export function isLedgerWindowExpired(
  ledger: UsageLedger,
  budgetWindow: BudgetWindow
): boolean {
  return isWindowExpired(budgetWindow, ledger.budgetState.windowStart);
}

/**
 * Get a summary of ledger state for diagnostics.
 *
 * Returns safe information - no sensitive data.
 */
export function getLedgerSummary(ledger: UsageLedger): LedgerSummary {
  return {
    version: ledger.version,
    requestCount: ledger.budgetState.requestCount,
    cumulativeInputTokens: ledger.budgetState.cumulativeInputTokens,
    cumulativeOutputTokens: ledger.budgetState.cumulativeOutputTokens,
    windowStart: ledger.budgetState.windowStart,
    windowEnd: ledger.budgetState.windowEnd,
    entryCount: ledger.entries.length,
    resetCount: ledger.resets.length,
    activeReservationCount: ledger.activeReservations.length,
    lastUpdated: ledger.updatedAt,
  };
}

/**
 * Safe summary of ledger state for diagnostics.
 */
export interface LedgerSummary {
  readonly version: number;
  readonly requestCount: number;
  readonly cumulativeInputTokens: number;
  readonly cumulativeOutputTokens: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly entryCount: number;
  readonly resetCount: number;
  readonly activeReservationCount: number;
  readonly lastUpdated: string;
}

/**
 * Forbidden fields that must never appear in ledger entries.
 * These would indicate sensitive data leakage.
 */
const FORBIDDEN_LEDGER_FIELDS = [
  'prompt', 'content', 'message', 'messages',
  'apiKey', 'key', 'secret', 'token', 'authorization',
  'toolArguments', 'arguments', 'payload',
  'response', 'output', 'completion',
  'continuationPayload', 'continuationState',
] as const;

/**
 * Check if a value is a plain object (not null, array, or other type).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate unknown input for forbidden fields.
 *
 * This is a safe runtime check that accepts unknown input and validates
 * it does not contain sensitive data fields.
 *
 * @param input - Unknown value to validate
 * @returns Array of validation errors, empty if valid
 */
export function validateRecordSafety(input: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    errors.push('Input is not a plain object');
    return errors;
  }

  // Check for forbidden fields
  for (const field of FORBIDDEN_LEDGER_FIELDS) {
    if (field in input && input[field] !== undefined) {
      errors.push(`Record contains forbidden field: ${field}`);
    }
  }

  return errors;
}

/**
 * Validate that a ledger entry contains no sensitive data.
 *
 * @param entry - Entry to validate
 * @returns Array of validation errors, empty if valid
 */
export function validateEntrySafety(entry: LedgerEntry): string[] {
  // LedgerEntry is already typed, but we validate at runtime in case
  // the entry was constructed from untrusted sources
  return validateRecordSafety(entry);
}
