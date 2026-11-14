# Structured Markdown Authoring Convention for Workflow Requirements

**Document status:** Task 2.5 deliverable
**Applies to:** Markdown (`.md`) and plain-text (`.txt`) workflow requirement documents
**Schema alignment:** `src/requirements/types.ts` (Phase 2)

---

## 1. Purpose

This convention defines how to write structured workflow requirements in Markdown so that:

1. A deterministic parser can validate the document and report exact line numbers for errors.
2. Author-assigned requirement IDs remain stable across releases.
3. Every requirement clearly states its expected result.
4. Negative cases always include both their condition and expected outcome.
5. Missing, ambiguous, or contradictory expected behavior is explicitly marked unresolved rather than inferred from current website behavior.

The convention preserves the source specification's terminology and intent. Structured records produced by parsing link back to the original document, section, and line range.

---

## 2. Document Identity

Document identity comes from the caller-supplied `documentId` at ingestion time, not from the filename or file path. Per DEC-030, the `documentId` is declared in the project's `config.documents` array and supplied through the platform's document-ingestion context.

**Key rules:**

- The `documentId` from `project.config.json` is the authoritative document identifier.
- Filenames, basenames, and file paths must never be used as the document's authoritative identity.
- Filenames may change; the `documentId` must remain stable for the same logical document.
- Source document identity is supplied through the platform's document-ingestion/import context, not inferred from requirement heading text.

Supported formats: `.md` (Markdown) and `.txt` (plain text).

---

## 3. Requirement ID Rules

### 3.1 Author-assigned stable IDs

Every requirement must have an author-assigned stable ID. The platform must not silently assign or rewrite authoritative IDs.

**ID syntax (regular expression):** `^[A-Z][A-Z0-9]*-\d+$`

**Format rules:**

- Prefix begins with one uppercase letter (A-Z).
- Remaining prefix characters may be uppercase letters or digits.
- A hyphen separates the prefix and numeric suffix.
- Numeric suffix contains one or more digits.
- No lowercase letters, underscores, spaces, or additional hyphens.

**Valid examples:** `REQ-001`, `REQ-1000`, `AUTH-001`, `REQ-01`, `TEST-42`

**Invalid examples:** `req-001` (lowercase), `REQ_001` (underscore), `REQ-001-A` (extra hyphen)

**ID comparison:** Compare IDs as exact strings. Do not remove leading zeroes or otherwise normalize IDs. For example, `REQ-01` and `REQ-001` are distinct IDs.

### 3.2 ID lifecycle rules

| Situation | Rule |
|-----------|------|
| Same requirement across releases | Retains its original ID, even if description or acceptance criteria change |
| New requirement | Receives a new, unused ID |
| Retired requirement | Marked with `Status: Retired`; ID is never reused for an unrelated requirement |

**Never reuse a retired ID for an unrelated requirement.** Retired IDs remain in history for traceability.

### 3.3 ID uniqueness

Requirement IDs must be unique within a project. The parser rejects documents containing duplicate IDs.

---

## 4. Document Structure

### 4.1 Document-level heading (optional)

A document may begin with a level-1 heading for the document title:

```markdown
# SauceDemo Checkout Workflow Requirements
```

This heading is metadata about the document, not a requirement.

### 4.2 Requirement heading (required)

Each requirement begins with a level-2 heading containing the requirement ID and title:

```markdown
## REQ-001: Login requires valid credentials
```

**Format:** `## <ID>: <Title>`

- The ID appears first, followed by a colon and space.
- The title is a brief, imperative summary of the requirement.
- The parser extracts both the ID and title from this heading.

### 4.3 Section order

After the requirement heading, sections appear in the following order. Required sections must be present; optional sections may be omitted.

| Section | Required | Purpose |
|---------|----------|---------|
| Field block | Yes | Status, Priority, and optionally Role |
| Description | Yes | Full description of the requirement |
| Expected result | Conditional | Required unless requirement is marked Unresolved |
| Negative cases | No | Error/edge cases with expected outcomes |
| Unresolved | Conditional | Present only when expected behavior is missing/ambiguous |

---

## 5. Field Definitions

### 5.1 Field block (required)

Immediately after the requirement heading, include a field block with key-value pairs:

```markdown
Status: Active
Priority: High
Role: Customer
```

**Field definitions:**

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `Status` | Yes | `Active` or `Retired` | Lifecycle status |
| `Priority` | Yes | `Critical`, `High`, `Medium`, or `Low` | Requirement priority |
| `Role` | No | Free text (e.g., `Customer`, `Administrator`) | Role this requirement applies to |

- Field names are case-insensitive for parsing but should use title case for consistency.
- Each field appears on its own line as `Field: Value`.
- An empty line separates the field block from subsequent sections.

### 5.2 Description section (required)

```markdown
### Description

A customer must provide valid credentials to access the authenticated portions of the application. The login form accepts a username and password.
```

- Use a level-3 heading: `### Description`
- The description explains the requirement in full.
- Preserve the original specification's terminology.

### 5.3 Expected result section (conditionally required)

```markdown
### Expected result

Upon successful login with valid credentials, the user is redirected to the inventory page and sees their shopping cart icon in the header.
```

- Use a level-3 heading: `### Expected result`
- **Required** for all active requirements that are NOT marked unresolved.
- May be omitted ONLY when the requirement has an `Unresolved` section.
- States the observable, verifiable outcome.
- Must be explicitly authored—never inferred from current website behavior.

### 5.4 Negative cases section (optional)

```markdown
### Negative cases

- Missing username: the login is prevented and the message "Username is required" is displayed.
- Incorrect password: the login is prevented and the message "Username and password do not match" is displayed.
- Locked-out user: the login is prevented and the message "This user has been locked out" is displayed.
```

- Use a level-3 heading: `### Negative cases`
- Each negative case is a bullet point.
- **Format:** `- <condition>: <expected outcome>`
- The first `: ` (colon followed by space) after the list marker separates the condition from the expected outcome.
- **Both parts are mandatory:** The condition describes the error scenario; the expected outcome states what should happen.
- A missing separator or missing expected outcome is a validation error.
- Preserve the original Markdown source text exactly as authored.
- Do not infer or invent missing outcomes.

This format matches PROJECT_SPEC.md section 7.2. For example, the following is valid:

```markdown
- Missing shipping address: checkout is prevented and a validation message is shown.
```

### 5.5 Unresolved section (conditional)

```markdown
### Unresolved

The specification does not state what message appears when the username field is empty. Clarification required from the product owner.
```

- Use a level-3 heading: `### Unresolved`
- Present ONLY when expected behavior is missing, ambiguous, or contradictory.
- The section body must contain a meaningful reason explaining WHY the requirement is unresolved.
- An unresolved requirement may omit its `Expected result` section.
- **Unresolved is NOT a lifecycle status.** It is a separate marker indicating the requirement needs clarification before it can be used for test generation.
- Do not invent expected behavior based on what the current website happens to do.

### 5.6 Expected result and Unresolved precedence

When a requirement contains **both** an `### Expected result` section and an `### Unresolved` section:

1. The requirement is considered **unresolved**.
2. The `### Unresolved` section must contain a meaningful reason.
3. The expected-result text is preserved exactly as authored for traceability and clarification context.
4. The expected-result text is **not considered actionable**.
5. The requirement must not be used for test generation until the unresolved issue is clarified.
6. The presence of an expected-result section does not override the unresolved marker.

This situation may occur when an author documents partial expected behavior but identifies that some aspect remains ambiguous or contradictory.

---

## 6. Lifecycle Status vs. Unresolved Marker

These two concepts are independent:

| Concept | Field/Section | Values | Purpose |
|---------|---------------|--------|---------|
| Lifecycle status | `Status:` field | `Active` or `Retired` | Whether the requirement is in active use |
| Unresolved marker | `### Unresolved` section | Reason text | Missing/ambiguous expected behavior needs clarification |

A requirement can be:
- **Active and resolved:** Has `Status: Active` and a complete `Expected result`; no `Unresolved` section
- **Active and unresolved:** Has `Status: Active` but missing/ambiguous expected behavior; has an `Unresolved` section
- **Retired:** Has `Status: Retired`; may or may not have had an `Unresolved` section when it was active

Release classifications (new/changed/unchanged) are determined by release comparison in Phase 7 and do not appear in the authoring convention.

---

## 7. Unknown Fields and Sections

**Policy:** The parser reports a diagnostic for any unrecognized field or section and preserves the text. Unknown content is never silently discarded.

If a document contains:

```markdown
Custom-Field: Some value

### Notes

These are author notes not part of the standard convention.
```

The parser:
1. Reports a diagnostic: `Line 5: Unknown field 'Custom-Field'` and `Line 7: Unknown section 'Notes'`
2. Preserves the text in the parsed record for human review
3. Does not fail validation solely due to unknown fields/sections

This policy ensures that meaningful content is not lost during parsing while maintaining awareness of non-standard additions.

---

## 8. Source Reference Retention

Parsed requirements include a source reference that points back to the original document. This enables traceability from structured records back to the exact source location.

**Required source reference fields:**

| Field | Description |
|-------|-------------|
| `documentId` | The caller-supplied document identifier (from `project.config.json`) |
| `documentHash` | SHA-256 content hash of the immutable document snapshot at parse time |
| `section` | The original requirement heading text exactly as authored (e.g., `REQ-001: Login requires valid credentials`) |
| `lineRange` | Start and end line numbers (1-based) where the requirement appears in the source document |

**Heading and section text preservation:**

- Keep the original requirement heading text exactly as authored.
- Do not invent synthetic section identifiers.
- Preserve relevant subsection/section heading text for context.
- The relationship between the requirement and its original source document is established through `documentId` and `documentHash`.

When a requirement changes across releases, the line range and section text help reviewers locate the change in the original document.

---

## 9. Validation Rules Summary

The parser enforces these rules:

| Rule | Error if violated |
|------|-------------------|
| Requirement ID format | ID does not match `^[A-Z][A-Z0-9]*-\d+$` pattern |
| Unique IDs | Duplicate ID found in document |
| Required field block | Missing `Status` or `Priority` field |
| Valid status value | Status is not `Active` or `Retired` |
| Valid priority value | Priority is not `Critical`, `High`, `Medium`, or `Low` |
| Expected result presence | Active requirement without `Unresolved` section is missing `Expected result` |
| Unresolved reason | `Unresolved` section is present but empty |
| Negative case format | Negative case is missing the `: ` separator or expected outcome |

---

## 10. Template

Use this template as a starting point for new requirements:

```markdown
## REQ-<NNN>: <Requirement title>

Status: Active
Priority: <Critical | High | Medium | Low>
Role: <Role name, or omit this line if not role-specific>

### Description

<Full description of the requirement. Preserve the original specification's terminology.>

### Expected result

<Observable, verifiable outcome. Must be explicitly stated, not inferred from website behavior.>

### Negative cases

- <Condition 1>: <expected outcome when this condition occurs>
- <Condition 2>: <expected outcome when this condition occurs>
```

For requirements with unresolved expected behavior:

```markdown
## REQ-<NNN>: <Requirement title>

Status: Active
Priority: <Critical | High | Medium | Low>

### Description

<Full description of the requirement.>

### Unresolved

<Explanation of why expected behavior is missing, ambiguous, or contradictory. Specify what clarification is needed.>
```

---

## 11. Example

The following example demonstrates a complete requirement document. **These are illustrative examples only, not universal requirements.** A real project author must supply the correct business rules, field values, and messages specific to their application.

```markdown
# SauceDemo Login Workflow Requirements

## REQ-001: Login requires valid credentials

Status: Active
Priority: Critical
Role: Customer

### Description

A customer must provide valid credentials (username and password) to access the authenticated portions of the SauceDemo application. The login form is displayed on the home page.

### Expected result

Upon successful login with valid credentials, the user is redirected to the inventory page (`/inventory.html`) and sees the products list with the shopping cart icon in the header.

### Negative cases

- Empty username: the login is prevented and the error message "Username is required" is displayed below the login form.
- Empty password: the login is prevented and the error message "Password is required" is displayed below the login form.
- Invalid credentials: the login is prevented and the error message "Username and password do not match any user in this service" is displayed.
- Locked-out user: the login is prevented and the error message "Sorry, this user has been locked out" is displayed.


## REQ-002: Login form displays accessible controls

Status: Active
Priority: High

### Description

The login page must display accessible form controls that can be identified by assistive technologies and automated testing tools.

### Expected result

The login form contains:
- A username input field with accessible name "Username"
- A password input field with accessible name "Password"
- A login button with accessible name "Login"


## REQ-003: Session timeout behavior

Status: Active
Priority: Medium

### Description

When a user's session expires, the application should handle the transition gracefully.

### Unresolved

The specification does not define:
1. How long a session lasts before timeout
2. Whether the user receives a warning before timeout
3. What page the user is redirected to after timeout

Clarification required from the product owner before this requirement can be used for test generation.


## REQ-004: Remember me functionality

Status: Retired
Priority: Low

### Description

This requirement was removed when the "Remember me" feature was descoped from the MVP.
```

---

## 12. Authoring Decisions

The following decisions were made for this convention:

### 12.1 Requirement ID syntax

The ID format uses the regular expression `^[A-Z][A-Z0-9]*-\d+$` as specified in section 3.1. This allows project-specific prefixes (e.g., `AUTH-001`, `CHECKOUT-01`) while maintaining consistent parsing rules. This is the authoring convention's ID syntax; it is not explicitly mandated by PROJECT_SPEC.md but is compatible with its examples.

### 12.2 Role field

The `Role` field remains optional and free text in Phase 2. Role values are not validated against `project.config.json` role profile IDs at this stage. Any mapping or validation against configured role profiles may be considered in a later task when the role profile implementation is addressed.

### 12.3 Custom fields

No custom-field registration mechanism is introduced. The existing unknown-field policy (section 7) applies:
- Report unknown fields/sections through a diagnostic.
- Preserve their original text.
- Never silently discard meaningful content.
- Do not silently interpret an unknown field as a supported schema field.

### 12.4 Markdown formatting preservation

Description and section text is preserved as authored Markdown. The convention/parser must not render Markdown or convert it into HTML.

Preserve meaningful formatting including:
- Bold and italic text
- Inline code
- Links
- Lists
- Nested headings and paragraphs

The immutable original source remains the authoritative text.

---

## References

- `src/requirements/types.ts` — Requirement type definitions
- `src/requirements/validation.ts` — Validation rules for requirements
- `docs/PROJECT_SPEC.md` section 7.2 — Requirements and requirement identity
- `docs/DECISIONS.md` DEC-009 — Author-assigned stable requirement IDs
- `docs/DECISIONS.md` DEC-029 — Storage lifecycle decisions
- `docs/DECISIONS.md` DEC-030 — Document reference vs. document registry responsibilities
