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
  ModelConfig,
  TrustTier,
  TrustTierConfig,
} from './types.js';
import { AgentError, CommandValidationError, envSchema } from './types.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  models: readonly ModelConfig[];
  envKey: string;
}

export const PROVIDERS: readonly ProviderConfig[] = [
  {
    name: 'CUA Free (No key needed)',
    baseUrl: 'https://cua-proxy.your-domain.workers.dev/v1',
    envKey: 'CUA_PROXY',
    models: Object.freeze([
      {
        name: 'Llama 3.3 70B (Free)',
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        description: 'Free — no API key, no signup, just works',
        license: 'Llama 3.3 License',
        recommended: true,
      },
      {
        name: 'DeepSeek Chat (Free)',
        id: 'deepseek/deepseek-chat:free',
        description: 'Free — strong reasoning and code generation',
        license: 'DeepSeek License',
        recommended: false,
      },
    ]),
  },
  {
    name: 'OpenRouter (Free)',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    models: Object.freeze([
      {
        name: 'Llama 3.3 70B Instruct',
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        description: 'Best overall - Strong function calling, 70B params',
        license: 'Llama 3.3 License',
        recommended: true,
      },
      {
        name: 'NVIDIA Nemotron Nano 9B',
        id: 'nvidia/nemotron-nano-9b-v2:free',
        description: 'Lightweight - 9B params, fast responses',
        license: 'NVIDIA Open Model',
        recommended: false,
      },
      {
        name: 'DeepSeek Chat',
        id: 'deepseek/deepseek-chat:free',
        description: 'Good reasoning, strong code generation',
        license: 'DeepSeek License',
        recommended: false,
      },
    ]),
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    models: Object.freeze([
      {
        name: 'GPT-4o',
        id: 'gpt-4o',
        description: 'Best overall - Excellent function calling',
        license: 'OpenAI',
        recommended: true,
      },
      {
        name: 'GPT-4o Mini',
        id: 'gpt-4o-mini',
        description: 'Fast and cheap - Good for simple tasks',
        license: 'OpenAI',
        recommended: false,
      },
    ]),
  },
  {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    models: Object.freeze([
      {
        name: 'Claude Sonnet 4',
        id: 'claude-sonnet-4-20250514',
        description: 'Excellent reasoning and code generation',
        license: 'Anthropic',
        recommended: true,
      },
    ]),
  },
  {
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    envKey: 'OLLAMA',
    models: Object.freeze([
      {
        name: 'Llama 3.3 70B',
        id: 'llama3.3:70b',
        description: 'Local Llama 70B - No API key needed',
        license: 'Llama 3.3 License',
        recommended: true,
      },
      {
        name: 'CodeLlama 34B',
        id: 'codellama:34b',
        description: 'Code-specialized model',
        license: 'Llama License',
        recommended: false,
      },
      {
        name: 'Mistral 7B',
        id: 'mistral:7b',
        description: 'Fast local model - Low resource usage',
        license: 'Apache 2.0',
        recommended: false,
      },
    ]),
  },
];

export const AVAILABLE_MODELS: readonly ModelConfig[] = PROVIDERS[0]!.models;

const READ_ONLY_COMMANDS = Object.freeze([
  'ls',
  'cat',
  'find',
  'grep',
  'pwd',
  'which',
  'whereis',
  'file',
  'less',
  'more',
  'head',
  'tail',
  'wc',
  'du',
  'sort',
  'uniq',
  'cut',
  'tr',
  'paste',
  'join',
  'nl',
  'pr',
  'expand',
  'fmt',
  'fold',
  'tee',
  'dirs',
  'pushd',
  'popd',
  'tree',
  'curl',
  'wget',
  'ping',
  'nslookup',
  'dig',
  'netstat',
  'jq',
  'yq',
  'date',
  'whoami',
  'uname',
  'df',
  'ps',
  'top',
  'uptime',
  'free',
  'lsof',
  'env',
  'printenv',
  'id',
  'groups',
  'last',
  'w',
  'git',
  'gh',
  'svn',
  'hg',
  'iostat',
  'vmstat',
  'sar',
  'sysctl',
  'rg',
  'ag',
  'stat',
  'getfacl',
  'lsattr',
  'pgrep',
  'pidof',
  'pstree',
  'open',
] as const);

const STANDARD_COMMANDS = Object.freeze([
  ...READ_ONLY_COMMANDS,
  'cd',
  'cp',
  'touch',
  'echo',
  'mkdir',
  'sed',
  'awk',
  'xargs',
  'tar',
  'zip',
  'unzip',
  'gzip',
  'gunzip',
  'bzip2',
  'bunzip2',
  'node',
  'npm',
  'yarn',
  'pnpm',
  'npx',
  'python',
  'python3',
  'pip',
  'pip3',
  'mktemp',
] as const);

const TRUSTED_COMMANDS = Object.freeze([
  ...STANDARD_COMMANDS,
  'rm',
  'mv',
  'rmdir',
  'chmod',
  'chown',
  'chgrp',
  'pip install',
  'npm install',
  'yarn add',
  'pnpm add',
  'git add',
  'git commit',
  'git push',
  'git pull',
  'git merge',
  'git rebase',
  'git stash',
  'docker',
  'kubectl',
] as const);

const ALWAYS_BLOCKED_PATTERNS = Object.freeze([
  /\bsudo\b/,
  /\bsu\b/,
  /\bdoas\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bdd\b/,
  /\bshred\b/,
  /\bwipe\b/,
  /\bsystemctl\b/,
  /\bservice\b/,
  /\binit\b/,
  /\buseradd\b/,
  /\buserdel\b/,
  /\bpasswd\b/,
  /\bcrontab\b/,
  /\biptables\b/,
  /\bufw\b/,
  /\bfirewall-cmd\b/,
  />\/(etc|boot|usr|bin|sbin|lib|lib64)\//,
  />>\/(etc|boot|usr|bin|sbin|lib|lib64)\//,
  />\s*\/(dev|proc|sys)/,
  />>\s*\/(dev|proc|sys)/,
] as const);

const DESTRUCTIVE_PATTERNS = Object.freeze([
  /\brm\b/,
  /\brmdir\b/,
  /\bmv\b/,
  /\bchmod\b/,
  /\bchown\b/,
] as const);

function isReadOnlyCommand(command: string): boolean {
  const base = command.trim().split(/\s+/)[0] ?? '';
  return READ_ONLY_COMMANDS.includes(base as (typeof READ_ONLY_COMMANDS)[number]);
}

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}

const TRUST_TIERS: Record<TrustTier, TrustTierConfig> = {
  sandbox: {
    name: 'Sandbox',
    description: 'Read-only exploration — no file modifications',
    allowedCommands: READ_ONLY_COMMANDS,
    blockedPatterns: ALWAYS_BLOCKED_PATTERNS,
    allowPipesAndRedirects: true,
    requiresConfirmation: () => false,
  },
  standard: {
    name: 'Standard',
    description: 'Daily development — create files, run tools, no destructive ops',
    allowedCommands: STANDARD_COMMANDS,
    blockedPatterns: ALWAYS_BLOCKED_PATTERNS,
    allowPipesAndRedirects: true,
    requiresConfirmation: (cmd) => !isReadOnlyCommand(cmd),
  },
  trusted: {
    name: 'Trusted',
    description: 'Full development — rm, mv, package install allowed',
    allowedCommands: TRUSTED_COMMANDS,
    blockedPatterns: ALWAYS_BLOCKED_PATTERNS,
    allowPipesAndRedirects: true,
    requiresConfirmation: (cmd) => isDestructiveCommand(cmd),
  },
  unrestricted: {
    name: 'Unrestricted',
    description: 'Almost everything — only system-critical commands blocked',
    allowedCommands: TRUSTED_COMMANDS,
    blockedPatterns: ALWAYS_BLOCKED_PATTERNS,
    allowPipesAndRedirects: true,
    requiresConfirmation: (cmd) => isDestructiveCommand(cmd),
  },
};

export { TRUST_TIERS, isReadOnlyCommand, isDestructiveCommand };

export class Config {
  private readonly _llm: LLMConfig;
  private readonly _security: SecurityConfig;
  private readonly _rootDir: string;
  private _trustTier: TrustTier;

  constructor(modelName?: string, trustTier?: TrustTier) {
    const env = this.validateEnv();

    this._llm = Object.freeze({
      baseUrl: env.LLM_BASE_URL,
      modelName: modelName || env.LLM_MODEL_NAME,
      apiKey: env.OPENROUTER_API_KEY,
      temperature: env.LLM_TEMPERATURE,
      topP: env.LLM_TOP_P,
      maxTokens: undefined,
      provider: env.LLM_PROVIDER,
    });

    this._security = {
      allowedCommands: STANDARD_COMMANDS,
      blockedPatterns: ALWAYS_BLOCKED_PATTERNS,
      allowPipesAndRedirects: true,
      commandTimeout: 30000,
    };

    this._trustTier = trustTier ?? 'standard';
    this._rootDir = join(__dirname, '..');

    this._applyTrustTier();
    this.validateConfig();
  }

  private _applyTrustTier(): void {
    const tier = TRUST_TIERS[this._trustTier];
    (this._security as { allowedCommands: readonly string[] }).allowedCommands =
      tier.allowedCommands;
    (this._security as { blockedPatterns: readonly RegExp[] }).blockedPatterns =
      tier.blockedPatterns;
    (this._security as { allowPipesAndRedirects: boolean }).allowPipesAndRedirects =
      tier.allowPipesAndRedirects;
  }

  get trustTier(): TrustTier {
    return this._trustTier;
  }

  setTrustTier(tier: TrustTier): void {
    this._trustTier = tier;
    this._applyTrustTier();
  }

  getTrustTierConfig(): TrustTierConfig {
    return TRUST_TIERS[this._trustTier];
  }

  requiresConfirmation(command: string): boolean {
    return TRUST_TIERS[this._trustTier].requiresConfirmation(command);
  }

  private validateEnv(): EnvVars {
    const envPath = join(__dirname, '..', '.env');
    if (existsSync(envPath)) {
      config({ path: envPath });
    } else if (
      !process.env['LLM_BASE_URL'] &&
      !process.env['OPENROUTER_API_KEY'] &&
      !process.env['OPENAI_API_KEY'] &&
      !process.env['ANTHROPIC_API_KEY'] &&
      !process.env['CUA_PROXY']
    ) {
      throw new AgentError(
        `No configuration found!\n\n` +
          `Setup options:\n` +
          `1. Run 'cua' for interactive setup (recommended)\n` +
          `2. Copy .env.example to .env: cp .env.example .env\n` +
          `3. Set environment variables directly:\n` +
          `   - OPENROUTER_API_KEY (free) from https://openrouter.ai/keys\n` +
          `   - OPENAI_API_KEY from https://platform.openai.com/api-keys\n` +
          `   - ANTHROPIC_API_KEY from https://console.anthropic.com/\n` +
          `   - Or install Ollama locally: https://ollama.ai\n` +
          `4. Use with --yes and --api-key flags for CI/CD`,
        'MISSING_ENV_FILE',
      );
    }

    try {
      return envSchema.parse(process.env);
    } catch (error) {
      if (error && typeof error === 'object' && 'errors' in error) {
        const zodError = error as { errors: Array<{ message: string }> };
        const messages = zodError.errors.map((e) => `  - ${e.message}`).join('\n');
        throw new AgentError(
          `Configuration validation failed:\n${messages}`,
          'CONFIG_VALIDATION_ERROR',
        );
      }

      if (error instanceof Error) {
        throw new AgentError(`Configuration error: ${error.message}`, 'CONFIG_VALIDATION_ERROR');
      }
      throw error;
    }
  }

  private validateConfig(): void {
    const isOllama =
      this._llm.baseUrl.includes('localhost:11434') ||
      this._llm.baseUrl.includes('127.0.0.1:11434') ||
      this._llm.provider === 'ollama' ||
      this._llm.apiKey === 'ollama-no-key' ||
      this._llm.apiKey === 'cua-free-tier';

    if (!isOllama && (!this._llm.apiKey || this._llm.apiKey === 'YOUR_API_KEY_HERE')) {
      throw new AgentError(
        'No API key configured!\n\n' +
          'Set one of these in your .env file:\n' +
          '  - OPENROUTER_API_KEY (free models) — https://openrouter.ai/keys\n' +
          '  - OPENAI_API_KEY — https://platform.openai.com/api-keys\n' +
          '  - ANTHROPIC_API_KEY — https://console.anthropic.com/\n' +
          '  - Or use Ollama locally (no key needed) — https://ollama.ai',
        'MISSING_API_KEY',
      );
    }

    if (this._llm.temperature < 0 || this._llm.temperature > 2) {
      throw new AgentError(
        `Invalid temperature value: ${this._llm.temperature}. Must be between 0 and 2`,
        'INVALID_TEMPERATURE',
      );
    }

    if (this._llm.topP < 0 || this._llm.topP > 1) {
      throw new AgentError(
        `Invalid top-p value: ${this._llm.topP}. Must be between 0 and 1`,
        'INVALID_TOP_P',
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
    const tier = TRUST_TIERS[this._trustTier];
    const commandList = tier.allowedCommands.join(', ');

    const tierInstructions =
      this._trustTier === 'sandbox'
        ? `You are in SANDBOX mode. You can ONLY read and explore. No file creation, no modifications.`
        : this._trustTier === 'standard'
          ? `You are in STANDARD mode. You can create files and run tools, but cannot delete or move files.`
          : this._trustTier === 'trusted'
            ? `You are in TRUSTED mode. You have full development capabilities including rm, mv, and package installation.`
            : `You are in UNRESTRICTED mode. Almost all commands are available. Only system-critical operations are blocked.`;

    return `/think
You are a helpful and very concise Bash assistant with the ability to execute commands in the shell.
You engage with users to help answer questions about bash commands, or execute their intent.
If user intent is unclear, keep engaging with them to figure out what they need and how to best help them.

${tierInstructions}

When a command is executed, you will be given the output from that command and any errors. Based on
that, either take further actions or yield control to the user.

For complex tasks, break them down into steps:
1. Analyze what the user wants to accomplish
2. Plan the sequence of commands needed
3. Execute one command at a time
4. Use temporary files (mktemp) to store intermediate results if needed
5. Use pipes (|) and redirections (>, >>) to chain commands safely
6. Verify each step before proceeding

You are allowed to execute the following commands:
\`\`\`
${commandList}
\`\`\`

**CAPABILITIES:**
- You CAN use pipes (|) to chain commands
- You CAN use redirections (>, >>) to save output
- You CAN use && and || for conditional execution
- You CAN use mktemp for intermediate results

**Never** attempt to execute a command not in this list.
**Never** attempt to execute: \`sudo\`, \`shutdown\`, \`reboot\`, \`mkfs\`, \`dd\`, \`systemctl\`.

**Special notes for Mac:**
- Use \`open -a "Application Name"\` to launch applications
- Use \`open URL\` to open websites in the default browser

Be helpful but always stay within the allowed command list!`;
  }

  isCommandAllowed(command: string): boolean {
    const baseCommand = command.trim().split(/\s+/)[0];
    return this._security.allowedCommands.some((allowed) => allowed === baseCommand);
  }

  hasBlockedPatterns(command: string): boolean {
    return this._security.blockedPatterns.some((pattern) => pattern.test(command));
  }

  validateCommand(command: string): void {
    if (!command.trim()) {
      throw new CommandValidationError('Command cannot be empty', command);
    }

    if (!this.isCommandAllowed(command)) {
      const baseCommand = command.trim().split(/\s+/)[0];
      throw new CommandValidationError(
        `Command '${baseCommand}' is not allowed in ${TRUST_TIERS[this._trustTier].name} mode. Use 'trust' command to elevate permissions.`,
        command,
      );
    }

    if (this.hasBlockedPatterns(command)) {
      throw new CommandValidationError('Command contains blocked patterns', command);
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

export function getConfig(modelName?: string, trustTier?: TrustTier): Config {
  if (!configInstance) {
    configInstance = new Config(modelName, trustTier);
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
