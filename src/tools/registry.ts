import type { ToolDefinition, ToolSchema, ToolResult, TrustTier } from '../types.js';
import { BashTool } from './bash-tool.js';
import { ReadFileTool } from './read-file-tool.js';
import { WriteFileTool } from './write-file-tool.js';
import { ListDirectoryTool } from './list-directory-tool.js';
import { SearchFilesTool } from './search-files-tool.js';
import { WebFetchTool } from './web-fetch-tool.js';
import { Bash } from '../bash.js';
import { Config } from '../config.js';

export class ToolRegistry {
  private readonly _tools: Map<string, ToolDefinition> = new Map();
  private _bashTool: BashTool;

  constructor(bash: Bash, config: Config) {
    this._bashTool = new BashTool(bash, config);
    this.register(this._bashTool);
    this.register(new ReadFileTool(bash.cwd));
    this.register(new WriteFileTool(bash.cwd, config.trustTier));
    this.register(new ListDirectoryTool(bash.cwd));
    this.register(new SearchFilesTool(bash.cwd));
    this.register(new WebFetchTool(bash.cwd));
  }

  register(tool: ToolDefinition): void {
    this._tools.set(tool.name, tool);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this._tools.get(name);
  }

  getAllSchemas(): ToolSchema[] {
    return Array.from(this._tools.values()).map((tool) => tool.schema);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this._tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    return tool.execute(args);
  }

  requiresConfirmation(name: string, args: Record<string, unknown>): boolean {
    const tool = this._tools.get(name);
    if (!tool) return false;

    if (tool.name === 'exec_bash_command' && 'shouldConfirm' in tool) {
      return (tool as BashTool).shouldConfirm(args);
    }

    return tool.requiresConfirmation;
  }

  updateCwd(cwd: string): void {
    for (const tool of this._tools.values()) {
      if ('updateCwd' in tool && typeof tool.updateCwd === 'function') {
        tool.updateCwd(cwd);
      }
    }
  }

  get bash(): Bash {
    return this._bashTool.bash;
  }

  get toolNames(): string[] {
    return Array.from(this._tools.keys());
  }
}
