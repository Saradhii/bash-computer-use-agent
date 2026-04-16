import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { TEMP_HOME } = vi.hoisted(() => ({
  TEMP_HOME: `/tmp/cua-test-home-${process.pid}`,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => TEMP_HOME };
});

import { SessionManager } from '../src/session-manager.js';
import type { SessionData } from '../src/session-manager.js';

const SESSIONS_DIR = join(TEMP_HOME, '.cua', 'sessions');
const manager = new SessionManager();

beforeAll(async () => {
  await rm(TEMP_HOME, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(TEMP_HOME, { recursive: true, force: true });
});

function makeData(overrides: Partial<SessionData['meta']> = {}): SessionData {
  return {
    meta: {
      id: 'test',
      name: 'Test Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 5,
      model: 'gpt-4',
      trustTier: 'full',
      ...overrides,
    },
    messages: [{ role: 'user', content: 'hello' }],
  };
}

describe('SessionManager', () => {
  describe('generateId', () => {
    it('produces IDs matching the expected format', () => {
      const id = manager.generateId();
      expect(id).toMatch(/^session-\d+-[a-z0-9]+$/);
    });

    it('generates unique values on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => manager.generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('save and load', () => {
    it('round-trips session data faithfully', async () => {
      const id = manager.generateId();
      const data = makeData({ id });
      await manager.save(id, 'Test Session', data);

      const loaded = await manager.load(id);
      expect(loaded).not.toBeNull();
      expect(loaded!.meta.id).toBe(id);
      expect(loaded!.meta.name).toBe('Test Session');
      expect(loaded!.meta.messageCount).toBe(5);
      expect(loaded!.meta.model).toBe('gpt-4');
      expect(loaded!.meta.trustTier).toBe('full');
      expect(loaded!.messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('returns null for a non-existent session', async () => {
      expect(await manager.load('does-not-exist')).toBeNull();
    });

    it('overwrites updatedAt with the current timestamp', async () => {
      const id = manager.generateId();
      const past = '2000-01-01T00:00:00.000Z';
      const data = makeData({ id, updatedAt: past });
      await manager.save(id, 'Old', data);

      const loaded = await manager.load(id);
      expect(loaded!.meta.updatedAt).not.toBe(past);
      expect(new Date(loaded!.meta.updatedAt).getTime()).toBeGreaterThan(new Date(past).getTime());
    });

    it('creates the sessions directory when it does not exist', async () => {
      await rm(TEMP_HOME, { recursive: true, force: true });
      const id = manager.generateId();
      await manager.save(id, 'New', makeData({ id }));
      const loaded = await manager.load(id);
      expect(loaded).not.toBeNull();
    });

    it('persists across multiple saves to the same ID', async () => {
      const id = manager.generateId();
      const first = makeData({ id, messageCount: 1 });
      await manager.save(id, 'First', first);

      const second = makeData({ id, messageCount: 10, model: 'claude-3' });
      await manager.save(id, 'Second', second);

      const loaded = await manager.load(id);
      expect(loaded!.meta.messageCount).toBe(10);
      expect(loaded!.meta.model).toBe('claude-3');
    });
  });

  describe('list', () => {
    it('returns an empty array when the sessions directory is absent', async () => {
      await rm(SESSIONS_DIR, { recursive: true, force: true });
      expect(await manager.list()).toEqual([]);
    });

    it('returns sessions sorted by updatedAt descending', async () => {
      await rm(SESSIONS_DIR, { recursive: true, force: true });

      const ids = [manager.generateId(), manager.generateId(), manager.generateId()];
      for (const id of ids) {
        await manager.save(id, `Session ${id}`, makeData({ id }));
        await new Promise((r) => setTimeout(r, 10));
      }

      const sessions = await manager.list();
      const listed = sessions.filter((s) => ids.includes(s.id));
      expect(listed).toHaveLength(3);
      expect(listed[0].id).toBe(ids[2]);
      expect(listed[1].id).toBe(ids[1]);
      expect(listed[2].id).toBe(ids[0]);
    });

    it('skips files containing invalid JSON', async () => {
      const id = manager.generateId();
      await manager.save(id, 'Valid', makeData({ id }));
      await writeFile(join(SESSIONS_DIR, 'corrupt.json'), 'not json', 'utf-8');

      const sessions = await manager.list();
      expect(sessions.find((s) => s.id === id)).toBeDefined();
      expect(sessions.find((s) => s.id === 'corrupt')).toBeUndefined();
    });

    it('ignores non-json files in the sessions directory', async () => {
      await rm(SESSIONS_DIR, { recursive: true, force: true });

      const id = manager.generateId();
      await manager.save(id, 'Valid', makeData({ id }));
      await writeFile(join(SESSIONS_DIR, 'notes.txt'), 'ignore me', 'utf-8');

      const sessions = await manager.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(id);
    });
  });

  describe('delete', () => {
    it('removes an existing session and returns true', async () => {
      const id = manager.generateId();
      await manager.save(id, 'ToDelete', makeData({ id }));
      expect(await manager.delete(id)).toBe(true);
      expect(await manager.load(id)).toBeNull();
    });

    it('returns false for a non-existent session', async () => {
      expect(await manager.delete('no-such-session')).toBe(false);
    });

    it('removes the session from subsequent list results', async () => {
      const id = manager.generateId();
      await manager.save(id, 'Temporary', makeData({ id }));
      await manager.delete(id);
      const sessions = await manager.list();
      expect(sessions.find((s) => s.id === id)).toBeUndefined();
    });
  });
});
