/**
 * Run ID generation with collision safety
 *
 * Generates UTC timestamp-based run IDs and ensures uniqueness.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generate a collision-safe UTC timestamp-based run ID.
 *
 * Format: YYYY-MM-DDTHH-mm-ss-SSSZ
 * Example: 2026-10-31T19-29-05-123Z
 *
 * If a directory with this ID already exists in the artifact directory,
 * a suffix (-2, -3, etc.) is added to ensure uniqueness.
 *
 * @param artifactDirectory - Absolute path to the artifact directory
 * @returns Unique run ID string
 */
export function generateRunId(artifactDirectory: string): string {
  const baseId = createTimestampId();

  // Check if this ID already exists
  if (!existsSync(join(artifactDirectory, baseId))) {
    return baseId;
  }

  // Find next available suffix
  let suffix = 2;
  while (existsSync(join(artifactDirectory, `${baseId}-${suffix}`))) {
    suffix++;
    // Safety limit to prevent infinite loops
    if (suffix > 1000) {
      throw new Error(
        `Unable to generate unique run ID after 1000 attempts. ` +
        `Check artifact directory: ${artifactDirectory}`
      );
    }
  }

  return `${baseId}-${suffix}`;
}

/**
 * Create a UTC timestamp-based ID string.
 *
 * Format: YYYY-MM-DDTHH-mm-ss-SSSZ
 * Uses colons replaced with hyphens for filesystem safety on all platforms.
 */
function createTimestampId(): string {
  const now = new Date();

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}-${milliseconds}Z`;
}
