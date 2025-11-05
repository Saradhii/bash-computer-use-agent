import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import type {
  AppConfig,
  LLMConfig,
  SecurityConfig,
  EnvVars,
  ToolSchema,
  ModelConfig
} from './types.js';
import {
  AgentError,
  CommandValidationError,
  envSchema
} from './types.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const AVAILABLE_MODELS: readonly ModelConfig[] = Object.freeze([
  {
    name: 'Llama 3.3 70B Instruct',
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    description: 'Best overall - Strong function calling, 70B params (Meta)',
    license: 'Llama 3.3 License',
    recommended: true,
  },
  {
    name: 'NVIDIA Nemotron Nano 9B',
    id: 'nvidia/nemotron-nano-9b-v2:free',
    description: 'Lightweight alternative - 9B params, fast (NVIDIA)',
    license: 'NVIDIA Open Model',
    recommended: false,
  },
] as const);

const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  // File operations
  'cd', 'cp', 'ls', 'cat', 'find', 'touch', 'echo', 'grep', 'pwd', 'mkdir',
  'sort', 'head', 'tail', 'du', 'wc', 'which', 'whereis', 'file', 'less', 'more',
  'tee', 'nl', 'pr', 'expand', 'fmt', 'fold',

  // Directory navigation and viewing
  'dirs', 'pushd', 'popd', 'tree',

  // macOS-specific commands
  'open',  // Can open applications and files on macOS

  // Network utilities
  'curl', 'wget', 'ping', 'nslookup', 'dig', 'netstat',

  // Text processing and manipulation
  'sed', 'awk', 'tr', 'cut', 'uniq', 'xargs', 'paste', 'join',
  'jq',  // JSON processor (if installed)
  'yq',  // YAML processor (if installed)

  // System information
  'date', 'whoami', 'uname', 'df', 'ps', 'top', 'uptime', 'free', 'lsof',
  'env', 'printenv', 'id', 'groups', 'last', 'w',

  // Development tools
  'python', 'python3', 'pip', 'pip3', 'node', 'npm', 'yarn', 'pnpm',
  'npx', 'yarn dlx', 'pnpm dlx',

  // Version control
  'git', 'gh', 'svn', 'hg',
  'git log', 'git status', 'git diff', 'git show', 'git blame',

  // Archive and compression
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'bunzip2',

  // Process management (read-only)
  'ps', 'top', 'htop', 'pgrep', 'pidof',
  'pstree', 'jobs', 'fg', 'bg',

  // File permissions (viewing only)
  'ls -l', 'stat', 'getfacl', 'lsattr',

  // Search utilities
  'find', 'locate', 'which', 'whereis', 'grep -r', 'rg', 'ag',

  // System monitoring (read-only)
  'iostat', 'vmstat', 'sar', 'sysctl',

  // Safe redirection commands
  '>', '>>', '<', '2>', '2>>', '&>', '&>>',

  // Safe pipe operators
  '|', '&&', '||',

  // Temporary file creation
  'mktemp', 'tempfile', 'with-tempfile',
] as const);

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

    // Prevent only dangerous background execution (allow & after grep, xargs, etc)
    /&\s*$/,

    // Allow && and || as they are safe operators
    // /\s&&\s/,
    // /\s\|\|\s/,

    // Prevent only semicolons at end of command
    /;\s*$/,
  ]),
  allowPipesAndRedirects: true,
  commandTimeout: 30000, // 30 seconds
});

export class Config {
  private readonly _llm: LLMConfig;
  private readonly _security: SecurityConfig;
  private readonly _rootDir: string;

  constructor(modelName?: string) {
    // Validate environment variables
    const env = this.validateEnv();

    // Initialize LLM configuration
    this._llm = Object.freeze({
      baseUrl: env.LLM_BASE_URL,
      modelName: modelName || env.LLM_MODEL_NAME,
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

  private validateEnv(): EnvVars {
    // Check if .env file exists
    const envPath = join(__dirname, '..', '.env');
    if (!existsSync(envPath)) {
      throw new AgentError(
        `Missing .env file!\n\n` +
        `Setup steps:\n` +
        `1. Copy .env.example to .env: cp .env.example .env\n` +
        `2. Get your free API key from: https://openrouter.ai/keys\n` +
        `3. Edit .env and add your OPENROUTER_API_KEY\n` +
        `4. Run the application again`,
        'MISSING_ENV_FILE'
      );
    }

    try {
      return envSchema.parse(process.env);
    } catch (error) {
      // Parse Zod validation errors for better messages
      if (error && typeof error === 'object' && 'errors' in error) {
        const zodError = error as { errors: Array<{ message: string }> };
        const messages = zodError.errors.map(e => `  - ${e.message}`).join('\n');
        throw new AgentError(
          `Configuration validation failed:\n${messages}`,
          'CONFIG_VALIDATION_ERROR'
        );
      }

      if (error instanceof Error) {
        throw new AgentError(
          `Configuration error: ${error.message}`,
          'CONFIG_VALIDATION_ERROR'
        );
      }
      throw error;
    }
  }

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

  get llm(): LLMConfig {
    return this._llm;
  }

  get security(): SecurityConfig {
    return this._security;
  }

  get rootDir(): string {
    return this._rootDir;
  }

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

For complex tasks, break them down into steps:
1. Analyze what the user wants to accomplish
2. Plan the sequence of commands needed
3. Execute one command at a time
4. Use temporary files (mktemp) to store intermediate results if needed
5. Use pipes (|) and redirections (>, >>) to chain commands safely
6. Verify each step before proceeding

You are only allowed to execute the following commands. Break complex tasks into shorter commands from this list:

\`\`\`
${this._security.allowedCommands.join(', ')}
\`\`\`

**NEW CAPABILITIES:**
- You CAN now use pipes (|) to chain commands safely
- You CAN use redirections (>, >>) to save output to files
- You CAN use && and || for conditional execution
- You CAN use mktemp to create temporary files for intermediate results

**TIPS FOR COMPLEX TASKS:**
- For data processing: Use pipes to chain commands (e.g., "cat file.json | jq .key")
- For analysis: Save intermediate results to temp files (e.g., "mktemp")
- For searching: Use grep with patterns and pipes (e.g., "ls -la | grep '\\.js$'")
- For counting: Use wc with pipes (e.g., "find . -name '*.ts' | wc -l")
- For JSON processing: Use jq if available, or use grep/cut for simple extraction

**Never** attempt to execute a command not in this list. **Never** attempt to execute dangerous commands
like \`rm\`, \`mv\`, \`rmdir\`, \`sudo\`, \`chmod\`, \`chown\`, etc. If the user asks you to do so, politely refuse.

**Special notes for Mac:**
- Use \`open -a "Application Name"\` to launch applications (e.g., \`open -a "Google Chrome"\`)
- Use \`open URL\` to open websites in the default browser (e.g., \`open https://google.com\`)
- Use \`open file.txt\` to open files with their default application

Be helpful but always stay within the allowed command list!`;
  }

  isCommandAllowed(command: string): boolean {
    // Get the base command (first word)
    const baseCommand = command.trim().split(/\s+/)[0];
    return this._security.allowedCommands.some(allowed => allowed === baseCommand);
  }

  hasBlockedPatterns(command: string): boolean {
    return this._security.blockedPatterns.some(pattern => pattern.test(command));
  }

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

let configInstance: Config | null = null;

export function getConfig(modelName?: string): Config {
  if (!configInstance) {
    configInstance = new Config(modelName);
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}