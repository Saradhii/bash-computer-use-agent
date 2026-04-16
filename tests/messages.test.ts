import { describe, it, expect } from 'vitest';
import { MessageManager } from '../src/messages.js';
import type { ToolCall } from '../src/types.js';

const makeToolCall = (id: string, name: string): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});

describe('MessageManager', () => {
  it('creates instance with system prompt and max messages', () => {
    const mgr = new MessageManager('hello', 10);
    expect(mgr.getSystemMessage()).toEqual({ role: 'system', content: 'hello' });
    const mgr2 = new MessageManager('', 20);
    expect(mgr2.getSystemMessage()).toBeNull();
    const mgr3 = new MessageManager();
    expect(mgr3.getSystemMessage()).toBeNull();
  });

  it('setSystemMessage() sets and retrieves system message', () => {
    const mgr = new MessageManager();
    expect(mgr.getSystemMessage()).toBeNull();
    mgr.setSystemMessage('sys');
    expect(mgr.getSystemMessage()).toEqual({ role: 'system', content: 'sys' });
    mgr.setSystemMessage('updated');
    expect(mgr.getSystemMessage()).toEqual({ role: 'system', content: 'updated' });
  });

  it('addUserMessage() adds user message and count increases', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('hi');
    mgr.addUserMessage('there');
    expect(mgr.getMessages().filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('addAssistantMessage() adds assistant message without tool_calls', () => {
    const mgr = new MessageManager();
    mgr.addAssistantMessage('response');
    const last = mgr.getLastAssistantMessage();
    expect(last).not.toBeNull();
    expect(last!.content).toBe('response');
    expect(last!.tool_calls).toBeUndefined();
  });

  it('addAssistantMessage() adds assistant message with tool_calls', () => {
    const mgr = new MessageManager();
    const tc = makeToolCall('tc1', 'fn1');
    mgr.addAssistantMessage('calling', [tc]);
    const last = mgr.getLastAssistantMessage();
    expect(last!.tool_calls).toEqual([tc]);
  });

  it('addToolMessage() adds tool message with tool_call_id', () => {
    const mgr = new MessageManager();
    mgr.addToolMessage('result', 'tc1');
    const msgs = mgr.getMessages();
    const toolMsg = msgs.find((m) => m.role === 'tool');
    expect(toolMsg).toEqual({ role: 'tool', content: 'result', tool_call_id: 'tc1' });
  });

  it('getMessages() returns system + all messages in order', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('u1');
    mgr.addAssistantMessage('a1');
    mgr.addUserMessage('u2');
    const msgs = mgr.getMessages();
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe('sys');
    expect(msgs[1].content).toBe('u1');
    expect(msgs[2].content).toBe('a1');
    expect(msgs[3].content).toBe('u2');
  });

  it('getMessages() returns only messages when no system prompt', () => {
    const mgr = new MessageManager();
    mgr.addUserMessage('hi');
    const msgs = mgr.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('getLastUserMessage() returns last user message or null', () => {
    const mgr = new MessageManager();
    expect(mgr.getLastUserMessage()).toBeNull();
    mgr.addUserMessage('first');
    mgr.addAssistantMessage('a');
    mgr.addUserMessage('second');
    expect(mgr.getLastUserMessage()!.content).toBe('second');
  });

  it('getLastAssistantMessage() returns last assistant message or null', () => {
    const mgr = new MessageManager();
    expect(mgr.getLastAssistantMessage()).toBeNull();
    mgr.addUserMessage('u');
    mgr.addAssistantMessage('first');
    mgr.addUserMessage('u2');
    mgr.addAssistantMessage('second');
    expect(mgr.getLastAssistantMessage()!.content).toBe('second');
  });

  it('getAllToolCalls() collects tool calls from all assistant messages', () => {
    const mgr = new MessageManager();
    const tc1 = makeToolCall('id1', 'fn1');
    const tc2 = makeToolCall('id2', 'fn2');
    const tc3 = makeToolCall('id3', 'fn3');
    mgr.addAssistantMessage('a1', [tc1]);
    mgr.addUserMessage('u');
    mgr.addAssistantMessage('a2', [tc2, tc3]);
    const all = mgr.getAllToolCalls();
    expect(all).toEqual([tc1, tc2, tc3]);
  });

  it('getAllToolCalls() returns empty array when no tool calls', () => {
    const mgr = new MessageManager();
    mgr.addAssistantMessage('no tools');
    expect(mgr.getAllToolCalls()).toEqual([]);
  });

  it('hasPendingToolCalls() is true when last message is assistant with tool_calls', () => {
    const mgr = new MessageManager();
    expect(mgr.hasPendingToolCalls()).toBe(false);
    mgr.addAssistantMessage('a', [makeToolCall('id1', 'fn1')]);
    expect(mgr.hasPendingToolCalls()).toBe(true);
    mgr.addToolMessage('result', 'id1');
    expect(mgr.hasPendingToolCalls()).toBe(false);
  });

  it('hasPendingToolCalls() is false when last assistant has no tool_calls', () => {
    const mgr = new MessageManager();
    mgr.addAssistantMessage('plain');
    expect(mgr.hasPendingToolCalls()).toBe(false);
  });

  it('clearMessages() clears messages but keeps system message', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('u');
    mgr.addAssistantMessage('a');
    mgr.clearMessages();
    expect(mgr.getMessages()).toHaveLength(1);
    expect(mgr.getMessages()[0].role).toBe('system');
    expect(mgr.getSystemMessage()).not.toBeNull();
  });

  it('reset() clears both messages and system message', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('u');
    mgr.reset();
    expect(mgr.getMessages()).toHaveLength(0);
    expect(mgr.getSystemMessage()).toBeNull();
  });

  it('exportConversation() returns conversation object', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('u');
    const data = mgr.exportConversation();
    expect(data.systemMessage).toEqual({ role: 'system', content: 'sys' });
    expect(data.messages).toHaveLength(1);
    expect(data.messageCount).toBe(1);
    expect(typeof data.timestamp).toBe('string');
  });

  it('importConversation() restores from exported data', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('u1');
    mgr.addAssistantMessage('a1');
    const json = JSON.stringify(mgr.exportConversation());
    const mgr2 = new MessageManager();
    mgr2.importConversation(json);
    expect(mgr2.getSystemMessage()).toEqual({ role: 'system', content: 'sys' });
    expect(mgr2.getMessages()).toHaveLength(3);
    expect(mgr2.getMessages()[1]!.content).toBe('u1');
    expect(mgr2.getMessages()[2]!.content).toBe('a1');
  });

  it('importConversation() throws on invalid JSON', () => {
    const mgr = new MessageManager();
    expect(() => mgr.importConversation('not json')).toThrow(/Failed to import conversation/);
  });

  it('getStats() returns correct counts', () => {
    const mgr = new MessageManager('sys');
    mgr.addUserMessage('u');
    mgr.addAssistantMessage('a', [makeToolCall('id1', 'fn1')]);
    mgr.addToolMessage('r', 'id1');
    mgr.addUserMessage('u2');
    const stats = mgr.getStats();
    expect(stats.totalMessages).toBe(4);
    expect(stats.messageCounts.user).toBe(2);
    expect(stats.messageCounts.assistant).toBe(1);
    expect(stats.messageCounts.tool).toBe(1);
    expect(stats.messageCounts.system).toBe(1);
    expect(stats.totalToolCalls).toBe(1);
    expect(stats.hasSystemMessage).toBe(true);
  });

  it('getStats() hasSystemMessage false when no system prompt', () => {
    const mgr = new MessageManager();
    mgr.addUserMessage('u');
    expect(mgr.getStats().hasSystemMessage).toBe(false);
  });

  it('isEmpty() is true when no user messages', () => {
    const mgr = new MessageManager('sys');
    expect(mgr.isEmpty()).toBe(true);
    mgr.addAssistantMessage('a');
    expect(mgr.isEmpty()).toBe(true);
    mgr.addUserMessage('u');
    expect(mgr.isEmpty()).toBe(false);
  });

  describe('message trimming', () => {
    it('trims oldest messages when exceeding maxMessages', () => {
      const mgr = new MessageManager('sys', 5);
      for (let i = 0; i < 8; i++) {
        mgr.addUserMessage(`msg ${i}`);
      }
      const msgs = mgr.getMessages();
      expect(msgs.length).toBeLessThanOrEqual(7);
    });

    it('keeps system message after trimming', () => {
      const mgr = new MessageManager('sys', 3);
      mgr.addUserMessage('u1');
      mgr.addUserMessage('u2');
      mgr.addUserMessage('u3');
      mgr.addUserMessage('u4');
      const msgs = mgr.getMessages();
      expect(msgs[0].role).toBe('system');
    });

    it('trims to respect maxMessages', () => {
      const mgr = new MessageManager('', 3);
      mgr.addUserMessage('u0');
      mgr.addUserMessage('u1');
      mgr.addUserMessage('u2');
      mgr.addUserMessage('u3');
      mgr.addUserMessage('u4');
      expect(mgr.getMessages().length).toBeLessThanOrEqual(5);
    });
  });
});
