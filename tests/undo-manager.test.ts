import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UndoManager } from '../src/undo-manager.js';
import { execa } from 'execa';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('UndoManager', () => {
  let tempDir: string;
  let manager: UndoManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'undo-test-'));
    await execa('git', ['init'], { cwd: tempDir });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    await writeFile(join(tempDir, 'initial.txt'), 'init');
    await execa('git', ['add', '-A'], { cwd: tempDir });
    await execa('git', ['commit', '-m', 'initial'], { cwd: tempDir });

    manager = new UndoManager(tempDir);
    await manager.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('initializes in a git repo', () => {
      expect(manager.isInitialized).toBe(true);
    });

    it('returns false for a non-git directory', async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));
      try {
        const m = new UndoManager(nonGitDir);
        const result = await m.init();
        expect(result).toBe(false);
        expect(m.isInitialized).toBe(false);
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('createSnapshot', () => {
    it('returns null when not initialized', async () => {
      const m = new UndoManager(tempDir);
      const result = await m.createSnapshot('test');
      expect(result).toBeNull();
    });

    it('returns null when there are no changes', async () => {
      const result = await manager.createSnapshot('empty');
      expect(result).toBeNull();
    });

    it('creates a snapshot with correct properties', async () => {
      await writeFile(join(tempDir, 'file1.txt'), 'hello');
      const snapshot = await manager.createSnapshot('add file1');

      expect(snapshot).not.toBeNull();
      expect(snapshot!.id).toMatch(/^cua-/);
      expect(snapshot!.message).toBe('add file1');
      expect(snapshot!.timestamp).toBeTruthy();
      expect(snapshot!.filesChanged).toBe(1);
    });

    it('tracks multiple snapshots', async () => {
      await writeFile(join(tempDir, 'a.txt'), 'a');
      await manager.createSnapshot('first');

      await writeFile(join(tempDir, 'b.txt'), 'b');
      await manager.createSnapshot('second');

      expect(manager.getSnapshotCount()).toBe(2);
      expect(manager.snapshots[0].message).toBe('first');
      expect(manager.snapshots[1].message).toBe('second');
    });

    it('counts multiple changed files', async () => {
      await writeFile(join(tempDir, 'x.txt'), 'x');
      await writeFile(join(tempDir, 'y.txt'), 'y');
      const snapshot = await manager.createSnapshot('multi');

      expect(snapshot!.filesChanged).toBe(2);
    });
  });

  describe('undo', () => {
    it('returns false when not initialized', async () => {
      const m = new UndoManager(tempDir);
      expect(await m.undo()).toBe(false);
    });

    it('returns false when no snapshots exist', async () => {
      expect(await manager.undo()).toBe(false);
    });

    it('reverts a single snapshot', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      await manager.createSnapshot('add file');

      const { stdout } = await execa('git', ['log', '--oneline'], { cwd: tempDir });
      const beforeCount = stdout.trim().split('\n').length;

      const result = await manager.undo(1);

      expect(result).toBe(true);
      expect(manager.getSnapshotCount()).toBe(0);

      const { stdout: afterLog } = await execa('git', ['log', '--oneline'], { cwd: tempDir });
      expect(afterLog.trim().split('\n').length).toBe(beforeCount - 1);
    });

    it('clamps steps to snapshot count', async () => {
      await writeFile(join(tempDir, 'a.txt'), 'a');
      await manager.createSnapshot('one');

      expect(await manager.undo(5)).toBe(true);
      expect(manager.getSnapshotCount()).toBe(0);
    });

    it('undoes multiple snapshots', async () => {
      await writeFile(join(tempDir, 'a.txt'), 'a');
      await manager.createSnapshot('first');

      await writeFile(join(tempDir, 'b.txt'), 'b');
      await manager.createSnapshot('second');

      const result = await manager.undo(2);

      expect(result).toBe(true);
      expect(manager.getSnapshotCount()).toBe(0);
    });

    it('restores file state after undo', async () => {
      await writeFile(join(tempDir, 'data.txt'), 'original');
      await manager.createSnapshot('save');

      await writeFile(join(tempDir, 'data.txt'), 'modified');
      await manager.createSnapshot('modify');

      await manager.undo(1);

      const { stdout } = await execa('cat', [join(tempDir, 'data.txt')], {
        cwd: tempDir,
        reject: false,
      });
      expect(stdout).toBe('original');
    });
  });

  describe('diff', () => {
    it('returns no-changes message when clean', async () => {
      const result = await manager.diff();
      expect(result).toBe('No changes since last snapshot');
    });

    it('returns stat output when there are changes', async () => {
      await writeFile(join(tempDir, 'initial.txt'), 'modified content');
      const result = await manager.diff();
      expect(result).toContain('initial.txt');
    });

    it('returns error message when not initialized', async () => {
      const m = new UndoManager(tempDir);
      expect(await m.diff()).toBe('Git not available');
    });
  });

  describe('getLastSnapshot', () => {
    it('returns null when no snapshots', () => {
      expect(manager.getLastSnapshot()).toBeNull();
    });

    it('returns the most recent snapshot', async () => {
      await writeFile(join(tempDir, 'a.txt'), 'a');
      await manager.createSnapshot('first');

      await writeFile(join(tempDir, 'b.txt'), 'b');
      await manager.createSnapshot('second');

      expect(manager.getLastSnapshot()!.message).toBe('second');
    });
  });

  describe('snapshots getter', () => {
    it('returns a readonly empty array initially', () => {
      expect(manager.snapshots).toEqual([]);
    });

    it('returns all snapshots after creation', async () => {
      await writeFile(join(tempDir, 'a.txt'), 'a');
      await manager.createSnapshot('s1');
      await writeFile(join(tempDir, 'b.txt'), 'b');
      await manager.createSnapshot('s2');

      expect(manager.snapshots.length).toBe(2);
    });
  });
});
