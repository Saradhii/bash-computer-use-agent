import chalk from 'chalk';
import stripAnsi from 'strip-ansi';

export class MarkdownRenderer {
  static render(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          inCodeBlock = false;
          result.push(codeBlockLines.map((l) => chalk.gray('  ' + l)).join('\n'));
          codeBlockLines = [];
        } else {
          inCodeBlock = true;
          codeBlockLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      if (/^#{1,3}\s/.test(line)) {
        result.push(chalk.bold.cyan(line));
        continue;
      }

      if (/^[-*]\s/.test(line)) {
        result.push(chalk.white(line));
        continue;
      }

      if (/^\d+\.\s/.test(line)) {
        result.push(chalk.white(line));
        continue;
      }

      result.push(MarkdownRenderer.renderInline(line));
    }

    return result.join('\n');
  }

  private static renderInline(line: string): string {
    let result = line;

    result = result.replace(/```[\s\S]*?```/g, (match) => {
      const content = match.slice(3, -3).trim();
      return content
        .split('\n')
        .map((l) => chalk.gray('  ' + l))
        .join('\n');
    });

    result = result.replace(/`([^`]+)`/g, (_m, content: string) => chalk.cyan(content));

    result = result.replace(/\*\*(.+?)\*\*/g, (_m, content: string) => chalk.bold(content));
    result = result.replace(/__(.+?)__/g, (_m, content: string) => chalk.bold(content));

    result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_m, content: string) =>
      chalk.italic(content),
    );
    result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_m, content: string) =>
      chalk.italic(content),
    );

    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
      return chalk.underline.cyan(text) + ' ' + chalk.gray(url);
    });

    return result;
  }

  static renderTable(text: string): string {
    const rows = text.split('\n').filter((line) => line.trim().length > 0);
    if (rows.length < 3) return text;

    const parsed = rows.map((row) => {
      const cells = row
        .split(/\s{2,}|\t/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      return cells;
    });

    const colCount = parsed[0]?.length ?? 0;
    if (colCount < 2) return text;
    if (!parsed.every((r) => r.length >= 2 && Math.abs(r.length - colCount) <= 1)) return text;

    const isSeparatorRow = (cells: string[]) => cells.every((c) => /^[-:]+$/.test(c));
    if (!parsed.some((r) => isSeparatorRow(r))) return text;

    const maxLens: number[] = [];
    for (let col = 0; col < colCount; col++) {
      let max = 0;
      for (const row of parsed) {
        const cell = row[col];
        if (cell && !isSeparatorRow([cell])) {
          max = Math.max(max, stripAnsi(cell).length);
        }
      }
      maxLens.push(max);
    }

    const result: string[] = [];
    for (const row of parsed) {
      if (isSeparatorRow(row)) {
        const sep = maxLens.map((len) => chalk.gray('─'.repeat(len + 2))).join(chalk.gray('┼'));
        result.push(chalk.gray('├' + sep + '┤'));
        continue;
      }
      const padded = row.map((cell, i) => {
        const stripped = stripAnsi(cell);
        const pad = ' '.repeat(Math.max(0, (maxLens[i] ?? 0) - stripped.length));
        return chalk.white(' ' + cell + pad + ' ');
      });
      result.push(chalk.gray('│') + padded.join(chalk.gray('│')) + chalk.gray('│'));
    }

    return result.join('\n');
  }

  static renderDiff(text: string): string {
    if (!/^[+-]/m.test(text) && !/^diff /m.test(text)) return text;

    return text
      .split('\n')
      .map((line) => {
        if (/^(\+\+\+|---|\@\@|diff\s)/.test(line)) return chalk.cyan(line);
        if (line.startsWith('+')) return chalk.green(line);
        if (line.startsWith('-')) return chalk.red(line);
        return line;
      })
      .join('\n');
  }

  static truncateWithPager(text: string, maxLines: number = 40): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return (
      lines.slice(0, maxLines).join('\n') +
      '\n' +
      chalk.gray(`... (${lines.length - maxLines} more lines — Press Enter for more)`)
    );
  }
}
