import type {
  Message,
  MessageRole,
  BaseMessage,
  AssistantMessage,
  ToolMessage,
  ToolCall,
  SystemMessage,
  UserMessage
} from './types.js';

const CONTEXT_SEPARATOR = 'ς';

export class MessageManager {
  private _systemMessage: BaseMessage | null = null;
  private _messages: Message[] = [];
  private _maxMessages: number;

  constructor(systemPrompt: string = '', maxMessages: number = 50) {
    this._maxMessages = maxMessages;
    if (systemPrompt) {
      this.setSystemMessage(systemPrompt);
    }
  }

  setSystemMessage(message: string): void {
    this._systemMessage = {
      role: 'system',
      content: message,
    };
  }

  getSystemMessage(): BaseMessage | null {
    return this._systemMessage;
  }

  addUserMessage(content: string, metadata?: Record<string, unknown>): void {
    const message: UserMessage = {
      role: 'user',
      content,
    };

    this._messages.push(message);
    this.trimMessages();
  }

  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    const message: AssistantMessage = {
      role: 'assistant',
      content,
      ...(toolCalls && { tool_calls: toolCalls }),
    };

    this._messages.push(message);
    this.trimMessages();
  }

  addToolMessage(content: string, toolCallId: string): void {
    const message: ToolMessage = {
      role: 'tool',
      content,
      tool_call_id: toolCallId,
    };

    this._messages.push(message);
    this.trimMessages();
  }

  getMessages(): Message[] {
    if (!this._systemMessage) {
      return this._messages;
    }

    return this._systemMessage ? [{ ...this._systemMessage, role: 'system' as const }, ...this._messages] : this._messages;
  }

  getLastMessages(count: number): Message[] {
    return this._messages.slice(-count);
  }

  getLastUserMessage(): UserMessage | null {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const message = this._messages[i];
      if (message && message.role === 'user') {
        return message as UserMessage;
      }
    }
    return null;
  }

  getLastAssistantMessage(): AssistantMessage | null {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const message = this._messages[i];
      if (message && message.role === 'assistant') {
        return message as AssistantMessage;
      }
    }
    return null;
  }

  getAllToolCalls(): ToolCall[] {
    const allToolCalls: ToolCall[] = [];

    for (const message of this._messages) {
      if (message.role === 'assistant') {
        const toolCalls = message.tool_calls || message.toolCalls;
        if (toolCalls) {
          allToolCalls.push(...toolCalls);
        }
      }
    }

    return allToolCalls;
  }

  getMessageCounts(): Record<MessageRole, number> {
    const counts = {
      system: 0,
      user: 0,
      assistant: 0,
      tool: 0,
    };

    if (this._systemMessage) {
      counts.system = 1;
    }

    for (const message of this._messages) {
      counts[message.role]++;
    }

    return counts;
  }

  hasPendingToolCalls(): boolean {
    const lastMessage = this._messages[this._messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return false;
    }

    const toolCalls = lastMessage.tool_calls || lastMessage.toolCalls;
    return toolCalls ? toolCalls.length > 0 : false;
  }

  clearMessages(): void {
    this._messages = [];
  }

  reset(): void {
    this._systemMessage = null;
    this._messages = [];
  }

  private trimMessages(): void {
    if (this._messages.length <= this._maxMessages) {
      return;
    }

    // Keep the last maxMessages messages
    // Always try to keep conversation pairs (user-assistant) intact
    const excess = this._messages.length - this._maxMessages;

    // Find a good cutoff point (preferably after a user message)
    let cutoff = excess;
    for (let i = excess; i < this._messages.length - 1; i++) {
      const message = this._messages[i];
      if (message && message.role === 'user') {
        cutoff = i + 1;
        break;
      }
    }

    // Remove excess messages from the beginning
    this._messages = this._messages.slice(cutoff);

    // Add context separator to indicate trimming occurred (NVIDIA's approach)
    if (this._messages.length > 0 && this._messages[0]?.role === 'user') {
      // Add separator as a system message to indicate context break
      this._messages.unshift({
        role: 'system',
        content: `${CONTEXT_SEPARATOR} Context trimmed: ${excess} messages removed to maintain conversation history ${CONTEXT_SEPARATOR}`
      });
    }
  }

  exportConversation(): string {
    return JSON.stringify({
      systemMessage: this._systemMessage,
      messages: this._messages,
      timestamp: new Date().toISOString(),
      messageCount: this._messages.length,
    }, null, 2);
  }

  importConversation(json: string): void {
    try {
      const data = JSON.parse(json);

      if (data.systemMessage) {
        this._systemMessage = data.systemMessage;
      }

      if (Array.isArray(data.messages)) {
        this._messages = data.messages;
      }

      // Trim messages if needed after import
      this.trimMessages();
    } catch (error) {
      throw new Error(`Failed to import conversation: ${error}`);
    }
  }

  getStats(): {
    totalMessages: number;
    messageCounts: Record<MessageRole, number>;
    totalToolCalls: number;
    hasSystemMessage: boolean;
  } {
    return {
      totalMessages: this._messages.length,
      messageCounts: this.getMessageCounts(),
      totalToolCalls: this.getAllToolCalls().length,
      hasSystemMessage: !!this._systemMessage,
    };
  }

  getLastResponse(): string | null {
    const lastAssistant = this.getLastAssistantMessage();
    if (!lastAssistant) {
      return null;
    }

    // Filter out the /think part if present
    let content = lastAssistant.content;
    if (content.startsWith('/think')) {
      content = content.substring(5).trim();
    }

    return content || null;
  }

  isEmpty(): boolean {
    return this._messages.length === 0 ||
           !this._messages.some(m => m.role === 'user');
  }
}