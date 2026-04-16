import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';

export interface ProjectContext {
  type: string;
  name: string;
  language: string;
  framework?: string | undefined;
  fileCount: number;
  totalLines: number;
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  lastGitCommit?: string | undefined;
  hasTests: boolean;
  summary: string;
}

export async function detectProject(rootDir: string): Promise<ProjectContext | null> {
  const packageJsonPath = join(rootDir, 'package.json');

  if (existsSync(packageJsonPath)) {
    return detectNodeProject(rootDir, packageJsonPath);
  }

  const pyprojectPath = join(rootDir, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    return detectPythonProject(rootDir);
  }

  return detectGenericProject(rootDir);
}

async function detectNodeProject(
  rootDir: string,
  packageJsonPath: string,
): Promise<ProjectContext> {
  let pkg: Record<string, unknown> = {};
  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    pkg = JSON.parse(content);
  } catch {
    // fallback
  }

  const name = (pkg['name'] as string) ?? 'unknown';
  const deps = Object.keys((pkg['dependencies'] as Record<string, string>) ?? {});
  const devDeps = Object.keys((pkg['devDependencies'] as Record<string, string>) ?? {});
  const scripts = (pkg['scripts'] as Record<string, string>) ?? {};

  let language = 'JavaScript';
  let framework: string | undefined;

  if (existsSync(join(rootDir, 'tsconfig.json'))) {
    language = 'TypeScript';
  }

  if (deps.includes('react') || devDeps.includes('react')) framework = 'React';
  else if (deps.includes('next') || devDeps.includes('next')) framework = 'Next.js';
  else if (deps.includes('express')) framework = 'Express';
  else if (deps.includes('fastify')) framework = 'Fastify';
  else if (deps.includes('@nestjs/core')) framework = 'NestJS';

  const extensions = language === 'TypeScript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
  const counts = await countFilesAndLines(rootDir, extensions);

  let lastGitCommit: string | undefined;
  try {
    const { execa } = await import('execa');
    const result = await execa('git', ['log', '-1', '--oneline'], {
      cwd: rootDir,
      timeout: 5000,
      reject: false,
    });
    lastGitCommit = result.stdout?.trim() || undefined;
  } catch {
    // git not available
  }

  const hasTests =
    existsSync(join(rootDir, 'test')) ||
    existsSync(join(rootDir, 'tests')) ||
    existsSync(join(rootDir, '__tests__')) ||
    existsSync(join(rootDir, 'jest.config.js')) ||
    existsSync(join(rootDir, 'jest.config.ts')) ||
    existsSync(join(rootDir, 'vitest.config.ts'));

  const summary = buildSummary({
    type: 'Node.js',
    name,
    language,
    framework,
    fileCount: counts.files,
    totalLines: counts.lines,
    dependencies: deps,
    devDependencies: devDeps,
    scripts,
    lastGitCommit,
    hasTests,
  });

  return {
    type: 'Node.js',
    name,
    language,
    framework,
    fileCount: counts.files,
    totalLines: counts.lines,
    dependencies: deps,
    devDependencies: devDeps,
    scripts,
    lastGitCommit,
    hasTests,
    summary,
  };
}

async function detectPythonProject(rootDir: string): Promise<ProjectContext> {
  const counts = await countFilesAndLines(rootDir, ['.py']);

  return {
    type: 'Python',
    name: rootDir.split('/').pop() ?? 'unknown',
    language: 'Python',
    fileCount: counts.files,
    totalLines: counts.lines,
    dependencies: [],
    devDependencies: [],
    scripts: {},
    hasTests: existsSync(join(rootDir, 'tests')) || existsSync(join(rootDir, 'test')),
    summary: `Python project (${counts.files} files, ${counts.lines} lines)`,
  };
}

async function detectGenericProject(rootDir: string): Promise<ProjectContext | null> {
  const counts = await countFilesAndLines(rootDir, []);

  if (counts.files === 0) return null;

  return {
    type: 'Generic',
    name: rootDir.split('/').pop() ?? 'unknown',
    language: 'Mixed',
    fileCount: counts.files,
    totalLines: counts.lines,
    dependencies: [],
    devDependencies: [],
    scripts: {},
    hasTests: false,
    summary: `Generic project (${counts.files} files, ${counts.lines} lines)`,
  };
}

async function countFilesAndLines(
  rootDir: string,
  extensions: string[],
  maxDepth: number = 5,
): Promise<{ files: number; lines: number }> {
  const skipDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '__pycache__',
    '.cache',
  ]);

  let fileCount = 0;
  let totalLines = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (extensions.length > 0 && !extensions.includes(ext)) continue;

        fileCount++;
        try {
          const content = await readFile(join(dir, entry.name), 'utf-8');
          totalLines += content.split('\n').length;
        } catch {
          // binary or unreadable
        }
      }
    }
  }

  await walk(rootDir, 0);
  return { files: fileCount, lines: totalLines };
}

function buildSummary(ctx: Omit<ProjectContext, 'summary'>): string {
  const parts: string[] = [];

  parts.push(`Detected: ${ctx.type} + ${ctx.language} project`);
  if (ctx.framework) parts.push(`(${ctx.framework})`);

  parts.push(`- ${ctx.fileCount} files, ${ctx.totalLines.toLocaleString()} lines`);

  if (ctx.dependencies.length > 0) {
    const keyDeps = ctx.dependencies.slice(0, 5).join(', ');
    const more = ctx.dependencies.length > 5 ? ` +${ctx.dependencies.length - 5} more` : '';
    parts.push(`- Dependencies: ${keyDeps}${more}`);
  }

  if (ctx.lastGitCommit) {
    parts.push(`- Last commit: ${ctx.lastGitCommit}`);
  }

  if (ctx.hasTests) {
    parts.push(`- Tests found`);
  } else {
    parts.push(`- No tests found`);
  }

  return parts.join('\n');
}

export function contextToSystemAppendix(ctx: ProjectContext): string {
  const lines: string[] = [
    '\n## Project Context',
    `Project: ${ctx.name} (${ctx.type})`,
    `Language: ${ctx.language}`,
  ];

  if (ctx.framework) lines.push(`Framework: ${ctx.framework}`);

  lines.push(`Files: ${ctx.fileCount} | Lines: ${ctx.totalLines.toLocaleString()}`);

  if (ctx.dependencies.length > 0) {
    lines.push(`Dependencies: ${ctx.dependencies.join(', ')}`);
  }

  if (ctx.scripts && Object.keys(ctx.scripts).length > 0) {
    lines.push(`Available scripts: ${Object.keys(ctx.scripts).join(', ')}`);
  }

  return lines.join('\n');
}
