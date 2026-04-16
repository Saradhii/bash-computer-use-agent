import { z } from 'zod';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface BaseMessage {
  role: MessageRole;
  content: string;
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  tool_call_id: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  tool_calls?: ToolCall[];
  toolCalls?: ToolCall[];
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface SystemMessage extends BaseMessage {
  role: 'system';
}

export interface UserMessage extends BaseMessage {
  role: 'user';
}

export interface CommandResult {
  stdout: string;

  stderr: string;

  cwd: string;

  exitCode?: number;

  error?: string;
}

export interface ExecutionContext {
  cwd: string;

  env: Record<string, string | undefined>;

  uid?: number;

  gid?: number;
}

export interface LLMConfig {
  baseUrl: string;

  modelName: string;

  apiKey: string;

  temperature: number;

  topP: number;

  maxTokens: number | null | undefined;

  provider: string;
}

export interface SecurityConfig {
  allowedCommands: readonly string[];

  blockedPatterns: readonly RegExp[];

  allowPipesAndRedirects: boolean;

  commandTimeout: number;
}

export interface AppConfig {
  llm: LLMConfig;

  security: SecurityConfig;

  rootDir: string;

  systemPrompt: string;
}

export interface ModelConfig {
  name: string;

  id: string;

  description: string;

  license: string;

  recommended?: boolean;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: readonly unknown[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: readonly string[];
}

export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: readonly string[];
  };
}

export interface ToolSchema {
  type: 'function';
  function: ToolFunction;
}

export interface ToolResult {
  content: string;
  isError: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  requiresConfirmation: boolean;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface CLIOptions {
  config?: string;

  verbose?: boolean;

  nonInteractive?: boolean;

  apiKey?: string;

  model?: string;

  auto?: boolean;

  dryRun?: boolean;

  yes?: boolean;

  prompt?: string;
}

export interface UserInput {
  text: string;

  cwd: string;

  timestamp: Date;
}

export const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  LLM_BASE_URL: z
    .string()
    .url({
      message: 'LLM_BASE_URL must be a valid URL',
    })
    .default('https://openrouter.ai/api/v1'),
  LLM_MODEL_NAME: z.string().default('meta-llama/llama-3.3-70b-instruct:free'),
  LLM_TEMPERATURE: z
    .string()
    .transform(Number)
    .pipe(z.number().min(0, 'Temperature must be >= 0').max(2, 'Temperature must be <= 2'))
    .default('0.1'),
  LLM_TOP_P: z
    .string()
    .transform(Number)
    .pipe(z.number().min(0, 'Top-p must be >= 0').max(1, 'Top-p must be <= 1'))
    .default('0.95'),
  LLM_PROVIDER: z.string().default('openai_compatible'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvVars = z.infer<typeof envSchema>;

export type TrustTier = 'sandbox' | 'standard' | 'trusted' | 'unrestricted';

export interface TrustTierConfig {
  name: string;
  description: string;
  allowedCommands: readonly string[];
  blockedPatterns: readonly RegExp[];
  allowPipesAndRedirects: boolean;
  requiresConfirmation: (command: string) => boolean;
}

export interface AgenticConfig {
  maxSteps: number;
  stepCounter: number;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class CommandValidationError extends AgentError {
  constructor(
    message: string,
    public readonly command: string,
  ) {
    super(message, 'COMMAND_VALIDATION_ERROR', { command });
    this.name = 'CommandValidationError';
  }
}

export class LLMError extends AgentError {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message, 'LLM_ERROR', { statusCode });
    this.name = 'LLMError';
  }
}

export class CommandExecutionError extends AgentError {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number,
  ) {
    super(message, 'COMMAND_EXECUTION_ERROR', { command, exitCode });
    this.name = 'CommandExecutionError';
  }
}
