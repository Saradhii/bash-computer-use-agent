import { execa, type ExecaError } from 'execa';
import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { type Config } from './config.js';
import type { CommandResult, ExecutionContext, ToolSchema } from './types.js';
import { CommandValidationError } from './types.js';

export class Bash {
  private _cwd: string;
  private readonly _config: Config;
  private readonly _env: NodeJS.ProcessEnv;

  constructor(config: Config) {
    this._config = config;
    this._cwd = config.rootDir;
    this._env = { ...process.env };
  }

  get cwd(): string {
    return this._cwd;
  }

  async execBashCommand(command: string): Promise<CommandResult> {
    this._config.validateCommand(command);

    if (command.trim().startsWith('cd ')) {
      return this._handleCdCommand(command);
    }

    return this._execute(command);
  }

  private async _handleCdCommand(command: string): Promise<CommandResult> {
    try {
      const dirPath = command
        .trim()
        .substring(3)
        .trim()
        .replace(/^["']|["']$/g, '');
      const newCwd = this._resolvePath(dirPath);

      const checkResult = await this._execute(`test -d "${newCwd}" && echo "EXISTS"`);
      if (checkResult.exitCode !== 0 || !checkResult.stdout.includes('EXISTS')) {
        return {
          stdout: '',
          stderr: `Directory does not exist: ${newCwd}`,
          cwd: this._cwd,
          exitCode: 1,
        };
      }

      this._cwd = newCwd;
      return {
        stdout: `Changed directory to: ${newCwd}`,
        stderr: '',
        cwd: this._cwd,
        exitCode: 0,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        cwd: this._cwd,
        exitCode: 1,
      };
    }
  }

  private _resolvePath(path: string): string {
    if (path === '~' || path === '~/') return homedir();
    if (path === '-') return this._cwd;
    if (isAbsolute(path)) return resolve(path);
    return resolve(this._cwd, path);
  }

  private async _execute(command: string): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      const wrappedCommand = `${command}; echo __END__; pwd`;

      const result = await execa(wrappedCommand, {
        shell: true,
        cwd: this._cwd,
        env: this._env,
        timeout: this._config.security.commandTimeout,
        extendEnv: false,
        cleanup: true,
        stripFinalNewline: false,
      });

      const output = result.stdout || '';
      const stderr = result.stderr || '';
      const parts = output.split('__END__');
      const stdout = parts[0]?.trim() ?? '';
      const newCwd = parts[1]?.trim() ?? this._cwd;

      this._cwd = newCwd;

      return {
        stdout: stdout || 'Command executed successfully, without any output.',
        stderr,
        cwd: newCwd,
        exitCode: result.exitCode,
      };
    } catch (error) {
      if (error instanceof Error && 'exitCode' in error) {
        const execError = error as unknown as {
          exitCode?: number;
          stdout?: string | unknown[];
          stderr?: string | unknown[];
          message?: string;
        };

        return {
          stdout: typeof execError.stdout === 'string' ? execError.stdout : '',
          stderr:
            typeof execError.stderr === 'string'
              ? execError.stderr
              : execError.message || 'Unknown error',
          cwd: this._cwd,
          exitCode: execError.exitCode ?? 1,
        };
      }

      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        cwd: this._cwd,
        exitCode: 1,
      };
    } finally {
      const duration = Date.now() - startTime;
      if (process.env['NODE_ENV'] === 'development') {
        console.debug(`Command executed in ${duration}ms: ${command}`);
      }
    }
  }

  getToolSchema(): ToolSchema {
    return this._config.bashToolSchema;
  }

  getExecutionContext(): ExecutionContext {
    const uid = process.getuid?.();
    const gid = process.getgid?.();

    return {
      cwd: this._cwd,
      env: this._env,
      ...(uid !== undefined && { uid }),
      ...(gid !== undefined && { gid }),
    };
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      const result = await this._execute(`test -f "${filename}" && echo "EXISTS"`);
      return result.stdout.includes('EXISTS');
    } catch {
      return false;
    }
  }

  async directoryExists(dirname: string): Promise<boolean> {
    try {
      const result = await this._execute(`test -d "${dirname}" && echo "EXISTS"`);
      return result.stdout.includes('EXISTS');
    } catch {
      return false;
    }
  }
}
