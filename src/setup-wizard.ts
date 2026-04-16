import inquirer from 'inquirer';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { PROVIDERS } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SetupWizard {
  static async runIfNeeded(): Promise<boolean> {
    const envPath = join(__dirname, '..', '.env');
    const hasExistingConfig =
      existsSync(envPath) ||
      process.env['OPENROUTER_API_KEY'] ||
      process.env['OPENAI_API_KEY'] ||
      process.env['ANTHROPIC_API_KEY'] ||
      process.env['LLM_BASE_URL'];

    if (hasExistingConfig) {
      return false;
    }

    const ollamaAvailable = await this._probeOllama();

    if (ollamaAvailable) {
      console.log(chalk.green('\nOllama detected! No API key needed — using local models.\n'));
      this._configureOllama();

      try {
        await writeFile(envPath, this._ollamaEnvContent(), 'utf-8');
      } catch {
        // Can't write .env (npx install), env vars set in memory
      }

      return true;
    }

    console.log(chalk.cyan.bold('\nWelcome to Computer Use Agent!\n'));
    console.log(chalk.gray('Get started instantly. No API key needed.\n'));

    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        type: 'list',
        name: 'choice',
        message: 'How would you like to connect?',
        choices: [
          {
            name: `${chalk.green('Instant (Free)')} — No API key, no signup, works immediately`,
            value: 'cua_free',
            short: 'Free',
          },
          {
            name: `${chalk.yellow('OpenRouter')} — Free models, bring your own key`,
            value: 'openrouter_free',
            short: 'OpenRouter',
          },
          {
            name: `${chalk.blue('API Key')} — Use OpenAI / Anthropic / other provider`,
            value: 'custom',
            short: 'Custom',
          },
          {
            name: `${chalk.gray('Ollama')} — Run locally (install from https://ollama.ai)`,
            value: 'ollama_local',
            short: 'Ollama',
          },
        ],
      },
    ]);

    if (choice === 'cua_free') {
      return this._setupCuaFree(envPath);
    }

    if (choice === 'openrouter_free') {
      return this._setupOpenRouterFree(envPath);
    }

    if (choice === 'ollama_local') {
      return this._setupOpenRouterFree(envPath);
    }

    if (choice === 'ollama_local') {
      this._configureOllama();
      try {
        await writeFile(envPath, this._ollamaEnvContent(), 'utf-8');
      } catch {
        // env vars set in memory
      }
      console.log(
        chalk.green('\nConfigured for Ollama. Make sure Ollama is running (`ollama serve`).\n'),
      );
      return true;
    }

    return this._setupCustomProvider(envPath);
  }

  private static async _setupCuaFree(envPath: string): Promise<boolean> {
    const proxyUrl = 'https://cua-proxy.your-domain.workers.dev/v1';

    const isReachable = await this._probeUrl(proxyUrl.replace('/v1', '/health'));
    if (!isReachable) {
      console.log(
        chalk.yellow(
          '\n  Free tier is currently unavailable. Falling back to OpenRouter (free key).\n',
        ),
      );
      return this._setupOpenRouterFree(envPath);
    }

    process.env['LLM_BASE_URL'] = proxyUrl;
    process.env['LLM_MODEL_NAME'] = 'meta-llama/llama-3.3-70b-instruct:free';
    process.env['OPENROUTER_API_KEY'] = 'cua-free-tier';
    process.env['LLM_PROVIDER'] = 'openai_compatible';

    const envContent = [
      '# Computer Use Agent - Configuration',
      '',
      '# Using CUA Free Tier (no API key needed)',
      `LLM_BASE_URL=${proxyUrl}`,
      'LLM_MODEL_NAME=meta-llama/llama-3.3-70b-instruct:free',
      'LLM_TEMPERATURE=0.1',
      'LLM_TOP_P=0.95',
    ].join('\n');

    try {
      await writeFile(envPath, envContent, 'utf-8');
    } catch {
      // env vars set in memory
    }

    console.log(chalk.green('\nReady! Using free Llama 3.3 70B — no API key needed.\n'));
    console.log(chalk.gray('  Rate limit: 30 requests/hour. For unlimited, bring your own key.\n'));
    return true;
  }

  private static async _probeUrl(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  private static async _setupOpenRouterFree(envPath: string): Promise<boolean> {
    console.log('');
    console.log(
      chalk.cyan('1. Open this URL in your browser: ') +
        chalk.underline.cyan('https://openrouter.ai/keys'),
    );
    console.log(chalk.cyan('2. Sign in with Google/GitHub (free, no credit card)'));
    console.log(chalk.cyan('3. Click "Create Key" and copy it\n'));

    const { key } = await inquirer.prompt<{ key: string }>([
      {
        type: 'password',
        name: 'key',
        message: 'Paste your OpenRouter API key:',
        mask: '*',
        validate: (input: string) => {
          const k = input.trim();
          if (!k) return 'API key is required — press Ctrl+C to cancel';
          if (!k.startsWith('sk-'))
            return 'Key should start with "sk-" — check you copied it right';
          return true;
        },
      },
    ]);

    const apiKey = key.trim();
    process.env['OPENROUTER_API_KEY'] = apiKey;
    process.env['LLM_BASE_URL'] = 'https://openrouter.ai/api/v1';
    process.env['LLM_MODEL_NAME'] = 'meta-llama/llama-3.3-70b-instruct:free';

    const envContent = [
      '# Computer Use Agent - Configuration',
      '',
      `OPENROUTER_API_KEY=${apiKey}`,
      'LLM_BASE_URL=https://openrouter.ai/api/v1',
      'LLM_MODEL_NAME=meta-llama/llama-3.3-70b-instruct:free',
      'LLM_TEMPERATURE=0.1',
      'LLM_TOP_P=0.95',
    ].join('\n');

    try {
      await writeFile(envPath, envContent, 'utf-8');
    } catch {
      // env vars set in memory
    }

    console.log(chalk.green('\nDone! Using free Llama 3.3 70B model via OpenRouter.\n'));
    return true;
  }

  private static async _setupCustomProvider(envPath: string): Promise<boolean> {
    const { providerIndex } = await inquirer.prompt<{ providerIndex: number }>([
      {
        type: 'list',
        name: 'providerIndex',
        message: 'Which provider?',
        choices: PROVIDERS.filter((p) => p.envKey !== 'OLLAMA').map((p, i) => ({
          name: `${chalk.bold(p.name)}`,
          value: i,
          short: p.name,
        })),
      },
    ]);

    const providers = PROVIDERS.filter((p) => p.envKey !== 'OLLAMA');
    const selectedProvider = providers[providerIndex];
    if (!selectedProvider) {
      console.log(chalk.red('No provider selected.'));
      return false;
    }

    const selectedModel = selectedProvider.models[0];

    console.log(
      chalk.gray(`\nGet your key from: ${chalk.underline(`${selectedProvider.name} settings`)}\n`),
    );

    const { key } = await inquirer.prompt<{ key: string }>([
      {
        type: 'password',
        name: 'key',
        message: `Enter your ${selectedProvider.name} API key:`,
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'API key is required';
          return true;
        },
      },
    ]);

    const apiKey = key.trim();
    process.env[selectedProvider.envKey] = apiKey;
    process.env['LLM_BASE_URL'] = selectedProvider.baseUrl;
    process.env['LLM_MODEL_NAME'] = selectedModel?.id ?? '';

    const envContent = [
      '# Computer Use Agent - Configuration',
      '',
      `${selectedProvider.envKey}=${apiKey}`,
      `LLM_BASE_URL=${selectedProvider.baseUrl}`,
      `LLM_MODEL_NAME=${selectedModel?.id ?? ''}`,
      'LLM_TEMPERATURE=0.1',
      'LLM_TOP_P=0.95',
    ].join('\n');

    try {
      await writeFile(envPath, envContent, 'utf-8');
    } catch {
      // env vars set in memory
    }

    console.log(
      chalk.green(
        `\nDone! Using ${selectedProvider.name} / ${selectedModel?.name ?? 'default model'}.\n`,
      ),
    );
    return true;
  }

  private static async _probeOllama(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch('http://localhost:11434/api/tags', {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) return false;

      const data = (await response.json()) as { models?: unknown[] };
      return Array.isArray(data.models) && data.models.length > 0;
    } catch {
      return false;
    }
  }

  private static _configureOllama(): void {
    process.env['LLM_BASE_URL'] = 'http://localhost:11434/v1';
    process.env['LLM_MODEL_NAME'] = 'llama3.3:70b';
    process.env['LLM_PROVIDER'] = 'ollama';
    process.env['OPENROUTER_API_KEY'] = 'ollama-no-key';
  }

  private static _ollamaEnvContent(): string {
    return [
      '# Computer Use Agent - Configuration',
      '',
      '# Using Ollama (local, no API key needed)',
      'LLM_BASE_URL=http://localhost:11434/v1',
      'LLM_MODEL_NAME=llama3.3:70b',
      'LLM_TEMPERATURE=0.1',
      'LLM_TOP_P=0.95',
    ].join('\n');
  }
}
