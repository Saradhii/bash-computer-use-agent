#!/usr/bin/env node
import inquirer from 'inquirer';
import commandPrompt from 'inquirer-command-prompt';
import { program } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import { homedir } from 'node:os';
import { mkdirSync, existsSync as existsSyncFs } from 'node:fs';
import { join as joinPath } from 'node:path';
import {
  Config,
  getConfig,
  AVAILABLE_MODELS,
  TRUST_TIERS,
  PROVIDERS,
  type ProviderConfig,
} from './config.js';
import { Bash } from './bash.js';
import { MessageManager } from './messages.js';
import { LLMClient, type LLMResponse } from './llm.js';
import { ToolRegistry } from './tools/registry.js';
import { detectProject, contextToSystemAppendix, type ProjectContext } from './project-context.js';
import { UndoManager } from './undo-manager.js';
import { SessionManager, type SessionData } from './session-manager.js';
import { getHelpText } from './help.js';
import { SetupWizard } from './setup-wizard.js';
import { ModelRouter } from './model-router.js';
import { ContextSummarizer } from './context-summarizer.js';
import { MarkdownRenderer } from './markdown-renderer.js';
import type {
  CLIOptions,
  ToolCall,
  TrustTier,
  ToolResult,
  AssistantMessage,
  ToolMessage,
} from './types.js';
import { AgentError, LLMError } from './types.js';

const MAX_AGENTIC_STEPS = 25;
const SMART_CONFIRM_THRESHOLD = 3;
const AUTO_SAVE_MESSAGE_INTERVAL = 5;

const TRUST_TIER_CHOICES: { name: string; value: TrustTier }[] = [
  { name: `Sandbox       — Read-only exploration`, value: 'sandbox' },
  { name: `Standard      — Create files, run tools (Default)`, value: 'standard' },
  { name: `Trusted       — Full dev: rm, mv, install`, value: 'trusted' },
  { name: `Unrestricted  — Everything except system-critical`, value: 'unrestricted' },
];

class CLIApplication {
  private readonly _config: Config;
  private readonly _tools: ToolRegistry;
  private readonly _llm: LLMClient;
  private readonly _messages: MessageManager;
  private readonly _options: CLIOptions;
  private readonly _undo: UndoManager;
  private readonly _sessionManager: SessionManager;
  private readonly _contextSummarizer: ContextSummarizer;
  private _sessionId: string = '';
  private _isRunning: boolean = true;
  private _projectContext: ProjectContext | null = null;
  private _successfulConfirms: number = 0;
  private _smartConfirmEnabled: boolean = false;
  private _exchangeCount: number = 0;

  constructor(
    options: CLIOptions = {},
    modelName?: string,
    trustTier?: TrustTier,
    providerBaseUrl?: string,
    providerApiKey?: string,
  ) {
    this._options = options;

    try {
      this._config = getConfig(modelName, trustTier);
      const bash = new Bash(this._config);
      this._tools = new ToolRegistry(bash, this._config);
      this._llm = new LLMClient(this._config);
      this._messages = new MessageManager(this._config.systemPrompt, 200);
      this._undo = new UndoManager(process.cwd());
      this._sessionManager = new SessionManager();
      this._contextSummarizer = new ContextSummarizer(this._llm);
      this._sessionId = this._sessionManager.generateId();

      inquirer.registerPrompt('command', commandPrompt);

      if (this._options.verbose) {
        process.env['NODE_ENV'] = 'development';
      }
    } catch (error) {
      if (error instanceof AgentError) {
        this._printError(error.message);
        process.exit(1);
      }
      throw error;
    }
  }

  static async selectProvider(): Promise<{ provider: ProviderConfig; modelId: string }> {
    console.log(chalk.cyan.bold('\nSelect LLM provider:\n'));

    const providerChoices = PROVIDERS.map((p) => {
      const hasKey = p.envKey === 'OLLAMA' || process.env[p.envKey];
      const status = hasKey ? chalk.green('(key found)') : chalk.gray('(set ' + p.envKey + ')');
      return {
        name: `${chalk.bold(p.name)} ${status}`,
        value: p,
        short: p.name,
      };
    });

    const { provider } = await inquirer.prompt<{ provider: ProviderConfig }>([
      {
        type: 'list',
        name: 'provider',
        message: chalk.cyan('Provider:'),
        choices: providerChoices,
      },
    ]);

    console.log('');

    if (provider.models.length === 1) {
      const model = provider.models[0]!;
      console.log(chalk.gray(`  Using ${model.name}`));
      return { provider, modelId: model.id };
    }

    const modelChoices = provider.models.map((model) => ({
      name: model.recommended
        ? `${chalk.green('*')} ${chalk.bold(model.name)} ${chalk.yellow('(Recommended)')}\n  ${chalk.gray(model.description)}`
        : `  ${chalk.bold(model.name)}\n  ${chalk.gray(model.description)}`,
      value: model.id,
      short: model.name,
    }));

    const { modelId } = await inquirer.prompt<{ modelId: string }>([
      {
        type: 'list',
        name: 'modelId',
        message: chalk.cyan('Model:'),
        choices: modelChoices,
        default: provider.models.find((m) => m.recommended)?.id,
      },
    ]);

    console.log('');
    return { provider, modelId };
  }

  static async selectTrustTier(): Promise<TrustTier> {
    console.log(chalk.cyan.bold('Select trust level:\n'));

    const { tier } = await inquirer.prompt([
      {
        type: 'list',
        name: 'tier',
        message: chalk.cyan('Trust level:'),
        choices: TRUST_TIER_CHOICES,
        default: 'standard' as TrustTier,
      },
    ]);

    console.log('');
    return tier;
  }

  async start(): Promise<void> {
    this._projectContext = await detectProject(process.cwd());
    await this._undo.init();

    const lastSession = await this._tryResumeSession();

    this._printWelcome();

    if (lastSession) {
      console.log(
        chalk.gray(
          `Resumed previous session (${this._messages.getStats().totalMessages} messages loaded)\n`,
        ),
      );
    }

    if (this._projectContext) {
      console.log(chalk.gray(this._projectContext.summary));
      console.log();
    }

    if (this._options.verbose) {
      await this._testLLMConnection();
    }

    if (this._options.prompt) {
      console.log(chalk.cyan(`\n> ${this._options.prompt}\n`));
      const inputWithContext = `${this._options.prompt}\n\nCurrent working directory: \`${this._cwd}\``;
      this._messages.addUserMessage(inputWithContext);
      await this._processRequestAgentic();
      await this._autoSaveSession();
      return;
    }

    while (this._isRunning) {
      try {
        await this._handleUserInput();
      } catch (error) {
        this._handleError(error);
      }
    }

    await this._autoSaveSession();
    this._printGoodbye();
  }

  private async _tryResumeSession(): Promise<boolean> {
    if (this._options.yes) return false;

    const sessions = await this._sessionManager.list();
    if (sessions.length === 0) return false;

    const lastSession = sessions[0];
    if (!lastSession) return false;

    const age = Date.now() - new Date(lastSession.updatedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) return false;

    const data = await this._sessionManager.load(lastSession.id);
    if (!data || !data.messages) return false;

    const { messages } = data.messages;
    if (!Array.isArray(messages) || messages.length === 0) return false;

    const userMsgCount = messages.filter(
      (m: unknown) => (m as Record<string, unknown>)['role'] === 'user',
    ).length;
    if (userMsgCount < 2) return false;

    console.log(
      chalk.gray(
        `\nFound recent session: "${lastSession.name}" (${userMsgCount} exchanges, ${new Date(lastSession.updatedAt).toLocaleString()})`,
      ),
    );

    const { resume } = await inquirer.prompt<{ resume: boolean }>([
      {
        type: 'confirm',
        name: 'resume',
        message: 'Resume this session?',
        default: true,
      },
    ]);

    if (resume) {
      this._sessionId = lastSession.id;
      this._messages.importConversation(JSON.stringify(data.messages));
      return true;
    }

    return false;
  }

  private async _autoSaveSession(): Promise<void> {
    try {
      const stats = this._messages.getStats();
      if (stats.totalMessages === 0) return;

      const sessionName = `Auto-save ${new Date().toLocaleString()}`;
      const data: SessionData = {
        meta: {
          id: this._sessionId,
          name: sessionName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: stats.totalMessages,
          model: this._config.llm.modelName,
          trustTier: this._config.trustTier,
        },
        messages: this._messages.exportConversation(),
      };

      await this._sessionManager.save(this._sessionId, sessionName, data);
    } catch {
      // silent fail for auto-save
    }
  }

  private _printWelcome(): void {
    const tier = this._config.getTrustTierConfig();
    const title = gradient.pastel.multiline('  COMPUTER USE AGENT  ');

    console.log(
      boxen(title, {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: 'round',
        borderColor: 'cyan',
        align: 'center',
      }),
    );

    const tierColor =
      this._config.trustTier === 'sandbox'
        ? 'gray'
        : this._config.trustTier === 'standard'
          ? 'green'
          : this._config.trustTier === 'trusted'
            ? 'yellow'
            : 'red';

    console.log(chalk[tierColor](`Trust: ${chalk.bold(tier.name)} — ${tier.description}`));
    console.log(chalk.gray(`Tools: ${this._tools.toolNames.join(', ')}`));
    console.log(
      chalk.gray(
        `Type 'quit' to exit | 'clear' to clear | 'cwd' for directory | 'trust' to change level`,
      ),
    );
    if (this._undo.isInitialized) {
      console.log(
        chalk.gray(`'undo' to revert changes | 'diff' to see changes | 'snapshots' to list`),
      );
    }
    console.log();
    if (this._messages.isEmpty()) {
      console.log(chalk.gray('Try: "list files in this directory" or "what is this project?"'));
      console.log();
    }
  }

  private async _testLLMConnection(): Promise<void> {
    console.log('Testing LLM connection...');
    try {
      const isConnected = await this._llm.testConnection();
      console.log(isConnected ? 'LLM connection successful' : 'LLM connection failed');
    } catch (error) {
      console.log('LLM connection test failed');
      console.error(`[ERROR] ${error}`);
    }
  }

  private _formatPath(cwd: string): string {
    const home = homedir();
    if (cwd.startsWith(home)) {
      return chalk.cyan(`~${cwd.slice(home.length)}`);
    }
    return chalk.cyan(cwd);
  }

  private get _cwd(): string {
    return this._tools.bash.cwd;
  }

  private async _handleUserInput(): Promise<void> {
    const formattedPath = this._formatPath(this._cwd);
    const tierLabel = chalk.gray(`[${this._config.getTrustTierConfig().name}]`);

    const historyDir = joinPath(homedir(), '.cua');
    if (!existsSyncFs(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }

    const { input } = await inquirer.prompt([
      {
        type: 'command',
        name: 'input',
        message: `${chalk.cyanBright('>')} ${formattedPath} ${tierLabel} ${chalk.gray('|')} `,
        context: 0,
        historyPath: joinPath(historyDir, 'history'),
        validate: (input: string) => {
          if (!input.trim()) return 'Please enter a command or question';
          return true;
        },
      },
    ]);

    const userInput = input.trim();

    if (await this._handleSpecialCommands(userInput)) return;

    const inputWithContext = `${userInput}\n\nCurrent working directory: \`${this._cwd}\``;
    this._messages.addUserMessage(inputWithContext);

    if (this._contextSummarizer.shouldSummarize(this._messages.getStats().totalMessages, 200)) {
      await this._summarizeAndTrim();
    }

    await this._processRequestAgentic();

    this._exchangeCount++;
    if (this._exchangeCount % AUTO_SAVE_MESSAGE_INTERVAL === 0) {
      await this._autoSaveSession();
    }
  }

  private async _summarizeAndTrim(): Promise<void> {
    const messages = this._messages.getMessages();
    if (messages.length < 20) return;

    const oldMessages = messages.slice(1, Math.floor(messages.length / 2));
    const summary = await this._contextSummarizer.summarize(oldMessages);

    const currentMessages = this._messages.getMessages();
    const keepCount = Math.floor(currentMessages.length / 2);
    const recentMessages = currentMessages.slice(-keepCount);

    this._messages.clearMessages();

    this._messages.addUserMessage(
      `[System: Previous context summarized]\n${summary}\n\nContinuing from above...`,
    );

    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        this._messages.addUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessage;
        this._messages.addAssistantMessage(assistantMsg.content, assistantMsg.tool_calls);
      } else if (msg.role === 'tool') {
        const toolMsg = msg as ToolMessage;
        this._messages.addToolMessage(toolMsg.content, toolMsg.tool_call_id);
      }
    }

    console.log(
      chalk.yellow('\n  [Context summarized — older conversation condensed to preserve memory]'),
    );
  }

  private async _handleSpecialCommands(input: string): Promise<boolean> {
    switch (input) {
      case 'quit':
      case 'exit':
      case 'q':
        this._isRunning = false;
        return true;

      case 'clear':
        console.clear();
        this._printWelcome();
        return true;

      case 'cwd':
        console.log(chalk.cyan(`\nCurrent directory: ${chalk.bold(this._cwd)}\n`));
        return true;

      case 'trust':
        this._changeTrustTier();
        return true;

      case 'undo':
        this._handleUndo();
        return true;

      case 'diff':
        this._handleDiff();
        return true;

      case 'snapshots':
        this._handleSnapshots();
        return true;

      case 'help':
        console.log(getHelpText());
        return true;

      case 'save':
        await this._handleSave(input.replace(/^save\s*/i, '').trim());
        return true;

      case 'sessions':
        await this._handleSessions();
        return true;

      default:
        return false;
    }
  }

  private async _changeTrustTier(): Promise<void> {
    console.log(chalk.cyan.bold('\nChange trust level:\n'));

    const { tier } = await inquirer.prompt([
      {
        type: 'list',
        name: 'tier',
        message: 'Select trust level:',
        choices: TRUST_TIER_CHOICES,
        default: this._config.trustTier,
      },
    ]);

    this._config.setTrustTier(tier as TrustTier);
    this._messages.setSystemMessage(this._config.systemPrompt);
    this._successfulConfirms = 0;
    this._smartConfirmEnabled = false;
    const tierConfig = this._config.getTrustTierConfig();
    console.log(
      chalk.green(
        `\nTrust level set to: ${chalk.bold(tierConfig.name)} — ${tierConfig.description}\n`,
      ),
    );
  }

  private async _handleUndo(): Promise<void> {
    if (!this._undo.isInitialized) {
      console.log(chalk.yellow('\nGit not available — undo requires a git repository'));
      return;
    }

    const snapshotCount = this._undo.getSnapshotCount();
    if (snapshotCount === 0) {
      console.log(chalk.yellow('\nNo snapshots to undo'));
      return;
    }

    const lastSnapshot = this._undo.getLastSnapshot();
    console.log(chalk.yellow(`\nRevert last snapshot: "${lastSnapshot?.message}"? [y/N]:`));
    const { confirm } = await inquirer.prompt<{ confirm: string }>([
      {
        type: 'input',
        name: 'confirm',
        message: '',
      },
    ]);

    if (confirm.trim().toLowerCase() === 'y') {
      const success = await this._undo.undo(1);
      if (success) {
        console.log(chalk.green('\nReverted to previous state'));
      } else {
        console.log(chalk.red('\nFailed to revert'));
      }
    }
  }

  private async _handleDiff(): Promise<void> {
    if (!this._undo.isInitialized) {
      console.log(chalk.yellow('\nGit not available'));
      return;
    }

    const diffOutput = await this._undo.diff();
    console.log(chalk.white(`\n${diffOutput}\n`));
  }

  private async _handleSnapshots(): Promise<void> {
    if (!this._undo.isInitialized) {
      console.log(chalk.yellow('\nGit not available'));
      return;
    }

    const snapshots = this._undo.snapshots;
    if (snapshots.length === 0) {
      console.log(chalk.yellow('\nNo snapshots taken this session'));
      return;
    }

    console.log(chalk.cyan.bold('\nSession snapshots:\n'));
    for (const snapshot of snapshots) {
      const time = new Date(snapshot.timestamp).toLocaleTimeString();
      console.log(chalk.white(`  ${time} — ${snapshot.message} (${snapshot.filesChanged} files)`));
    }
    console.log();
  }

  private async _handleSave(name: string): Promise<void> {
    const sessionName = name || `Session ${new Date().toLocaleDateString()}`;
    const data: SessionData = {
      meta: {
        id: this._sessionId,
        name: sessionName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: this._messages.getStats().totalMessages,
        model: this._config.llm.modelName,
        trustTier: this._config.trustTier,
      },
      messages: this._messages.exportConversation(),
    };

    await this._sessionManager.save(this._sessionId, sessionName, data);
    console.log(chalk.green(`\nSession saved: ${chalk.bold(sessionName)}\n`));
  }

  private async _handleSessions(): Promise<void> {
    const sessions = await this._sessionManager.list();
    if (sessions.length === 0) {
      console.log(chalk.yellow('\nNo saved sessions'));
      return;
    }

    console.log(chalk.cyan.bold('\nSaved sessions:\n'));
    for (const session of sessions.slice(0, 10)) {
      const time = new Date(session.updatedAt).toLocaleString();
      console.log(chalk.white(`  ${chalk.bold(session.name)}`));
      console.log(
        chalk.gray(
          `    ID: ${session.id} | Model: ${session.model} | Messages: ${session.messageCount}`,
        ),
      );
      console.log(chalk.gray(`    Updated: ${time}`));
    }
    console.log();
  }

  private async _processRequestAgentic(): Promise<void> {
    for (let step = 1; step <= MAX_AGENTIC_STEPS; step++) {
      process.stdout.write(chalk.gray(`\nStep ${step}/${MAX_AGENTIC_STEPS} `));
      process.stdout.write(chalk.cyan('Thinking... '));

      let isFirstToken = true;

      try {
        const response: LLMResponse = await this._llm.queryStream(
          this._messages,
          this._tools.getAllSchemas(),
          {
            onToken: (token) => {
              if (isFirstToken) {
                process.stdout.write('\n');
                isFirstToken = false;
              }
              process.stdout.write(token);
            },
            onToolCallDetected: (name) => {
              if (isFirstToken) {
                process.stdout.write('\n');
                isFirstToken = false;
              }
              process.stdout.write(chalk.gray(`\n  [tool: ${name}]`));
            },
          },
        );

        if (!isFirstToken) {
          process.stdout.write('\n');
        } else {
          process.stdout.write(chalk.green('done\n'));
        }

        if (response.usage) {
          console.log(
            chalk.gray(
              `  Tokens: ${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion = ${response.usage.totalTokens} total`,
            ),
          );
        }

        if (response.message) {
          const content = this._filterThinkDirective(response.message);
          if (content) {
            if (isFirstToken) {
              console.log('\n' + MarkdownRenderer.render(content));
            }
            this._messages.addAssistantMessage(content);
          }
        }

        if (response.toolCalls.length > 0) {
          const shouldContinue = await this._handleToolCalls(response.toolCalls);
          if (!shouldContinue) break;

          this._tools.updateCwd(this._cwd);
          continue;
        }

        break;
      } catch (error) {
        if (!isFirstToken) process.stdout.write('\n');

        if (error instanceof AgentError) {
          const llmErr = error instanceof LLMError ? error : null;
          const isTransient =
            llmErr !== null &&
            llmErr.statusCode !== undefined &&
            (llmErr.statusCode >= 500 || llmErr.statusCode === 429 || llmErr.statusCode === 408);

          if (isTransient && llmErr) {
            console.log(
              chalk.yellow(`  Transient error (${llmErr.statusCode}), retrying step ${step}...`),
            );
            await new Promise((r) => setTimeout(r, 2000));
            step--;
            continue;
          }
        }

        throw error;
      }
    }
  }

  private async _handleToolCalls(toolCalls: ToolCall[]): Promise<boolean> {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let args: Record<string, unknown>;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        this._messages.addToolMessage(
          `Invalid arguments: ${toolCall.function.arguments}`,
          toolCall.id,
        );
        continue;
      }

      const needsConfirm = this._tools.requiresConfirmation(toolName, args);

      if (toolName === 'write_file' && this._config.trustTier === 'sandbox') {
        console.log(chalk.red('\nFile writing is not allowed in Sandbox mode.'));
        this._messages.addToolMessage(
          'Error: File writing not allowed in sandbox mode',
          toolCall.id,
        );
        return false;
      }

      if (this._options.dryRun) {
        const dryArgs =
          toolName === 'exec_bash_command' ? (args['cmd'] as string) : JSON.stringify(args);
        console.log(chalk.yellow(`\n  [dry-run] ${chalk.cyan(toolName)}: ${dryArgs}`));
        this._messages.addToolMessage('Dry run: command not executed', toolCall.id);
        continue;
      }

      if (toolName === 'exec_bash_command') {
        const command = args['cmd'] as string;
        if (!command) {
          this._messages.addToolMessage('No command provided', toolCall.id);
          continue;
        }

        let shouldExecute = false;

        if (this._options.auto || this._options.yes) {
          console.log(chalk.gray(`\n> Auto-executing: ${chalk.cyan(command)}`));
          shouldExecute = true;
        } else if (this._smartConfirmEnabled && !this._isHighRiskCommand(command)) {
          console.log(chalk.gray(`\n> Auto-running (trusted): ${chalk.cyan(command)}`));
          shouldExecute = true;
        } else if (needsConfirm) {
          console.log(chalk.yellow(`\n> Execute '${chalk.cyan(command)}'? [y/N]:`));
          const { confirm } = await inquirer.prompt([
            {
              type: 'input',
              name: 'confirm',
              message: '',
              validate: (input: string) => {
                const answer = input.trim().toLowerCase();
                if (answer === 'y' || answer === 'n' || answer === '') return true;
                return 'Please enter y or n';
              },
            },
          ]);
          shouldExecute = confirm.trim().toLowerCase() === 'y';
        } else {
          console.log(chalk.gray(`\n> Running: ${chalk.cyan(command)}`));
          shouldExecute = true;
        }

        if (!shouldExecute) {
          console.log(chalk.yellow('\nCommand cancelled'));
          this._messages.addToolMessage('Command cancelled by user', toolCall.id);
          return false;
        }
      } else {
        const displayArgs =
          toolName === 'write_file'
            ? `path=${args['path']}`
            : toolName === 'read_file'
              ? `path=${args['path']}`
              : toolName === 'search_files'
                ? `pattern="${args['pattern']}"`
                : toolName === 'list_directory'
                  ? `path=${args['path'] ?? '.'}`
                  : '';

        if (needsConfirm && !this._options.auto) {
          console.log(chalk.yellow(`\n> Tool: ${chalk.cyan(toolName)}(${displayArgs}) [y/N]:`));
          const { confirm } = await inquirer.prompt([
            {
              type: 'input',
              name: 'confirm',
              message: '',
              validate: (input: string) => {
                const answer = input.trim().toLowerCase();
                if (answer === 'y' || answer === 'n' || answer === '') return true;
                return 'Please enter y or n';
              },
            },
          ]);
          if (confirm.trim().toLowerCase() !== 'y') {
            this._messages.addToolMessage('Tool cancelled by user', toolCall.id);
            return false;
          }
        } else {
          console.log(chalk.gray(`\n> Tool: ${chalk.cyan(toolName)}(${displayArgs})`));
        }
      }

      const isMutation =
        toolName === 'write_file' ||
        (toolName === 'exec_bash_command' &&
          this._config.requiresConfirmation(args['cmd'] as string));

      if (isMutation && this._undo.isInitialized) {
        const description =
          toolName === 'write_file'
            ? `Before writing ${args['path'] as string}`
            : `Before: ${args['cmd'] as string}`;
        await this._undo.createSnapshot(description);
      }

      const execSpinner = ora({
        text: chalk.cyan('Executing...'),
        spinner: 'dots',
      }).start();

      try {
        const result = await this._tools.executeTool(toolName, args);
        execSpinner.stop();

        this._displayToolResult(toolName, result);
        this._messages.addToolMessage(result.content, toolCall.id);

        if (result.isError) {
          this._successfulConfirms = 0;
          return false;
        }

        if (needsConfirm) {
          this._successfulConfirms++;
          if (this._successfulConfirms >= SMART_CONFIRM_THRESHOLD && !this._smartConfirmEnabled) {
            this._smartConfirmEnabled = true;
            console.log(
              chalk.gray(
                `\n  [Smart confirm enabled — low-risk commands will auto-run. Use 'trust sandbox' to reset]`,
              ),
            );
          }
        }
      } catch (error) {
        execSpinner.fail(chalk.red('Execution failed'));

        const errorBox = boxen(chalk.red(`${error}`), {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'red',
          title: chalk.red.bold('Execution Error'),
        });
        console.log('\n' + errorBox);

        this._messages.addToolMessage(`Error: ${error}`, toolCall.id);
        return false;
      }
    }

    return true;
  }

  private _displayToolResult(toolName: string, result: ToolResult): void {
    if (result.isError) {
      const suggestion = this._suggestFix(toolName, result.content);
      const errorContent =
        chalk.red(result.content) + (suggestion ? '\n\n' + chalk.yellow(suggestion) : '');
      const errorBox = boxen(errorContent, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'red',
        title: chalk.red.bold(`Error [${toolName}]`),
        titleAlignment: 'left',
      });
      console.log('\n' + errorBox);
      return;
    }

    if (toolName === 'exec_bash_command') {
      try {
        const parsed = JSON.parse(result.content);
        const hasOutput = parsed.stdout && parsed.stdout.trim().length > 0;
        const hasErrors = parsed.stderr && parsed.stderr.trim().length > 0;

        let outputContent = '';

        if (hasOutput) {
          outputContent = this._formatStructuredOutput(parsed.stdout);
        }

        if (hasErrors) {
          if (outputContent) outputContent += '\n';
          outputContent += chalk.yellow(parsed.stderr);
        }

        if (!hasOutput && !hasErrors) {
          outputContent = chalk.gray('Command executed successfully (no output)');
        }

        const statusColor = parsed.exitCode === 0 ? 'green' : 'yellow';
        const statusIcon = parsed.exitCode === 0 ? 'OK' : `Exit: ${parsed.exitCode}`;

        const resultBox = boxen(outputContent, {
          padding: 1,
          borderStyle: 'round',
          borderColor: statusColor,
          title: chalk[statusColor].bold(statusIcon),
          titleAlignment: 'left',
        });

        console.log('\n' + resultBox);
      } catch {
        console.log(chalk.white(`\n${result.content}`));
      }
    } else {
      const formatted = this._formatStructuredOutput(result.content);
      const truncated = MarkdownRenderer.truncateWithPager(formatted, 40);
      console.log('\n' + truncated);
    }
  }

  private _suggestFix(toolName: string, errorContent: string): string | null {
    if (errorContent.includes('ENOENT') || errorContent.includes('not found')) {
      return 'Suggestion: Check the file path or use list_directory to find the correct location.';
    }
    if (errorContent.includes('EACCES') || errorContent.includes('Permission denied')) {
      return 'Suggestion: Try changing trust level with the "trust" command.';
    }
    if (errorContent.includes('Command cancelled')) {
      return null;
    }
    if (toolName === 'exec_bash_command' && errorContent.includes('not recognized')) {
      return 'Suggestion: The command may not be installed. Try checking with "which <command>".';
    }
    if (errorContent.includes('timeout')) {
      return 'Suggestion: The operation timed out. Try breaking it into smaller steps.';
    }
    return null;
  }

  private _formatStructuredOutput(content: string): string {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const pretty = JSON.stringify(parsed, null, 2);
        const lines = pretty.split('\n');
        if (lines.length > 50) {
          return (
            chalk.white(lines.slice(0, 50).join('\n')) +
            chalk.gray(`\n\n... (${lines.length - 50} more lines)`)
          );
        }
        return chalk.white(pretty);
      } catch {
        // not valid JSON, fall through
      }
    }

    const lines = content.split('\n');
    if (lines.length > 50) {
      const truncated = chalk.white(lines.slice(0, 50).join('\n'));
      const summary = chalk.gray(`\n\n... (${lines.length - 50} more lines)`);
      return truncated + summary;
    }

    return chalk.white(content);
  }

  private _filterThinkDirective(content: string): string {
    if (content.startsWith('/think')) {
      return content.substring(5).trim();
    }
    return content.trim();
  }

  private _isHighRiskCommand(command: string): boolean {
    const highRisk = [
      /\brm\s+-rf\b/,
      /\brm\s+/,
      /\bmv\s+/,
      /\bchmod\s+/,
      /\bchown\s+/,
      /\bgit\s+push\b/,
      /\bgit\s+reset\b/,
      /\bdocker\s+rm\b/,
      /\bdocker\s+rmi\b/,
      /\bnpm\s+publish\b/,
      /\bdd\s+/,
    ];
    return highRisk.some((p) => p.test(command));
  }

  private _handleError(error: unknown): void {
    if (error instanceof AgentError) {
      this._printError(error.message);
    } else if (error instanceof Error) {
      this._printError(`Unexpected error: ${error.message}`);
      if (this._options.verbose) {
        console.error(chalk.gray('\nStack trace:'));
        console.error(chalk.gray(error.stack));
      }
    } else {
      this._printError(`Unknown error: ${error}`);
    }
  }

  private _printError(message: string): void {
    const errorBox = boxen(chalk.red(message), {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'red',
      title: chalk.red.bold('Error'),
      titleAlignment: 'left',
    });
    console.log('\n' + errorBox + '\n');
  }

  private _printGoodbye(): void {
    console.log(chalk.cyan('\nShutting down. Bye!\n'));
  }
}

async function main(): Promise<void> {
  program
    .name('cua')
    .description('Computer Use Agent - Interactive CLI for bash command execution')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-k, --api-key <key>', 'Override API key')
    .option('-m, --model <model>', 'Override LLM model')
    .option('-n, --non-interactive', 'Run without command confirmation')
    .option('-a, --auto', 'Auto-execute commands without confirmation')
    .option('-y, --yes', 'Non-interactive: auto-confirm everything, no prompts')
    .option('-p, --prompt <text>', 'Run a single prompt non-interactively and exit')
    .option('-d, --dry-run', 'Show what the agent would do without executing')
    .option('-t, --trust <tier>', 'Trust tier: sandbox|standard|trusted|unrestricted')
    .parse();

  const options = program.opts() as CLIOptions & { trust?: TrustTier };

  if (options.prompt) {
    options.yes = true;
  }

  await SetupWizard.runIfNeeded();

  let selectedModel: string | undefined = options.model;
  let providerBaseUrl: string | undefined;
  let providerApiKey: string | undefined;
  let selectedProviderName: string | undefined;

  const { modelId: routerModelId, router: modelRouter } = ModelRouter.resolveModelSelection(
    options.model,
    PROVIDERS,
  );

  if (!selectedModel || selectedModel === 'auto') {
    if (options.yes && !options.prompt) {
      const envModel = process.env['LLM_MODEL_NAME'];
      const envBaseUrl = process.env['LLM_BASE_URL'];
      if (envModel) selectedModel = envModel;
      if (envBaseUrl) providerBaseUrl = envBaseUrl;
    }

    if (!selectedModel || selectedModel === 'auto') {
      const selection = await CLIApplication.selectProvider();
      selectedModel = selection.modelId;
      providerBaseUrl = selection.provider.baseUrl;
      selectedProviderName = selection.provider.name;
      const envKey = selection.provider.envKey;
      if (envKey !== 'OLLAMA' && process.env[envKey]) {
        providerApiKey = process.env[envKey];
      }
    }
  }

  if (providerBaseUrl) {
    process.env['LLM_BASE_URL'] = providerBaseUrl;
  }
  if (providerApiKey) {
    process.env['OPENROUTER_API_KEY'] = providerApiKey;
  }

  if (selectedProviderName) {
    const providerName = selectedProviderName.toLowerCase();
    if (providerName.includes('anthropic')) {
      process.env['LLM_PROVIDER'] = 'anthropic';
    } else if (providerName.includes('ollama')) {
      process.env['LLM_PROVIDER'] = 'ollama';
    } else {
      process.env['LLM_PROVIDER'] = 'openai_compatible';
    }
  }

  let selectedTier: TrustTier | undefined = options.trust as TrustTier | undefined;
  if (!selectedTier) {
    if (options.yes) {
      selectedTier = 'standard';
    } else {
      selectedTier = await CLIApplication.selectTrustTier();
    }
  }

  const app = new CLIApplication(
    options,
    selectedModel,
    selectedTier,
    providerBaseUrl,
    providerApiKey,
  );

  process.on('SIGINT', () => {
    console.log('\nInterrupted by user. Shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived termination signal. Shutting down gracefully...');
    process.exit(0);
  });

  await app.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
