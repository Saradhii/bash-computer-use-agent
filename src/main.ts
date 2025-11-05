import inquirer from 'inquirer';
import commandPrompt from 'inquirer-command-prompt';
import { program } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { Config, getConfig, AVAILABLE_MODELS } from './config.js';
import { Bash } from './bash.js';
import { MessageManager } from './messages.js';
import { LLMClient, type LLMResponse } from './llm.js';
import type {
  CLIOptions,
  UserInput,
  CommandResult,
  ToolCall,
  ModelConfig
} from './types.js';
import {
  AgentError
} from './types.js';

class CLIApplication {
  private readonly _config: Config;
  private readonly _bash: Bash;
  private readonly _llm: LLMClient;
  private readonly _messages: MessageManager;
  private readonly _options: CLIOptions;
  private _isRunning: boolean = true;

  constructor(options: CLIOptions = {}, modelName?: string) {
    this._options = options;

    try {
      // Initialize configuration and components
      this._config = getConfig(modelName);
      this._bash = new Bash(this._config);
      this._llm = new LLMClient(this._config);
      this._messages = new MessageManager(this._config.systemPrompt, 200);

      // Register command prompt for history support
      inquirer.registerPrompt('command', commandPrompt);

      // Override config with command line options
      this._applyCLIOptions();
    } catch (error) {
      if (error instanceof AgentError) {
        this._printError(error.message);
        process.exit(1);
      }
      throw error;
    }
  }

  static async selectModel(): Promise<string> {
    console.log(chalk.cyan.bold('\n🤖 Select an LLM model:\n'));

    // Format choices with recommendation indicator and colors
    const choices = AVAILABLE_MODELS.map(model => ({
      name: model.recommended
        ? `${chalk.green('★')} ${chalk.bold(model.name)} ${chalk.yellow('(Recommended)')}\n  ${chalk.gray(model.description)}`
        : `  ${chalk.bold(model.name)}\n  ${chalk.gray(model.description)}`,
      value: model.id,
      short: model.name,
    }));

    const { modelId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'modelId',
        message: chalk.cyan('Choose model:'),
        choices,
        default: AVAILABLE_MODELS.find(m => m.recommended)?.id || AVAILABLE_MODELS[0]?.id,
      },
    ]);

    console.log(''); // Empty line for spacing
    return modelId;
  }

  private _applyCLIOptions(): void {
    // Note: Config properties are readonly by design
    // CLI options override will need to be handled differently
    // For now, we'll set environment variables

    if (this._options.verbose) {
      process.env['NODE_ENV'] = 'development';
    }
  }

  async start(): Promise<void> {
    this._printWelcome();

    // Test LLM connection in verbose mode
    if (this._options.verbose) {
      await this._testLLMConnection();
    }

    // Main interaction loop
    while (this._isRunning) {
      try {
        await this._handleUserInput();
      } catch (error) {
        this._handleError(error);
      }
    }

    this._printGoodbye();
  }

  private _printWelcome(): void {
    const title = gradient.pastel.multiline([
      '  🤖 BASH COMPUTER USE AGENT  ',
    ].join('\n'));

    console.log(boxen(title, {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: 'round',
      borderColor: 'cyan',
      align: 'center'
    }));

    console.log(chalk.gray(`Type 'quit' to exit | 'clear' to clear screen | 'cwd' for current directory`));
    console.log();
  }

  private async _testLLMConnection(): Promise<void> {
    console.log('Testing LLM connection...');

    try {
      const isConnected = await this._llm.testConnection();

      if (isConnected) {
        console.log('LLM connection successful');
      } else {
        console.log('LLM connection failed');
        console.log('[WARNING] Please check your API key and network connection');
      }
    } catch (error) {
      console.log('LLM connection test failed');
      console.error(`[ERROR] ${error}`);
    }
  }

  private _formatPath(cwd: string): string {
    const home = homedir();

    // Replace home directory with ~
    if (cwd.startsWith(home)) {
      return chalk.cyan(`~${cwd.slice(home.length)}`);
    }

    // For non-home paths, just style them
    return chalk.cyan(cwd);
  }

  private async _handleUserInput(): Promise<void> {
    // Get user input - Modern styled prompt with history support
    const formattedPath = this._formatPath(this._bash.cwd);
    const { input } = await inquirer.prompt([
      {
        type: 'command',
        name: 'input',
        message: `${chalk.cyanBright('❯')} ${formattedPath} ${chalk.gray('›')} `,
        context: 0,
        validate: (input: string) => {
          if (!input.trim()) {
            return 'Please enter a command or question';
          }
          return true;
        },
      },
    ]);

    const userInput = input.trim();

    // Handle special commands
    if (this._handleSpecialCommands(userInput)) {
      return;
    }

    // Add context to user input
    const inputWithContext = `${userInput}\n\nCurrent working directory: \`${this._bash.cwd}\``;

    // Add user message to conversation
    this._messages.addUserMessage(inputWithContext);

    // Process the request with LLM
    await this._processRequest();
  }

  private _handleSpecialCommands(input: string): boolean {
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
        console.log(chalk.cyan(`\n📁 Current directory: ${chalk.bold(this._bash.cwd)}\n`));
        return true;

      default:
        return false;
    }
  }

  private async _processRequest(): Promise<void> {
    // Continue processing until no more tool calls
    while (true) {
      // Show thinking indicator with ora spinner
      const spinner = ora({
        text: chalk.cyan('Thinking...'),
        spinner: 'dots',
      }).start();

      try {
        // Query the LLM
        const response: LLMResponse = await this._llm.query(
          this._messages,
          [this._bash.getToolSchema()]
        );

        // Stop spinner successfully
        spinner.succeed(chalk.green('Response ready'));

        // Handle assistant's text response
        if (response.message) {
          const content = this._filterThinkDirective(response.message);
          if (content) {
            console.log(chalk.white(`\n${content}`));
            this._messages.addAssistantMessage(content);
          }
        }

        // Handle tool calls (execute bash commands)
        if (response.toolCalls.length > 0) {
          await this._handleToolCalls(response.toolCalls);
          // After executing commands, break to wait for user input
          break;
        }

        // No more tool calls, exit loop
        break;

      } catch (error) {
        spinner.fail(chalk.red('Error occurred'));
        throw error;
      }
    }
  }

  private async _handleToolCalls(toolCalls: ToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      if (toolCall.function.name !== 'exec_bash_command') {
        console.log(`Unknown function called: ${toolCall.function.name}`);
        this._messages.addToolMessage(
          `Unknown function: ${toolCall.function.name}`,
          toolCall.id
        );
        continue;
      }

      // Parse command arguments
      const args = JSON.parse(toolCall.function.arguments);
      const command = args.cmd;

      if (!command) {
        console.log(chalk.red('✗ No command provided'));
        this._messages.addToolMessage('No command provided', toolCall.id);
        continue;
      }

      // Check if auto-execute is enabled
      let shouldExecute = false;

      if (this._options.auto) {
        console.log(chalk.gray(`\n▶ Auto-executing: ${chalk.cyan(command)}`));
        shouldExecute = true;
      } else {
        // Ask for confirmation
        console.log(chalk.yellow(`\n▶ Execute '${chalk.cyan(command)}'? [y/N]:`));

        // Get user confirmation (simple input, not inquirer confirm)
        const { confirm } = await inquirer.prompt([
          {
            type: 'input',
            name: 'confirm',
            message: '',
            validate: (input: string) => {
              const answer = input.trim().toLowerCase();
              if (answer === 'y' || answer === 'n' || answer === '') {
                return true;
              }
              return 'Please enter y or n';
            },
          },
        ]);

        shouldExecute = confirm.trim().toLowerCase() === 'y';
      }

      if (shouldExecute) {
        // Execute the command
        const execSpinner = ora({
          text: chalk.cyan('Executing command...'),
          spinner: 'dots',
        }).start();

        try {
          const result = await this._bash.execBashCommand(command);
          execSpinner.stop();

          // Display results with modern UI
          this._displayCommandResult(result);

          // Add result to messages
          const toolResult = {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            cwd: result.cwd,
            exitCode: result.exitCode || 0,
          };

          this._messages.addToolMessage(
            JSON.stringify(toolResult),
            toolCall.id
          );
        } catch (error) {
          execSpinner.fail(chalk.red('Execution failed'));

          const errorBox = boxen(chalk.red(`${error}`), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'red',
            title: chalk.red.bold('Execution Error'),
          });
          console.log('\n' + errorBox);

          this._messages.addToolMessage(
            `Error: ${error}`,
            toolCall.id
          );
        }
      } else {
        // Command cancelled by user
        console.log(chalk.yellow('\n⊘ Command execution cancelled'));
        this._messages.addToolMessage(
          'Command cancelled by user',
          toolCall.id
        );
      }
    }
  }

  private _displayCommandResult(result: CommandResult): void {
    if (result.error) {
      // Display error in a red box
      const errorBox = boxen(chalk.red(`✗ Error: ${result.error}`), {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'red',
        title: chalk.red.bold('Error'),
        titleAlignment: 'left',
      });
      console.log('\n' + errorBox);
      return;
    }

    // Check if command has any output
    const hasStdout = result.stdout && result.stdout.trim().length > 0;
    const hasStderr = result.stderr && result.stderr.trim().length > 0;
    const hasOutput = hasStdout || hasStderr;

    // Build output content
    let outputContent = '';

    if (hasStdout) {
      outputContent += chalk.white(result.stdout);
    }

    if (hasStderr) {
      if (outputContent) outputContent += '\n';
      outputContent += chalk.yellow(result.stderr);
    }

    // If no output, show success message
    if (!hasOutput) {
      outputContent = chalk.gray('✓ Command executed successfully (no output)');
    }

    // Display output in a box
    const statusColor = result.exitCode === 0 ? 'green' : 'yellow';
    const statusIcon = result.exitCode === 0 ? '✓' : '⚠';
    const statusText = result.exitCode === 0 ? 'Success' : `Exit code: ${result.exitCode}`;

    const resultBox = boxen(outputContent, {
      padding: 1,
      borderStyle: 'round',
      borderColor: statusColor,
      title: chalk[statusColor].bold(`${statusIcon} ${statusText}`),
      titleAlignment: 'left',
    });

    console.log('\n' + resultBox);
  }

  private _filterThinkDirective(content: string): string {
    if (content.startsWith('/think')) {
      return content.substring(5).trim();
    }
    return content.trim();
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
      title: chalk.red.bold('✗ Error'),
      titleAlignment: 'left',
    });
    console.log('\n' + errorBox + '\n');
  }

  private _printGoodbye(): void {
    console.log(chalk.cyan('\n👋 Shutting down. Bye!\n'));
  }
}

async function main(): Promise<void> {
  // Setup command line program
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
    .parse();

  const options = program.opts() as CLIOptions;

  // Select model if not provided via CLI option
  let selectedModel: string | undefined = options.model;
  if (!selectedModel) {
    selectedModel = await CLIApplication.selectModel();
  }

  // Create and start the CLI application
  const app = new CLIApplication(options, selectedModel);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nInterrupted by user. Shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived termination signal. Shutting down gracefully...');
    process.exit(0);
  });

  // Start the application
  await app.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}