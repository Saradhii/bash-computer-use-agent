import { basename, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  const firstSpace = trimmed.indexOf(' ');
  return firstSpace > 0 ? trimmed.substring(0, firstSpace) : trimmed;
}

export function isEmpty(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      i++;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
      i++;
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
      i++;
    } else {
      current += char;
      i++;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function getFileExtension(path: string): string {
  return extname(path).substring(1);
}

export function getRelativePath(from: string, to: string): string {
  return relative(from, to);
}

export function sanitizeString(str: string): string {
  return str
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim();
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries) {
        break;
      }
      await delay(baseDelay * Math.pow(2, attempt - 1));
    }
  }

  throw lastError!;
}

export function generateId(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else if (ms < 3600000) {
    return `${(ms / 60000).toFixed(1)}m`;
  } else {
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}

export function isPromise(value: unknown): value is Promise<unknown> {
  return value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function';
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }

  if (typeof obj === 'object' && obj !== null) {
    const cloned: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
      }
    }
    return cloned as T;
  }

  return obj;
}

export function memoize<TArgs extends readonly unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  maxSize: number = 100
): (...args: TArgs) => TReturn {
  const cache = new Map<string, { value: TReturn; timestamp: number }>();
  const accessOrder: string[] = [];

  return (...args: TArgs): TReturn => {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      // Move to end of access order
      const index = accessOrder.indexOf(key);
      if (index > -1) {
        accessOrder.splice(index, 1);
      }
      accessOrder.push(key);
      return cache.get(key)!.value;
    }

    // Compute new value
    const value = fn(...args);

    // Manage cache size
    if (cache.size >= maxSize && accessOrder.length > 0) {
      const oldestKey = accessOrder.shift()!;
      cache.delete(oldestKey);
    }

    cache.set(key, { value, timestamp: Date.now() });
    accessOrder.push(key);

    return value;
  };
}

export function getTimestamp(): string {
  return new Date().toISOString();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}