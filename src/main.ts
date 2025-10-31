/**
 * Main CLI interface for the Computer Use Agent
 * Provides an interactive command-line interface for executing bash commands through natural language
 * Based on NVIDIA's official implementation with minimal UI
 */

import inquirer from 'inquirer';
import { program } from 'commander';
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

/**
 * CLI application class that manages the interactive session
 */
class CLIApplication {
  private readonly _config: Config;
  private readonly _bash: Bash;
  private readonly _llm: LLMClient;
  private readonly _messages: MessageManager;
  private readonly _options: CLIOptions;
  private _isRunning: boolean = true;

  /**
   * Initialize the CLI application
   * @param options - CLI options from command line arguments
   * @param modelName - Optional model name to use
   */
  constructor(options: CLIOptions = {}, modelName?: string) {
    this._options = options;

    try {
      // Initialize configuration and components
      this._config = getConfig(modelName);
      this._bash = new Bash(this._config);
      this._llm = new LLMClient(this._config);
      this._messages = new MessageManager(this._config.systemPrompt, 50);

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

  /**
   * Prompt user to select an LLM model
   * @returns Selected model ID
   */
  static async selectModel(): Promise<string> {
    console.log('Select an LLM model:\n');

    // Format choices with recommendation indicator
    const choices = AVAILABLE_MODELS.map(model => ({
      name: `${model.name}${model.recommended ? ' (Recommended)' : ''}\n  ${model.description}`,
      value: model.id,
      short: model.name,
    }));

    const { modelId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'modelId',
        message: 'Choose model:',
        choices,
        default: AVAILABLE_MODELS.find(m => m.recommended)?.id || AVAILABLE_MODELS[0]?.id,
      },
    ]);

    console.log(''); // Empty line for spacing
    return modelId;
  }

  /**
   * Apply command line options to configuration
   * @private
   */
  private _applyCLIOptions(): void {
    // Note: Config properties are readonly by design
    // CLI options override will need to be handled differently
    // For now, we'll set environment variables

    if (this._options.verbose) {
      process.env['NODE_ENV'] = 'development';
    }
  }

  /**
   * Start the interactive CLI session
   */
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

  /**
   * Print welcome message and help information
   * @private
   */
  private _printWelcome(): void {
    console.log('-'.repeat(80));
    console.log('BASH COMPUTER USE AGENT');
    console.log('-'.repeat(80));
    console.log(`[INFO] Type 'quit' to exit`);
  }

  /**
   * Test LLM connection and report status
   * @private
   */
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

  /**
   * Handle user input from the command line
   * @private
   */
  private async _handleUserInput(): Promise<void> {
    // Get user input - NVIDIA style prompt
    const { input } = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: `[${this._bash.cwd}] 🙂] `,
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

  /**
   * Handle special CLI commands
   * @param input - User input (lowercase)
   * @returns True if a special command was handled
   * @private
   */
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
        console.log(`Current directory: ${this._bash.cwd}`);
        return true;

      default:
        return false;
    }
  }

  /**
   * Process user request with the LLM
   * @private
   */
  private async _processRequest(): Promise<void> {
    // Continue processing until no more tool calls
    while (true) {
      // Show thinking indicator (NVIDIA style - simple text)
      console.log('Thinking...');

      try {
        // Query the LLM
        const response: LLMResponse = await this._llm.query(
          this._messages,
          [this._bash.getToolSchema()]
        );

        // Handle assistant's text response
        if (response.message) {
          const content = this._filterThinkDirective(response.message);
          if (content) {
            console.log(`\n${content}`);
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
        throw error;
      }
    }
  }

  /**
   * Handle tool calls from the LLM
   * @param toolCalls - Array of tool calls to execute
   * @private
   */
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
        console.log('No command provided');
        this._messages.addToolMessage('No command provided', toolCall.id);
        continue;
      }

      // Ask for confirmation - NVIDIA style
      console.log(`\n▶️ Execute '${command}'? [y/N]:`);

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

      const shouldExecute = confirm.trim().toLowerCase() === 'y';

      if (shouldExecute) {
        // Execute the command
        console.log('Executing...');

        try {
          const result = await this._bash.execBashCommand(command);

          // Display results - NVIDIA style (raw output)
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
          console.log(`Error: ${error}`);
          this._messages.addToolMessage(
            `Error: ${error}`,
            toolCall.id
          );
        }
      } else {
        // Command cancelled by user
        console.log('Command execution cancelled');
        this._messages.addToolMessage(
          'Command cancelled by user',
          toolCall.id
        );
      }
    }
  }

  /**
   * Display command execution result
   * @param result - Command execution result
   * @private
   */
  private _displayCommandResult(result: CommandResult): void {
    if (result.error) {
      console.log(`Error: ${result.error}`);
      return;
    }

    // Display stdout (NVIDIA style - raw output)
    if (result.stdout) {
      console.log(result.stdout);
    }

    // Display stderr (NVIDIA style - raw output)
    if (result.stderr) {
      console.error(result.stderr);
    }
  }

  /**
   * Filter out the /think directive from assistant responses
   * @param content - Raw content from assistant
   * @returns Filtered content
   * @private
   */
  private _filterThinkDirective(content: string): string {
    if (content.startsWith('/think')) {
      return content.substring(5).trim();
    }
    return content.trim();
  }

  /**
   * Handle errors gracefully
   * @param error - Error to handle
   * @private
   */
  private _handleError(error: unknown): void {
    if (error instanceof AgentError) {
      this._printError(error.message);
    } else if (error instanceof Error) {
      this._printError(`Unexpected error: ${error.message}`);
      if (this._options.verbose) {
        console.error(error.stack);
      }
    } else {
      this._printError(`Unknown error: ${error}`);
    }
  }

  /**
   * Print error message
   * @param message - Error message to print
   * @private
   */
  private _printError(message: string): void {
    console.log(`Error: ${message}`);
  }

  /**
   * Print goodbye message
   * @private
   */
  private _printGoodbye(): void {
    console.log('Shutting down. Bye!');
  }
}

/**
 * Main entry point
 */
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

// Run the application if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}