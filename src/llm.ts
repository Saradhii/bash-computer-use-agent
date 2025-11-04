import { OpenAI } from 'openai';
import type { Config } from './config.js';
import type {
  Message,
  ToolCall,
  ToolSchema,
  AssistantMessage,
  ToolMessage
} from './types.js';
import {
  LLMError
} from './types.js';
import { MessageManager } from './messages.js';

export interface LLMResponse {
  
  message: string;
  
  toolCalls: ToolCall[];
  
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  
  metadata: {
    model: string;
    finishReason: string | null;
    responseTime: number;
  };
}

export class LLMClient {
  private readonly _client: OpenAI;
  private readonly _config: Config;
  private readonly _maxRetries: number = 3;
  private readonly _retryDelay: number = 1000; // 1 second

  constructor(config: Config) {
    this._config = config;

    // Initialize OpenAI client with custom configuration
    this._client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      timeout: 60000, // 60 seconds timeout
      maxRetries: 0, // We'll handle retries ourselves
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/your-username/computer-use-agent',
        'X-Title': 'Computer Use Agent',
      },
    });

    // Log configuration info (without exposing sensitive data)
    console.info(`[LLM] Initialized with model: ${config.llm.modelName}`);
    console.info(`[LLM] API endpoint: ${config.llm.baseUrl}`);
  }

  async query(
    messages: MessageManager,
    tools: ToolSchema[],
    maxTokens?: number
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    // Retry logic for transient errors
    for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
      try {
        const response = await this._executeQuery(
          messages.getMessages(),
          tools,
          maxTokens
        );

        const responseTime = Date.now() - startTime;

        // Log response info in development
        if (process.env['NODE_ENV'] === 'development') {
          console.debug(`[LLM] Response received in ${responseTime}ms`);
          console.debug(`[LLM] Finish reason: ${response.metadata.finishReason}`);
          if (response.usage) {
            console.debug(`[LLM] Token usage: ${response.usage.totalTokens} total`);
          }
        }

        return response;
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this._isRetryableError(error) || attempt === this._maxRetries) {
          break;
        }

        // Log retry attempt
        console.warn(`[LLM] Query failed (attempt ${attempt}/${this._maxRetries}), retrying...`);
        console.warn(`[LLM] Error: ${error}`);

        // Wait before retrying with exponential backoff
        await this._delay(this._retryDelay * Math.pow(2, attempt - 1));
      }
    }

    // All retries failed
    const errorMessage = lastError?.message || 'Unknown error occurred';
    const statusCode = this._extractStatusCode(lastError);

    throw new LLMError(
      `LLM query failed after ${this._maxRetries} attempts: ${errorMessage}`,
      statusCode || undefined
    );
  }

  private async _executeQuery(
    messages: Message[],
    tools: ToolSchema[],
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const completion = await this._client.chat.completions.create({
        model: this._config.llm.modelName,
        messages: messages.map(m => {
          if (m.role === 'system') {
            return { role: 'system' as const, content: m.content };
          }

          if (m.role === 'user') {
            return { role: 'user' as const, content: m.content };
          }

          if (m.role === 'assistant') {
            const assistantMsg = m as AssistantMessage;
            const baseMessage = {
              role: 'assistant' as const,
              content: m.content,
            };

            if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
              return {
                ...baseMessage,
                tool_calls: assistantMsg.tool_calls.map(tc => ({
                  id: tc.id,
                  type: tc.type as 'function',
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                  },
                })),
              };
            }

            return baseMessage;
          }

          if (m.role === 'tool') {
            const toolMsg = m as ToolMessage;
            return {
              role: 'tool' as const,
              content: m.content,
              tool_call_id: toolMsg.tool_call_id,
            };
          }

          // This should never happen with proper typing
          throw new Error(`Unknown message role: ${(m as any).role}`);
        }),
        tools: tools.map(tool => ({
          type: tool.type,
          function: tool.function,
        })),
        temperature: this._config.llm.temperature,
        top_p: this._config.llm.topP,
        ...(maxTokens && { max_tokens: maxTokens }),
        stream: false,
        // Enable function calling
        tool_choice: 'auto',
      });

      const choice = completion.choices[0];
      if (!choice) {
        throw new LLMError('No response choices returned from LLM');
      }

      const message = choice.message;
      const toolCalls: ToolCall[] = [];

      // Parse tool calls if present
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          toolCalls.push({
            id: toolCall.id,
            type: toolCall.type,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          });
        }
      }

      return {
        message: message.content || '',
        toolCalls,
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : null,
        metadata: {
          model: completion.model,
          finishReason: choice.finish_reason || null,
          responseTime: 0, // Will be set by caller
        },
      };
    } catch (error) {
      // Transform OpenAI errors to our custom error type
      if (error instanceof Error) {
        // Check for specific OpenAI error types
        const openaiError = error as { status?: number };
        if (openaiError.status) {
          throw new LLMError(
            error.message,
            openaiError.status
          );
        }

        if (error.name === 'APIConnectionError') {
          throw new LLMError('Failed to connect to LLM API', 503);
        }

        if (error.name === 'AuthenticationError') {
          throw new LLMError('Invalid API key', 401);
        }

        if (error.name === 'RateLimitError') {
          throw new LLMError('Rate limit exceeded', 429);
        }
      }

      throw error;
    }
  }

  private _isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors
      if (error.name === 'APIConnectionError' ||
          error.name === 'FetchError' ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT')) {
        return true;
      }

      // Rate limit errors (with retry-after header)
      if (error.name === 'RateLimitError') {
        return true;
      }

      // Server errors (5xx)
      const statusCode = this._extractStatusCode(error);
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        return true;
      }
    }

    return false;
  }

  private _extractStatusCode(error: unknown): number | null {
    if (error && typeof error === 'object') {
      // OpenAI errors
      const statusError = error as { status?: number };
      if ('status' in statusError) {
        return statusError.status;
      }

      // Fetch errors
      const causeError = error as { cause?: { status?: number } };
      if (causeError.cause && typeof causeError.cause === 'object') {
        if ('status' in causeError.cause) {
          return causeError.cause.status;
        }
      }
    }

    return null;
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this._client.chat.completions.create({
        model: this._config.llm.modelName,
        messages: [
          {
            role: 'user',
            content: 'Respond with just "OK"',
          },
        ],
        max_tokens: 10,
      });

      return response.choices.length > 0 &&
             response.choices[0]!.message.content?.includes('OK') === true;
    } catch (error) {
      console.error('[LLM] Connection test failed:', error);
      return false;
    }
  }

  getModelInfo(): {
    name: string;
    endpoint: string;
    temperature: number;
    topP: number;
  } {
    return {
      name: this._config.llm.modelName,
      endpoint: this._config.llm.baseUrl,
      temperature: this._config.llm.temperature,
      topP: this._config.llm.topP,
    };
  }

  estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token
    // This is not exact but good enough for estimates
    return Math.ceil(text.length / 4);
  }

  estimateConversationTokens(messages: Message[]): number {
    let totalTokens = 0;

    for (const message of messages) {
      totalTokens += this.estimateTokens(message.content);

      // Add tokens for tool calls if present
      if ('tool_calls' in message && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          totalTokens += this.estimateTokens(toolCall.function.name);
          totalTokens += this.estimateTokens(toolCall.function.arguments);
        }
      }
    }

    return totalTokens;
  }
}