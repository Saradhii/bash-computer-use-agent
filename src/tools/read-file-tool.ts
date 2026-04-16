import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import type { ToolDefinition, ToolSchema, ToolResult } from '../types.js';

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_OUTPUT_LINES = 2000;

export class ReadFileTool implements ToolDefinition {
  readonly name = 'read_file';
  readonly description =
    'Read the contents of a file. Returns file content with line numbers. Supports reading specific line ranges.';
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
              description: 'Path to the file to read (relative or absolute)',
            },
            offset: {
              type: 'number',
              description: 'Line number to start reading from (1-indexed). Default: 1',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of lines to read. Default: 2000',
            },
          },
          required: ['path'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args['path'] as string;
    const offset = (args['offset'] as number) ?? 1;
    const limit = (args['limit'] as number) ?? MAX_OUTPUT_LINES;

    if (!filePath) {
      return { content: 'No file path provided', isError: true };
    }

    try {
      const resolvedPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);

      const fileStat = await stat(resolvedPath);

      if (!fileStat.isFile()) {
        return { content: `Path is not a file: ${filePath}`, isError: true };
      }

      if (fileStat.size > MAX_FILE_SIZE) {
        return {
          content: `File is too large (${Math.round(fileStat.size / 1024)}KB). Use offset/limit to read specific sections.`,
          isError: true,
          metadata: { size: fileStat.size },
        };
      }

      const content = await readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(1, offset) - 1;
      const endLine = Math.min(lines.length, startLine + limit);
      const selectedLines = lines.slice(startLine, endLine);

      const numberedContent = selectedLines
        .map((line, i) => `${startLine + i + 1}: ${line}`)
        .join('\n');

      const summary =
        lines.length > endLine
          ? `\n\n(showing lines ${startLine + 1}-${endLine} of ${lines.length}. Use offset/limit to read more)`
          : '';

      return {
        content: numberedContent + summary,
        isError: false,
        metadata: { totalLines: lines.length, path: resolvedPath },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: `File not found: ${filePath}`, isError: true };
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return { content: `Permission denied: ${filePath}`, isError: true };
      }
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  updateCwd(cwd: string): void {
    this._cwd = cwd;
  }
}
