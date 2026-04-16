import { execa } from 'execa';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface Snapshot {
  id: string;
  message: string;
  timestamp: string;
  filesChanged: number;
}

export class UndoManager {
  private readonly _rootDir: string;
  private readonly _snapshots: Snapshot[] = [];
  private _initialized: boolean = false;

  constructor(rootDir: string) {
    this._rootDir = rootDir;
  }

  async init(): Promise<boolean> {
    try {
      const isGitRepo = await this._exec('git', ['rev-parse', '--is-inside-work-tree']);
      if (isGitRepo.trim() !== 'true') return false;

      this._initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get snapshots(): readonly Snapshot[] {
    return this._snapshots;
  }

  async createSnapshot(description: string): Promise<Snapshot | null> {
    if (!this._initialized) return null;

    try {
      const statusResult = await this._exec('git', ['status', '--porcelain']);
      if (!statusResult.trim()) return null;

      const filesChanged = statusResult.trim().split('\n').length;
      const id = `cua-${Date.now()}`;

      await this._exec('git', ['add', '-A']);
      await this._exec('git', ['commit', '--allow-empty', '-m', `[CUA Snapshot] ${description}`]);

      const snapshot: Snapshot = {
        id,
        message: description,
        timestamp: new Date().toISOString(),
        filesChanged,
      };

      this._snapshots.push(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }

  async undo(steps: number = 1): Promise<boolean> {
    if (!this._initialized || this._snapshots.length === 0) return false;

    const stepsToUndo = Math.min(steps, this._snapshots.length);

    try {
      await this._exec('git', ['reset', '--hard', `HEAD~${stepsToUndo}`]);

      for (let i = 0; i < stepsToUndo; i++) {
        this._snapshots.pop();
      }

      return true;
    } catch {
      return false;
    }
  }

  async diff(): Promise<string> {
    if (!this._initialized) return 'Git not available';

    try {
      const result = await this._exec('git', ['diff', 'HEAD']);
      if (!result.trim()) return 'No changes since last snapshot';

      const statResult = await this._exec('git', ['diff', '--stat', 'HEAD']);
      return statResult;
    } catch {
      return 'Unable to get diff';
    }
  }

  getSnapshotCount(): number {
    return this._snapshots.length;
  }

  getLastSnapshot(): Snapshot | null {
    return this._snapshots[this._snapshots.length - 1] ?? null;
  }

  private async _exec(command: string, args: string[]): Promise<string> {
    const result = await execa(command, args, {
      cwd: this._rootDir,
      timeout: 10000,
      reject: false,
    });
    return result.stdout || '';
  }
}
