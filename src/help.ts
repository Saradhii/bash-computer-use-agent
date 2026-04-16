import chalk from 'chalk';

export function getHelpText(): string {
  return `
${chalk.cyan.bold('Computer Use Agent — Commands')}

${chalk.bold('Special Commands:')}
  quit, exit, q     — Exit the agent
  clear             — Clear the screen
  cwd               — Show current working directory
  trust             — Change trust level
  help              — Show this help
  undo              — Revert last change (requires git)
  diff              — Show changes since last snapshot
  snapshots         — List session snapshots
  save [name]       — Save current session
  sessions          — List saved sessions

${chalk.bold('Trust Levels:')}
  sandbox           — Read-only: explore without risk
  standard          — Create files, run tools (default)
  trusted           — Full dev: rm, mv, package install
  unrestricted      — Everything except system-critical

${chalk.bold('Available Tools:')}
  exec_bash_command — Run any allowed shell command
  read_file         — Read file contents with line numbers
  write_file        — Create or update files
  list_directory    — Browse directory structure
  search_files      — Search for patterns in files

${chalk.bold('CLI Flags:')}
  -m, --model       — Specify LLM model
  -t, --trust       — Set trust tier
  -a, --auto        — Auto-execute without confirmation
  -v, --verbose     — Enable debug output

${chalk.bold('Tips:')}
  • Ask natural language questions about your codebase
  • The agent can chain multiple commands automatically
  • Use "undo" to revert any unwanted changes
  • Increase trust level for write/delete operations
`;
}

export function getQuickHelp(): string {
  return chalk.gray(
    "Type 'help' for commands | 'trust' to change permissions | describe what you want in natural language",
  );
}
