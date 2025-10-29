# Computer Use Agent 🤖

A TypeScript-powered CLI agent that executes bash commands safely through natural language.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure API Key
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your OpenRouter API key
# Get your free key at: https://openrouter.ai/keys
```

### 3. Build and Run
```bash
# Build the project
npm run build

# Start the agent
npm start
```

## Usage Examples

```bash
# Start the interactive agent
npm start

# Or run directly with ts-node (development)
npm run dev

# Example interactions:
# "List all TypeScript files"
# "Open Chrome browser"
# "What's the current date?"
# "Create a folder called test"
# "Show system information"
```

## Special Commands
- `help` - Show examples and available commands
- `clear` - Clear screen
- `stats` - Show conversation statistics
- `cwd` - Show current directory
- `quit` - Exit the agent

## Features
- ✅ Natural language to bash commands
- ✅ Safe execution with command whitelist
- ✅ Interactive confirmation before execution
- ✅ Working directory tracking
- ✅ 100% TypeScript with full type safety
- ✅ Beautiful colored terminal UI
- ✅ Free OpenAI-compatible models available

## Configuration

Edit `.env` file:
```env
OPENROUTER_API_KEY=your-api-key-here
LLM_MODEL_NAME=nvidia/nemotron-nano-9b-v2:free
```

## Available Commands

The agent includes a curated list of safe commands:

### File Operations
- `ls`, `cd`, `cp`, `cat`, `find`, `touch`, `echo`, `grep`, `pwd`, `mkdir`
- `sort`, `head`, `tail`, `du`, `wc`, `which`, `whereis`, `file`, `less`, `more`

### macOS Specific
- `open` - Launch applications and files

### Network Utilities
- `curl`, `wget`, `ping`, `nslookup`, `dig`, `netstat`

### Text Processing
- `sed`, `awk`, `tr`, `cut`, `uniq`, `xargs`, `paste`, `join`

### System Information
- `date`, `whoami`, `uname`, `df`, `ps`, `top`, `uptime`, `free`, `lsof`

### Development Tools
- `python`, `python3`, `pip`, `pip3`, `node`, `npm`, `yarn`, `pnpm`
- `git`, `gh`, `svn`, `hg`

### Archives
- `tar`, `zip`, `unzip`, `gzip`, `gunzip`, `bzip2`

### Security Notice
For safety, the following commands are **blocked**:
- `rm`, `sudo`, `chmod`, `chown`, `rmdir`
- Any command with pipes or redirects
- Command injection patterns (backticks, $(), etc.)

## Development

### Project Structure

```
computer-use-agent/
├── src/
│   ├── types.ts          # Type definitions and interfaces
│   ├── config.ts         # Configuration management
│   ├── bash.ts           # Command execution engine
│   ├── messages.ts       # Message handling
│   ├── llm.ts           # LLM API integration
│   └── main.ts          # CLI interface
├── dist/                # Compiled JavaScript
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── .env.example         # Environment template
└── README.md           # This file
```

### Scripts

```bash
# Development
npm run dev           # Run in development mode with TypeScript
npm run build         # Compile TypeScript to JavaScript
npm run build:watch   # Compile with watch mode

# Code Quality
npm run lint          # Run ESLint
npm run format        # Format code with Prettier

# Testing
npm test              # Run tests
npm run clean         # Clean build artifacts
```

### Adding New Commands

To add new allowed commands, edit `src/config.ts`:

```typescript
const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  // ... existing commands
  'your-new-command',  // Add your command here
] as const);
```

### Type Safety

The project uses strict TypeScript with:
- 100% type coverage
- No implicit any
- Strict null checks
- Exact optional properties

## Troubleshooting

### Common Issues

1. **"API key not configured"**
   - Ensure your `.env` file has `OPENROUTER_API_KEY` set
   - Get a free key at [openrouter.ai](https://openrouter.ai)

2. **"Command not allowed"**
   - Check if the command is in the allowlist
   - The agent blocks dangerous commands for safety

3. **"Connection timeout"**
   - Check your internet connection
   - Try again after a few seconds

### Debug Mode

Run with verbose output for debugging:

```bash
npm run dev -- --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with full type safety
4. Add tests if applicable
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- Use TypeScript strict mode
- Follow the existing code style
- Add JSDoc comments for public APIs
- Ensure all new code is fully typed

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [TypeScript](https://www.typescriptlang.org/)
- LLM integration via [OpenAI](https://openai.com/)
- CLI powered by [Commander.js](https://commander.js/)
- Command execution with [execa](https://github.com/sindresorhus/execa)
- UI elements from [chalk](https://github.com/chalk/chalk), [ora](https://github.com/sindresorhus/ora), and [inquirer](https://github.com/SBoudrias/Inquirer.js)

## Support

If you encounter any issues or have questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Search [existing issues](https://github.com/your-username/computer-use-agent/issues)
3. Create a [new issue](https://github.com/your-username/computer-use-agent/issues/new)

---

**⚠️ Security Warning**: This tool executes shell commands on your computer. Always review commands before execution and never share sensitive information through the agent.