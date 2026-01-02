import { describe, test, expect } from 'bun:test';
import {
  compareVersions,
  parseVersion,
  generateId,
  getClaudeConfigDir,
} from '../src/utils/index.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('Utils', () => {
  describe('compareVersions', () => {
    test('should return 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    });

    test('should return -1 when first version is lower', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    });

    test('should return 1 when first version is higher', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    });

    test('should handle versions with different lengths', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', '1.0')).toBe(0);
      expect(compareVersions('1.0', '1.0.1')).toBe(-1);
    });
  });

  describe('parseVersion', () => {
    test('should parse standard semver', () => {
      const result = parseVersion('1.2.3');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.prerelease).toBeUndefined();
    });

    test('should parse version with v prefix', () => {
      const result = parseVersion('v1.2.3');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
    });

    test('should parse version with prerelease', () => {
      const result = parseVersion('1.2.3-beta.1');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.prerelease).toBe('beta.1');
    });

    test('should throw for invalid format', () => {
      expect(() => parseVersion('invalid')).toThrow('Invalid version format');
    });
  });

  describe('generateId', () => {
    test('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    test('should generate IDs with expected format', () => {
      const id = generateId();
      expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('getClaudeConfigDir', () => {
    test('should return path in home directory', () => {
      const configDir = getClaudeConfigDir();
      expect(configDir).toBe(join(homedir(), '.claude'));
    });
  });
});
