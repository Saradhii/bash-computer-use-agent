import { OpenAI } from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import type { Config } from './config.js';
import type { Message, ToolCall, ToolSchema, AssistantMessage, ToolMessage } from './types.js';
import { LLMError } from './types.js';
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

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onToolCallDetected?: (name: string) => void;
  onComplete?: (response: LLMResponse) => void;
}

type ProviderType = 'anthropic' | 'ollama' | 'openai_compatible';

export class LLMClient {
  private readonly _client: OpenAI;
  private readonly _anthropicClient: Anthropic | null;
  private readonly _config: Config;
  private readonly _provider: ProviderType;
  private readonly _maxRetries: number = 3;
  private readonly _retryDelay: number = 1000;

  constructor(config: Config) {
    this._config = config;
    this._provider = this._detectProvider(config.llm.provider);

    if (this._provider === 'anthropic') {
      this._anthropicClient = new Anthropic({ apiKey: config.llm.apiKey });
    } else {
      this._anthropicClient = null;
    }

    this._client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      timeout: 60000,
      maxRetries: 0,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/your-username/computer-use-agent',
        'X-Title': 'Computer Use Agent',
      },
    });

    console.info(`[LLM] Initialized with model: ${config.llm.modelName}`);
    console.info(`[LLM] API endpoint: ${config.llm.baseUrl}`);
    console.info(`[LLM] Provider: ${this._provider}`);
  }

  private _detectProvider(providerStr: string): ProviderType {
    const lower = providerStr.toLowerCase();
    if (lower === 'anthropic') return 'anthropic';
    if (lower === 'ollama') return 'ollama';
    return 'openai_compatible';
  }

  async query(
    messages: MessageManager,
    tools: ToolSchema[],
    maxTokens?: number,
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    const response = await this._withRetry(() => {
      if (this._provider === 'anthropic') {
        return this._executeAnthropicQuery(messages.getMessages(), tools, maxTokens);
      }
      return this._executeQuery(messages.getMessages(), tools, maxTokens);
    });

    const responseTime = Date.now() - startTime;

    if (process.env['NODE_ENV'] === 'development') {
      console.debug(`[LLM] Response received in ${responseTime}ms`);
      console.debug(`[LLM] Finish reason: ${response.metadata.finishReason}`);
      if (response.usage) {
        console.debug(`[LLM] Token usage: ${response.usage.totalTokens} total`);
      }
    }

    return response;
  }

  async queryStream(
    messages: MessageManager,
    tools: ToolSchema[],
    callbacks: StreamCallbacks,
    maxTokens?: number,
  ): Promise<LLMResponse> {
    if (this._provider === 'ollama') {
      const response = await this.query(messages, tools, maxTokens);
      callbacks.onComplete?.(response);
      return response;
    }

    if (this._provider === 'anthropic') {
      const startTime = Date.now();

      const response = await this._withRetry(() =>
        this._executeAnthropicStreamQuery(messages.getMessages(), tools, callbacks, maxTokens),
      );

      const responseTime = Date.now() - startTime;
      if (process.env['NODE_ENV'] === 'development') {
        console.debug(`[LLM] Anthropic stream response in ${responseTime}ms`);
      }

      callbacks.onComplete?.(response);
      return response;
    }

    const startTime = Date.now();

    const response = await this._withRetry(() =>
      this._executeStreamQuery(messages.getMessages(), tools, callbacks, maxTokens),
    );

    const responseTime = Date.now() - startTime;
    if (process.env['NODE_ENV'] === 'development') {
      console.debug(`[LLM] Stream response in ${responseTime}ms`);
    }

    callbacks.onComplete?.(response);
    return response;
  }

  private async _withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (!this._isRetryableError(error) || attempt === this._maxRetries) {
          break;
        }

        console.warn(`[LLM] Query failed (attempt ${attempt}/${this._maxRetries}), retrying...`);
        console.warn(`[LLM] Error: ${error}`);

        await this._delay(this._retryDelay * Math.pow(2, attempt - 1));
      }
    }

    const errorMessage = lastError?.message || 'Unknown error occurred';
    const statusCode = this._extractStatusCode(lastError);

    throw new LLMError(
      `LLM query failed after ${this._maxRetries} attempts: ${errorMessage}`,
      statusCode || undefined,
    );
  }

  private async _executeQuery(
    messages: Message[],
    tools: ToolSchema[],
    maxTokens?: number,
  ): Promise<LLMResponse> {
    try {
      const completion = await this._client.chat.completions.create({
        model: this._config.llm.modelName,
        messages: this._mapMessages(messages),
        tools: tools.map((tool) => ({
          type: tool.type,
          function: tool.function,
        })),
        temperature: this._config.llm.temperature,
        top_p: this._config.llm.topP,
        ...(maxTokens && { max_tokens: maxTokens }),
        stream: false,
        tool_choice: 'auto',
      });

      const choice = completion.choices[0];
      if (!choice) {
        throw new LLMError('No response choices returned from LLM');
      }

      const message = choice.message;
      const toolCalls = this._parseToolCalls(message.tool_calls);

      return {
        message: message.content || '',
        toolCalls,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : null,
        metadata: {
          model: completion.model,
          finishReason: choice.finish_reason || null,
          responseTime: 0,
        },
      };
    } catch (error) {
      this._handleOpenAIError(error);
      throw error;
    }
  }

  private async _executeStreamQuery(
    messages: Message[],
    tools: ToolSchema[],
    callbacks: StreamCallbacks,
    maxTokens?: number,
  ): Promise<LLMResponse> {
    try {
      const stream = await this._client.chat.completions.create({
        model: this._config.llm.modelName,
        messages: this._mapMessages(messages),
        tools: tools.map((tool) => ({
          type: tool.type,
          function: tool.function,
        })),
        temperature: this._config.llm.temperature,
        top_p: this._config.llm.topP,
        ...(maxTokens && { max_tokens: maxTokens }),
        stream: true,
        tool_choice: 'auto',
      });

      let fullContent = '';
      const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          callbacks.onToken?.(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              });
              if (tc.function?.name) {
                callbacks.onToolCallDetected?.(tc.function.name);
              }
            } else {
              const existing = toolCallMap.get(idx)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
        }
      }

      const toolCalls: ToolCall[] = Array.from(toolCallMap.values()).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }));

      return {
        message: fullContent,
        toolCalls,
        usage: null,
        metadata: {
          model: this._config.llm.modelName,
          finishReason: null,
          responseTime: 0,
        },
      };
    } catch (error) {
      this._handleOpenAIError(error);
      throw error;
    }
  }

  private async _executeAnthropicQuery(
    messages: Message[],
    tools: ToolSchema[],
    maxTokens?: number,
  ): Promise<LLMResponse> {
    if (!this._anthropicClient) {
      throw new LLMError('Anthropic client not initialized');
    }

    const startTime = Date.now();
    const { system, messages: anthropicMessages } = this._mapMessagesToAnthropic(messages);
    const anthropicTools = this._mapToolsToAnthropic(tools);

    try {
      const response = await this._anthropicClient.messages.create({
        model: this._config.llm.modelName,
        max_tokens: maxTokens ?? 4096,
        ...(system && { system }),
        messages: anthropicMessages,
        ...(anthropicTools.length > 0 && {
          tools: anthropicTools,
          tool_choice: { type: 'auto' },
        }),
      });

      return this._parseAnthropicResponse(response, Date.now() - startTime);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(error.message, error.status ?? undefined);
      }
      throw new LLMError(
        `Anthropic query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async _executeAnthropicStreamQuery(
    messages: Message[],
    tools: ToolSchema[],
    callbacks: StreamCallbacks,
    maxTokens?: number,
  ): Promise<LLMResponse> {
    if (!this._anthropicClient) {
      throw new LLMError('Anthropic client not initialized');
    }

    const startTime = Date.now();
    const { system, messages: anthropicMessages } = this._mapMessagesToAnthropic(messages);
    const anthropicTools = this._mapToolsToAnthropic(tools);

    try {
      const stream = this._anthropicClient.messages.stream({
        model: this._config.llm.modelName,
        max_tokens: maxTokens ?? 4096,
        ...(system && { system }),
        messages: anthropicMessages,
        ...(anthropicTools.length > 0 && {
          tools: anthropicTools,
          tool_choice: { type: 'auto' },
        }),
      });

      const toolCallMap = new Map<
        string,
        { id: string; name: string; input: Record<string, unknown> }
      >();

      stream.on('text', (textDelta: string) => {
        callbacks.onToken?.(textDelta);
      });

      stream.on('contentBlock', (content: Anthropic.ContentBlock) => {
        if (content.type === 'tool_use') {
          callbacks.onToolCallDetected?.(content.name);
          toolCallMap.set(content.id, {
            id: content.id,
            name: content.name,
            input: content.input as Record<string, unknown>,
          });
        }
      });

      const finalMessage = await stream.finalMessage();

      const toolCalls: ToolCall[] = Array.from(toolCallMap.values()).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.input),
        },
      }));

      let textContent = '';
      for (const block of finalMessage.content) {
        if (block.type === 'text') {
          textContent += block.text;
        }
      }

      return {
        message: textContent,
        toolCalls,
        usage: finalMessage.usage
          ? {
              promptTokens: finalMessage.usage.input_tokens,
              completionTokens: finalMessage.usage.output_tokens,
              totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
            }
          : null,
        metadata: {
          model: finalMessage.model,
          finishReason: finalMessage.stop_reason ?? null,
          responseTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(error.message, error.status ?? undefined);
      }
      throw new LLMError(
        `Anthropic stream failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private _mapMessagesToAnthropic(messages: Message[]): {
    system: string;
    messages: Anthropic.MessageParam[];
  } {
    let system = '';
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
        continue;
      }

      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
        continue;
      }

      if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessage;
        const content: Anthropic.ContentBlockParam[] = [];

        if (assistantMsg.content) {
          content.push({ type: 'text', text: assistantMsg.content });
        }

        if (assistantMsg.tool_calls) {
          for (const tc of assistantMsg.tool_calls) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {
              // keep empty input on parse failure
            }
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
        }

        if (content.length > 0) {
          result.push({ role: 'assistant', content });
        }
        continue;
      }

      if (msg.role === 'tool') {
        const toolMsg = msg as ToolMessage;
        const toolResult: Anthropic.ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: toolMsg.tool_call_id,
          content: toolMsg.content,
        };

        const lastMsg = result[result.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'user' &&
          Array.isArray(lastMsg.content) &&
          lastMsg.content.length > 0 &&
          lastMsg.content[0]?.type === 'tool_result'
        ) {
          (lastMsg.content as Anthropic.ToolResultBlockParam[]).push(toolResult);
        } else {
          result.push({
            role: 'user',
            content: [toolResult],
          });
        }
      }
    }

    return { system, messages: result };
  }

  private _mapToolsToAnthropic(tools: ToolSchema[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.function.parameters.properties as Record<
          string,
          Anthropic.Tool.InputSchema['properties'] extends Record<string, infer V> ? V : never
        >,
        required: [...tool.function.parameters.required],
      },
    }));
  }

  private _parseAnthropicResponse(response: Anthropic.Message, responseTime: number): LLMResponse {
    let message = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        message += block.text;
      }
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      message,
      toolCalls,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : null,
      metadata: {
        model: response.model,
        finishReason: response.stop_reason ?? null,
        responseTime,
      },
    };
  }

  private _mapMessages(messages: Message[]) {
    return messages.map((m) => {
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
            tool_calls: assistantMsg.tool_calls.map((tc) => ({
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

      throw new Error(`Unknown message role: ${(m as Record<string, unknown>)['role'] as string}`);
    });
  }

  private _parseToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
  ): ToolCall[] {
    if (!toolCalls) return [];

    return toolCalls.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  private _handleOpenAIError(error: unknown): void {
    if (error instanceof Error) {
      const openaiError = error as { status?: number };
      if (openaiError.status) {
        throw new LLMError(error.message, openaiError.status);
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
  }

  private _isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      if (
        error.name === 'APIConnectionError' ||
        error.name === 'FetchError' ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
      ) {
        return true;
      }

      if (error.name === 'RateLimitError') {
        return true;
      }

      if (error instanceof LLMError) {
        const code = error.statusCode;
        if (code && code >= 500 && code < 600) return true;
        if (code === 429) return true;
      }

      const statusCode = this._extractStatusCode(error);
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        return true;
      }
    }

    return false;
  }

  private _extractStatusCode(error: unknown): number | null {
    if (error && typeof error === 'object') {
      const statusError = error as { status?: number };
      if ('status' in statusError) {
        return statusError.status;
      }

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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this._provider === 'anthropic' && this._anthropicClient) {
        const response = await this._anthropicClient.messages.create({
          model: this._config.llm.modelName,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Respond with just "OK"' }],
        });
        const textBlock = response.content[0];
        return textBlock?.type === 'text' && textBlock.text.includes('OK');
      }

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

      return (
        response.choices.length > 0 && response.choices[0]!.message.content?.includes('OK') === true
      );
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
    return Math.ceil(text.length / 4);
  }
}
