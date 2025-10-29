/**
 * Message management for LLM conversations
 * Handles conversation history, message formatting, and context management
 * Based on NVIDIA's implementation with context trimming support
 */

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

/**
 * Context trimming separator (NVIDIA's approach)
 * Uses special character ς to mark context boundaries
 */
const CONTEXT_SEPARATOR = 'ς';

/**
 * Message manager class for maintaining conversation state
 * Provides type-safe message handling and conversation context
 */
export class MessageManager {
  private _systemMessage: BaseMessage | null = null;
  private _messages: Message[] = [];
  private _maxMessages: number;

  /**
   * Initialize the message manager
   * @param systemPrompt - System message to set the context
   * @param maxMessages - Maximum number of messages to retain (default: 50)
   */
  constructor(systemPrompt: string = '', maxMessages: number = 50) {
    this._maxMessages = maxMessages;
    if (systemPrompt) {
      this.setSystemMessage(systemPrompt);
    }
  }

  /**
   * Set or update the system message
   * @param message - System message content
   */
  setSystemMessage(message: string): void {
    this._systemMessage = {
      role: 'system',
      content: message,
    };
  }

  /**
   * Get the current system message
   * @returns System message or null if not set
   */
  getSystemMessage(): BaseMessage | null {
    return this._systemMessage;
  }

  /**
   * Add a user message to the conversation
   * @param content - User message content
   * @param metadata - Optional metadata for the message
   */
  addUserMessage(content: string, metadata?: Record<string, unknown>): void {
    const message: UserMessage = {
      role: 'user',
      content,
    };

    this._messages.push(message);
    this.trimMessages();
  }

  /**
   * Add an assistant message to the conversation
   * @param content - Assistant message content
   * @param toolCalls - Optional tool calls made by the assistant
   */
  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    const message: AssistantMessage = {
      role: 'assistant',
      content,
      ...(toolCalls && { tool_calls: toolCalls }),
    };

    this._messages.push(message);
    this.trimMessages();
  }

  /**
   * Add a tool result message to the conversation
   * @param content - Tool result content
   * @param toolCallId - ID of the tool call this result belongs to
   */
  addToolMessage(content: string, toolCallId: string): void {
    const message: ToolMessage = {
      role: 'tool',
      content,
      tool_call_id: toolCallId,
    };

    this._messages.push(message);
    this.trimMessages();
  }

  /**
   * Get all messages formatted for API consumption
   * @returns Array of messages with system message included
   */
  getMessages(): Message[] {
    if (!this._systemMessage) {
      return this._messages;
    }

    return this._systemMessage ? [{ ...this._systemMessage, role: 'system' as const }, ...this._messages] : this._messages;
  }

  /**
   * Get the last n messages from the conversation
   * @param count - Number of messages to retrieve
   * @returns Array of the last n messages
   */
  getLastMessages(count: number): Message[] {
    return this._messages.slice(-count);
  }

  /**
   * Get the most recent user message
   * @returns Last user message or null if none exists
   */
  getLastUserMessage(): UserMessage | null {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const message = this._messages[i];
      if (message && message.role === 'user') {
        return message as UserMessage;
      }
    }
    return null;
  }

  /**
   * Get the most recent assistant message
   * @returns Last assistant message or null if none exists
   */
  getLastAssistantMessage(): AssistantMessage | null {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const message = this._messages[i];
      if (message && message.role === 'assistant') {
        return message as AssistantMessage;
      }
    }
    return null;
  }

  /**
   * Get all tool calls in the conversation
   * @returns Array of all tool calls made
   */
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

  /**
   * Count messages by role
   * @returns Object with message counts by role
   */
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

  /**
   * Check if the conversation has tool calls awaiting results
   * @returns True if there are pending tool calls
   */
  hasPendingToolCalls(): boolean {
    const lastMessage = this._messages[this._messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return false;
    }

    const toolCalls = lastMessage.tool_calls || lastMessage.toolCalls;
    return toolCalls ? toolCalls.length > 0 : false;
  }

  /**
   * Clear all messages except the system message
   */
  clearMessages(): void {
    this._messages = [];
  }

  /**
   * Clear the entire conversation including system message
   */
  reset(): void {
    this._systemMessage = null;
    this._messages = [];
  }

  /**
   * Trim messages to stay within the maximum limit
   * Uses NVIDIA's context trimming approach with special separator
   * Preserves important context by keeping system and recent messages
   * @private
   */
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

  /**
   * Export conversation to JSON for debugging or persistence
   * @returns JSON string representation of the conversation
   */
  exportConversation(): string {
    return JSON.stringify({
      systemMessage: this._systemMessage,
      messages: this._messages,
      timestamp: new Date().toISOString(),
      messageCount: this._messages.length,
    }, null, 2);
  }

  /**
   * Import conversation from JSON
   * @param json - JSON string representation of conversation
   * @throws {Error} If JSON is invalid
   */
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

  /**
   * Get conversation statistics
   * @returns Statistics about the conversation
   */
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

  /**
   * Format the last assistant response for display
   * @returns Formatted response string or null
   */
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

  /**
   * Check if the conversation is empty (no user messages)
   * @returns True if no user messages have been sent
   */
  isEmpty(): boolean {
    return this._messages.length === 0 ||
           !this._messages.some(m => m.role === 'user');
  }
}