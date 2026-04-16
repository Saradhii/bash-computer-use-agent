# Computer Use Agent

A TypeScript CLI agent that translates natural language into shell commands and executes them autonomously. Supports multiple LLM providers, trust levels, file operations, and undo.

## Features

- **Natural Language to Shell**: Describe what you want, the agent figures out the commands
- **Agentic Loop**: Executes multi-step tasks autonomously (up to 25 steps)
- **5 Built-in Tools**: bash execution, read_file, write_file, list_directory, search_files
- **Streaming Responses**: See the agent's thinking in real-time
- **4 Trust Levels**: Sandbox, Standard, Trusted, Unrestricted — control what the agent can do
- **Multi-Provider**: OpenRouter (free), OpenAI, Anthropic, Ollama (local)
- **Project Detection**: Auto-detects Node.js/Python projects and loads context
- **Undo System**: Git-based snapshots let you revert any change
- **Session Persistence**: Save and resume sessions

## Setup

```bash
# Install dependencies
npm install

# Configure API key
cp .env.example .env
# Edit .env and add at least one provider key

# Build
npm run build
```

## Providers

| Provider   | Key                  | Get Key                              |
| ---------- | -------------------- | ------------------------------------ |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys (free)    |
| OpenAI     | `OPENAI_API_KEY`     | https://platform.openai.com/api-keys |
| Anthropic  | `ANTHROPIC_API_KEY`  | https://console.anthropic.com/       |
| Ollama     | No key needed        | https://ollama.ai (local)            |

## Usage

```bash
# Start (prompts for provider, model, trust level)
npm start

# Auto-execute mode (no confirmation prompts)
npm run start:auto

# Development mode
npm run dev
npm run dev:auto

# With specific model and trust level
npm start -- -m gpt-4o -t trusted

# Combine flags
npm start -- -m gpt-4o -t trusted -a
```

### Trust Levels

| Level            | Allowed                          | Use Case                    |
| ---------------- | -------------------------------- | --------------------------- |
| **Sandbox**      | Read-only: ls, cat, grep, find   | Exploring repos safely      |
| **Standard**     | + file creation, mkdir, tools    | Daily development (default) |
| **Trusted**      | + rm, mv, pip/npm install        | Full development            |
| **Unrestricted** | Everything except sudo, shutdown | Power users                 |

Change trust level at any time with the `trust` command.

### Commands

- `quit` / `exit` / `q` — Exit
- `clear` — Clear screen
- `cwd` — Show current directory
- `trust` — Change trust level
- `help` — Show help
- `undo` — Revert last change (requires git)
- `diff` — Show changes since last snapshot
- `snapshots` — List session snapshots
- `save [name]` — Save current session
- `sessions` — List saved sessions

### CLI Flags

- `-v, --verbose` — Enable debug output
- `-m, --model <model>` — Override LLM model
- `-t, --trust <tier>` — Set trust tier
- `-a, --auto` — Auto-execute without confirmation
- `-k, --api-key <key>` — Override API key

## Architecture

```
src/
├── main.ts              # CLI interface, agentic loop
├── llm.ts               # OpenAI-compatible client with streaming
├── config.ts            # Trust tiers, security, provider configs
├── bash.ts              # Command execution
├── messages.ts          # Conversation history
├── types.ts             # Type definitions, Zod schemas
├── utils.ts             # Utility functions
├── project-context.ts   # Auto-detect project type
├── undo-manager.ts      # Git-based undo system
├── session-manager.ts   # Session persistence
├── help.ts              # Help system
└── tools/
    ├── registry.ts          # Tool registry and dispatch
    ├── bash-tool.ts         # Bash execution tool
    ├── read-file-tool.ts    # File reader with offset/limit
    ├── write-file-tool.ts   # File writer with append mode
    ├── list-directory-tool  # Directory browser
    └── search-files-tool.ts # Grep-based search
```

## Security

- Commands validated against trust-tier allowlist
- System-critical commands always blocked (sudo, shutdown, reboot, mkfs, etc.)
- Destructive commands require confirmation even in trusted mode
- Read-only commands skip confirmation
- 30-second timeout per command
- Git snapshots before every mutation

## Development

```bash
npm run dev          # Run with ts-node
npm run build        # Compile TypeScript
npm run build:watch  # Watch mode
npm run lint         # ESLint
npm run format       # Prettier
npm run clean        # Remove build artifacts
```

## Requirements

- Node.js >= 18
- At least one LLM provider API key (OpenRouter has free models)
