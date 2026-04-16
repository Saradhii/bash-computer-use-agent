# TRACKER.md - Persistent Memory Bridge

> This file is the single source of truth for session state.
> Every sprint MUST update this file before context clear.
> A fresh AI reads ONLY this file + source code to rebuild full context.

## Current Status

- **Sprint**: 8 / 8 (ALL COMPLETE)
- **Overall Progress**: 100%
- **Phase**: COMPLETE
- **Current Task**: Final review done
- **Blockers**: None
- **Last Action**: README updated, all sprints complete, build passing

## Final File Structure

```
src/
├── main.ts              # CLI interface with agentic loop, streaming, all commands
├── llm.ts               # OpenAI-compatible client with streaming + retry
├── config.ts            # Trust tiers (4 levels), security, multi-provider configs
├── bash.ts              # Command execution (single _execute method, trust-aware)
├── messages.ts          # Conversation history management
├── types.ts             # Types, Zod schemas, error classes, TrustTier, ToolDefinition
├── utils.ts             # Utility functions
├── project-context.ts   # Auto-detect Node.js/Python projects
├── undo-manager.ts      # Git-based undo system with snapshots
├── session-manager.ts   # Save/load sessions to ~/.cua/sessions/
├── help.ts              # Help text for inline help command
└── tools/
    ├── registry.ts          # Tool registry, CWD sync, generic dispatch
    ├── bash-tool.ts         # Bash wrapped as a tool
    ├── read-file-tool.ts    # File reader (offset/limit/line numbers/max size)
    ├── write-file-tool.ts   # File writer (append/auto-mkdir/size reporting)
    ├── list-directory-tool.ts # Directory listing (recursive/depth/skip node_modules)
    └── search-files-tool.ts   # Grep search (include patterns/max results)
```

## Architecture Decisions Log

| Decision           | Choice                                     | Rationale                                | Sprint |
| ------------------ | ------------------------------------------ | ---------------------------------------- | ------ |
| Module system      | ESM (type: module)                         | Pre-existing                             | 0      |
| Language           | TypeScript strict mode                     | Pre-existing                             | 0      |
| LLM client         | OpenAI SDK (works with OpenRouter, Ollama) | Pre-existing                             | 0      |
| Security model     | Trust tiers instead of blocklist           | User control > paternalism               | 1      |
| Agentic loop       | Max 25 steps with step counter             | Prevent infinite loops, visible progress | 1      |
| Tool system        | ToolDefinition interface + ToolRegistry    | Extensible, generic dispatch             | 2      |
| Streaming          | OpenAI streaming API with callbacks        | Real-time UX                             | 3      |
| Multi-provider     | Provider configs with env key detection    | Users bring their own keys               | 4      |
| Project context    | Auto-detect at startup                     | Eliminates repeated explanation          | 4      |
| Undo               | Git-based snapshots before mutations       | Simple, reliable, trust-building         | 5      |
| Sessions           | JSON files in ~/.cua/sessions/             | Simple persistence                       | 6      |
| API key validation | Any provider key accepted                  | Flexibility                              | 7      |

## Sprint Completion Summary

### Sprint 1: Agentic Loop + Trust Levels + Security Fix

- Removed broken INJECTION_PATTERNS, replaced with trust tier system
- 4 trust tiers: sandbox, standard, trusted, unrestricted
- Agentic loop with max 25 steps and step counter
- Smart confirmation (skip read-only, prompt destructive)
- Output truncation (>50 lines)
- Deleted main.ts.backup, consolidated bash.ts methods

### Sprint 2: Multi-Tool System

- ToolDefinition interface, ToolResult, ToolSchema
- ToolRegistry managing all tools with generic dispatch
- 5 tools: bash, read_file, write_file, list_directory, search_files
- CWD sync across tools via updateCwd()

### Sprint 3: Streaming Responses

- queryStream() in LLM client with StreamCallbacks
- Real-time token streaming via process.stdout.write
- Tool call detection during streaming
- Replaced ora spinner with inline streaming output

### Sprint 4: Project Context + Multi-Provider

- detectProject() auto-detects Node.js/Python projects
- contextToSystemAppendix() for system prompt enrichment
- 4 providers: OpenRouter, OpenAI, Anthropic, Ollama
- Provider selection at startup with API key detection
- PROVIDERS config array in config.ts

### Sprint 5: Undo System

- UndoManager with git-based snapshots
- createSnapshot() before mutations
- undo(steps), diff(), snapshots commands
- Integrated into tool call handler

### Sprint 6: Session Persistence + Help

- SessionManager with save/load/list/delete
- ~/.cua/sessions/ for persistence
- save [name], sessions commands
- Inline help system with getHelpText()

### Sprint 7: Polish

- Updated .env.example for multi-provider
- Made API keys optional in env schema
- Better error messages for missing keys
- Updated config validation

### Sprint 8: Final Review

- README completely rewritten
- All sprints verified compiling clean
- TRACKER updated with final state

## Known Limitations

1. Anthropic API uses different message format — may need adapter for tool calls
2. Ollama streaming may differ from OpenAI — needs testing
3. web_fetch tool deferred (needs fetch/node-fetch dependency decision)
4. No tests yet — testing infrastructure needed
5. ESLint config broken (pre-existing, missing @typescript-eslint/recommended plugin)

## Key Patterns & Conventions

- **Imports**: Use `.js` extensions for local imports (ESM requirement)
- **Error handling**: Custom error classes extend AgentError
- **Config**: Readonly properties, frozen objects, singleton pattern
- **Naming**: Private fields prefixed with `_`, PascalCase classes, camelCase functions
- **Types**: Strict TypeScript with noImplicitAny, strictNullChecks, noUncheckedIndexedAccess
- **No comments in code** unless explicitly requested

## Context Clear Protocol

When context is about to be cleared:

1. Update this entire TRACKER.md with current state
2. List every file changed and what changed
3. List every decision made and why
4. List any open questions or blockers
5. Write exact next steps for the next sprint
6. Say "TRACKER UPDATED — SAFE TO CLEAR CONTEXT"

When context is freshly loaded:

1. Read TRACKER.md first
2. Read only the files listed as "changed this sprint"
3. Continue from exact next steps
4. Do NOT re-read unchanged files unless debugging

---

**TRACKER UPDATED — ALL SPRINTS COMPLETE — BUILD PASSING**
