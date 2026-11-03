/**
 * Platform version information
 */
export const VERSION = '0.1.0';
export const PLATFORM_NAME = 'AI QA Automation Platform';

export function getVersionInfo(): string {
  return `${PLATFORM_NAME} v${VERSION}`;
}
