import type { ToolDefinition, ToolSchema, TrustTier } from '../types.js';
import { Bash } from '../bash.js';
import { Config } from '../config.js';

export class BashTool implements ToolDefinition {
  readonly name = 'exec_bash_command';
  readonly description =
    'Execute a bash command and return stdout/stderr and the working directory';

  private readonly _bash: Bash;
  private readonly _config: Config;

  constructor(bash: Bash, config: Config) {
    this._bash = bash;
    this._config = config;
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
            cmd: {
              type: 'string',
              description: 'The bash command to execute',
            },
          },
          required: ['cmd'],
        },
      },
    };
  }

  get requiresConfirmation(): boolean {
    return true;
  }

  shouldConfirm(args: Record<string, unknown>): boolean {
    const cmd = args['cmd'] as string;
    return this._config.requiresConfirmation(cmd);
  }

  async execute(args: Record<string, unknown>): Promise<import('../types.js').ToolResult> {
    const command = args['cmd'] as string;

    if (!command) {
      return { content: 'No command provided', isError: true };
    }

    try {
      const result = await this._bash.execBashCommand(command);

      const toolResult = {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        cwd: result.cwd,
        exitCode: result.exitCode || 0,
      };

      return {
        content: JSON.stringify(toolResult),
        isError: result.exitCode !== 0 && result.exitCode !== undefined,
      };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  get bash(): Bash {
    return this._bash;
  }
}
