/**
 * Configuration management for the Computer Use Agent
 * Handles environment variables, default values, and validation
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import type {
  AppConfig,
  LLMConfig,
  SecurityConfig,
  EnvVars,
  ToolSchema
} from './types.js';
import {
  AgentError,
  CommandValidationError,
  envSchema
} from './types.js';

// Load environment variables from .env file
config();

/**
 * Get the current file's directory (ES module equivalent of __dirname)
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default allowed commands for the bash agent
 * These commands are safe to execute and commonly needed for file operations
 */
const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  // File operations
  'cd', 'cp', 'ls', 'cat', 'find', 'touch', 'echo', 'grep', 'pwd', 'mkdir',
  'sort', 'head', 'tail', 'du', 'wc', 'which', 'whereis', 'file', 'less', 'more',

  // Directory navigation and viewing
  'dirs', 'pushd', 'popd', 'tree',

  // macOS-specific commands
  'open',  // Can open applications and files on macOS

  // Network utilities
  'curl', 'wget', 'ping', 'nslookup', 'dig', 'netstat',

  // Text processing and manipulation
  'sed', 'awk', 'tr', 'cut', 'uniq', 'xargs', 'paste', 'join',

  // System information
  'date', 'whoami', 'uname', 'df', 'ps', 'top', 'uptime', 'free', 'lsof',

  // Development tools
  'python', 'python3', 'pip', 'pip3', 'node', 'npm', 'yarn', 'pnpm',

  // Version control
  'git', 'gh', 'svn', 'hg',

  // Archive and compression
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2',

  // Process management (read-only)
  'ps', 'top', 'htop', 'pgrep', 'pidof',

  // File permissions (viewing only)
  'ls -l', 'stat', 'getfacl',

  // Search utilities
  'find', 'locate', 'which', 'whereis',

  // System monitoring (read-only)
  'iostat', 'vmstat', 'sar', 'sysctl',
] as const);

/**
 * Default security configuration
 * Enhanced based on NVIDIA's implementation
 */
const DEFAULT_SECURITY_CONFIG: SecurityConfig = Object.freeze({
  allowedCommands: DEFAULT_ALLOWED_COMMANDS,
  blockedPatterns: Object.freeze([
    // Prevent command injection (NVIDIA pattern)
    /[`$\\(\\)]/,

    // Prevent destructive operations
    /\brm\b/,
    /\brm\s+/,
    /\bmv\b/,
    /\bcp\b.*\//, // cp with destination path
    /\bsudo\b/,
    /\bsu\b/,
    /\bdoas\b/,

    // Prevent permission changes
    /\bchmod\s+[0-9]/,
    /\bchown\b/,
    /\bchgrp\b/,

    // Prevent directory removal
    /\brmdir\b/,

    // Prevent system operations
    /\bshutdown\b/,
    /\breboot\b/,
    /\bhalt\b/,
    /\bpoweroff\b/,

    // Prevent user management
    /\buseradd\b/,
    /\buserdel\b/,
    /\busermod\b/,
    /\bgroupadd\b/,
    /\bgroupdel\b/,
    /\bpasswd\b/,

    // Prevent process killing
    /\bkill\b/,
    /\bkillall\b/,
    /\bpkill\b/,

    // Prevent disk operations
    /\bmkfs\b/,
    /\bformat\b/,
    /\bfdisk\b/,
    /\bdd\b/,
    /\bshred\b/,
    /\bwipe\b/,

    // Prevent system service changes
    /\bsystemctl\b/,
    /\bservice\b/,
    /\binit\b/,
    /\brc\./,

    // Prevent critical file modifications
    />\/etc\//,
    />>\/etc\//,
    />\/boot\//,
    />\/usr\//,
    />\/bin\//,
    />\/sbin\//,
    />\/lib\//,
    />\/lib64\//,

    // Prevent package installation
    /\bpip\s+install/,
    /\bnpm\s+install\s+-g/,
    /\byarn\s+global/,
    /\bgem\s+install/,
    /\bgo\s+install/,
    /\bcargo\s+install/,
    /\bbrew\s+install/,
    /\bapt-get\s+install/,
    /\byum\s+install/,
    /\bdnf\s+install/,
    /\bpacman\s+-S/,
    /\bapt\s+install/,

    // Prevent container operations
    /\bdocker\s+(exec|run|rm|stop|kill)/,
    /\bkubectl\s+(delete|exec|apply)/,
    /\bhelm\s+(delete|install|upgrade)/,

    // Prevent cron jobs
    /\bcrontab\b/,
    /\bat\b/,

    // Prevent firewall changes
    /\biptables\b/,
    /\bufw\b/,
    /\bfirewall-cmd\b/,

    // Prevent network operations on critical ports
    /:(22|23|25|53|135|139|445|993|995)\b/,

    // Prevent file redirection to sensitive locations
    />\s*\/(dev|proc|sys)/,
    />>\s*\/(dev|proc|sys)/,

    // Prevent background execution
    /&\s*$/,
    /\s&&\s/,
    /\s\|\|\s/,
    /;\s*$/,
  ]),
  allowPipesAndRedirects: false,
  commandTimeout: 30000, // 30 seconds
});

/**
 * Configuration class that manages all application settings
 */
export class Config {
  private readonly _llm: LLMConfig;
  private readonly _security: SecurityConfig;
  private readonly _rootDir: string;

  constructor() {
    // Validate environment variables
    const env = this.validateEnv();

    // Initialize LLM configuration
    this._llm = Object.freeze({
      baseUrl: env.LLM_BASE_URL,
      modelName: env.LLM_MODEL_NAME,
      apiKey: env.OPENROUTER_API_KEY,
      temperature: env.LLM_TEMPERATURE,
      topP: env.LLM_TOP_P,
      maxTokens: undefined, // Let the model decide
    });

    // Use default security configuration
    this._security = DEFAULT_SECURITY_CONFIG;

    // Set root directory to the project root
    this._rootDir = join(__dirname, '..');

    // Validate critical configuration
    this.validateConfig();
  }

  /**
   * Validate and parse environment variables
   * @throws {AgentError} If required environment variables are missing
   */
  private validateEnv(): EnvVars {
    try {
      return envSchema.parse(process.env);
    } catch (error) {
      if (error instanceof Error) {
        throw new AgentError(
          `Configuration error: ${error.message}`,
          'CONFIG_VALIDATION_ERROR'
        );
      }
      throw error;
    }
  }

  /**
   * Validate critical configuration values
   * @throws {AgentError} If configuration is invalid
   */
  private validateConfig(): void {
    // Check if API key is properly configured
    if (this._llm.apiKey === 'YOUR_API_KEY_HERE' || !this._llm.apiKey) {
      throw new AgentError(
        'API key not configured! Please set OPENROUTER_API_KEY in your environment or .env file',
        'MISSING_API_KEY'
      );
    }

    // Validate temperature range
    if (this._llm.temperature < 0 || this._llm.temperature > 2) {
      throw new AgentError(
        `Invalid temperature value: ${this._llm.temperature}. Must be between 0 and 2`,
        'INVALID_TEMPERATURE'
      );
    }

    // Validate top-p range
    if (this._llm.topP < 0 || this._llm.topP > 1) {
      throw new AgentError(
        `Invalid top-p value: ${this._llm.topP}. Must be between 0 and 1`,
        'INVALID_TOP_P'
      );
    }
  }

  /**
   * Get the LLM configuration
   */
  get llm(): LLMConfig {
    return this._llm;
  }

  /**
   * Get the security configuration
   */
  get security(): SecurityConfig {
    return this._security;
  }

  /**
   * Get the root directory
   */
  get rootDir(): string {
    return this._rootDir;
  }

  /**
   * Get the system prompt template
   */
  get systemPrompt(): string {
    return `/think

You are a helpful and very concise Bash assistant with the ability to execute commands in the shell.
You engage with users to help answer questions about bash commands, or execute their intent.
If user intent is unclear, keep engaging with them to figure out what they need and how to best help
them. If they ask question that are not relevant to bash or computer use, decline to answer.

When a command is executed, you will be given the output from that command and any errors. Based on
that, either take further actions or yield control to the user.

The bash interpreter's output and current working directory will be given to you every time a
command is executed. Take that into account for the next conversation.
If there was an error during execution, tell the user what that error was exactly.

You are only allowed to execute the following commands. Break complex tasks into shorter commands from this list:

\`\`\`
${this._security.allowedCommands.join(', ')}
\`\`\`

**Never** attempt to execute a command not in this list. **Never** attempt to execute dangerous commands
like \`rm\`, \`mv\`, \`rmdir\`, \`sudo\`, \`chmod\`, \`chown\`, etc. If the user asks you to do so, politely refuse.

**Special notes for Mac:**
- Use \`open -a "Application Name"\` to launch applications (e.g., \`open -a "Google Chrome"\`)
- Use \`open URL\` to open websites in the default browser (e.g., \`open https://google.com\`)
- Use \`open file.txt\` to open files with their default application

Be helpful but always stay within the allowed command list!`;
  }

  /**
   * Check if a command is in the allowlist
   * @param command - Command to check
   * @returns True if command is allowed
   */
  isCommandAllowed(command: string): boolean {
    // Get the base command (first word)
    const baseCommand = command.trim().split(/\s+/)[0];
    return this._security.allowedCommands.some(allowed => allowed === baseCommand);
  }

  /**
   * Check if a command contains blocked patterns
   * @param command - Command to check
   * @returns True if command contains blocked patterns
   */
  hasBlockedPatterns(command: string): boolean {
    return this._security.blockedPatterns.some(pattern => pattern.test(command));
  }

  /**
   * Validate a command for execution
   * @param command - Command to validate
   * @throws {CommandValidationError} If command is not allowed
   */
  validateCommand(command: string): void {
    if (!command.trim()) {
      throw new CommandValidationError('Command cannot be empty', command);
    }

    if (!this.isCommandAllowed(command)) {
      const baseCommand = command.trim().split(/\s+/)[0];
      throw new CommandValidationError(
        `Command '${baseCommand}' is not in the allowlist`,
        command
      );
    }

    if (this.hasBlockedPatterns(command)) {
      throw new CommandValidationError(
        'Command contains blocked patterns',
        command
      );
    }

    // Check for pipes and redirects if not allowed
    if (!this._security.allowPipesAndRedirects && /[|>]/.test(command)) {
      throw new CommandValidationError(
        'Pipes and redirects are not currently allowed for safety',
        command
      );
    }
  }

  /**
   * Get a tool schema for the exec_bash_command function
   */
  get bashToolSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: 'exec_bash_command',
        description: 'Execute a bash command and return stdout/stderr and the working directory',
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
}

/**
 * Create a singleton configuration instance
 */
let configInstance: Config | null = null;

/**
 * Get the global configuration instance
 * @returns The configuration instance
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = new Config();
  }
  return configInstance;
}