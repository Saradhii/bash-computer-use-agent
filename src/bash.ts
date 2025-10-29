/**
 * Bash command executor with safety features
 * Handles command validation, execution, and working directory tracking
 * Based on NVIDIA's official implementation
 */

import { execa, type ExecaError } from 'execa';
import { join, resolve, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { type Config } from './config.js';
import type {
  CommandResult,
  ExecutionContext,
  ToolSchema,
  CommandExecutionError
} from './types.js';
import {
  CommandValidationError
} from './types.js';

/**
 * Command injection patterns to block
 * Prevents command injection attacks
 */
const INJECTION_PATTERNS = [
  /\$[^a-zA-Z_]/, // $ followed by non-alphabetic character
  /`[^`]*`/, // Backticks for command substitution
  /\$\([^)]*\)/, // $(command) substitution
  /\$\{[^}]*\}/, // ${variable} substitution
  /<[^>]*>/, // Input redirection
  /[^\\]\|[^|]/, // Pipes (except escaped)
  /&&/, // Command chaining
  /\|\|/, // OR command chaining
  /;/, // Command separator
  /&[^&]/, // Background command
  />>/, // Append redirection
  />[^>]/, // Output redirection (except >>)
] as const;

/**
 * Bash executor class that provides safe command execution
 * with working directory tracking and comprehensive error handling
 */
export class Bash {
  private _cwd: string;
  private readonly _config: Config;
  private readonly _env: NodeJS.ProcessEnv;

  /**
   * Initialize the Bash executor
   * @param config - Application configuration
   */
  constructor(config: Config) {
    this._config = config;
    this._cwd = config.rootDir;
    this._env = { ...process.env };

    // Initialize the working directory
    void this.initializeWorkingDirectory();
  }

  /**
   * Get the current working directory
   */
  get cwd(): string {
    return this._cwd;
  }

  /**
   * Initialize the working directory
   * @private
   */
  private async initializeWorkingDirectory(): Promise<void> {
    try {
      // Validate and set the initial working directory
      const result = await this.executeCommand(`cd "${this._cwd}"`);
      if (result.exitCode !== 0) {
        console.error(`Warning: Could not set initial working directory to ${this._cwd}`);
      }
    } catch (error) {
      console.error(`Warning: Failed to initialize working directory: ${error}`);
    }
  }

  /**
   * Split command string into parts for validation
   * @param command - Command string to split
   * @returns Array of command parts
   * @private
   */
  private _splitCommands(command: string): string[] {
    // Split by spaces, but preserve quoted strings
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes && char === ' ') {
        if (current) {
          parts.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Check for command injection patterns
   * @param command - Command to check
   * @throws {CommandValidationError} If injection patterns are found
   * @private
   */
  private _checkForInjection(command: string): void {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(command)) {
        throw new CommandValidationError(
          'Command injection patterns are not allowed.',
          command
        );
      }
    }
  }

  /**
   * Execute a bash command with safety checks
   * @param command - Command to execute
   * @returns Promise resolving to command result
   * @throws {CommandValidationError} If command fails validation
   * @throws {CommandExecutionError} If command execution fails
   */
  async execBashCommand(command: string): Promise<CommandResult> {
    // Check for injection patterns first
    this._checkForInjection(command);

    // Validate command against allowlist
    this._config.validateCommand(command);

    // Special handling for cd command
    if (command.trim().startsWith('cd ')) {
      return this.handleCdCommand(command);
    }

    // Execute regular command with NVIDIA's wrapping pattern
    return this.executeCommandWithWrapper(command);
  }

  /**
   * Handle cd command specially to track working directory
   * @param command - The cd command
   * @returns Command result with updated working directory
   * @private
   */
  private async handleCdCommand(command: string): Promise<CommandResult> {
    try {
      // Extract directory path from command
      const dirPath = this.extractDirectoryPath(command);

      // Resolve the new working directory
      const newCwd = this.resolvePath(dirPath);

      // Check if directory exists
      const checkResult = await this.executeCommand(`test -d "${newCwd}" && echo "EXISTS"`);

      if (checkResult.exitCode !== 0 || !checkResult.stdout.includes('EXISTS')) {
        return {
          stdout: '',
          stderr: `Directory does not exist: ${newCwd}`,
          cwd: this._cwd,
          exitCode: 1,
        };
      }

      // Update working directory
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

  /**
   * Extract directory path from cd command
   * @param command - cd command string
   * @returns Directory path
   * @private
   */
  private extractDirectoryPath(command: string): string {
    // Remove 'cd ' prefix and strip whitespace
    return command.trim().substring(3).trim().replace(/^["']|["']$/g, '');
  }

  /**
   * Resolve a path relative to current working directory
   * @param path - Path to resolve
   * @returns Absolute path
   * @private
   */
  private resolvePath(path: string): string {
    // Handle special cases
    if (path === '~' || path === '~/') {
      return homedir();
    }

    if (path === '-') {
      // Previous directory (not implemented for safety)
      return this._cwd;
    }

    // Resolve relative or absolute path
    if (isAbsolute(path)) {
      return resolve(path);
    }

    return resolve(this._cwd, path);
  }

  /**
   * Execute a command using NVIDIA's wrapping pattern
   * Wraps command with echo __END__; pwd to separate output and directory
   * @param command - Command to execute
   * @returns Command result
   * @private
   */
  private async executeCommandWithWrapper(command: string): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      // Wrap command with NVIDIA's pattern: command; echo __END__; pwd
      const wrappedCommand = `${command}; echo __END__; pwd`;

      // Execute wrapped command with timeout
      const result = await execa(wrappedCommand, {
        shell: true,
        cwd: this._cwd,
        env: this._env,
        timeout: this._config.security.commandTimeout,
        extendEnv: false,
        cleanup: true,
        stripFinalNewline: false, // Keep newlines for parsing
      });

      // Parse output to separate stdout, stderr, and new cwd
      const output = result.stdout || '';
      const stderr = result.stderr || '';

      // Split output by __END__ marker
      const parts = output.split('__END__');
      const stdout = parts[0]?.trim() ?? '';
      const newCwd = parts[1]?.trim() ?? this._cwd;

      // Update working directory
      this._cwd = newCwd;

      // If no stdout output, provide success message
      const finalStdout = stdout || 'Command executed successfully, without any output.';

      return {
        stdout: finalStdout,
        stderr: stderr,
        cwd: newCwd,
        exitCode: result.exitCode,
      };
    } catch (error) {
      // Handle execution errors
      if (error instanceof Error && 'exitCode' in error) {
        const execError = error as unknown as {
          exitCode?: number;
          stdout?: string | unknown[];
          stderr?: string | unknown[];
          command: string;
          message?: string
        };

        const stdout = typeof execError.stdout === 'string' ? execError.stdout : '';
        const stderr = typeof execError.stderr === 'string' ? execError.stderr : execError.message || 'Unknown error';

        return {
          stdout: stdout,
          stderr: stderr,
          cwd: this._cwd,
          exitCode: execError.exitCode ?? 1,
        };
      }

      // Handle unexpected errors
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

  /**
   * Execute a command using execa for better error handling
   * @param command - Command to execute
   * @returns Command result
   * @private
   */
  private async executeCommand(command: string): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      // Execute command with timeout
      const result = await execa(command, {
        shell: true,
        cwd: this._cwd,
        env: this._env,
        timeout: this._config.security.commandTimeout,
        extendEnv: false,
        cleanup: true,
        stripFinalNewline: true,
      });

      // Handle output - NVIDIA approach
      let stdout = result.stdout;
      let stderr = result.stderr;
      let newCwd = this._cwd;

      // If no output, provide success message (like NVIDIA's implementation)
      if (!stdout && !stderr) {
        stdout = 'Command executed successfully, without any output.';
      }

      // Only check for directory changes if it's a cd command
      if (command.trim().startsWith('cd ')) {
        // Execute a separate pwd to get the current directory
        try {
          const pwdResult = await execa('pwd', {
            shell: true,
            cwd: this._cwd,
            timeout: 1000,
            stripFinalNewline: true,
          });
          newCwd = pwdResult.stdout.trim();
          this._cwd = newCwd;
        } catch {
          // If pwd fails, keep current directory
        }
      }

      return {
        stdout: stdout || '',
        stderr: stderr || '',
        cwd: newCwd,
        exitCode: result.exitCode,
      };
    } catch (error) {
      // Handle execution errors
      if (error instanceof Error && 'exitCode' in error) {
        const execError = error as unknown as { exitCode?: number; stdout?: string | unknown[]; stderr?: string | unknown[]; command: string; message?: string };

        // Update working directory if available in error output
        let newCwd = this._cwd;
        if (execError.stdout && typeof execError.stdout === 'string') {
          const lines = execError.stdout.split('\n');
          const lastLine = lines[lines.length - 1]?.trim();
          if (lastLine && lastLine !== execError.command) {
            newCwd = lastLine;
          }
        }

        return {
          stdout: typeof execError.stdout === 'string' ? execError.stdout : '',
          stderr: typeof execError.stderr === 'string' ? execError.stderr : execError.message || 'Unknown error',
          cwd: newCwd,
          exitCode: execError.exitCode ?? 1,
        };
      }

      // Handle unexpected errors
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

  /**
   * Get the JSON schema for the exec_bash_command tool
   * @returns Tool schema for LLM function calling
   */
  getToolSchema(): ToolSchema {
    return this._config.bashToolSchema;
  }

  /**
   * Get execution context information
   * @returns Current execution context
   */
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

  /**
   * Check if a file exists in the current working directory
   * @param filename - File to check
   * @returns True if file exists
   */
  async fileExists(filename: string): Promise<boolean> {
    try {
      const result = await this.executeCommand(`test -f "${filename}" && echo "EXISTS"`);
      return result.stdout.includes('EXISTS');
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists in the current working directory
   * @param dirname - Directory to check
   * @returns True if directory exists
   */
  async directoryExists(dirname: string): Promise<boolean> {
    try {
      const result = await this.executeCommand(`test -d "${dirname}" && echo "EXISTS"`);
      return result.stdout.includes('EXISTS');
    } catch {
      return false;
    }
  }

  /**
   * Get the size of a file
   * @param filename - File to check
   * @returns File size in bytes, or null if file doesn't exist
   */
  async getFileSize(filename: string): Promise<number | null> {
    try {
      const result = await this.executeCommand(`wc -c < "${filename}"`);
      const size = parseInt(result.stdout.trim(), 10);
      return isNaN(size) ? null : size;
    } catch {
      return null;
    }
  }

  /**
   * List files in current directory with optional pattern
   * @param pattern - Glob pattern to match (optional)
   * @returns Array of file names
   */
  async listFiles(pattern?: string): Promise<string[]> {
    try {
      const command = pattern ? `ls -1 ${pattern} 2>/dev/null` : 'ls -1';
      const result = await this.executeCommand(command);

      if (result.exitCode === 0 && result.stdout) {
        return result.stdout.split('\n').filter(Boolean);
      }

      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get current user information
   * @returns User information object
   */
  async getUserInfo(): Promise<{ user: string; home: string; shell: string }> {
    try {
      const userResult = await this.executeCommand('whoami');
      const homeResult = await this.executeCommand('echo $HOME');
      const shellResult = await this.executeCommand('echo $SHELL');

      return {
        user: userResult.stdout.trim(),
        home: homeResult.stdout.trim(),
        shell: shellResult.stdout.trim(),
      };
    } catch {
      return {
        user: 'unknown',
        home: homedir(),
        shell: '/bin/bash',
      };
    }
  }
}