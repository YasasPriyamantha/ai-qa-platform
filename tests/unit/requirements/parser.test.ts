/**
 * Tests for structured Markdown requirement document parser
 *
 * Verifies parser behavior per REQUIREMENTS_AUTHORING_CONVENTION.md:
 * - Requirement heading parsing (## ID: Title)
 * - Field block parsing (Status, Priority, Role)
 * - Section parsing (Description, Expected result, Negative cases, Unresolved)
 * - Line number accuracy in diagnostics
 * - Duplicate ID detection within document
 * - Unknown field/section handling
 * - Negative case format parsing
 * - Unresolved precedence rules
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  parseRequirementContent,
  parseRequirementDocument,
  hasErrors,
  getErrors,
  getWarnings,
  getDiagnosticsForRequirement,
  formatDiagnostic,
  formatDiagnostics,
} from '../../../src/requirements/parser.js';
import type {
  ParseContext,
  ParseDiagnostic,
} from '../../../src/requirements/parser.js';
import { validateRequirement, isActionable } from '../../../src/requirements/validation.js';

// Helper to compute SHA-256 hash
function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// Create a minimal parse context
function createContext(content: string, overrides: Partial<ParseContext> = {}): ParseContext {
  const hash = computeHash(content);
  return {
    projectId: 'test-project',
    documentId: 'test-doc',
    contentHash: hash,
    documentsDir: '/test/documents',
    snapshotPath: `sources/${hash}.md`,
    ...overrides,
  };
}

// ============================================================================
// Single Valid Requirement Tests
// ============================================================================

describe('parseRequirementContent - single valid requirement', () => {
  it('should parse a complete valid requirement', () => {
    const content = `## REQ-001: Login requires valid credentials

Status: Active
Priority: Critical
Role: Customer

### Description

A customer must provide valid credentials to access the authenticated portions of the application.

### Expected result

Upon successful login with valid credentials, the user is redirected to the inventory page.

### Negative cases

- Empty username: the login is prevented and the error "Username is required" is displayed.
- Invalid password: the login is prevented and the error "Invalid credentials" is displayed.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);

    const req = result.requirements[0];
    expect(req.requirement.requirementId).toBe('REQ-001');
    expect(req.requirement.title).toBe('Login requires valid credentials');
    expect(req.requirement.status).toBe('active');
    expect(req.requirement.priority).toBe('critical');
    expect(req.requirement.role).toBe('Customer');
    expect(req.requirement.description).toContain('valid credentials');
    expect(req.requirement.expectedResult).toContain('redirected to the inventory page');
    expect(req.requirement.negativeCases).toHaveLength(2);
    expect(req.requirement.negativeCases[0].condition).toBe('Empty username');
    expect(req.requirement.negativeCases[0].expectedOutcome).toContain('Username is required');
    expect(req.isComplete).toBe(true);
    expect(req.unknownContent).toHaveLength(0);

    // Source reference validation
    expect(req.requirement.sourceReference.documentId).toBe('test-doc');
    expect(req.requirement.sourceReference.contentHash).toBe(ctx.contentHash);
    expect(req.requirement.sourceReference.section).toBe('REQ-001: Login requires valid credentials');
    expect(req.requirement.sourceReference.lineRange?.start).toBe(1);
  });

  it('should parse a requirement with minimal fields (no Role)', () => {
    const content = `## REQ-002: Basic feature

Status: Active
Priority: High

### Description

A basic feature description.

### Expected result

The feature works correctly.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);

    const req = result.requirements[0];
    expect(req.requirement.requirementId).toBe('REQ-002');
    expect(req.requirement.role).toBeUndefined();
    expect(req.isComplete).toBe(true);
  });

  it('should parse a retired requirement without Expected result', () => {
    const content = `## REQ-003: Retired feature

Status: Retired
Priority: Low

### Description

This feature has been retired.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);

    const req = result.requirements[0];
    expect(req.requirement.status).toBe('retired');
    expect(req.requirement.expectedResult).toBeUndefined();
    expect(req.isComplete).toBe(true);
  });
});

// ============================================================================
// Multiple Requirements Tests
// ============================================================================

describe('parseRequirementContent - multiple requirements', () => {
  it('should parse multiple valid requirements', () => {
    const content = `# Login Workflow Requirements

## REQ-001: First requirement

Status: Active
Priority: High

### Description

First requirement description.

### Expected result

First expected result.


## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

Second requirement description with
multiple lines of text.

### Expected result

Second expected result.


## REQ-003: Third requirement

Status: Retired
Priority: Low

### Description

Third requirement was retired.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(3);
    expect(hasErrors(result)).toBe(false);
    expect(result.documentTitle).toBe('Login Workflow Requirements');

    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(result.requirements[1].requirement.requirementId).toBe('REQ-002');
    expect(result.requirements[2].requirement.requirementId).toBe('REQ-003');
  });

  it('should calculate correct line ranges for multiple requirements', () => {
    const content = `## REQ-001: First

Status: Active
Priority: High

### Description

Description one.

### Expected result

Result one.

## REQ-002: Second

Status: Active
Priority: Medium

### Description

Description two.

### Expected result

Result two.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(2);

    // First requirement starts at line 1, ends before second requirement
    const first = result.requirements[0];
    expect(first.lineRange.start).toBe(1);
    expect(first.lineRange.end).toBe(13);

    // Second requirement starts at line 14 (## REQ-002)
    const second = result.requirements[1];
    expect(second.lineRange.start).toBe(14);
    expect(second.lineRange.end).toBe(result.totalLines);
  });

  it('should handle requirement after multiline section', () => {
    const content = `## REQ-001: First requirement

Status: Active
Priority: High

### Description

This is a multiline description.
It spans multiple lines.
And includes various content.

Here's another paragraph.

### Expected result

A multiline expected result.
With multiple sentences.

## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

Second description.

### Expected result

Second result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(2);
    expect(hasErrors(result)).toBe(false);

    // Verify first requirement captures all multiline content
    const first = result.requirements[0];
    expect(first.requirement.description).toContain('multiline description');
    expect(first.requirement.description).toContain('another paragraph');

    // Verify second requirement starts at correct line
    const second = result.requirements[1];
    expect(second.lineRange.start).toBe(19); // Line where ## REQ-002 appears
    expect(second.requirement.requirementId).toBe('REQ-002');
  });
});

// ============================================================================
// Exact Line Number Tests
// ============================================================================

describe('parseRequirementContent - exact source line references', () => {
  it('should report exact line numbers in source reference', () => {
    const content = `# Document Title

## REQ-001: First requirement

Status: Active
Priority: High

### Description

First description.

### Expected result

First result.

## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

Second description.

### Expected result

Second result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(2);

    // REQ-001 starts at line 3 (after blank line and title)
    const first = result.requirements[0];
    expect(first.requirement.sourceReference.lineRange?.start).toBe(3);
    expect(first.requirement.sourceReference.lineRange?.end).toBe(15);

    // REQ-002 starts at line 16
    const second = result.requirements[1];
    expect(second.requirement.sourceReference.lineRange?.start).toBe(16);
    expect(second.requirement.sourceReference.lineRange?.end).toBe(result.totalLines);
  });

  it('should report exact line numbers in error diagnostics', () => {
    const content = `## REQ-001: Valid

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

## REQ-002: Missing fields

### Description

Missing status and priority.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    const req002Errors = getDiagnosticsForRequirement(errors, 'REQ-002');

    // Should have errors for missing Status and Priority at the heading line
    expect(req002Errors.length).toBeGreaterThanOrEqual(2);

    // The errors should reference line 14 where REQ-002 heading is
    const statusError = req002Errors.find(e => e.message.includes('Status'));
    expect(statusError?.line).toBe(14);
  });
});

// ============================================================================
// Malformed Section Diagnostics Tests
// ============================================================================

describe('parseRequirementContent - malformed sections', () => {
  it('should report missing Status field', () => {
    const content = `## REQ-001: Missing status

Priority: High

### Description

Description here.

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e => e.message.includes('Missing required field: Status'))).toBe(true);
    expect(result.requirements[0].isComplete).toBe(false);
  });

  it('should report missing Priority field', () => {
    const content = `## REQ-001: Missing priority

Status: Active

### Description

Description here.

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e => e.message.includes('Missing required field: Priority'))).toBe(true);
    expect(result.requirements[0].isComplete).toBe(false);
  });

  it('should report invalid Status value', () => {
    const content = `## REQ-001: Invalid status

Status: Pending
Priority: High

### Description

Description here.

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes("Invalid Status value 'Pending'")
    )).toBe(true);
    expect(errors.some(e => e.line === 3)).toBe(true); // Status line
  });

  it('should report invalid Priority value', () => {
    const content = `## REQ-001: Invalid priority

Status: Active
Priority: Urgent

### Description

Description here.

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes("Invalid Priority value 'Urgent'")
    )).toBe(true);
  });

  it('should report missing Description section', () => {
    const content = `## REQ-001: Missing description

Status: Active
Priority: High

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e => e.message.includes('Missing required section: Description'))).toBe(true);
  });

  it('should report empty Description section', () => {
    const content = `## REQ-001: Empty description

Status: Active
Priority: High

### Description

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e => e.message.includes('Description section is empty'))).toBe(true);
  });

  it('should report duplicate sections', () => {
    const content = `## REQ-001: Duplicate sections

Status: Active
Priority: High

### Description

First description.

### Description

Second description.

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e => e.message.includes('Duplicate Description section'))).toBe(true);
  });
});

// ============================================================================
// Duplicate ID Tests
// ============================================================================

describe('parseRequirementContent - duplicate IDs', () => {
  it('should report duplicate requirement IDs within document', () => {
    const content = `## REQ-001: First occurrence

Status: Active
Priority: High

### Description

First description.

### Expected result

First result.

## REQ-001: Second occurrence with same ID

Status: Active
Priority: High

### Description

Second description.

### Expected result

Second result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes("Duplicate requirement ID 'REQ-001'")
    )).toBe(true);

    // Should identify the line of the duplicate
    const dupError = errors.find(e => e.message.includes('Duplicate'));
    expect(dupError?.line).toBe(14); // Line of second occurrence
    expect(dupError?.message).toContain('first seen at line 1');
  });

  it('should allow different IDs (REQ-01 vs REQ-001)', () => {
    const content = `## REQ-01: First

Status: Active
Priority: High

### Description

First.

### Expected result

Result.

## REQ-001: Second

Status: Active
Priority: High

### Description

Second.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(2);
    const errors = getErrors(result.diagnostics);
    expect(errors.filter(e => e.message.includes('Duplicate'))).toHaveLength(0);
  });
});

// ============================================================================
// Missing Expected Result Tests
// ============================================================================

describe('parseRequirementContent - missing expected result', () => {
  it('should report missing Expected result for active requirement', () => {
    const content = `## REQ-001: Missing expected result

Status: Active
Priority: High

### Description

Description here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Active requirement without Unresolved section must have Expected result')
    )).toBe(true);
    expect(result.requirements[0].isComplete).toBe(false);
  });

  it('should allow missing Expected result for retired requirement', () => {
    const content = `## REQ-001: Retired no expected

Status: Retired
Priority: Low

### Description

This was retired.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].isComplete).toBe(true);
  });

  it('should allow missing Expected result when Unresolved is present', () => {
    const content = `## REQ-001: Unresolved requirement

Status: Active
Priority: High

### Description

Description here.

### Unresolved

The expected behavior is not specified in the source document.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].isComplete).toBe(true);
    expect(result.requirements[0].requirement.unresolved?.reason).toContain('not specified');
  });
});

// ============================================================================
// Unresolved Expected Result Tests
// ============================================================================

describe('parseRequirementContent - unresolved requirements', () => {
  it('should mark requirement as unresolved when Unresolved section present', () => {
    const content = `## REQ-001: Unresolved behavior

Status: Active
Priority: High

### Description

A requirement with unclear expected behavior.

### Unresolved

The specification does not define what happens when the user clicks the button twice.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    const req = result.requirements[0];
    expect(req.requirement.unresolved).toBeDefined();
    expect(req.requirement.unresolved?.reason).toContain('clicks the button twice');
    expect(req.isComplete).toBe(true);
  });

  it('should preserve Expected result text when both sections present', () => {
    // Per section 5.6: unresolved takes precedence, but expectedResult is preserved
    const content = `## REQ-001: Partially known behavior

Status: Active
Priority: High

### Description

A requirement with partial expected behavior.

### Expected result

User is redirected to the dashboard.

### Unresolved

The specification does not define what message is shown if the redirect fails.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    const req = result.requirements[0];

    // Both should be present
    expect(req.requirement.expectedResult).toContain('redirected to the dashboard');
    expect(req.requirement.unresolved?.reason).toContain('redirect fails');

    // But requirement should not be actionable (validated separately)
    const validationResult = validateRequirement(req.requirement, {
      skipSourceReferenceValidation: true,
    });
    expect(validationResult.valid).toBe(true);
    expect(isActionable(req.requirement)).toBe(false);
  });

  it('should report error for empty Unresolved section', () => {
    const content = `## REQ-001: Empty unresolved

Status: Active
Priority: High

### Description

Description here.

### Unresolved

`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Unresolved section is empty')
    )).toBe(true);
  });
});

// ============================================================================
// Negative Cases Tests
// ============================================================================

describe('parseRequirementContent - negative cases', () => {
  it('should parse multiple negative cases correctly', () => {
    const content = `## REQ-001: With negative cases

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Negative cases

- Empty username: the login is prevented and "Username required" is shown.
- Invalid email format: validation fails and "Invalid email" is displayed.
- Password too short: submission is blocked with "Password must be 8+ characters".
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    const req = result.requirements[0];
    expect(req.requirement.negativeCases).toHaveLength(3);

    expect(req.requirement.negativeCases[0].condition).toBe('Empty username');
    expect(req.requirement.negativeCases[0].expectedOutcome).toContain('Username required');

    expect(req.requirement.negativeCases[1].condition).toBe('Invalid email format');
    expect(req.requirement.negativeCases[1].expectedOutcome).toContain('Invalid email');

    expect(req.requirement.negativeCases[2].condition).toBe('Password too short');
  });

  it('should report error for negative case missing separator', () => {
    const content = `## REQ-001: Malformed negative case

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Negative cases

- Empty username without outcome
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes("missing ': ' separator")
    )).toBe(true);

    // Should still create a case with empty outcome (for validation to catch)
    const req = result.requirements[0];
    expect(req.requirement.negativeCases[0].expectedOutcome).toBe('');
  });

  it('should report error for negative case with empty outcome', () => {
    const content = `## REQ-001: Empty outcome

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Negative cases

- Empty username:
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('empty expected outcome')
    )).toBe(true);
  });

  it('should handle colon without space after it', () => {
    // This is a valid case per the convention - first `: ` separates, but
    // if content has colon without space, we should still parse it
    const content = `## REQ-001: Colon variations

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Negative cases

- Missing field:show error message
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should parse successfully (colon without space is accepted)
    const req = result.requirements[0];
    expect(req.requirement.negativeCases).toHaveLength(1);
    expect(req.requirement.negativeCases[0].condition).toBe('Missing field');
    expect(req.requirement.negativeCases[0].expectedOutcome).toBe('show error message');
  });

  it('should report error for empty condition', () => {
    const content = `## REQ-001: Empty condition

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Negative cases

- : the outcome
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('empty condition')
    )).toBe(true);
  });

  it('should include exact line number for negative case errors', () => {
    const content = `## REQ-001: Line numbered errors

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Negative cases

- Valid case: with outcome
- Missing outcome without separator
- Another valid: case here
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    const missingOutcomeError = errors.find(e => e.message.includes("missing ': ' separator"));

    // Line 17 is where "- Missing outcome..." appears
    expect(missingOutcomeError?.line).toBe(17);
  });
});

// ============================================================================
// Unknown Fields and Sections Tests
// ============================================================================

describe('parseRequirementContent - unknown fields and sections', () => {
  it('should report warning for unknown field and preserve it', () => {
    const content = `## REQ-001: With unknown field

Status: Active
Priority: High
CustomField: Some value

### Description

Description here.

### Expected result

Result here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const warnings = getWarnings(result.diagnostics);
    expect(warnings.some(e =>
      e.message.includes("Unknown field 'CustomField'")
    )).toBe(true);

    // Check unknown content is preserved
    const req = result.requirements[0];
    expect(req.unknownContent).toHaveLength(1);
    expect(req.unknownContent[0].type).toBe('field');
    expect(req.unknownContent[0].name).toBe('CustomField');
    expect(req.unknownContent[0].text).toContain('CustomField: Some value');

    // Requirement should still be valid (unknown fields are warnings, not errors)
    expect(hasErrors(result)).toBe(false);
  });

  it('should report warning for unknown section and preserve it', () => {
    const content = `## REQ-001: With unknown section

Status: Active
Priority: High

### Description

Description here.

### Expected result

Result here.

### Notes

These are author notes not part of the standard convention.
They span multiple lines.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const warnings = getWarnings(result.diagnostics);
    expect(warnings.some(e =>
      e.message.includes("Unknown section 'Notes'")
    )).toBe(true);

    // Check unknown content is preserved
    const req = result.requirements[0];
    expect(req.unknownContent).toHaveLength(1);
    expect(req.unknownContent[0].type).toBe('section');
    expect(req.unknownContent[0].name).toBe('Notes');
    expect(req.unknownContent[0].text).toContain('### Notes');
    expect(req.unknownContent[0].text).toContain('author notes');

    // Requirement should still be valid
    expect(hasErrors(result)).toBe(false);
  });

  it('should preserve multiple unknown fields and sections', () => {
    const content = `## REQ-001: Multiple unknown

Status: Active
Priority: High
Author: John Doe
Version: 1.0

### Description

Description here.

### Expected result

Result here.

### Implementation Notes

Implementation details here.

### Testing Notes

Testing guidance here.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const warnings = getWarnings(result.diagnostics);
    expect(warnings.length).toBeGreaterThanOrEqual(4);

    const req = result.requirements[0];
    expect(req.unknownContent.length).toBe(4);

    const fields = req.unknownContent.filter(u => u.type === 'field');
    const sections = req.unknownContent.filter(u => u.type === 'section');

    expect(fields).toHaveLength(2);
    expect(sections).toHaveLength(2);
  });
});

// ============================================================================
// Empty Document Tests
// ============================================================================

describe('parseRequirementContent - empty and edge cases', () => {
  it('should handle empty document', () => {
    const content = '';
    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(0);
    expect(result.diagnostics.some(d =>
      d.message.includes('No requirement sections found')
    )).toBe(true);
  });

  it('should handle document with only title', () => {
    const content = `# Requirements Document

This is introductory text without any requirements.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(0);
    expect(result.documentTitle).toBe('Requirements Document');
    expect(result.diagnostics.some(d =>
      d.message.includes('No requirement sections found')
    )).toBe(true);
  });

  it('should handle document with whitespace only', () => {
    const content = `


`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(0);
  });

  it('should handle malformed requirement heading', () => {
    // Missing colon and space
    const content = `## REQ001 Missing format

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should not parse as a requirement (doesn't match pattern)
    expect(result.requirements).toHaveLength(0);
    expect(result.diagnostics.some(d =>
      d.message.includes('No requirement sections found')
    )).toBe(true);
  });
});

// ============================================================================
// Unicode Text Tests
// ============================================================================

describe('parseRequirementContent - unicode text', () => {
  it('should handle unicode in requirement title', () => {
    const content = `## REQ-001: Поддержка Unicode символов

Status: Active
Priority: High

### Description

Описание требования на русском языке.

### Expected result

Ожидаемый результат с Unicode символами: é, ñ, 中文, 日本語, 🎉
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);

    const req = result.requirements[0];
    expect(req.requirement.title).toBe('Поддержка Unicode символов');
    expect(req.requirement.description).toContain('русском языке');
    expect(req.requirement.expectedResult).toContain('中文');
    expect(req.requirement.expectedResult).toContain('🎉');
  });

  it('should handle unicode in negative cases', () => {
    const content = `## REQ-001: Unicode negative cases

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.

### Negative cases

- Пустое поле: показывается ошибка "Обязательное поле"
- 空のフィールド: エラーメッセージを表示
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    const req = result.requirements[0];
    expect(req.requirement.negativeCases).toHaveLength(2);
    expect(req.requirement.negativeCases[0].condition).toBe('Пустое поле');
    expect(req.requirement.negativeCases[1].condition).toBe('空のフィールド');
  });
});

// ============================================================================
// Multiple Markdown Headings Tests
// ============================================================================

describe('parseRequirementContent - multiple markdown headings', () => {
  it('should handle description with nested headings', () => {
    const content = `## REQ-001: Complex description

Status: Active
Priority: High

### Description

This description contains multiple elements.

#### Subsection One

Content of subsection one.

#### Subsection Two

Content of subsection two.

### Expected result

The feature works correctly.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    // Level 4 headings are part of description content
    const req = result.requirements[0];
    expect(req.requirement.description).toContain('#### Subsection One');
    expect(req.requirement.description).toContain('#### Subsection Two');
    expect(req.requirement.description).toContain('Content of subsection one');
  });

  it('should not confuse level 1 heading inside content', () => {
    const content = `# Document Title

## REQ-001: Requirement with markdown example

Status: Active
Priority: High

### Description

Here's an example of markdown:

\`\`\`markdown
# This is not a document title
## This is not a requirement
\`\`\`

### Expected result

Parser handles code blocks correctly.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(result.documentTitle).toBe('Document Title');
  });
});

// ============================================================================
// Field Case Insensitivity Tests
// ============================================================================

describe('parseRequirementContent - field case handling', () => {
  it('should accept different case for Status field', () => {
    const content = `## REQ-001: Case test

status: active
priority: HIGH

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].requirement.status).toBe('active');
    expect(result.requirements[0].requirement.priority).toBe('high');
  });

  it('should accept mixed case Status value', () => {
    const content = `## REQ-001: Mixed case

Status: ACTIVE
Priority: Medium

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].requirement.status).toBe('active');
  });
});

// ============================================================================
// Snapshot File Resolution Tests
// ============================================================================

describe('parseRequirementDocument - snapshot resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempDir, 'sources'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should read and parse snapshot file', () => {
    const content = `## REQ-001: From snapshot

Status: Active
Priority: High

### Description

Description from snapshot file.

### Expected result

Result from snapshot.
`;

    const hash = computeHash(content);
    const snapshotPath = `sources/${hash}.md`;
    writeFileSync(join(tempDir, snapshotPath), content);

    const ctx: ParseContext = {
      projectId: 'test-project',
      documentId: 'test-doc',
      contentHash: hash,
      documentsDir: tempDir,
      snapshotPath,
    };

    const result = parseRequirementDocument(ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].requirement.description).toContain('from snapshot file');
  });

  it('should report error for missing snapshot file', () => {
    const ctx: ParseContext = {
      projectId: 'test-project',
      documentId: 'test-doc',
      contentHash: 'a'.repeat(64),
      documentsDir: tempDir,
      snapshotPath: 'sources/nonexistent.md',
    };

    const result = parseRequirementDocument(ctx);

    expect(result.requirements).toHaveLength(0);
    expect(hasErrors(result)).toBe(true);
    expect(result.diagnostics[0].message).toContain('Failed to read snapshot');
  });

  it('should report error for path traversal attempt', () => {
    const ctx: ParseContext = {
      projectId: 'test-project',
      documentId: 'test-doc',
      contentHash: 'a'.repeat(64),
      documentsDir: tempDir,
      snapshotPath: '../../../etc/passwd',
    };

    const result = parseRequirementDocument(ctx);

    expect(result.requirements).toHaveLength(0);
    expect(hasErrors(result)).toBe(true);
    expect(result.diagnostics[0].message).toContain('escapes containment');
  });
});

// ============================================================================
// Diagnostic Formatting Tests
// ============================================================================

describe('diagnostic formatting', () => {
  it('should format diagnostic with line number', () => {
    const diagnostic: ParseDiagnostic = {
      line: 5,
      severity: 'error',
      message: 'Missing required field: Status',
      requirementId: 'REQ-001',
    };

    const formatted = formatDiagnostic(diagnostic);
    expect(formatted).toContain('ERROR');
    expect(formatted).toContain('[REQ-001]');
    expect(formatted).toContain('line 5');
    expect(formatted).toContain('Missing required field: Status');
  });

  it('should format diagnostic with line range', () => {
    const diagnostic: ParseDiagnostic = {
      line: 10,
      endLine: 15,
      severity: 'warning',
      message: 'Unknown section',
    };

    const formatted = formatDiagnostic(diagnostic);
    expect(formatted).toContain('WARNING');
    expect(formatted).toContain('lines 10-15');
  });

  it('should format multiple diagnostics', () => {
    const diagnostics: ParseDiagnostic[] = [
      { line: 1, severity: 'error', message: 'Error 1' },
      { line: 5, severity: 'warning', message: 'Warning 1' },
    ];

    const formatted = formatDiagnostics(diagnostics);
    expect(formatted).toContain('ERROR');
    expect(formatted).toContain('WARNING');
    expect(formatted.split('\n')).toHaveLength(2);
  });
});

// ============================================================================
// Integration with Validation Tests
// ============================================================================

describe('parser output with validation', () => {
  it('should produce requirements that pass validation', () => {
    const content = `## REQ-001: Valid requirement

Status: Active
Priority: High
Role: Customer

### Description

A complete and valid requirement.

### Expected result

The expected behavior is clearly defined.

### Negative cases

- Error case: error handling is described.
`;

    const ctx = createContext(content);
    const parseResult = parseRequirementContent(content, ctx);

    expect(parseResult.requirements).toHaveLength(1);
    expect(hasErrors(parseResult)).toBe(false);

    const req = parseResult.requirements[0].requirement;
    const validationResult = validateRequirement(req, {
      skipSourceReferenceValidation: true, // Skip registry lookup in unit test
    });

    expect(validationResult.valid).toBe(true);
    expect(isActionable(req)).toBe(true);
  });

  it('should produce unresolved requirements that pass validation but are not actionable', () => {
    const content = `## REQ-001: Unresolved requirement

Status: Active
Priority: High

### Description

A requirement with unclear expected behavior.

### Unresolved

The specification does not define this behavior.
`;

    const ctx = createContext(content);
    const parseResult = parseRequirementContent(content, ctx);

    expect(parseResult.requirements).toHaveLength(1);
    expect(hasErrors(parseResult)).toBe(false);

    const req = parseResult.requirements[0].requirement;
    const validationResult = validateRequirement(req, {
      skipSourceReferenceValidation: true,
    });

    expect(validationResult.valid).toBe(true);
    expect(isActionable(req)).toBe(false);
  });

  it('should produce requirements with empty negative case outcome that fail validation', () => {
    const content = `## REQ-001: Invalid negative case

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.

### Negative cases

- Missing outcome without separator
`;

    const ctx = createContext(content);
    const parseResult = parseRequirementContent(content, ctx);

    // Parser reports the error
    expect(hasErrors(parseResult)).toBe(true);

    // The requirement record has the incomplete negative case
    const req = parseResult.requirements[0].requirement;
    expect(req.negativeCases[0].expectedOutcome).toBe('');

    // Validation also catches it
    const validationResult = validateRequirement(req, {
      skipSourceReferenceValidation: true,
    });
    expect(validationResult.valid).toBe(false);
    expect(validationResult.errors.some(e => e.includes('expectedOutcome'))).toBe(true);
  });
});

// ============================================================================
// Windows Line Endings and BOM Tests
// ============================================================================

describe('parseRequirementContent - line endings and BOM', () => {
  const baseDocument = `## REQ-001: Test requirement

Status: Active
Priority: High

### Description

Description text.

### Expected result

Result text.
`;

  it('should parse document with LF line endings', () => {
    const content = baseDocument; // Already LF
    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].requirement.status).toBe('active');
    expect(result.requirements[0].requirement.priority).toBe('high');
    expect(result.requirements[0].lineRange).toEqual({ start: 1, end: 13 });
  });

  it('should parse document with CRLF line endings', () => {
    const content = baseDocument.replace(/\n/g, '\r\n');
    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].requirement.status).toBe('active');
    expect(result.requirements[0].requirement.priority).toBe('high');
    // Line ranges should be identical
    expect(result.requirements[0].lineRange).toEqual({ start: 1, end: 13 });
  });

  it('should parse document with UTF-8 BOM', () => {
    const bom = '\uFEFF';
    const content = bom + baseDocument;
    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    // First requirement should still be recognized at line 1
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(result.requirements[0].lineRange.start).toBe(1);
  });

  it('should parse document with BOM followed by CRLF', () => {
    const bom = '\uFEFF';
    const content = bom + baseDocument.replace(/\n/g, '\r\n');
    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
  });

  it('should not retain trailing CR in field values', () => {
    // CRLF content where field value could retain \r
    const content = `## REQ-001: Test\r\n\r\nStatus: Active\r\nPriority: High\r\nRole: Customer\r\n\r\n### Description\r\n\r\nDescription.\r\n\r\n### Expected result\r\n\r\nResult.\r\n`;
    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    // Field values should NOT have trailing \r
    expect(result.requirements[0].requirement.status).toBe('active');
    expect(result.requirements[0].requirement.priority).toBe('high');
    expect(result.requirements[0].requirement.role).toBe('Customer');
    expect(result.requirements[0].requirement.role).not.toContain('\r');
  });

  it('should produce identical results for LF, CRLF, and BOM+CRLF', () => {
    const lfContent = baseDocument;
    const crlfContent = baseDocument.replace(/\n/g, '\r\n');
    const bomCrlfContent = '\uFEFF' + crlfContent;

    const lfResult = parseRequirementContent(lfContent, createContext(lfContent));
    const crlfResult = parseRequirementContent(crlfContent, createContext(crlfContent));
    const bomResult = parseRequirementContent(bomCrlfContent, createContext(bomCrlfContent));

    // All should parse successfully
    expect(lfResult.requirements).toHaveLength(1);
    expect(crlfResult.requirements).toHaveLength(1);
    expect(bomResult.requirements).toHaveLength(1);

    // Line ranges should be identical
    expect(crlfResult.requirements[0].lineRange).toEqual(lfResult.requirements[0].lineRange);
    expect(bomResult.requirements[0].lineRange).toEqual(lfResult.requirements[0].lineRange);

    // Content should be identical
    expect(crlfResult.requirements[0].requirement.description).toBe(
      lfResult.requirements[0].requirement.description
    );
    expect(bomResult.requirements[0].requirement.description).toBe(
      lfResult.requirements[0].requirement.description
    );
  });
});

// ============================================================================
// Malformed Requirement Heading Tests
// ============================================================================

describe('parseRequirementContent - malformed requirement headings', () => {
  it('should report error for missing colon separator', () => {
    const content = `## REQ-01 Login

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should NOT parse as a requirement
    expect(result.requirements).toHaveLength(0);

    // Should report malformed heading diagnostic
    const errors = getErrors(result.diagnostics);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e =>
      e.message.includes('Malformed requirement heading') &&
      e.message.includes("missing ':'")
    )).toBe(true);

    // Diagnostic should include source line
    const malformedError = errors.find(e => e.message.includes('Malformed'));
    expect(malformedError?.line).toBe(1);
    expect(malformedError?.sourceText).toContain('REQ-01 Login');
  });

  it('should report error for lowercase ID', () => {
    const content = `## req-001: Login

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should NOT parse as a requirement
    expect(result.requirements).toHaveLength(0);

    // Should report malformed heading diagnostic
    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Malformed requirement heading') &&
      e.message.toLowerCase().includes('lowercase')
    )).toBe(true);
  });

  it('should report error for malformed ID format (missing hyphen)', () => {
    const content = `## REQ001: Login

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should NOT parse as a requirement
    expect(result.requirements).toHaveLength(0);

    // Should report malformed heading diagnostic
    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Malformed requirement heading') &&
      e.message.includes('REQ001')
    )).toBe(true);
  });

  it('should NOT report ordinary headings as malformed', () => {
    const content = `# Document Title

## About This Document

Introduction text.

## REQ-001: Actual requirement

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should parse the valid requirement
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');

    // Should NOT report "About This Document" as malformed
    const errors = getErrors(result.diagnostics);
    expect(errors.filter(e => e.message.includes('Malformed'))).toHaveLength(0);
  });
});

// ============================================================================
// Duplicate Fields Tests
// ============================================================================

describe('parseRequirementContent - duplicate fields', () => {
  it('should report error for duplicate Status field', () => {
    const content = `## REQ-001: Duplicate status

Status: Active
Priority: High
Status: Retired

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Duplicate Status field')
    )).toBe(true);

    // Should include line numbers
    const dupError = errors.find(e => e.message.includes('Duplicate Status'));
    expect(dupError?.line).toBe(5); // Second occurrence
    expect(dupError?.message).toContain('first seen at line 3');
  });

  it('should report error for duplicate Priority field', () => {
    const content = `## REQ-001: Duplicate priority

Status: Active
Priority: High
Priority: Low

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Duplicate Priority field')
    )).toBe(true);
  });

  it('should report error for duplicate Role field', () => {
    const content = `## REQ-001: Duplicate role

Status: Active
Priority: High
Role: Customer
Role: Administrator

### Description

Description.

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Duplicate Role field')
    )).toBe(true);
  });

  it('should report error for duplicate Negative cases section', () => {
    const content = `## REQ-001: Duplicate negative cases

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.

### Negative cases

- Case 1: outcome 1

### Negative cases

- Case 2: outcome 2
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    const errors = getErrors(result.diagnostics);
    expect(errors.some(e =>
      e.message.includes('Duplicate Negative cases section')
    )).toBe(true);
  });
});

// ============================================================================
// Fenced Code Block Tests
// ============================================================================

describe('parseRequirementContent - fenced code blocks', () => {
  it('should ignore fake requirement heading inside backtick fence', () => {
    const content = `## REQ-001: Real requirement

Status: Active
Priority: High

### Description

Here's an example:

\`\`\`markdown
## REQ-FAKE: This is not a requirement
Status: Fake
Priority: Fake
\`\`\`

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should only parse the real requirement
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(hasErrors(result)).toBe(false);
  });

  it('should ignore fake requirement heading inside tilde fence', () => {
    const content = `## REQ-001: Real requirement

Status: Active
Priority: High

### Description

Example:

~~~
## REQ-FAKE: Not a requirement
Status: Fake
~~~

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should only parse the real requirement
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(hasErrors(result)).toBe(false);
  });

  it('should ignore fields inside fenced code blocks', () => {
    const content = `## REQ-001: Test

Status: Active
Priority: High

### Description

Configuration example:

\`\`\`yaml
Status: pending
Priority: urgent
Role: superuser
\`\`\`

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    // Should NOT report warnings for "unknown fields" inside code block
    const warnings = getWarnings(result.diagnostics);
    expect(warnings.filter(w => w.message.includes('Unknown field'))).toHaveLength(0);
  });

  it('should ignore section headings inside fenced code blocks', () => {
    const content = `## REQ-001: Test

Status: Active
Priority: High

### Description

Template example:

\`\`\`markdown
### Description

This is a template description section.

### Expected result

Template result.
\`\`\`

### Expected result

Actual result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(hasErrors(result)).toBe(false);
    // Should NOT report duplicate sections (the ones inside code block are ignored)
    const errors = getErrors(result.diagnostics);
    expect(errors.filter(e => e.message.includes('Duplicate'))).toHaveLength(0);
  });

  it('should handle real requirement after fenced code block', () => {
    const content = `## REQ-001: First requirement

Status: Active
Priority: High

### Description

Example code:

\`\`\`
## REQ-FAKE: Fake
\`\`\`

### Expected result

First result.

## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

Second description.

### Expected result

Second result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // Should parse both real requirements, ignore fake one
    expect(result.requirements).toHaveLength(2);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(result.requirements[1].requirement.requirementId).toBe('REQ-002');
    expect(hasErrors(result)).toBe(false);
  });

  it('should handle unclosed fence at end of document', () => {
    const content = `## REQ-001: Test

Status: Active
Priority: High

### Description

Description.

### Expected result

Result.

\`\`\`
## REQ-FAKE: Inside unclosed fence
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // 1. Valid requirement before the unclosed fence is still parsed
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(result.requirements[0].isComplete).toBe(true);

    // 2. Content inside the unclosed fence is ignored (REQ-FAKE not parsed)
    const reqIds = result.requirements.map(r => r.requirement.requirementId);
    expect(reqIds).not.toContain('REQ-FAKE');

    // 3. An error diagnostic exists for the unclosed fence
    expect(hasErrors(result)).toBe(true);
    const errors = getErrors(result.diagnostics);
    const unclosedError = errors.find(e => e.message.includes('Unclosed fenced code block'));
    expect(unclosedError).toBeDefined();

    // 4. The diagnostic identifies the opening fence's exact line number (line 14)
    expect(unclosedError?.line).toBe(14);

    // 5. The diagnostic severity is 'error'
    expect(unclosedError?.severity).toBe('error');

    // 6. requirementId is absent (document-level error)
    expect(unclosedError?.requirementId).toBeUndefined();

    // 7. Source context includes the opening fence marker
    expect(unclosedError?.sourceText).toBe('```');
  });

  it('should detect unclosed fence that hides subsequent requirements', () => {
    // This test ensures an unclosed fence cannot silently hide a subsequent
    // requirement without blocking import (error diagnostic must be produced)
    const content = `## REQ-001: First requirement

Status: Active
Priority: High

### Description

Description of first requirement.

### Expected result

Result of first requirement.

\`\`\`markdown
## REQ-002: This requirement is hidden inside unclosed fence

Status: Active
Priority: Medium

### Description

This should not be parsed as a real requirement.

### Expected result

Hidden result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    // First requirement is still parsed
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');

    // REQ-002 inside the unclosed fence is NOT parsed
    const reqIds = result.requirements.map(r => r.requirement.requirementId);
    expect(reqIds).not.toContain('REQ-002');

    // Error diagnostic blocks import (per parse result contract)
    expect(hasErrors(result)).toBe(true);
    const errors = getErrors(result.diagnostics);
    const unclosedError = errors.find(e => e.message.includes('Unclosed fenced code block'));
    expect(unclosedError).toBeDefined();

    // The diagnostic identifies the opening fence line (line 14, with language tag)
    expect(unclosedError?.line).toBe(14);
    expect(unclosedError?.sourceText).toBe('```markdown');
  });

  it('should handle fence with language tag', () => {
    const content = `## REQ-001: Test

Status: Active
Priority: High

### Description

Example:

\`\`\`typescript
## REQ-FAKE: Not parsed
const x = 1;
\`\`\`

### Expected result

Result.
`;

    const ctx = createContext(content);
    const result = parseRequirementContent(content, ctx);

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].requirement.requirementId).toBe('REQ-001');
    expect(hasErrors(result)).toBe(false);
  });
});

// ============================================================================
// End-to-End Integration Test: Ingestion + Parsing + Validation
// ============================================================================

describe('parseRequirementDocument - integration with ingestion and validation', () => {
  let testWorkspace: string;

  beforeEach(async () => {
    // Create a temporary project workspace
    testWorkspace = join(tmpdir(), `parser-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testWorkspace, { recursive: true });

    // Create required directories
    mkdirSync(join(testWorkspace, 'documents', 'sources'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should parse requirements from ingested document and validate', async () => {
    // Create a project config with a document declaration
    const projectConfig = {
      projectId: 'e2e-test-project',
      name: 'E2E Test Project',
      createdAt: new Date().toISOString(),
      documents: [
        {
          documentId: 'test-requirements',
          name: 'Test Requirements',
          path: 'requirements.md',
        },
      ],
    };
    writeFileSync(
      join(testWorkspace, 'project.config.json'),
      JSON.stringify(projectConfig, null, 2)
    );

    // Create the source requirements document with both valid and unresolved requirements
    const docContent = `# Test Requirements Document

## REQ-001: Valid actionable requirement

Status: Active
Priority: High
Role: Customer

### Description

A fully specified requirement with all required sections.

### Expected result

The user sees the expected outcome clearly documented.

### Negative cases

- Invalid input: an error message is displayed.
- Empty input: validation prevents submission.


## REQ-002: Unresolved requirement

Status: Active
Priority: Medium

### Description

A requirement where the expected behavior is not yet specified.

### Unresolved

The specification does not define what happens when the session expires.
`;

    // Write the source document
    const docPath = join(testWorkspace, 'requirements.md');
    writeFileSync(docPath, docContent);

    // Import document ingestion service dynamically to avoid circular deps
    const { ingestDocument } = await import('../../../src/documents/service.js');

    // Ingest the document
    const ingestResult = ingestDocument(
      {
        documentId: 'test-requirements',
        sourcePath: 'requirements.md',
        name: 'Test Requirements',
      },
      { workspace: testWorkspace }
    );

    // Verify ingestion succeeded
    expect(ingestResult.record.documentId).toBe('test-requirements');
    expect(ingestResult.version.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // Get the snapshot path and documents directory
    const { getProjectStoragePaths } = await import('../../../src/projects/storage.js');
    const storagePaths = getProjectStoragePaths(testWorkspace);

    // Create parse context from ingestion result
    const parseCtx: ParseContext = {
      projectId: projectConfig.projectId,
      documentId: 'test-requirements',
      contentHash: ingestResult.version.contentHash,
      documentsDir: storagePaths.documentsDir,
      snapshotPath: ingestResult.version.snapshotPath,
    };

    // Parse the document using the snapshot
    const parseResult = parseRequirementDocument(parseCtx);

    // Verify parsing succeeded
    expect(parseResult.requirements).toHaveLength(2);
    expect(hasErrors(parseResult)).toBe(false);
    expect(parseResult.documentTitle).toBe('Test Requirements Document');

    // Verify source references use correct document ID and content hash
    const req1 = parseResult.requirements[0].requirement;
    const req2 = parseResult.requirements[1].requirement;

    expect(req1.sourceReference.documentId).toBe('test-requirements');
    expect(req1.sourceReference.contentHash).toBe(ingestResult.version.contentHash);
    expect(req1.sourceReference.lineRange?.start).toBe(3);

    expect(req2.sourceReference.documentId).toBe('test-requirements');
    expect(req2.sourceReference.contentHash).toBe(ingestResult.version.contentHash);

    // Validate the parsed requirements using validateRequirementsForProject
    // First, we need to ensure document registry exists
    const { loadDocumentRegistry } = await import('../../../src/documents/service.js');
    const registry = loadDocumentRegistry(storagePaths.documentsRegistryPath);
    expect(registry.documents['test-requirements']).toBeDefined();

    // Validate individual requirements
    const req1Validation = validateRequirement(req1, {
      skipSourceReferenceValidation: true, // Skip registry lookup
    });
    expect(req1Validation.valid).toBe(true);
    expect(isActionable(req1)).toBe(true);

    const req2Validation = validateRequirement(req2, {
      skipSourceReferenceValidation: true,
    });
    expect(req2Validation.valid).toBe(true);
    // Unresolved requirement is structurally valid but NOT actionable
    expect(isActionable(req2)).toBe(false);
    expect(req2.unresolved).toBeDefined();
    expect(req2.unresolved?.reason).toContain('session expires');
  });

  it('should use temp directory and not pollute project-data', () => {
    // The test uses a temp directory, verify project-data is untouched
    // This test simply verifies we're using temp directories properly
    expect(testWorkspace).not.toContain('project-data');
    // Temp directory should be in OS temp location (contains tmpdir path)
    expect(testWorkspace.startsWith(tmpdir())).toBe(true);
  });
});
