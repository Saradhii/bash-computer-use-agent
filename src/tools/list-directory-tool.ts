import { readdir, stat, readFile } from 'node:fs/promises';
import { resolve, isAbsolute, join, extname } from 'node:path';
import type { ToolDefinition, ToolSchema, ToolResult } from '../types.js';

interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modified: string;
}

export class ListDirectoryTool implements ToolDefinition {
  readonly name = 'list_directory';
  readonly description =
    'List directory contents with file details. Returns names, types, sizes, and modification times.';
  readonly requiresConfirmation = false;

  private _cwd: string;

  constructor(cwd: string) {
    this._cwd = cwd;
  }

  get schema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Directory path to list (relative or absolute). Default: current directory',
            },
            recursive: {
              type: 'boolean',
              description: 'If true, list recursively. Default: false',
            },
            maxDepth: {
              type: 'number',
              description: 'Maximum recursion depth when recursive=true. Default: 3',
            },
          },
          required: [],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = (args['path'] as string) ?? '.';
    const recursive = (args['recursive'] as boolean) ?? false;
    const maxDepth = (args['maxDepth'] as number) ?? 3;

    try {
      const resolvedPath = isAbsolute(dirPath) ? dirPath : resolve(this._cwd, dirPath);
      const entries = await this._listDir(resolvedPath, recursive, maxDepth, 0);

      if (entries.length === 0) {
        return { content: `Empty directory: ${dirPath}`, isError: false };
      }

      const formatted = this._formatEntries(entries, resolvedPath);

      return {
        content: formatted,
        isError: false,
        metadata: { count: entries.length, path: resolvedPath },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: `Directory not found: ${dirPath}`, isError: true };
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        return { content: `Not a directory: ${dirPath}`, isError: true };
      }
      return {
        content: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private async _listDir(
    dirPath: string,
    recursive: boolean,
    maxDepth: number,
    currentDepth: number,
  ): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    let dirEntries;

    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    for (const entry of dirEntries) {
      const fullPath = join(dirPath, entry.name);

      let type: FileEntry['type'] = 'file';
      if (entry.isDirectory()) type = 'directory';
      else if (entry.isSymbolicLink()) type = 'symlink';

      let size = 0;
      let modified = '';

      try {
        const fileStat = await stat(fullPath);
        size = fileStat.size;
        modified = fileStat.mtime.toISOString();
      } catch {
        // skip stat errors
      }

      entries.push({ name: entry.name, type, size, modified });

      if (recursive && type === 'directory' && currentDepth < maxDepth) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const subEntries = await this._listDir(fullPath, recursive, maxDepth, currentDepth + 1);
        for (const sub of subEntries) {
          entries.push({
            ...sub,
            name: `${entry.name}/${sub.name}`,
          });
        }
      }
    }

    return entries;
  }

  private _formatEntries(entries: FileEntry[], basePath: string): string {
    const lines = entries.map((entry) => {
      const icon = entry.type === 'directory' ? 'd' : entry.type === 'symlink' ? 'l' : 'f';
      const sizeStr =
        entry.type === 'file' ? `${this._formatSize(entry.size)}`.padStart(10) : ''.padStart(10);
      return `${icon} ${sizeStr}  ${entry.name}`;
    });

    return lines.join('\n');
  }

  private _formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  updateCwd(cwd: string): void {
    this._cwd = cwd;
  }
}
