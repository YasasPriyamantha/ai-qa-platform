/**
 * Unit tests for CLI argument parsing
 */

import { describe, it, expect } from 'vitest';
import { parseArgs, getHelpText } from '../../../src/cli/args.js';

describe('parseArgs', () => {
  describe('help command', () => {
    it('should parse "help" command', () => {
      const result = parseArgs(['help']);
      expect(result.command).toBe('help');
      expect(result.errors).toHaveLength(0);
    });

    it('should parse "--help" flag', () => {
      const result = parseArgs(['--help']);
      expect(result.command).toBe('help');
      expect(result.errors).toHaveLength(0);
    });

    it('should parse "-h" flag', () => {
      const result = parseArgs(['-h']);
      expect(result.command).toBe('help');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('no arguments', () => {
    it('should return help with error for empty args', () => {
      const result = parseArgs([]);
      expect(result.command).toBe('help');
      expect(result.errors).toContain('No command specified');
    });
  });

  describe('unknown command', () => {
    it('should return help with error for unknown command', () => {
      const result = parseArgs(['unknown']);
      expect(result.command).toBe('help');
      expect(result.errors).toContain('Unknown command: unknown');
    });

    it('should return help with error for multiple unknown commands', () => {
      const result = parseArgs(['foo']);
      expect(result.command).toBe('help');
      expect(result.errors.some(e => e.includes('Unknown command'))).toBe(true);
    });
  });

  describe('ai-check command', () => {
    it('parses ai-check with and without --live, and rejects unknown options', () => {
      expect(parseArgs(['ai-check'])).toEqual({ command: 'ai-check', aiCheckOptions: { live: false }, errors: [] });
      expect(parseArgs(['ai-check', '--live'])).toEqual({ command: 'ai-check', aiCheckOptions: { live: true }, errors: [] });
      expect(parseArgs(['ai-check', '--force']).errors).toContain('Unknown option: --force');
    });
  });

  describe('mcp-check command', () => {
    it('parses mcp-check --config and requires the config path', () => {
      expect(parseArgs(['mcp-check', '--config', 'p.json'])).toEqual({
        command: 'mcp-check', mcpCheckOptions: { configPath: 'p.json' }, errors: [],
      });
      expect(parseArgs(['mcp-check']).errors).toContain('Missing required option: --config <project-config-path>');
    });
  });

  describe('run command', () => {
    it('should parse run command with --config option', () => {
      const result = parseArgs(['run', '--config', 'path/to/config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('path/to/config.json');
    });

    it('should parse run command with -c option', () => {
      const result = parseArgs(['run', '-c', 'path/to/config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('path/to/config.json');
    });

    it('should parse run command with --config=value syntax', () => {
      const result = parseArgs(['run', '--config=path/to/config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('path/to/config.json');
    });

    it('should parse run command with -c=value syntax', () => {
      const result = parseArgs(['run', '-c=path/to/config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('path/to/config.json');
    });

    it('should error when run command is missing --config', () => {
      const result = parseArgs(['run']);
      expect(result.command).toBe('run');
      expect(result.errors).toContain('Missing required option: --config <project-config-path>');
    });

    it('should error when --config is missing value', () => {
      const result = parseArgs(['run', '--config']);
      expect(result.command).toBe('run');
      expect(result.errors).toContain('--config requires a path argument');
    });

    it('should error when --config is followed by another option', () => {
      const result = parseArgs(['run', '--config', '--other']);
      expect(result.command).toBe('run');
      expect(result.errors).toContain('--config requires a path argument');
    });

    it('should error for unknown options', () => {
      const result = parseArgs(['run', '--config', 'path', '--unknown']);
      expect(result.command).toBe('run');
      expect(result.errors).toContain('Unknown option: --unknown');
    });

    it('should error for unexpected positional arguments', () => {
      const result = parseArgs(['run', '--config', 'path', 'extra']);
      expect(result.command).toBe('run');
      expect(result.errors).toContain('Unexpected argument: extra');
    });

    it('should handle paths with spaces', () => {
      const result = parseArgs(['run', '--config', 'path/with spaces/config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('path/with spaces/config.json');
    });

    it('should handle absolute Windows paths', () => {
      const result = parseArgs(['run', '--config', 'C:\\Users\\test\\config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('C:\\Users\\test\\config.json');
    });

    it('should handle absolute Unix paths', () => {
      const result = parseArgs(['run', '--config', '/home/user/config.json']);
      expect(result.command).toBe('run');
      expect(result.errors).toHaveLength(0);
      expect(result.runOptions?.configPath).toBe('/home/user/config.json');
    });
  });
});

describe('getHelpText', () => {
  it('should return non-empty help text', () => {
    const help = getHelpText();
    expect(help.length).toBeGreaterThan(0);
  });

  it('should include usage information', () => {
    const help = getHelpText();
    expect(help).toContain('Usage:');
    expect(help).toContain('npm run qa');
  });

  it('should include run command', () => {
    const help = getHelpText();
    expect(help).toContain('run');
    expect(help).toContain('--config');
  });

  it('should include help command', () => {
    const help = getHelpText();
    expect(help).toContain('help');
  });

  it('should mention provisional results', () => {
    const help = getHelpText();
    expect(help).toContain('PROVISIONAL');
  });

  it('should include exit code information', () => {
    const help = getHelpText();
    expect(help).toContain('Exit Codes:');
  });
});
