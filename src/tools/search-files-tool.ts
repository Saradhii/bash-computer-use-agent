import { execa } from 'execa';
import { resolve, isAbsolute } from 'node:path';
import type { ToolDefinition, ToolSchema, ToolResult } from '../types.js';

interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

export class SearchFilesTool implements ToolDefinition {
  readonly name = 'search_files';
  readonly description =
    'Search for patterns in files using grep. Returns matching files with line numbers and context.';
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
            pattern: {
              type: 'string',
              description: 'Search pattern (regex supported)',
            },
            path: {
              type: 'string',
              description: 'Directory or file to search in. Default: current directory',
            },
            include: {
              type: 'string',
              description: 'File pattern to include (e.g., "*.ts", "*.{js,jsx}")',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results. Default: 50',
            },
          },
          required: ['pattern'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args['pattern'] as string;
    const searchPath = (args['path'] as string) ?? '.';
    const include = args['include'] as string | undefined;
    const maxResults = (args['maxResults'] as number) ?? 50;

    if (!pattern) {
      return { content: 'No search pattern provided', isError: true };
    }

    try {
      const resolvedPath = isAbsolute(searchPath) ? searchPath : resolve(this._cwd, searchPath);

      const grepArgs = ['--line-number', '--with-filename', '--no-heading'];

      if (include) {
        grepArgs.push(`--include=${include}`);
      }

      grepArgs.push('--', pattern, resolvedPath);

      let result;
      try {
        result = await execa('grep', ['-r', ...grepArgs], {
          timeout: 10000,
          maxBuffer: 1024 * 1024,
          reject: false,
        });
      } catch {
        result = await execa('grep', ['-rn', pattern, resolvedPath], {
          timeout: 10000,
          maxBuffer: 1024 * 1024,
          reject: false,
        });
      }

      if (!result.stdout || result.stdout.trim().length === 0) {
        return {
          content: `No matches found for pattern: "${pattern}"`,
          isError: false,
        };
      }

      const lines = result.stdout.trim().split('\n');
      const limited = lines.slice(0, maxResults);

      let output = limited.join('\n');

      if (lines.length > maxResults) {
        output += `\n\n(showing ${maxResults} of ${lines.length} matches)`;
      }

      return {
        content: output,
        isError: false,
        metadata: { totalMatches: lines.length, pattern, path: resolvedPath },
      };
    } catch (error) {
      return {
        content: `Error searching files: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  updateCwd(cwd: string): void {
    this._cwd = cwd;
  }
}
