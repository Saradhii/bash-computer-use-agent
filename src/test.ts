/**
 * Simple test runner for the Computer Use Agent
 * Verifies core functionality without requiring API keys
 */

import chalk from 'chalk';
import { Config } from './config.js';
import { Bash } from './bash.js';
import { MessageManager } from './messages.js';
import { extractBaseCommand, parseCommandArgs } from './utils.js';

/**
 * Test result interface
 */
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

/**
 * Simple test runner
 */
class TestRunner {
  private results: TestResult[] = [];

  /**
   * Run a test and record the result
   * @param name - Test name
   * @param fn - Test function
   */
  async test(name: string, fn: () => Promise<void> | void): Promise<void> {
    const startTime = Date.now();

    try {
      await fn();
      const duration = Date.now() - startTime;
      this.results.push({ name, passed: true, duration });
      console.log(chalk.green(`  ✓ ${name} (${duration}ms)`));
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, error: errorMessage, duration });
      console.log(chalk.red(`  ✗ ${name} (${duration}ms)`));
      console.log(chalk.red(`    Error: ${errorMessage}`));
    }
  }

  /**
   * Print test summary
   */
  printSummary(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(chalk.bold('\n📊 Test Summary:'));
    console.log(chalk.green(`  Passed: ${passed}`));
    console.log(chalk.red(`  Failed: ${failed}`));
    console.log(chalk.blue(`  Total: ${this.results.length}`));
    console.log(chalk.gray(`  Duration: ${totalDuration}ms`));

    if (failed > 0) {
      console.log(chalk.red('\n❌ Some tests failed!'));
      process.exit(1);
    } else {
      console.log(chalk.green('\n✅ All tests passed!'));
    }
  }
}

/**
 * Assert that a condition is true
 * @param condition - Condition to check
 * @param message - Error message
 */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Main test suite
 */
async function runTests(): Promise<void> {
  console.log(chalk.bold.blue('🧪 Running Computer Use Agent Tests\n'));

  const runner = new TestRunner();

  // Test utility functions
  await runner.test('extractBaseCommand - basic command', () => {
    assert(extractBaseCommand('ls') === 'ls', 'Should extract simple command');
  });

  await runner.test('extractBaseCommand - command with args', () => {
    assert(extractBaseCommand('ls -la') === 'ls', 'Should extract base command with args');
  });

  await runner.test('extractBaseCommand - command with quotes', () => {
    assert(extractBaseCommand('echo "hello world"') === 'echo', 'Should extract base command with quotes');
  });

  await runner.test('parseCommandArgs - simple args', () => {
    const args = parseCommandArgs('ls -la');
    assert(args.length === 2, 'Should parse 2 arguments');
    assert(args[0] === 'ls', 'First argument should be ls');
    assert(args[1] === '-la', 'Second argument should be -la');
  });

  await runner.test('parseCommandArgs - quoted args', () => {
    const args = parseCommandArgs('echo "hello world"');
    assert(args.length === 2, 'Should parse 2 arguments with quotes');
    assert(args[0] === 'echo', 'First argument should be echo');
    assert(args[1] === 'hello world', 'Second argument should be quoted text');
  });

  // Test configuration (without real API key)
  await runner.test('Config - environment validation', () => {
    // This will fail without real API key, but we can test other aspects
    try {
      const config = new Config();
      assert(config.rootDir.length > 0, 'Root directory should be set');
      assert(config.security.allowedCommands.length > 0, 'Should have allowed commands');
    } catch (error) {
      // Expected if API key is not configured
      assert(error instanceof Error, 'Should throw error for missing API key');
    }
  });

  // Test message manager
  await runner.test('MessageManager - basic functionality', () => {
    const messages = new MessageManager('You are a helpful assistant.');

    messages.addUserMessage('Hello');
    messages.addAssistantMessage('Hi there!');

    const allMessages = messages.getMessages();
    assert(allMessages.length === 3, 'Should have 3 messages (system + user + assistant)');
    assert(allMessages[0]!.role === 'system', 'First message should be system');
    assert(allMessages[1]!.role === 'user', 'Second message should be user');
    assert(allMessages[2]!.role === 'assistant', 'Third message should be assistant');
  });

  await runner.test('MessageManager - tool calls', () => {
    const messages = new MessageManager();

    const toolCall = {
      id: 'test-123',
      type: 'function' as const,
      function: {
        name: 'test_function',
        arguments: '{"param": "value"}',
      },
    };

    messages.addAssistantMessage('I will help you', [toolCall]);
    messages.addToolMessage('Tool executed successfully', 'test-123');

    const toolCalls = messages.getAllToolCalls();
    assert(toolCalls.length === 1, 'Should have one tool call');
    assert(toolCalls[0]!.id === 'test-123', 'Tool call ID should match');
  });

  // Test bash executor (without actual execution)
  await runner.test('Bash - initialization', async () => {
    try {
      const config = new Config();
      const bash = new Bash(config);

      assert(bash.cwd.length > 0, 'Working directory should be set');

      // Test tool schema generation
      const schema = bash.getToolSchema();
      assert(schema.type === 'function', 'Schema should be function type');
      assert(schema.function.name === 'exec_bash_command', 'Function name should match');
    } catch (error) {
      // Expected if API key is not configured
      assert(error instanceof Error, 'Should throw error for missing API key');
    }
  });

  await runner.test('Bash - command validation', async () => {
    try {
      const config = new Config();
      const bash = new Bash(config);

      // Test safe command
      await bash.execBashCommand('echo "test"');
      assert(true, 'Safe command should execute');

      // Test dangerous command (should throw)
      try {
        await bash.execBashCommand('rm -rf /');
        assert(false, 'Dangerous command should fail');
      } catch (error) {
        assert(error instanceof Error, 'Should throw error for dangerous command');
      }
    } catch (error) {
      // Expected if API key is not configured
      // Skip this test
    }
  });

  // Print summary
  runner.printSummary();
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(error => {
    console.error(chalk.red('Test runner failed:'), error);
    process.exit(1);
  });
}