# Computer Use Agent

TypeScript CLI for executing bash commands via LLM function calling.

## Setup

```bash
# Install dependencies
npm install

# Configure API key
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY from https://openrouter.ai/keys

# Build
npm run build
```

## Usage

```bash
# Start (prompts for model selection)
npm start

# Or use directly
npm run dev

# With specific model
npm start -- -m meta-llama/llama-3.3-70b-instruct:free
```

### Available Models

- `meta-llama/llama-3.3-70b-instruct:free` - **Recommended** (70B, best function calling)
- `nvidia/nemotron-nano-9b-v2:free` - Lightweight (9B, fast responses)

### Commands

- `quit` - Exit
- `clear` - Clear screen
- `cwd` - Show current directory

## Architecture

```
src/
├── types.ts       # Type definitions, Zod schemas
├── config.ts      # Config management, security rules
├── bash.ts        # Command execution with safety checks
├── llm.ts         # OpenAI-compatible API client
├── messages.ts    # Conversation history management
└── main.ts        # CLI interface
```

## Security

**Whitelisted commands only**: `ls`, `cd`, `cat`, `find`, `grep`, `pwd`, `mkdir`, etc.

**Blocked**: `rm`, `sudo`, `chmod`, `chown`, pipes, redirects, command injection patterns.

Timeout: 30 seconds per command.

## Development

```bash
npm run dev          # Run with ts-node
npm run build        # Compile TypeScript
npm run build:watch  # Watch mode
npm run lint         # ESLint
npm run format       # Prettier
npm run clean        # Remove build artifacts
```

## Configuration

`.env` variables:
- `OPENROUTER_API_KEY` - Required
- `LLM_BASE_URL` - Default: `https://openrouter.ai/api/v1`
- `LLM_MODEL_NAME` - Default: `meta-llama/llama-3.3-70b-instruct:free`
- `LLM_TEMPERATURE` - Default: `0.1`
- `LLM_TOP_P` - Default: `0.95`

CLI options: `-v` (verbose), `-m <model>` (override model), `-n` (non-interactive)

## Requirements

- Node.js >= 18
- OpenRouter API key (free)
