import type { Message } from './types.js';
import type { LLMClient, LLMResponse } from './llm.js';
import { MessageManager } from './messages.js';

const SUMMARY_PREFIX = '[Previous conversation summary]';

const FALLBACK_USER_MESSAGE_LIMIT = 5;

const SUMMARIZATION_PROMPT = `Summarize the following conversation in 3-5 bullet points. Your summary must:
- Note any files that were read, created, or modified
- Note the current task/goal
- Note any decisions made
- Keep it under 200 words

Conversation:
`;

export class ContextSummarizer {
  private readonly _llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this._llmClient = llmClient;
  }

  async summarize(messages: Message[]): Promise<string> {
    try {
      const conversationText = this._formatMessages(messages);
      const messageManager = new MessageManager(SUMMARIZATION_PROMPT);
      messageManager.addUserMessage(conversationText);

      const response: LLMResponse = await this._llmClient.query(messageManager, [], 500);

      const summary = response.message.trim();
      if (!summary) {
        return this._fallbackSummary(messages);
      }

      return `${this.getSummaryPrefix()}\n${summary}`;
    } catch {
      return this._fallbackSummary(messages);
    }
  }

  shouldSummarize(messageCount: number, maxMessages: number): boolean {
    return messageCount > maxMessages * 0.8;
  }

  getSummaryPrefix(): string {
    return SUMMARY_PREFIX;
  }

  private _formatMessages(messages: Message[]): string {
    return messages
      .map((msg) => {
        const role = msg.role.toUpperCase();
        const content =
          msg.content.length > 500 ? msg.content.substring(0, 500) + '...[truncated]' : msg.content;
        return `${role}: ${content}`;
      })
      .join('\n\n');
  }

  private _fallbackSummary(messages: Message[]): string {
    const userMessages = messages
      .filter((msg) => msg.role === 'user')
      .slice(-FALLBACK_USER_MESSAGE_LIMIT)
      .map((msg) => `- ${msg.content.substring(0, 200)}`);

    const userLines =
      userMessages.length > 0 ? userMessages.join('\n') : '- No user messages available';

    return `${this.getSummaryPrefix()}\nContext was trimmed.\nRecent user messages:\n${userLines}`;
  }
}
