import { describe, it, expect } from 'vitest';
import { TRUST_TIERS, isReadOnlyCommand, isDestructiveCommand } from '../src/config.js';

describe('isReadOnlyCommand', () => {
  it('returns true for ls', () => {
    expect(isReadOnlyCommand('ls')).toBe(true);
  });

  it('returns true for cat', () => {
    expect(isReadOnlyCommand('cat')).toBe(true);
  });

  it('returns true for pwd', () => {
    expect(isReadOnlyCommand('pwd')).toBe(true);
  });

  it('returns true for commands with arguments', () => {
    expect(isReadOnlyCommand('ls -la /home')).toBe(true);
    expect(isReadOnlyCommand('cat file.txt')).toBe(true);
    expect(isReadOnlyCommand('grep -r "pattern" src/')).toBe(true);
  });

  it('returns true for git', () => {
    expect(isReadOnlyCommand('git status')).toBe(true);
    expect(isReadOnlyCommand('git')).toBe(true);
  });

  it('returns false for rm', () => {
    expect(isReadOnlyCommand('rm -rf /')).toBe(false);
  });

  it('returns false for mv', () => {
    expect(isReadOnlyCommand('mv a b')).toBe(false);
  });

  it('returns false for cp', () => {
    expect(isReadOnlyCommand('cp a b')).toBe(false);
  });

  it('returns false for mkdir', () => {
    expect(isReadOnlyCommand('mkdir newdir')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isReadOnlyCommand('')).toBe(false);
  });

  it('returns false for whitespace-only input', () => {
    expect(isReadOnlyCommand('   ')).toBe(false);
  });

  it('handles leading/trailing whitespace', () => {
    expect(isReadOnlyCommand('  ls  ')).toBe(true);
  });
});

describe('isDestructiveCommand', () => {
  it('returns true for rm', () => {
    expect(isDestructiveCommand('rm file.txt')).toBe(true);
  });

  it('returns true for rmdir', () => {
    expect(isDestructiveCommand('rmdir dir')).toBe(true);
  });

  it('returns true for mv', () => {
    expect(isDestructiveCommand('mv a b')).toBe(true);
  });

  it('returns true for chmod', () => {
    expect(isDestructiveCommand('chmod 755 file')).toBe(true);
  });

  it('returns true for chown', () => {
    expect(isDestructiveCommand('chown user file')).toBe(true);
  });

  it('returns false for ls', () => {
    expect(isDestructiveCommand('ls')).toBe(false);
  });

  it('returns false for cat', () => {
    expect(isDestructiveCommand('cat file.txt')).toBe(false);
  });

  it('returns false for cp', () => {
    expect(isDestructiveCommand('cp a b')).toBe(false);
  });

  it('returns false for echo', () => {
    expect(isDestructiveCommand('echo hello')).toBe(false);
  });

  it('returns false for git', () => {
    expect(isDestructiveCommand('git commit -m "msg"')).toBe(false);
  });

  it('returns true for commands with destructive pattern embedded', () => {
    expect(isDestructiveCommand('echo hello && rm file')).toBe(true);
  });
});

describe('TRUST_TIERS', () => {
  const tierNames = ['sandbox', 'standard', 'trusted', 'unrestricted'] as const;

  it('has exactly four tiers', () => {
    expect(Object.keys(TRUST_TIERS)).toHaveLength(4);
  });

  it('every tier has required properties', () => {
    for (const name of tierNames) {
      const tier = TRUST_TIERS[name];
      expect(tier).toHaveProperty('name');
      expect(tier).toHaveProperty('description');
      expect(tier).toHaveProperty('allowedCommands');
      expect(tier).toHaveProperty('blockedPatterns');
      expect(tier).toHaveProperty('allowPipesAndRedirects');
      expect(tier).toHaveProperty('requiresConfirmation');
      expect(typeof tier.requiresConfirmation).toBe('function');
    }
  });

  it('every tier allows pipes and redirects', () => {
    for (const name of tierNames) {
      expect(TRUST_TIERS[name].allowPipesAndRedirects).toBe(true);
    }
  });

  describe('sandbox tier', () => {
    const tier = TRUST_TIERS.sandbox;

    it('allows ls', () => {
      expect(tier.allowedCommands).toContain('ls');
    });

    it('allows cat', () => {
      expect(tier.allowedCommands).toContain('cat');
    });

    it('does not allow cp', () => {
      expect(tier.allowedCommands).not.toContain('cp');
    });

    it('does not allow rm', () => {
      expect(tier.allowedCommands).not.toContain('rm');
    });

    it('does not allow mv', () => {
      expect(tier.allowedCommands).not.toContain('mv');
    });

    it('does not allow mkdir', () => {
      expect(tier.allowedCommands).not.toContain('mkdir');
    });

    it('never requires confirmation', () => {
      expect(tier.requiresConfirmation('rm -rf /')).toBe(false);
      expect(tier.requiresConfirmation('ls')).toBe(false);
    });
  });

  describe('standard tier', () => {
    const tier = TRUST_TIERS.standard;

    it('has more commands than sandbox', () => {
      expect(tier.allowedCommands.length).toBeGreaterThan(
        TRUST_TIERS.sandbox.allowedCommands.length,
      );
    });

    it('allows cp', () => {
      expect(tier.allowedCommands).toContain('cp');
    });

    it('allows mkdir', () => {
      expect(tier.allowedCommands).toContain('mkdir');
    });

    it('allows node', () => {
      expect(tier.allowedCommands).toContain('node');
    });

    it('does not allow rm', () => {
      expect(tier.allowedCommands).not.toContain('rm');
    });

    it('does not allow mv', () => {
      expect(tier.allowedCommands).not.toContain('mv');
    });

    it('requires confirmation for non-read-only commands', () => {
      expect(tier.requiresConfirmation('cp a b')).toBe(true);
      expect(tier.requiresConfirmation('mkdir dir')).toBe(true);
    });

    it('does not require confirmation for read-only commands', () => {
      expect(tier.requiresConfirmation('ls')).toBe(false);
      expect(tier.requiresConfirmation('cat file')).toBe(false);
    });
  });

  describe('trusted tier', () => {
    const tier = TRUST_TIERS.trusted;

    it('has more commands than standard', () => {
      expect(tier.allowedCommands.length).toBeGreaterThan(
        TRUST_TIERS.standard.allowedCommands.length,
      );
    });

    it('allows rm', () => {
      expect(tier.allowedCommands).toContain('rm');
    });

    it('allows mv', () => {
      expect(tier.allowedCommands).toContain('mv');
    });

    it('allows chmod', () => {
      expect(tier.allowedCommands).toContain('chmod');
    });

    it('allows docker', () => {
      expect(tier.allowedCommands).toContain('docker');
    });

    it('requires confirmation for destructive commands', () => {
      expect(tier.requiresConfirmation('rm file')).toBe(true);
      expect(tier.requiresConfirmation('mv a b')).toBe(true);
      expect(tier.requiresConfirmation('chmod 755 file')).toBe(true);
    });

    it('does not require confirmation for safe commands', () => {
      expect(tier.requiresConfirmation('ls')).toBe(false);
      expect(tier.requiresConfirmation('cat file')).toBe(false);
      expect(tier.requiresConfirmation('cp a b')).toBe(false);
    });
  });

  describe('unrestricted tier', () => {
    const tier = TRUST_TIERS.unrestricted;

    it('has same command count as trusted', () => {
      expect(tier.allowedCommands.length).toBe(TRUST_TIERS.trusted.allowedCommands.length);
    });

    it('allows rm', () => {
      expect(tier.allowedCommands).toContain('rm');
    });

    it('allows mv', () => {
      expect(tier.allowedCommands).toContain('mv');
    });

    it('requires confirmation for destructive commands', () => {
      expect(tier.requiresConfirmation('rm file')).toBe(true);
      expect(tier.requiresConfirmation('mv a b')).toBe(true);
    });

    it('does not require confirmation for safe commands', () => {
      expect(tier.requiresConfirmation('ls')).toBe(false);
    });
  });

  describe('tier hierarchy', () => {
    it('sandbox commands are a subset of standard commands', () => {
      const sandbox = new Set(TRUST_TIERS.sandbox.allowedCommands);
      const standard = new Set(TRUST_TIERS.standard.allowedCommands);
      for (const cmd of sandbox) {
        expect(standard.has(cmd)).toBe(true);
      }
    });

    it('standard commands are a subset of trusted commands', () => {
      const standard = new Set(TRUST_TIERS.standard.allowedCommands);
      const trusted = new Set(TRUST_TIERS.trusted.allowedCommands);
      for (const cmd of standard) {
        expect(trusted.has(cmd)).toBe(true);
      }
    });
  });
});

describe('ALWAYS_BLOCKED_PATTERNS', () => {
  const tiers = ['sandbox', 'standard', 'trusted', 'unrestricted'] as const;

  it('blocks sudo in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('sudo rm -rf /'))).toBe(true);
    }
  });

  it('blocks shutdown in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('shutdown -h now'))).toBe(true);
    }
  });

  it('blocks reboot in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('reboot'))).toBe(true);
    }
  });

  it('blocks su in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('su - root'))).toBe(true);
    }
  });

  it('blocks doas in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('doas rm file'))).toBe(true);
    }
  });

  it('blocks mkfs in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('mkfs.ext4 /dev/sda1'))).toBe(true);
    }
  });

  it('blocks dd in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('dd if=/dev/zero of=/dev/sda'))).toBe(true);
    }
  });

  it('blocks systemctl in every tier', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('systemctl stop nginx'))).toBe(true);
    }
  });

  it('blocks writing to /etc', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('echo "malicious" >/etc/passwd'))).toBe(true);
    }
  });

  it('blocks appending to system directories', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('echo "x" >>/etc/hosts'))).toBe(true);
    }
  });

  it('does not block normal commands', () => {
    for (const name of tiers) {
      const { blockedPatterns } = TRUST_TIERS[name];
      expect(blockedPatterns.some((p) => p.test('ls -la'))).toBe(false);
      expect(blockedPatterns.some((p) => p.test('cat file.txt'))).toBe(false);
    }
  });
});
