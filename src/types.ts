/**
 * Core type definitions for the Computer Use Agent
 * Provides strict typing for all data structures and API interactions
 */

import { z } from 'zod';

// ============================================================================
// LLM and Message Types
// ============================================================================

/**
 * Role of a message in the conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Base message interface for all message types
 */
export interface BaseMessage {
  role: MessageRole;
  content: string;
}

/**
 * Tool message containing the result of a tool execution
 */
export interface ToolMessage extends BaseMessage {
  role: 'tool';
  tool_call_id: string;
}

/**
 * Tool call requested by the LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Assistant message that may include tool calls
 */
export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  tool_calls?: ToolCall[];
  toolCalls?: ToolCall[];
}

/**
 * Union type for all possible messages
 */
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

/**
 * System message type
 */
export interface SystemMessage extends BaseMessage {
  role: 'system';
}

/**
 * User message type
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
}

// ============================================================================
// Command Execution Types
// ============================================================================

/**
 * Result of executing a bash command
 */
export interface CommandResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error output from the command */
  stderr: string;
  /** Current working directory after command execution */
  cwd: string;
  /** Exit code of the command (0 = success) */
  exitCode?: number;
  /** Error message if command failed validation */
  error?: string;
}

/**
 * Execution context for bash commands
 */
export interface ExecutionContext {
  /** Current working directory */
  cwd: string;
  /** Environment variables */
  env: Record<string, string | undefined>;
  /** User ID */
  uid?: number;
  /** Group ID */
  gid?: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * LLM provider configuration
 */
export interface LLMConfig {
  /** Base URL for the LLM API */
  baseUrl: string;
  /** Model name to use */
  modelName: string;
  /** API key for authentication */
  apiKey: string;
  /** Temperature for response randomness (0-1) */
  temperature: number;
  /** Top-p sampling for response diversity */
  topP: number;
  /** Maximum tokens for response */
  maxTokens: number | null | undefined;
}

/**
 * Security configuration for command execution
 */
export interface SecurityConfig {
  /** List of allowed commands */
  allowedCommands: readonly string[];
  /** Blocked command patterns */
  blockedPatterns: readonly RegExp[];
  /** Enable pipe and redirect operations */
  allowPipesAndRedirects: boolean;
  /** Maximum command execution time in milliseconds */
  commandTimeout: number;
}

/**
 * Complete application configuration
 */
export interface AppConfig {
  /** LLM configuration */
  llm: LLMConfig;
  /** Security settings */
  security: SecurityConfig;
  /** Root directory for the agent */
  rootDir: string;
  /** System prompt template */
  systemPrompt: string;
}

// ============================================================================
// Tool Schema Types
// ============================================================================

/**
 * JSON Schema for tool parameters
 */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: readonly unknown[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: readonly string[];
}

/**
 * JSON Schema for a tool function
 */
export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: readonly string[];
  };
}

/**
 * Complete tool schema for LLM function calling
 */
export interface ToolSchema {
  type: 'function';
  function: ToolFunction;
}

// ============================================================================
// UI and CLI Types
// ============================================================================

/**
 * CLI command options
 */
export interface CLIOptions {
  /** Configuration file path */
  config?: string;
  /** Verbose output */
  verbose?: boolean;
  /** Non-interactive mode */
  nonInteractive?: boolean;
  /** Custom API key */
  apiKey?: string;
  /** Custom model */
  model?: string;
}

/**
 * User input with context
 */
export interface UserInput {
  /** Raw user input */
  text: string;
  /** Current working directory when input was received */
  cwd: string;
  /** Timestamp of input */
  timestamp: Date;
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Zod schema for validating environment variables
 */
export const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "API key is required"),
  LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL_NAME: z.string().default("nvidia/nemotron-nano-9b-v2:free"),
  LLM_TEMPERATURE: z.string().transform(Number).pipe(z.number().min(0).max(2)).default("0.1"),
  LLM_TOP_P: z.string().transform(Number).pipe(z.number().min(0).max(1)).default("0.95"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Type for validated environment variables
 */
export type EnvVars = z.infer<typeof envSchema>;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for application-specific errors
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Error thrown when command validation fails
 */
export class CommandValidationError extends AgentError {
  constructor(message: string, public readonly command: string) {
    super(message, 'COMMAND_VALIDATION_ERROR', { command });
    this.name = 'CommandValidationError';
  }
}

/**
 * Error thrown when LLM API call fails
 */
export class LLMError extends AgentError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'LLM_ERROR', { statusCode });
    this.name = 'LLMError';
  }
}

/**
 * Error thrown when command execution fails
 */
export class CommandExecutionError extends AgentError {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number
  ) {
    super(message, 'COMMAND_EXECUTION_ERROR', { command, exitCode });
    this.name = 'CommandExecutionError';
  }
}