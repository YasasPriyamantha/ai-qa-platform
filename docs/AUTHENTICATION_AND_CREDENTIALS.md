# Authentication and Credential Security

**Document status:** Phase 2 baseline
**Related decisions:** DEC-024, DEC-028

This document describes the security conventions for handling credentials and authentication state in the AI QA Automation Platform.

---

## 1. Overview

The platform handles two distinct categories of sensitive information:

1. **Platform-level AI provider credentials** — API keys for hosted AI model inference (Phase 3+)
2. **Project-level test credentials** — Usernames, passwords, and tokens used to authenticate with applications under test

Both categories require careful handling to prevent accidental exposure through commits, logs, reports, or AI prompts.

## 2. Platform-Level AI Provider Credentials

### 2.1 Storage location

The AI provider API key is stored in a local `.env` file at the repository root. This file:

- Is Git-ignored and must never be committed
- Is never created automatically; users copy `.env.example` and fill in values
- Contains the actual secret value (not an environment variable name)

### 2.2 Separation from project configuration

Platform AI provider credentials must never be stored in:

- `project.config.json` files
- Project role profile `credentials` fields
- Any file tracked by Git

The `.env` file is the only authorized location for platform-level secrets in local development.

### 2.3 Phase 2 constraints

In Phase 2, the `AI_PROVIDER_API_KEY` variable:

- Is defined as a placeholder in `.env.example`
- Is not loaded, validated, or used by any platform code
- Has no provider-specific SDK or integration

Provider selection and API integration are deferred to Phase 3.

## 3. Project-Level Test Credentials

### 3.1 Role profiles and credential references

Project configurations may define role profiles that reference credentials:

```json
{
  "roles": [
    {
      "roleId": "standard_user",
      "name": "Standard User",
      "credentials": {
        "username": "SAUCEDEMO_STANDARD_USER_USERNAME",
        "password": "SAUCEDEMO_STANDARD_USER_PASSWORD"
      },
      "storageStatePath": ".auth/standard_user.json"
    }
  ]
}
```

**Key principles:**

- The `credentials` object stores **environment variable names**, not actual values
- Actual credential values are loaded from the `.env` file at runtime
- Project configs are safe to commit because they contain only variable names

### 3.2 Environment variable naming convention

Use a consistent naming pattern for credential variables:

```
<PROJECT>_<ROLE>_<CREDENTIAL>
```

Examples:
- `SAUCEDEMO_STANDARD_USER_USERNAME`
- `SAUCEDEMO_STANDARD_USER_PASSWORD`
- `MYAPP_ADMIN_API_TOKEN`

### 3.3 Credential presence checking

The platform provides explicit credential presence checking via `checkCredentialPresence()` and `checkRoleCredentialPresence()`. These functions:

- Report missing variable **names** only, never values
- Do not throw on missing credentials
- Are designed for pre-flight checks before authenticated test execution
- Are not called during ordinary project loading

Loading a project configuration does not require the referenced credential environment variables to be present.

## 4. Authentication State Files

### 4.1 Sensitivity

Authentication state files (Playwright `storageState` JSON) may contain:

- Session cookies
- Authentication tokens
- Bearer tokens
- Refresh tokens
- Other session identifiers

These are **secrets** and must be treated with the same care as passwords.

### 4.2 Storage location convention

Authentication state files must be stored within the project workspace in a restricted location:

```
<project-workspace>/.auth/<role-id>.json
```

Example paths:
- `project-data/saucedemo/.auth/standard_user.json`
- `project-data/saucedemo/.auth/admin.json`
- `project-data/myapp/.auth/power-user.json`

The `.auth/` directory:
- Is Git-ignored via `**/.auth/` in `.gitignore`
- Contains only authentication state files
- Uses role IDs as filenames for easy identification
- Is created by the authenticated workflow when needed

### 4.3 Path validation

The platform validates that `storageStatePath` values:

- Are relative paths (not absolute POSIX, Windows drive, or UNC paths)
- Use the `.auth/` directory prefix (enforced convention)
- End with `.json` extension
- Do not contain path traversal segments (`..`)
- Resolve inside the project workspace after normalization

### 4.4 Git ignore rules

The following patterns in `.gitignore` protect authentication state:

```gitignore
# Playwright authentication state (secrets)
**/auth-state.json
**/storage-state.json
**/.auth/
```

Verify these rules are effective before committing any project changes.

## 5. Playwright Artifacts and Sensitive Data

**WARNING:** Playwright traces, videos, screenshots, and HTML reports may capture sensitive information including:

- Typed credentials (usernames, passwords)
- Session cookies and authentication tokens
- Page content that may include personal data
- Form submissions with sensitive values
- API responses containing tokens or secrets

These artifacts are stored in Git-ignored generated-output directories (`<project>/artifacts/<run-id>/`). They must:

- **NOT** be committed to version control
- **NOT** be shared externally without review
- **NOT** be included in AI prompts or context
- **NOT** be uploaded to public issue trackers

The platform configures Playwright to capture traces only on failure (`trace: 'retain-on-failure'`) and screenshots only on failure (`screenshot: 'only-on-failure'`) to minimize accidental credential capture.

## 6. Prohibited Exposure

Authentication state files and credential values must **never** appear in:

| Location | Reason |
|----------|--------|
| Git commits | Permanent exposure in repository history |
| Console logs | Visible in CI/CD logs, terminal history |
| Error messages | Could be captured by monitoring systems |
| JSON/HTML reports | May be shared or stored long-term |
| AI prompts | Sent to external model providers |
| AI context | Could influence or be reflected in outputs |
| Exception stack traces | May be logged or reported |

### 6.1 Logging guidelines

When logging:

- **DO** log environment variable names (e.g., "Missing credential: SAUCEDEMO_PASSWORD")
- **DO NOT** log environment variable values
- **DO** log that authentication state was loaded/saved
- **DO NOT** log authentication state file contents
- **DO** log file paths (e.g., ".auth/admin.json")
- **DO NOT** log cookies, tokens, or session identifiers

### 6.2 Error handling guidelines

When reporting errors:

- Include the credential name or file path for diagnosis
- Replace actual values with `[REDACTED]` if accidentally captured
- Do not include stack traces that might contain values

## 7. Unsupported Authentication Flows

### 7.1 Blocked authentication scenarios

The platform must surface the following as **blockers** requiring user-provided setup, rather than falsely reporting successful authentication:

| Scenario | Behavior |
|----------|----------|
| **CAPTCHA** | Cannot be automated; requires user to complete manually |
| **MFA/2FA** | Requires out-of-band verification; cannot be automated |
| **SSO/OAuth** | May require external identity provider interaction |
| **Hardware tokens** | Physical device interaction cannot be automated |
| **Biometric auth** | Fingerprint, face recognition cannot be automated |
| **Time-based OTP** | Requires manual token entry or special setup |

### 7.2 Surfacing blockers

When the platform detects or encounters an unsupported authentication flow:

1. **Stop the authentication attempt** — Do not retry or work around
2. **Report the blocker clearly** — Identify the specific flow that cannot be automated
3. **Do not claim success** — Never report authentication as successful when it was not
4. **Document requirements** — Explain what manual setup is needed

Example blocker report:

```
Authentication blocked: CAPTCHA detected on login page
  - Role: standard_user
  - URL: https://example.com/login
  - Blocker: Interactive CAPTCHA challenge

Action required: Complete login manually and export storageState,
or use a test environment with CAPTCHA disabled.
```

### 7.3 Manual authentication state provision

For applications with unsupported authentication flows, users may:

1. Log in manually using a browser
2. Export the authenticated session state using Playwright's `storageState`
3. Place the exported JSON file at the configured `storageStatePath`
4. Run tests using the pre-authenticated state

The platform must not validate or modify user-provided authentication state files beyond checking that the file exists and is readable JSON.

## 8. Phase 2 Scope

In Phase 2, the platform:

- **Implements:** Role profile configuration and credential reference validation
- **Implements:** `storageStatePath` configuration and path validation
- **Implements:** Git ignore rules for authentication state
- **Documents:** Security conventions and blocker handling

The platform does **not** implement in Phase 2:

- Playwright setup projects or login scripts
- Automated authentication state generation
- Authentication state file creation or management
- Actual authenticated test execution
- Blocker detection (CAPTCHA, MFA, etc.)

These capabilities are deferred per DEC-024.

## 9. Summary Checklist

Before running authenticated tests:

- [ ] `.env` file exists and is Git-ignored
- [ ] `.env` contains credential values for all referenced environment variables
- [ ] Project config stores only environment variable names, not values
- [ ] `storageStatePath` resolves inside the project workspace
- [ ] `.auth/` directory is Git-ignored
- [ ] No credentials appear in logs, reports, or prompts
- [ ] Unsupported auth flows are documented and surfaced as blockers

## References

- [Playwright Authentication](https://playwright.dev/docs/auth)
- [Playwright Storage State](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)
- DEC-024: Add authentication support in stages
- DEC-028: Adopt a Hosted AI Provider API for Model Inference
