import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const SESSIONS_DIR = join(homedir(), '.cua', 'sessions');

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model: string;
  trustTier: string;
}

export interface SessionData {
  meta: SessionMeta;
  messages: {
    systemMessage: unknown;
    messages: unknown[];
    timestamp: string;
    messageCount: number;
  };
}

export class SessionManager {
  async save(sessionId: string, name: string, data: SessionData): Promise<void> {
    if (!existsSync(SESSIONS_DIR)) {
      await mkdir(SESSIONS_DIR, { recursive: true });
    }

    data.meta.updatedAt = new Date().toISOString();

    const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<SessionData | null> {
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as SessionData;
    } catch {
      return null;
    }
  }

  async list(): Promise<SessionMeta[]> {
    if (!existsSync(SESSIONS_DIR)) return [];

    try {
      const files = await readdir(SESSIONS_DIR);
      const sessions: SessionMeta[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(join(SESSIONS_DIR, file), 'utf-8');
          const data = JSON.parse(content) as SessionData;
          sessions.push(data.meta);
        } catch {
          // skip corrupt files
        }
      }

      return sessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return false;

    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
    return true;
  }

  generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
