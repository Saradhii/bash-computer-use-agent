import { describe, it, expect, vi } from 'vitest';
import {
  extractBaseCommand,
  isEmpty,
  truncate,
  formatBytes,
  parseCommandArgs,
  getFileExtension,
  sanitizeString,
  delay,
  generateId,
  formatDuration,
  isPromise,
  deepClone,
  getTimestamp,
  capitalize,
  snakeToCamel,
  camelToSnake,
  memoize,
} from '../src/utils.js';

describe('extractBaseCommand', () => {
  it('extracts first word from command', () => {
    expect(extractBaseCommand('git commit -m "msg"')).toBe('git');
  });

  it('returns whole string when no spaces', () => {
    expect(extractBaseCommand('ls')).toBe('ls');
  });

  it('trims leading whitespace', () => {
    expect(extractBaseCommand('  npm install')).toBe('npm');
  });

  it('returns trimmed string when only whitespace', () => {
    expect(extractBaseCommand('   ')).toBe('');
  });
});

describe('isEmpty', () => {
  it('returns true for null', () => {
    expect(isEmpty(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isEmpty(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isEmpty('')).toBe(true);
  });

  it('returns true for whitespace-only string', () => {
    expect(isEmpty('   ')).toBe(true);
  });

  it('returns false for non-empty string', () => {
    expect(isEmpty('hello')).toBe(false);
  });
});

describe('truncate', () => {
  it('returns original string when within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('returns exact-length string unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('handles maxLength of 3', () => {
    expect(truncate('hello', 3)).toBe('...');
  });
});

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('respects decimals parameter', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });

  it('handles negative decimals as 0', () => {
    expect(formatBytes(1024, -1)).toBe('1 KB');
  });
});

describe('parseCommandArgs', () => {
  it('splits simple command', () => {
    expect(parseCommandArgs('git commit -m "hello"')).toEqual(['git', 'commit', '-m', 'hello']);
  });

  it('handles single quotes', () => {
    expect(parseCommandArgs("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles double quotes', () => {
    expect(parseCommandArgs('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('handles empty string', () => {
    expect(parseCommandArgs('')).toEqual([]);
  });

  it('handles multiple spaces between args', () => {
    expect(parseCommandArgs('a   b   c')).toEqual(['a', 'b', 'c']);
  });
});

describe('getFileExtension', () => {
  it('extracts extension', () => {
    expect(getFileExtension('file.ts')).toBe('ts');
  });

  it('extracts extension from path', () => {
    expect(getFileExtension('/path/to/file.test.js')).toBe('js');
  });

  it('returns empty for no extension', () => {
    expect(getFileExtension('file')).toBe('');
  });

  it('handles hidden files with no real extension', () => {
    expect(getFileExtension('.gitignore')).toBe('');
  });
});

describe('sanitizeString', () => {
  it('removes control characters', () => {
    expect(sanitizeString('hello\x00world\x01')).toBe('helloworld');
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('removes tab characters', () => {
    expect(sanitizeString('hello\tworld')).toBe('helloworld');
  });

  it('returns clean string unchanged', () => {
    expect(sanitizeString('clean')).toBe('clean');
  });
});

describe('delay', () => {
  it('resolves after specified milliseconds', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('resolves with undefined', async () => {
    const result = await delay(0);
    expect(result).toBeUndefined();
  });
});

describe('generateId', () => {
  it('generates string of default length 8', () => {
    expect(generateId()).toHaveLength(8);
  });

  it('generates string of specified length', () => {
    expect(generateId(16)).toHaveLength(16);
  });

  it('generates alphanumeric characters', () => {
    const id = generateId(100);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId()));
    expect(ids.size).toBeGreaterThan(40);
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });

  it('formats minutes', () => {
    expect(formatDuration(120000)).toBe('2.0m');
  });

  it('formats hours', () => {
    expect(formatDuration(3600000)).toBe('1.0h');
  });

  it('formats exact boundary: 1000ms', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  it('formats exact boundary: 60000ms', () => {
    expect(formatDuration(60000)).toBe('1.0m');
  });
});

describe('isPromise', () => {
  it('returns true for a Promise', () => {
    expect(isPromise(Promise.resolve())).toBe(true);
  });

  it('returns false for null', () => {
    expect(isPromise(null)).toBe(false);
  });

  it('returns false for a plain object', () => {
    expect(isPromise({})).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isPromise('hello')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPromise(undefined)).toBe(false);
  });

  it('returns true for thenable object', () => {
    expect(isPromise({ then: () => {} })).toBe(true);
  });
});

describe('deepClone', () => {
  it('clones a plain object', () => {
    const obj = { a: 1, b: 'hello' };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  it('clones nested objects deeply', () => {
    const obj = { a: { b: { c: 1 } } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned.a).not.toBe(obj.a);
    expect(cloned.a.b).not.toBe(obj.a.b);
  });

  it('clones arrays', () => {
    const arr = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[1]).not.toBe(arr[1]);
  });

  it('clones dates', () => {
    const date = new Date('2024-01-01');
    const cloned = deepClone(date);
    expect(cloned).toEqual(date);
    expect(cloned).not.toBe(date);
  });

  it('returns primitives as-is', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBe(null);
    expect(deepClone(true)).toBe(true);
  });
});

describe('getTimestamp', () => {
  it('returns an ISO string', () => {
    const ts = getTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns a valid date', () => {
    const ts = getTimestamp();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

describe('capitalize', () => {
  it('capitalizes first character', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('handles already capitalized string', () => {
    expect(capitalize('Hello')).toBe('Hello');
  });

  it('handles empty string', () => {
    expect(capitalize('')).toBe('');
  });

  it('only capitalizes first character', () => {
    expect(capitalize('hello world')).toBe('Hello world');
  });
});

describe('snakeToCamel', () => {
  it('converts snake_case to camelCase', () => {
    expect(snakeToCamel('hello_world')).toBe('helloWorld');
  });

  it('handles multiple underscores', () => {
    expect(snakeToCamel('my_long_variable_name')).toBe('myLongVariableName');
  });

  it('returns unchanged if no underscores', () => {
    expect(snakeToCamel('hello')).toBe('hello');
  });

  it('handles leading underscore', () => {
    expect(snakeToCamel('_private')).toBe('Private');
  });
});

describe('camelToSnake', () => {
  it('converts camelCase to snake_case', () => {
    expect(camelToSnake('helloWorld')).toBe('hello_world');
  });

  it('handles multiple capitals', () => {
    expect(camelToSnake('myLongVariableName')).toBe('my_long_variable_name');
  });

  it('returns unchanged if no capitals', () => {
    expect(camelToSnake('hello')).toBe('hello');
  });

  it('handles single capital at start', () => {
    expect(camelToSnake('Hello')).toBe('_hello');
  });
});

describe('memoize', () => {
  it('caches function results', () => {
    const fn = vi.fn((x: number) => x * 2);
    const memoized = memoize(fn);
    expect(memoized(5)).toBe(10);
    expect(memoized(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caches different arguments separately', () => {
    const fn = vi.fn((x: number) => x * 2);
    const memoized = memoize(fn);
    expect(memoized(1)).toBe(2);
    expect(memoized(2)).toBe(4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest entry when maxSize exceeded', () => {
    const fn = vi.fn((x: number) => x);
    const memoized = memoize(fn, 2);
    memoized(1);
    memoized(2);
    memoized(3);
    expect(fn).toHaveBeenCalledTimes(3);
    fn.mockClear();
    memoized(2);
    expect(fn).toHaveBeenCalledTimes(0);
    memoized(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses default maxSize of 100', () => {
    const fn = vi.fn((x: number) => x);
    const memoized = memoize(fn);
    for (let i = 0; i < 100; i++) {
      memoized(i);
    }
    fn.mockClear();
    memoized(50);
    expect(fn).toHaveBeenCalledTimes(0);
  });
});
