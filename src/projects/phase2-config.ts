/**
 * Phase 2 project configuration types
 *
 * Extends Phase 1 ExecutionConfig with fields for:
 * - Role profiles (identity + credential environment-variable names)
 * - Document references (for tracking source documents)
 *
 * All new fields are optional to maintain Phase 1 backward compatibility.
 * Phase 1 configurations remain valid without modification.
 *
 * SECURITY:
 * - Never store passwords, tokens, cookies, or storage-state contents
 * - Only environment-variable NAMES are stored, not secret values
 * - Authentication state files are handled separately (Git-ignored)
 */

import type { ExecutionConfig, ResolvedConfig, Environment } from './config.js';

/**
 * Role profile defines a role's identity and credential references.
 *
 * Credentials are supplied through environment variables. This type stores
 * only the environment-variable NAMES, never the actual secret values.
 *
 * Per DEC-024: Define role profiles and environment-variable credential
 * references during Phase 2. Never store passwords, tokens, cookies, or
 * session state contents.
 *
 * NOTE: Role validation is implemented in Task 2.9, not here.
 */
export interface RoleProfile {
  /** Unique role identifier within the project (e.g., "admin", "customer") */
  roleId: string;

  /** Human-readable role name */
  name: string;

  /** Optional description of the role */
  description?: string;

  /**
   * Environment variable names for credentials.
   * Keys are credential identifiers (e.g., "username", "password").
   * Values are environment variable names (e.g., "SAUCEDEMO_ADMIN_USER").
   *
   * Example:
   * {
   *   "username": "SAUCEDEMO_ADMIN_USER",
   *   "password": "SAUCEDEMO_ADMIN_PASSWORD"
   * }
   */
  credentials: Record<string, string>;

  /**
   * Path to Playwright storageState file relative to project workspace.
   * This file may contain cookies/tokens and must be Git-ignored.
   * Optional - authentication may use other mechanisms.
   */
  storageStatePath?: string;
}

/**
 * Declaration of a source document associated with the project.
 *
 * Per DEC-030: This is a declaration in project configuration specifying
 * which documents belong to this project. It represents intent, not state.
 *
 * The actual ingested document metadata (content hash, snapshot path,
 * version history) is stored in the DocumentRegistry (documents.json).
 *
 * During document ingestion (Task 2.4):
 * 1. Platform reads this reference to locate the source file
 * 2. Computes content hash and creates immutable snapshot
 * 3. Updates DocumentRegistry with ingested version metadata
 *
 * The documentId must match between this reference and the DocumentRegistry
 * to link project configuration to ingested document state.
 */
export interface DocumentReference {
  /**
   * Unique document identifier within the project.
   * Must match the documentId in DocumentRegistry after ingestion.
   */
  documentId: string;

  /**
   * Source path relative to project workspace.
   * Where the document file is located for ingestion.
   */
  sourcePath: string;

  /** Document format identifier */
  format: 'markdown' | 'text';
}

/** Exploration permissions (DEC-041 §6): interactive adds click, type, select and key tools. */
export type ExplorationMode = 'read-only' | 'interactive';

export interface ExplorationSettings {
  /** Default `read-only`. */
  mode: ExplorationMode;
}

/**
 * Phase 2 project configuration.
 *
 * Extends Phase 1 ExecutionConfig with optional fields for:
 * - Role profiles for authenticated workflows
 * - Document references for requirements sources
 *
 * All Phase 1 fields retain their names and meaning (per DEC-015).
 * New fields are optional to maintain backward compatibility.
 */
export interface Phase2ProjectConfig extends ExecutionConfig {
  /**
   * Role profiles for authenticated workflows.
   * Each role defines credentials through environment-variable names.
   * Optional - projects may have no authentication requirements.
   */
  roles?: RoleProfile[];

  /**
   * Document references for requirements sources.
   * These reference workflow/requirements documents to be ingested.
   * Optional - documents may be added after project creation.
   */
  documents?: DocumentReference[];

  /**
   * Optional project description.
   */
  description?: string;

  /** Exploration settings (Task Q2); absent means read-only. */
  exploration?: ExplorationSettings;
}

/**
 * Resolved Phase 2 configuration with absolute paths.
 * Extends ResolvedConfig with Phase 2 additions.
 */
export interface ResolvedPhase2Config extends ResolvedConfig {
  /** Role profiles if defined */
  roles?: RoleProfile[];

  /** Document references if defined */
  documents?: DocumentReference[];

  /** Project description if defined */
  description?: string;

  /** Exploration settings if defined */
  exploration?: ExplorationSettings;
}

// Re-export Phase 1 types for convenience
export type { ExecutionConfig, ResolvedConfig, Environment };
