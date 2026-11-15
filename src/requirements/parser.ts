/**
 * Deterministic parser for structured Markdown requirement documents
 *
 * This parser implements the exact grammar defined in REQUIREMENTS_AUTHORING_CONVENTION.md.
 * It produces candidate requirement records that can be validated by Task 2.6 validators.
 *
 * Key behaviors:
 * - Parses only the exact structured Markdown convention (no general-purpose Markdown)
 * - Produces Requirement type from types.ts (not a parallel parser-only schema)
 * - Reports malformed structure with line-numbered diagnostics
 * - Distinguishes malformed structure from unresolved business behavior
 * - Never infers or invents expected outcomes
 * - Preserves original text and source references
 * - Deterministic: no AI, no external services
 *
 * See REQUIREMENTS_AUTHORING_CONVENTION.md for the authoritative grammar.
 */

import { readFileSync } from 'node:fs';
import { REQUIREMENT_ID_PATTERN } from './validation.js';
import type {
  Requirement,
  RequirementPriority,
  RequirementStatus,
  NegativeCase,
  UnresolvedMarker,
  SourceReference,
} from './types.js';
import { resolveDocumentSnapshotPath } from '../projects/storage.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Diagnostic severity level.
 */
export type DiagnosticSeverity = 'error' | 'warning';

/**
 * Parse diagnostic with line number for actionable error reporting.
 *
 * Diagnostics are produced for:
 * - Malformed heading/field syntax
 * - Invalid field values
 * - Duplicate IDs within the document
 * - Missing required sections
 * - Malformed negative case syntax
 * - Unknown fields/sections (warning)
 */
export interface ParseDiagnostic {
  /** Line number (1-based) where the issue occurs */
  line: number;
  /** End line for multi-line issues (optional) */
  endLine?: number;
  /** Column number (1-based, optional) */
  column?: number;
  /** Severity: error or warning */
  severity: DiagnosticSeverity;
  /** Human-readable message */
  message: string;
  /** Affected requirement ID/heading if known */
  requirementId?: string;
  /** Raw source text that caused the issue (optional) */
  sourceText?: string;
}

/**
 * Context provided by the caller for document identity.
 * These values come from the project/document ingestion context,
 * not from filenames or requirement text.
 */
export interface ParseContext {
  /** Project ID from project.config.json */
  projectId: string;
  /** Document ID from project.config.json documents array */
  documentId: string;
  /** Content hash of the document snapshot being parsed */
  contentHash: string;
  /** Documents directory for snapshot path resolution */
  documentsDir: string;
  /** Relative snapshot path (e.g., "sources/<hash>.md") */
  snapshotPath: string;
}

/**
 * Parsed requirement candidate before validation.
 * Includes the full Requirement structure plus parsing metadata.
 */
export interface ParsedRequirement {
  /** The requirement record (may be incomplete if parsing failed) */
  requirement: Requirement;
  /** Whether this requirement is structurally complete (all required sections present) */
  isComplete: boolean;
  /** Line range for this requirement */
  lineRange: { start: number; end: number };
  /** Any unknown fields/sections found (preserved per convention section 7) */
  unknownContent: UnknownContent[];
}

/**
 * Unknown field or section preserved per convention section 7.
 */
export interface UnknownContent {
  /** Type: 'field' or 'section' */
  type: 'field' | 'section';
  /** Name of the unknown field/section */
  name: string;
  /** Line number where it appears */
  line: number;
  /** Original text content */
  text: string;
}

/**
 * Result of parsing a requirement document.
 */
export interface ParseResult {
  /** Successfully parsed requirements (may include incomplete/unresolved ones) */
  requirements: ParsedRequirement[];
  /** All diagnostics (errors and warnings) */
  diagnostics: ParseDiagnostic[];
  /** Document-level metadata extracted */
  documentTitle?: string;
  /** Total lines in the document */
  totalLines: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Requirement heading pattern: ## REQ-001: Title
 * Captures: id, title
 */
const REQUIREMENT_HEADING_REGEX = /^##\s+([A-Z][A-Z0-9]*-\d+):\s*(.+?)\s*$/;

/**
 * Field line pattern: Key: Value
 * Captures: key, value
 */
const FIELD_LINE_REGEX = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/;

/**
 * Section heading pattern: ### Section Name
 * Captures: name
 */
const SECTION_HEADING_REGEX = /^###\s+(.+?)\s*$/;

/**
 * Negative case bullet pattern: - condition: expected outcome
 * The first `: ` after the list marker separates condition from outcome.
 */
const NEGATIVE_CASE_REGEX = /^-\s+(.+?):\s+(.+)$/;

// Note: Field and section validation uses inline comparisons for clarity.
// Known values are documented in REQUIREMENTS_AUTHORING_CONVENTION.md:
// - Status: active, retired
// - Priority: critical, high, medium, low
// - Known sections: description, expected result, negative cases, unresolved
// - Known fields: status, priority, role

/**
 * Pattern to detect malformed requirement-like headings.
 *
 * A heading is considered "requirement-like" if it:
 * - Starts with ## (level 2 heading)
 * - Contains something that looks like an ID (uppercase prefix + digits)
 *
 * This pattern identifies headings that LOOK like requirements but don't
 * conform to the exact grammar. It is NOT applied to every ## heading.
 *
 * Detection rules:
 * - `## REQ-001 Login` - missing colon separator → malformed
 * - `## req-001: Login` - lowercase ID → malformed
 * - `## REQ001: Login` - missing hyphen in ID → malformed
 * - `## About This Document` - ordinary heading → NOT malformed
 */
const MALFORMED_REQUIREMENT_LIKE_PATTERN = /^##\s+([A-Za-z][A-Za-z0-9]*[-_]?\d+|[A-Z][A-Z0-9]*-\d+[A-Za-z-]*)/;

// ============================================================================
// Input Normalization
// ============================================================================

/**
 * Fenced code block region (1-based line numbers, inclusive).
 */
interface FencedRegion {
  startLine: number;
  endLine: number;
}

/**
 * Result of identifying fenced code blocks in a document.
 */
interface FencedCodeBlocksResult {
  /** Fenced regions found (including unclosed ones extended to end of document) */
  regions: FencedRegion[];
  /** Information about an unclosed fence, if present */
  unclosedFence?: {
    /** 1-based line number where the opening fence occurs */
    line: number;
    /** The fence character used ('`' or '~') */
    fenceChar: string;
    /** The full text of the opening fence line */
    fenceText: string;
  };
}

/**
 * Normalize input content for parsing.
 *
 * This function:
 * - Strips UTF-8 BOM if present at the start
 * - Normalizes CRLF to LF for consistent parsing
 *
 * The original document content is NOT modified; this normalization
 * is only for parsing purposes.
 *
 * @param content - Raw document content
 * @returns Normalized content
 */
function normalizeInputContent(content: string): string {
  let normalized = content;

  // Strip UTF-8 BOM (U+FEFF) if present at start
  if (normalized.charCodeAt(0) === 0xFEFF) {
    normalized = normalized.slice(1);
  }

  // Normalize CRLF to LF
  // This ensures field values don't retain trailing \r
  normalized = normalized.replace(/\r\n/g, '\n');

  // Also handle standalone CR (rare, but possible in old Mac files)
  normalized = normalized.replace(/\r/g, '\n');

  return normalized;
}

/**
 * Identify fenced code block regions in the document.
 *
 * Supports both backtick (```) and tilde (~~~) fences.
 * Content inside fenced blocks should be ignored for requirement parsing.
 *
 * @param lines - Document lines (already split)
 * @returns Result with fenced regions and any unclosed fence information
 */
function identifyFencedCodeBlocks(lines: string[]): FencedCodeBlocksResult {
  const regions: FencedRegion[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceStart = 0;
  let fenceText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for fence markers (``` or ~~~, optionally with language tag)
    const backtickMatch = line.match(/^(`{3,})/);
    const tildeMatch = line.match(/^(~{3,})/);

    if (!inFence) {
      // Look for opening fence
      if (backtickMatch) {
        inFence = true;
        fenceChar = '`';
        fenceStart = lineNum;
        fenceText = line;
      } else if (tildeMatch) {
        inFence = true;
        fenceChar = '~';
        fenceStart = lineNum;
        fenceText = line;
      }
    } else {
      // Look for closing fence (must match opening fence type)
      if ((fenceChar === '`' && backtickMatch) || (fenceChar === '~' && tildeMatch)) {
        // Closing fence found
        regions.push({ startLine: fenceStart, endLine: lineNum });
        inFence = false;
        fenceChar = '';
        fenceText = '';
      }
    }
  }

  // If still in fence at end of document, close it at the last line
  if (inFence) {
    regions.push({ startLine: fenceStart, endLine: lines.length });
    return {
      regions,
      unclosedFence: {
        line: fenceStart,
        fenceChar,
        fenceText,
      },
    };
  }

  return { regions };
}

/**
 * Check if a line number is inside a fenced code block.
 *
 * @param lineNum - 1-based line number
 * @param regions - Fenced regions from identifyFencedCodeBlocks
 * @returns true if line is inside a fenced block
 */
function isInsideFencedBlock(lineNum: number, regions: FencedRegion[]): boolean {
  for (const region of regions) {
    if (lineNum >= region.startLine && lineNum <= region.endLine) {
      return true;
    }
  }
  return false;
}

/**
 * Detect malformed requirement-like headings.
 *
 * This function identifies headings that LOOK like requirements but don't
 * conform to the exact grammar. Ordinary Markdown headings (like "## About")
 * are NOT flagged as malformed.
 *
 * Malformed cases:
 * - `## REQ-01 Login` - missing colon separator
 * - `## req-001: Login` - lowercase ID
 * - `## REQ001: Login` - malformed ID format (missing hyphen)
 *
 * @param line - Line content
 * @param lineNum - 1-based line number
 * @returns Diagnostic if malformed, undefined otherwise
 */
function detectMalformedRequirementHeading(line: string, lineNum: number): ParseDiagnostic | undefined {
  // Only check level 2 headings
  if (!line.startsWith('## ')) {
    return undefined;
  }

  // Check if it looks like a requirement-like heading
  const match = line.match(MALFORMED_REQUIREMENT_LIKE_PATTERN);
  if (!match) {
    // This is an ordinary heading like "## About This Document"
    return undefined;
  }

  const potentialId = match[1];

  // If it already matched REQUIREMENT_HEADING_REGEX, it's valid (not malformed)
  if (REQUIREMENT_HEADING_REGEX.test(line)) {
    return undefined;
  }

  // Determine the specific malformation
  let message: string;
  let extractedId: string | undefined;

  // Check for missing colon
  if (!line.includes(':')) {
    message = `Malformed requirement heading: missing ':' separator after ID. Expected format: '## ID: Title'`;
    // Try to extract the ID for the diagnostic
    if (REQUIREMENT_ID_PATTERN.test(potentialId)) {
      extractedId = potentialId;
    }
  }
  // Check for lowercase ID
  else if (/^[a-z]/.test(potentialId) || potentialId !== potentialId.toUpperCase().replace(/[^A-Z0-9-]/g, '')) {
    message = `Malformed requirement heading: ID '${potentialId}' contains lowercase letters. IDs must be uppercase.`;
    extractedId = potentialId.toUpperCase();
  }
  // Check for malformed ID format (e.g., missing hyphen)
  else if (!REQUIREMENT_ID_PATTERN.test(potentialId)) {
    message = `Malformed requirement heading: ID '${potentialId}' does not match required format. Expected: uppercase prefix + hyphen + numeric suffix (e.g., REQ-001)`;
  }
  // Generic malformation
  else {
    message = `Malformed requirement heading: does not match expected format '## ID: Title'`;
  }

  return {
    line: lineNum,
    severity: 'error',
    message,
    requirementId: extractedId,
    sourceText: line,
  };
}

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Parse a structured Markdown requirement document.
 *
 * This is the main entry point. It reads the snapshot file using the
 * provided context and parses all requirement sections.
 *
 * @param context - Parse context with document identity
 * @returns Parse result with requirements and diagnostics
 */
export function parseRequirementDocument(context: ParseContext): ParseResult {
  // Resolve snapshot path to absolute filesystem path
  const pathResult = resolveDocumentSnapshotPath(context.snapshotPath, context.documentsDir);

  if (!pathResult.isContained) {
    return {
      requirements: [],
      diagnostics: [{
        line: 1,
        severity: 'error',
        message: `Snapshot path escapes containment: ${pathResult.error}`,
      }],
      totalLines: 0,
    };
  }

  // Read the snapshot content
  let content: string;
  try {
    content = readFileSync(pathResult.absolutePath, 'utf-8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return {
      requirements: [],
      diagnostics: [{
        line: 1,
        severity: 'error',
        message: `Failed to read snapshot: ${error.message}`,
      }],
      totalLines: 0,
    };
  }

  return parseRequirementContent(content, context);
}

/**
 * Parse requirement document content directly.
 *
 * This is useful for testing or when content is already loaded.
 *
 * ## Parse Result Contract
 *
 * The parser returns a `ParseResult` containing:
 *
 * - **requirements**: Array of `ParsedRequirement` candidates. These are requirements
 *   whose structure could be parsed, even if they contain errors. A candidate is
 *   included if the heading was successfully parsed (valid `## ID: Title` format).
 *   Candidates may have:
 *   - Missing required fields (Status, Priority)
 *   - Invalid field values
 *   - Missing required sections (Description, Expected result)
 *   - Malformed negative cases (empty outcome preserved as empty string)
 *
 * - **diagnostics**: All errors and warnings produced during parsing. Each diagnostic
 *   includes a 1-based line number. Error diagnostics (`severity: 'error'`) indicate
 *   structural problems that must be resolved. Warning diagnostics (`severity: 'warning'`)
 *   indicate non-blocking issues like unknown fields/sections.
 *
 * ## When Candidates Are Omitted
 *
 * A requirement is NOT included in the candidates array when:
 * - The heading is malformed (doesn't match `## ID: Title` format) - a diagnostic is produced instead
 * - Duplicate fields or sections make the value ambiguous - a diagnostic is produced for the specific issue
 *
 * ## Diagnostic Linkage
 *
 * - Diagnostics include `requirementId` when the error is within a parseable requirement
 * - Diagnostics without a known requirement ID (e.g., document-level errors) still include
 *   the source line number and `sourceText` where applicable
 *
 * ## Import Behavior (Task 2.7)
 *
 * Any error-severity parser diagnostic MUST block entire document import. No partial import
 * is allowed. Warnings alone (unknown fields/sections) are non-blocking.
 *
 * @param content - Raw document content
 * @param context - Parse context with document identity
 * @returns Parse result with requirements and diagnostics
 */
export function parseRequirementContent(content: string, context: ParseContext): ParseResult {
  // Normalize input: strip UTF-8 BOM and normalize line endings
  const normalizedContent = normalizeInputContent(content);
  const lines = normalizedContent.split('\n');
  const totalLines = lines.length;
  const diagnostics: ParseDiagnostic[] = [];
  const requirements: ParsedRequirement[] = [];
  let documentTitle: string | undefined;

  // Track requirement IDs for duplicate detection within document
  const seenIds = new Map<string, number>(); // id -> first line number

  // Identify fenced code block regions to skip during parsing
  const fencedResult = identifyFencedCodeBlocks(lines);
  const fencedRegions = fencedResult.regions;

  // Report error for unclosed fenced code block
  if (fencedResult.unclosedFence) {
    const { line, fenceText } = fencedResult.unclosedFence;
    diagnostics.push({
      line,
      severity: 'error',
      message: `Unclosed fenced code block: opening fence at line ${line} has no matching closing fence before end of document`,
      sourceText: fenceText,
    });
  }

  // Find all requirement section boundaries
  const requirementStarts: Array<{ line: number; match: RegExpMatchArray }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Skip lines inside fenced code blocks
    if (isInsideFencedBlock(lineNum, fencedRegions)) {
      continue;
    }

    // Check for document title (# heading)
    if (line.startsWith('# ') && !documentTitle) {
      documentTitle = line.slice(2).trim();
      continue;
    }

    // Check for requirement heading (## ID: Title)
    const reqMatch = line.match(REQUIREMENT_HEADING_REGEX);
    if (reqMatch) {
      requirementStarts.push({ line: lineNum, match: reqMatch });
    } else {
      // Check for malformed requirement-like headings
      const malformedDiag = detectMalformedRequirementHeading(line, lineNum);
      if (malformedDiag) {
        diagnostics.push(malformedDiag);
      }
    }
  }

  // Parse each requirement section
  for (let i = 0; i < requirementStarts.length; i++) {
    const start = requirementStarts[i];
    const endLine = i + 1 < requirementStarts.length
      ? requirementStarts[i + 1].line - 1
      : totalLines;

    const reqId = start.match[1];
    const reqTitle = start.match[2];

    // Check for duplicate IDs within document
    const firstSeenLine = seenIds.get(reqId);
    if (firstSeenLine !== undefined) {
      diagnostics.push({
        line: start.line,
        severity: 'error',
        message: `Duplicate requirement ID '${reqId}' (first seen at line ${firstSeenLine})`,
        requirementId: reqId,
        sourceText: lines[start.line - 1],
      });
    } else {
      seenIds.set(reqId, start.line);
    }

    // Parse the requirement body
    const sectionLines = lines.slice(start.line, endLine); // Lines after heading
    const parsed = parseRequirementBody(
      sectionLines,
      start.line + 1, // Body starts after heading
      reqId,
      reqTitle,
      context,
      start.line,
      endLine
    );

    requirements.push(parsed.requirement);
    diagnostics.push(...parsed.diagnostics);
  }

  // Check for empty document (no requirements found)
  if (requirementStarts.length === 0) {
    diagnostics.push({
      line: 1,
      severity: 'warning',
      message: 'No requirement sections found in document',
    });
  }

  return {
    requirements,
    diagnostics,
    documentTitle,
    totalLines,
  };
}

// ============================================================================
// Requirement Body Parser
// ============================================================================

interface ParsedBody {
  requirement: ParsedRequirement;
  diagnostics: ParseDiagnostic[];
}

/**
 * Parse the body of a single requirement section.
 */
function parseRequirementBody(
  bodyLines: string[],
  bodyStartLine: number,
  requirementId: string,
  title: string,
  context: ParseContext,
  headingLine: number,
  endLine: number
): ParsedBody {
  const diagnostics: ParseDiagnostic[] = [];
  const unknownContent: UnknownContent[] = [];

  // Initialize parsed values
  let status: RequirementStatus | undefined;
  let priority: RequirementPriority | undefined;
  let role: string | undefined;
  let description: string | undefined;
  let expectedResult: string | undefined;
  let negativeCases: NegativeCase[] = [];
  let unresolved: UnresolvedMarker | undefined;

  // Track first occurrence of fields for duplicate detection
  let statusLine: number | undefined;
  let priorityLine: number | undefined;
  let roleLine: number | undefined;
  let negativeCasesSectionLine: number | undefined;

  let lineIndex = 0;

  // Skip any leading empty lines after the heading
  while (lineIndex < bodyLines.length && bodyLines[lineIndex].trim() === '') {
    lineIndex++;
  }

  // Phase 1: Parse field block (Status, Priority, Role)
  // The field block is lines before the first section heading (### )
  // It ends at an empty line followed by a section, or at the first section heading
  let inFieldBlock = true;

  while (lineIndex < bodyLines.length && inFieldBlock) {
    const line = bodyLines[lineIndex];
    const currentLineNum = bodyStartLine + lineIndex;

    // Section heading ends field block
    if (line.startsWith('### ')) {
      inFieldBlock = false;
      break;
    }

    // Empty line might end field block - check if next non-empty is a section
    if (line.trim() === '') {
      // Look ahead to see if we're transitioning to sections
      let nextNonEmpty = lineIndex + 1;
      while (nextNonEmpty < bodyLines.length && bodyLines[nextNonEmpty].trim() === '') {
        nextNonEmpty++;
      }
      // If next non-empty is a section heading or end of body, field block is done
      if (nextNonEmpty >= bodyLines.length || bodyLines[nextNonEmpty].startsWith('### ')) {
        inFieldBlock = false;
        lineIndex++;
        break;
      }
      // Otherwise, continue (might be blank line between fields)
      lineIndex++;
      continue;
    }

    // Try to parse as field
    const fieldMatch = line.match(FIELD_LINE_REGEX);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      const keyLower = key.toLowerCase();

      if (keyLower === 'status') {
        // Check for duplicate Status field
        if (statusLine !== undefined) {
          diagnostics.push({
            line: currentLineNum,
            severity: 'error',
            message: `Duplicate Status field (first seen at line ${statusLine})`,
            requirementId,
            sourceText: line,
          });
        } else {
          statusLine = currentLineNum;
          const parsed = parseStatus(value, currentLineNum, requirementId);
          if (parsed.value !== undefined) {
            status = parsed.value;
          } else {
            diagnostics.push(parsed.diagnostic!);
          }
        }
      } else if (keyLower === 'priority') {
        // Check for duplicate Priority field
        if (priorityLine !== undefined) {
          diagnostics.push({
            line: currentLineNum,
            severity: 'error',
            message: `Duplicate Priority field (first seen at line ${priorityLine})`,
            requirementId,
            sourceText: line,
          });
        } else {
          priorityLine = currentLineNum;
          const parsed = parsePriority(value, currentLineNum, requirementId);
          if (parsed.value !== undefined) {
            priority = parsed.value;
          } else {
            diagnostics.push(parsed.diagnostic!);
          }
        }
      } else if (keyLower === 'role') {
        // Check for duplicate Role field
        if (roleLine !== undefined) {
          diagnostics.push({
            line: currentLineNum,
            severity: 'error',
            message: `Duplicate Role field (first seen at line ${roleLine})`,
            requirementId,
            sourceText: line,
          });
        } else {
          roleLine = currentLineNum;
          role = value.trim();
        }
      } else {
        // Unknown field - report and preserve
        diagnostics.push({
          line: currentLineNum,
          severity: 'warning',
          message: `Unknown field '${key}'`,
          requirementId,
          sourceText: line,
        });
        unknownContent.push({
          type: 'field',
          name: key,
          line: currentLineNum,
          text: line,
        });
      }
    } else if (line.trim() !== '') {
      // Non-empty line that's not a field - unexpected content in field block
      diagnostics.push({
        line: currentLineNum,
        severity: 'warning',
        message: 'Unexpected content in field block (expected "Field: Value" format)',
        requirementId,
        sourceText: line,
      });
    }

    lineIndex++;
  }

  // Skip any empty lines after field block
  while (lineIndex < bodyLines.length && bodyLines[lineIndex].trim() === '') {
    lineIndex++;
  }

  // Identify fenced code block regions within this requirement body
  const bodyFencedRegions = identifyFencedCodeBlocks(bodyLines).regions;

  // Phase 2: Parse sections (Description, Expected result, Negative cases, Unresolved)
  while (lineIndex < bodyLines.length) {
    const line = bodyLines[lineIndex];
    const currentLineNum = bodyStartLine + lineIndex;
    const bodyLineNum = lineIndex + 1; // 1-based within bodyLines

    // Skip lines inside fenced code blocks (don't treat as section headers)
    if (isInsideFencedBlock(bodyLineNum, bodyFencedRegions)) {
      lineIndex++;
      continue;
    }

    // Check for section heading
    const sectionMatch = line.match(SECTION_HEADING_REGEX);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      const sectionNameLower = sectionName.toLowerCase();
      const sectionStartLine = currentLineNum;

      lineIndex++;

      // Find section content (until next section heading or end)
      // Must respect fenced code blocks - content inside fences is not a section boundary
      const sectionContentStart = lineIndex;
      while (lineIndex < bodyLines.length) {
        const bodyLineNumForCheck = lineIndex + 1;
        // If inside a fenced block, don't check for section/requirement headings
        if (isInsideFencedBlock(bodyLineNumForCheck, bodyFencedRegions)) {
          lineIndex++;
          continue;
        }
        // Check for section or requirement heading (end of current section)
        if (bodyLines[lineIndex].match(SECTION_HEADING_REGEX) ||
            bodyLines[lineIndex].match(REQUIREMENT_HEADING_REGEX)) {
          break;
        }
        lineIndex++;
      }

      const sectionContent = bodyLines.slice(sectionContentStart, lineIndex)
        .join('\n')
        .trim();

      // Process known sections
      if (sectionNameLower === 'description') {
        if (description !== undefined) {
          diagnostics.push({
            line: sectionStartLine,
            severity: 'error',
            message: 'Duplicate Description section',
            requirementId,
          });
        } else {
          description = sectionContent;
          if (!description) {
            diagnostics.push({
              line: sectionStartLine,
              severity: 'error',
              message: 'Description section is empty',
              requirementId,
            });
          }
        }
      } else if (sectionNameLower === 'expected result') {
        if (expectedResult !== undefined) {
          diagnostics.push({
            line: sectionStartLine,
            severity: 'error',
            message: 'Duplicate Expected result section',
            requirementId,
          });
        } else {
          expectedResult = sectionContent;
          // Note: Empty expected result may be valid if unresolved
        }
      } else if (sectionNameLower === 'negative cases') {
        // Check for duplicate Negative cases section
        if (negativeCasesSectionLine !== undefined) {
          diagnostics.push({
            line: sectionStartLine,
            severity: 'error',
            message: `Duplicate Negative cases section (first seen at line ${negativeCasesSectionLine})`,
            requirementId,
          });
        } else {
          negativeCasesSectionLine = sectionStartLine;
          const parsed = parseNegativeCases(
            bodyLines.slice(sectionContentStart, lineIndex),
            bodyStartLine + sectionContentStart,
            requirementId
          );
          negativeCases = parsed.cases;
          diagnostics.push(...parsed.diagnostics);
        }
      } else if (sectionNameLower === 'unresolved') {
        if (unresolved !== undefined) {
          diagnostics.push({
            line: sectionStartLine,
            severity: 'error',
            message: 'Duplicate Unresolved section',
            requirementId,
          });
        } else {
          if (!sectionContent) {
            diagnostics.push({
              line: sectionStartLine,
              severity: 'error',
              message: 'Unresolved section is empty (must contain a reason)',
              requirementId,
            });
            unresolved = { reason: '' }; // Mark as unresolved but invalid
          } else {
            unresolved = { reason: sectionContent };
          }
        }
      } else {
        // Unknown section - report and preserve
        diagnostics.push({
          line: sectionStartLine,
          severity: 'warning',
          message: `Unknown section '${sectionName}'`,
          requirementId,
          sourceText: line,
        });
        unknownContent.push({
          type: 'section',
          name: sectionName,
          line: sectionStartLine,
          text: `### ${sectionName}\n\n${sectionContent}`,
        });
      }
    } else if (line.trim() !== '') {
      // Non-section content after field block
      // This could be part of an improperly formatted document
      diagnostics.push({
        line: currentLineNum,
        severity: 'warning',
        message: 'Content outside of a section (expected "### Section Name")',
        requirementId,
        sourceText: line,
      });
      lineIndex++;
    } else {
      // Empty line - skip
      lineIndex++;
    }
  }

  // Phase 3: Validate required fields and sections
  let isComplete = true;

  if (status === undefined) {
    diagnostics.push({
      line: headingLine,
      severity: 'error',
      message: 'Missing required field: Status',
      requirementId,
    });
    isComplete = false;
  }

  if (priority === undefined) {
    diagnostics.push({
      line: headingLine,
      severity: 'error',
      message: 'Missing required field: Priority',
      requirementId,
    });
    isComplete = false;
  }

  if (description === undefined || description.trim() === '') {
    diagnostics.push({
      line: headingLine,
      severity: 'error',
      message: 'Missing required section: Description',
      requirementId,
    });
    isComplete = false;
  }

  // Expected result validation per section 5.6 precedence rules:
  // - If unresolved is present, requirement is non-actionable (expectedResult optional)
  // - If unresolved is NOT present, expectedResult is required for active requirements
  if (unresolved === undefined && status === 'active') {
    if (expectedResult === undefined || expectedResult.trim() === '') {
      diagnostics.push({
        line: headingLine,
        severity: 'error',
        message: 'Active requirement without Unresolved section must have Expected result',
        requirementId,
      });
      isComplete = false;
    }
  }

  // Build the requirement record
  const now = new Date().toISOString();
  const sourceReference: SourceReference = {
    documentId: context.documentId,
    contentHash: context.contentHash,
    section: `${requirementId}: ${title}`,
    lineRange: { start: headingLine, end: endLine },
  };

  const requirement: Requirement = {
    projectId: context.projectId,
    requirementId,
    title,
    description: description ?? '',
    expectedResult: expectedResult,
    negativeCases,
    priority: priority ?? 'medium', // Default if missing (will fail validation)
    status: status ?? 'active', // Default if missing (will fail validation)
    unresolved,
    sourceReference,
    role,
    createdAt: now,
    updatedAt: now,
  };

  return {
    requirement: {
      requirement,
      isComplete,
      lineRange: { start: headingLine, end: endLine },
      unknownContent,
    },
    diagnostics,
  };
}

// ============================================================================
// Field Parsers
// ============================================================================

interface FieldParseResult<T> {
  value?: T;
  diagnostic?: ParseDiagnostic;
}

/**
 * Parse and validate Status field value.
 */
function parseStatus(
  value: string,
  line: number,
  requirementId: string
): FieldParseResult<RequirementStatus> {
  const normalized = value.toLowerCase().trim();

  if (normalized === 'active') {
    return { value: 'active' };
  } else if (normalized === 'retired') {
    return { value: 'retired' };
  }

  return {
    diagnostic: {
      line,
      severity: 'error',
      message: `Invalid Status value '${value}'. Must be 'Active' or 'Retired'.`,
      requirementId,
      sourceText: `Status: ${value}`,
    },
  };
}

/**
 * Parse and validate Priority field value.
 */
function parsePriority(
  value: string,
  line: number,
  requirementId: string
): FieldParseResult<RequirementPriority> {
  const normalized = value.toLowerCase().trim();

  if (normalized === 'critical') return { value: 'critical' };
  if (normalized === 'high') return { value: 'high' };
  if (normalized === 'medium') return { value: 'medium' };
  if (normalized === 'low') return { value: 'low' };

  return {
    diagnostic: {
      line,
      severity: 'error',
      message: `Invalid Priority value '${value}'. Must be 'Critical', 'High', 'Medium', or 'Low'.`,
      requirementId,
      sourceText: `Priority: ${value}`,
    },
  };
}

// ============================================================================
// Negative Case Parser
// ============================================================================

interface NegativeCaseParseResult {
  cases: NegativeCase[];
  diagnostics: ParseDiagnostic[];
}

/**
 * Parse negative cases from section content.
 *
 * Per convention section 5.4:
 * - Format: `- <condition>: <expected outcome>`
 * - First `: ` after list marker separates condition from outcome
 * - Both parts are mandatory
 */
function parseNegativeCases(
  lines: string[],
  startLine: number,
  requirementId: string
): NegativeCaseParseResult {
  const cases: NegativeCase[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const currentLine = startLine + i;

    // Skip empty lines
    if (line === '') continue;

    // Check for bullet point
    if (!line.startsWith('-')) {
      if (line.startsWith('*') || /^\d+\./.test(line)) {
        // Allow other list markers but warn
        diagnostics.push({
          line: currentLine,
          severity: 'warning',
          message: 'Negative cases should use "- " bullet format',
          requirementId,
          sourceText: line,
        });
      }
      continue;
    }

    // Try to parse as negative case
    const match = line.match(NEGATIVE_CASE_REGEX);

    if (match) {
      const condition = match[1].trim();
      const expectedOutcome = match[2].trim();

      if (condition && expectedOutcome) {
        cases.push({ condition, expectedOutcome });
      } else {
        // One or both parts are empty
        if (!condition) {
          diagnostics.push({
            line: currentLine,
            severity: 'error',
            message: 'Negative case has empty condition',
            requirementId,
            sourceText: line,
          });
        }
        if (!expectedOutcome) {
          diagnostics.push({
            line: currentLine,
            severity: 'error',
            message: 'Negative case has empty expected outcome',
            requirementId,
            sourceText: line,
          });
        }
      }
    } else {
      // Line starts with - but doesn't match the pattern
      // This means missing `: ` separator or missing outcome
      const content = line.slice(1).trim(); // Remove leading -

      // Check if there's a colon at all
      const colonIndex = content.indexOf(':');
      if (colonIndex === -1) {
        diagnostics.push({
          line: currentLine,
          severity: 'error',
          message: `Negative case is missing ': ' separator between condition and expected outcome. Format: '- <condition>: <expected outcome>'`,
          requirementId,
          sourceText: line,
        });
        // Create an incomplete case that will fail validation
        cases.push({ condition: content, expectedOutcome: '' });
      } else {
        // Has colon but no space after it, or outcome is missing
        const afterColon = content.slice(colonIndex + 1).trim();
        if (!afterColon) {
          diagnostics.push({
            line: currentLine,
            severity: 'error',
            message: 'Negative case has empty expected outcome after ":"',
            requirementId,
            sourceText: line,
          });
          cases.push({
            condition: content.slice(0, colonIndex).trim(),
            expectedOutcome: '',
          });
        } else {
          // Has colon and content after, but didn't match pattern
          // This could be colon without following space - still valid per convention
          const condition = content.slice(0, colonIndex).trim();
          if (!condition) {
            diagnostics.push({
              line: currentLine,
              severity: 'error',
              message: 'Negative case has empty condition',
              requirementId,
              sourceText: line,
            });
          }
          cases.push({
            condition,
            expectedOutcome: afterColon,
          });
        }
      }
    }
  }

  return { cases, diagnostics };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a requirement ID matches the expected format.
 * Uses the same pattern as validation.ts.
 */
export function isValidRequirementIdFormat(id: string): boolean {
  return REQUIREMENT_ID_PATTERN.test(id);
}

/**
 * Filter diagnostics by severity.
 */
export function getErrors(diagnostics: ParseDiagnostic[]): ParseDiagnostic[] {
  return diagnostics.filter(d => d.severity === 'error');
}

/**
 * Filter diagnostics by severity.
 */
export function getWarnings(diagnostics: ParseDiagnostic[]): ParseDiagnostic[] {
  return diagnostics.filter(d => d.severity === 'warning');
}

/**
 * Check if parse result has any errors (not just warnings).
 */
export function hasErrors(result: ParseResult): boolean {
  return result.diagnostics.some(d => d.severity === 'error');
}

/**
 * Get diagnostics for a specific requirement.
 */
export function getDiagnosticsForRequirement(
  diagnostics: ParseDiagnostic[],
  requirementId: string
): ParseDiagnostic[] {
  return diagnostics.filter(d => d.requirementId === requirementId);
}

/**
 * Format a diagnostic for display.
 */
export function formatDiagnostic(diagnostic: ParseDiagnostic): string {
  const location = diagnostic.endLine
    ? `lines ${diagnostic.line}-${diagnostic.endLine}`
    : `line ${diagnostic.line}`;

  const reqId = diagnostic.requirementId
    ? ` [${diagnostic.requirementId}]`
    : '';

  const severity = diagnostic.severity === 'error' ? 'ERROR' : 'WARNING';

  return `${severity}${reqId} at ${location}: ${diagnostic.message}`;
}

/**
 * Format all diagnostics for display.
 */
export function formatDiagnostics(diagnostics: ParseDiagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join('\n');
}
