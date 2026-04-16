import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { Bash } from '../../src/bash.js';
import { Config } from '../../src/config.js';
import type { ToolDefinition } from '../../src/types.js';

const mockConfig = {
  trustTier: 'standard' as const,
  getTrustTierConfig: () => ({
    name: 'standard',
    description: 'Standard tier',
    allowedCommands: [] as readonly string[],
    blockedPatterns: [] as readonly RegExp[],
    allowPipesAndRedirects: true,
    requiresConfirmation: (_cmd: string) => false,
  }),
  requiresConfirmation: (_cmd: string) => false,
  validateCommand: () => {},
  security: { commandTimeout: 30000 },
  rootDir: '/tmp/test',
  bashToolSchema: {
    type: 'function' as const,
    function: {
      name: 'exec_bash_command',
      description: 'Execute a bash command',
      parameters: {
        type: 'object' as const,
        properties: {
          cmd: { type: 'string' as const, description: 'The bash command to execute' },
        },
        required: ['cmd'],
      },
    },
  },
} as unknown as Config;

const mockBash = {
  cwd: '/tmp/test',
  execBashCommand: vi.fn().mockResolvedValue({
    stdout: 'ok',
    stderr: '',
    cwd: '/tmp/test',
    exitCode: 0,
  }),
} as unknown as Bash;

function createRegistry(): ToolRegistry {
  return new ToolRegistry(mockBash, mockConfig);
}

describe('ToolRegistry', () => {
  describe('constructor', () => {
    it('registers 6 default tools', () => {
      const registry = createRegistry();
      expect(registry.toolNames).toHaveLength(6);
    });

    it('registers the expected tool names', () => {
      const registry = createRegistry();
      const names = registry.toolNames;
      expect(names).toContain('exec_bash_command');
      expect(names).toContain('read_file');
      expect(names).toContain('write_file');
      expect(names).toContain('list_directory');
      expect(names).toContain('search_files');
      expect(names).toContain('web_fetch');
    });
  });

  describe('register', () => {
    it('adds a custom tool to the registry', () => {
      const registry = createRegistry();
      const customTool: ToolDefinition = {
        name: 'custom_tool',
        description: 'A custom tool',
        schema: {
          type: 'function',
          function: {
            name: 'custom_tool',
            description: 'A custom tool',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        requiresConfirmation: false,
        execute: vi.fn().mockResolvedValue({ content: 'done', isError: false }),
      };
      registry.register(customTool);
      expect(registry.getTool('custom_tool')).toBe(customTool);
    });

    it('overwrites an existing tool with the same name', () => {
      const registry = createRegistry();
      const replacement: ToolDefinition = {
        name: 'exec_bash_command',
        description: 'Replaced',
        schema: {
          type: 'function',
          function: {
            name: 'exec_bash_command',
            description: 'Replaced',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        requiresConfirmation: false,
        execute: vi.fn().mockResolvedValue({ content: 'replaced', isError: false }),
      };
      registry.register(replacement);
      expect(registry.getTool('exec_bash_command')).toBe(replacement);
      expect(registry.toolNames).toHaveLength(6);
    });
  });

  describe('getTool', () => {
    it('returns the tool definition for a registered tool', () => {
      const registry = createRegistry();
      const tool = registry.getTool('exec_bash_command');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('exec_bash_command');
    });

    it('returns undefined for an unknown tool', () => {
      const registry = createRegistry();
      expect(registry.getTool('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllSchemas', () => {
    it('returns a schema for every registered tool', () => {
      const registry = createRegistry();
      const schemas = registry.getAllSchemas();
      expect(schemas).toHaveLength(6);
      for (const schema of schemas) {
        expect(schema.type).toBe('function');
        expect(schema.function.name).toBeDefined();
        expect(schema.function.parameters).toBeDefined();
      }
    });

    it('includes schemas for custom tools after registration', () => {
      const registry = createRegistry();
      const customTool: ToolDefinition = {
        name: 'extra',
        description: 'Extra tool',
        schema: {
          type: 'function',
          function: {
            name: 'extra',
            description: 'Extra tool',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        requiresConfirmation: false,
        execute: vi.fn().mockResolvedValue({ content: '', isError: false }),
      };
      registry.register(customTool);
      const schemas = registry.getAllSchemas();
      expect(schemas).toHaveLength(7);
      expect(schemas.map((s) => s.function.name)).toContain('extra');
    });
  });

  describe('executeTool', () => {
    it('returns an error result for an unknown tool', async () => {
      const registry = createRegistry();
      const result = await registry.executeTool('nonexistent', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool: nonexistent');
    });

    it('executes a registered tool and returns its result', async () => {
      const registry = createRegistry();
      const result = await registry.executeTool('exec_bash_command', { cmd: 'echo hello' });
      expect(result.isError).toBe(false);
      expect(mockBash.execBashCommand).toHaveBeenCalledWith('echo hello');
    });
  });

  describe('requiresConfirmation', () => {
    it('returns false for unknown tools', () => {
      const registry = createRegistry();
      expect(registry.requiresConfirmation('nonexistent', {})).toBe(false);
    });

    it('delegates to tool requiresConfirmation for non-bash tools', () => {
      const registry = createRegistry();
      const readFile = registry.getTool('read_file');
      expect(readFile!.requiresConfirmation).toBe(false);
      expect(registry.requiresConfirmation('read_file', {})).toBe(false);
    });

    it('uses shouldConfirm for exec_bash_command based on config', () => {
      const registry = createRegistry();
      expect(registry.requiresConfirmation('exec_bash_command', { cmd: 'ls' })).toBe(false);
    });

    it('returns true for exec_bash_command when config requires it', () => {
      const strictConfig = {
        ...mockConfig,
        requiresConfirmation: (_cmd: string) => true,
      } as unknown as Config;
      const registry = new ToolRegistry(mockBash, strictConfig);
      expect(registry.requiresConfirmation('exec_bash_command', { cmd: 'rm -rf /' })).toBe(true);
    });
  });

  describe('updateCwd', () => {
    it('calls updateCwd on tools that support it', () => {
      const registry = createRegistry();
      const readFile = registry.getTool('read_file');
      const updateSpy = vi.spyOn(
        readFile! as unknown as { updateCwd: (cwd: string) => void },
        'updateCwd',
      );
      registry.updateCwd('/new/dir');
      expect(updateSpy).toHaveBeenCalledWith('/new/dir');
      updateSpy.mockRestore();
    });
  });

  describe('bash getter', () => {
    it('returns the Bash instance from the BashTool', () => {
      const registry = createRegistry();
      expect(registry.bash).toBe(mockBash);
    });
  });

  describe('toolNames getter', () => {
    it('returns an array of all registered tool name strings', () => {
      const registry = createRegistry();
      const names = registry.toolNames;
      expect(Array.isArray(names)).toBe(true);
      expect(names).toEqual(
        expect.arrayContaining([
          'exec_bash_command',
          'read_file',
          'write_file',
          'list_directory',
          'search_files',
          'web_fetch',
        ]),
      );
    });

    it('reflects newly registered tools', () => {
      const registry = createRegistry();
      const customTool: ToolDefinition = {
        name: 'my_new_tool',
        description: '',
        schema: {
          type: 'function',
          function: {
            name: 'my_new_tool',
            description: '',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        requiresConfirmation: false,
        execute: vi.fn().mockResolvedValue({ content: '', isError: false }),
      };
      registry.register(customTool);
      expect(registry.toolNames).toContain('my_new_tool');
    });
  });
});
