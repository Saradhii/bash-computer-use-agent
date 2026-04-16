import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { ToolDefinition, ToolSchema, ToolResult, TrustTier } from '../types.js';

export class WriteFileTool implements ToolDefinition {
  readonly name = 'write_file';
  readonly description =
    'Write content to a file. Creates parent directories if needed. Returns diff summary.';
  readonly requiresConfirmation = true;

  private _cwd: string;
  private readonly _trustTier: TrustTier;

  constructor(cwd: string, trustTier: TrustTier) {
    this._cwd = cwd;
    this._trustTier = trustTier;
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
              description: 'Path to the file to write (relative or absolute)',
            },
            content: {
              type: 'string',
              description: 'Content to write to the file',
            },
            append: {
              type: 'boolean',
              description: 'If true, append to file instead of overwriting. Default: false',
            },
          },
          required: ['path', 'content'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args['path'] as string;
    const content = args['content'] as string;
    const append = (args['append'] as boolean) ?? false;

    if (!filePath) {
      return { content: 'No file path provided', isError: true };
    }

    if (content === undefined || content === null) {
      return { content: 'No content provided', isError: true };
    }

    try {
      const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(this._cwd, filePath);

      const existed = existsSync(resolvedPath);
      let previousSize = 0;

      if (existed) {
        const prevStat = await stat(resolvedPath);
        previousSize = prevStat.size;
      }

      const dir = dirname(resolvedPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      if (append && existed) {
        const { appendFile } = await import('node:fs/promises');
        await appendFile(resolvedPath, content, 'utf-8');
      } else {
        await writeFile(resolvedPath, content, 'utf-8');
      }

      const newStat = await stat(resolvedPath);
      const lineCount = content.split('\n').length;

      const action = append && existed ? 'Appended to' : existed ? 'Updated' : 'Created';
      const sizeInfo = existed
        ? ` (${previousSize} -> ${newStat.size} bytes)`
        : ` (${newStat.size} bytes, ${lineCount} lines)`;

      return {
        content: `${action} file: ${filePath}${sizeInfo}`,
        isError: false,
        metadata: { path: resolvedPath, existed, size: newStat.size, lines: lineCount },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return { content: `Permission denied: ${filePath}`, isError: true };
      }
      return {
        content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  updateCwd(cwd: string): void {
    this._cwd = cwd;
  }
}
