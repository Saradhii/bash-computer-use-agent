# NEXT SESSION — Action Items

> **Goal**: The project has been through 2 major improvement rounds. Priority 1-3 features and usability overhaul are complete.
> **Status**: Build clean, 217 tests passing, all priority items done.
> **Current usability rating**: ~7.5/10

---

## What's Been Done

### Round 1 — Core Fixes (Priority 1-3 + Bugs)

- Anthropic native SDK with streaming (1.1)
- Ollama streaming fallback (1.2)
- vitest + 217 tests across 6 files (1.3)
- web_fetch tool (2.1)
- --dry-run mode (2.2)
- Model router with auto-complexity detection (2.3)
- Setup wizard for first-run (2.4)
- ESLint config fixed (3.1)
- Command history persistence to ~/.cua/history (3.2)
- Better output formatting with JSON pretty-print (3.3)
- Token usage display (3.4)
- Graceful error recovery with retry on 5xx/429/408 (3.5)
- exportConversation() returns object not string (B1)
- Trust tier change updates system prompt (B2)
- write_file blocked in sandbox mode (B3)

### Round 2 — Usability Overhaul

- `#!/usr/bin/env node` shebang + `files` in package.json for `npx cua` (U1)
- First-run works without .env — wizard sets env vars in memory (U2)
- Smart auto-confirm — auto-runs after 3 successful confirms, high-risk excluded (U3)
- Auto-save sessions on exit + every 5 exchanges + session resume on restart (U4)
- Auto-summarization via LLM at 80% context capacity instead of silent truncation (U5)
- `cua -p "do X" -y` non-interactive scripting mode (U6)
- Error suggestions — actionable hints on ENOENT, EACCES, timeout, etc. (U7)
- Markdown rendering for LLM output + diff/table rendering + pager truncation (U8)
- First-run onboarding examples + guided wizard (U9)

---

## Next Steps (To Get to 9/10)

### N1: Publish to npm

- `npm publish` so `npx cua` works without cloning
- Add proper README with install instructions and GIF demo

### N2: Proper Terminal UI

- Replace `inquirer-command-prompt` with a custom readline or ink-based interface
- Multi-line input support (paste code blocks)
- Autocomplete for file paths and commands
- Syntax highlighting in input

### N3: Streaming Tool Output

- For long-running commands, stream partial output (like `tail -f`)
- Show progress bars for file operations
- Better spinner with estimated time

### N4: MCP Protocol Support

- Implement Model Context Protocol for IDE integration
- Allow VS Code / Cursor to use CUA as a tool provider
- Share context between IDE and CLI

### N5: Plugin System

- Allow users to add custom tools via `~/.cua/plugins/`
- Support for project-specific tools (`.cua/tools/`)
- Tool marketplace or shared community tools

### N6: Multi-Model Conversations

- Route sub-tasks to different models (fast model for ls, powerful for code gen)
- Cost tracking per conversation
- Model switching mid-session with `model` command

### N7: Configuration Profiles

- Named config profiles: `cua --profile work` vs `cua --profile personal`
- Different API keys, models, trust tiers per profile

---

## Quick Reference

```
# Build & test:
npm run build          # Compile TypeScript
npx tsc --noEmit       # Type check only
npm test               # Run 217 vitest tests

# Run:
npm start              # Interactive mode
npm run dev            # Dev mode
cua -p "list files" -y # Non-interactive scripting
cua --dry-run          # Preview without executing

# Conventions:
- .js extensions on local imports (ESM)
- Private fields prefixed with _
- No comments in code
- Strict TypeScript (noImplicitAny, strictNullChecks, noUncheckedIndexedAccess)
- exactOptionalPropertyTypes is ON

# Architecture:
src/main.ts             — CLI app, agentic loop, commands
src/llm.ts              — LLM client (OpenAI, Anthropic, Ollama)
src/config.ts           — Trust tiers, providers, security
src/messages.ts         — Message manager with smart trimming
src/context-summarizer.ts — LLM-based context summarization
src/markdown-renderer.ts — Terminal markdown rendering
src/tools/              — Tool system (bash, read, write, list, search, web_fetch)
src/model-router.ts     — Auto model selection by task complexity
src/setup-wizard.ts     — First-run interactive setup
```
