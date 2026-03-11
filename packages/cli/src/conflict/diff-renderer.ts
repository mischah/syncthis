import { Chalk } from 'chalk';
import { createTwoFilesPatch, diffWords } from 'diff';

// Force colors — this function always returns colored terminal output
const chalk = new Chalk({ level: 3 });

export interface DiffLine {
  type: 'context' | 'removed' | 'added';
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffRendererOptions {
  terminalWidth?: number;
  localLabel?: string;
  remoteLabel?: string;
}

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split('\n');

  let current: DiffHunk | null = null;

  for (const line of lines) {
    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number.parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1,
        newStart: Number.parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] !== undefined ? Number.parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    // Skip file header lines
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) continue;
    if (line.startsWith('\\ No newline')) continue;

    if (line.startsWith('-')) {
      current.lines.push({ type: 'removed', content: line.slice(1) });
    } else if (line.startsWith('+')) {
      current.lines.push({ type: 'added', content: line.slice(1) });
    } else if (line.startsWith(' ')) {
      current.lines.push({ type: 'context', content: line.slice(1) });
    }
  }

  if (current) hunks.push(current);
  return hunks;
}

export function getContextLines(totalLines: number): number | 'full' {
  if (totalLines < 50) return 'full';
  return 3;
}

export function highlightWordDiff(
  oldLine: string,
  newLine: string,
): { formattedOld: string; formattedNew: string } {
  const changes = diffWords(oldLine, newLine);
  let formattedOld = '';
  let formattedNew = '';

  for (const change of changes) {
    if (change.removed) {
      formattedOld += chalk.bgRedBright.white(change.value);
    } else if (change.added) {
      formattedNew += chalk.bgGreenBright.black(change.value);
    } else {
      formattedOld += chalk.red(change.value);
      formattedNew += chalk.green(change.value);
    }
  }

  return { formattedOld, formattedNew };
}

function makeLine(char: string, width: number): string {
  return char.repeat(width);
}

function formatLineRange(oldStart: number, oldLines: number): string {
  if (oldLines <= 1) return `Zeile ${oldStart}`;
  return `Zeile ${oldStart}-${oldStart + oldLines - 1}`;
}

export function renderConflictDiff(
  filePath: string,
  localContent: string,
  remoteContent: string,
  options?: DiffRendererOptions,
): string {
  const width = options?.terminalWidth ?? process.stdout.columns ?? 80;
  const hrLine = makeLine('─', width);

  // Special cases
  if (localContent === '' || remoteContent === '') {
    const header = [hrLine, `  ${filePath}`, hrLine].join('\n');
    return `${header}\n\n  ${chalk.dim('(File is empty)')}\n`;
  }

  // Binary detection
  const hasBinary = (s: string) => s.includes('\0');
  if (hasBinary(localContent) || hasBinary(remoteContent)) {
    const header = [hrLine, `  ${filePath}`, hrLine].join('\n');
    return `${header}\n\n  ${chalk.dim('Binary file, cannot display diff')}\n`;
  }

  if (localContent === remoteContent) {
    const header = [hrLine, `  ${filePath}`, hrLine].join('\n');
    return `${header}\n\n  ${chalk.dim('Files are identical')}\n`;
  }

  const totalLines = Math.max(localContent.split('\n').length, remoteContent.split('\n').length);
  const contextAmount = getContextLines(totalLines);
  const contextLines = contextAmount === 'full' ? totalLines : contextAmount;

  const unifiedDiff = createTwoFilesPatch(
    filePath,
    filePath,
    localContent,
    remoteContent,
    'local',
    'remote',
    { context: contextLines },
  );

  const hunks = parseUnifiedDiff(unifiedDiff);

  const output: string[] = [];
  output.push(hrLine);
  output.push(`  ${filePath}`);
  if (options?.localLabel && options?.remoteLabel) {
    output.push(
      `  ${chalk.red('■')} ${options.localLabel}   ${chalk.green('■')} ${options.remoteLabel}`,
    );
  }
  output.push(hrLine);

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    const hunkLabel = `  @@ ${formatLineRange(hunk.oldStart, hunk.oldLines)}`;
    const remaining = width - hunkLabel.length - 1;
    const hunkLine = `${hunkLabel} ${makeLine('─', Math.max(0, remaining))}`;
    output.push(hunkLine);

    const lines = hunk.lines;
    let j = 0;
    while (j < lines.length) {
      const line = lines[j];
      if (line.type === 'context') {
        output.push(chalk.dim(`  ${line.content}`));
        j++;
      } else if (line.type === 'removed') {
        const removed: string[] = [];
        while (j < lines.length && lines[j].type === 'removed') {
          removed.push(lines[j].content);
          j++;
        }
        const added: string[] = [];
        while (j < lines.length && lines[j].type === 'added') {
          added.push(lines[j].content);
          j++;
        }
        const pairCount = Math.min(removed.length, added.length);
        for (let k = 0; k < pairCount; k++) {
          const { formattedOld, formattedNew } = highlightWordDiff(removed[k], added[k]);
          output.push(`  ${formattedOld}`);
          output.push(`  ${formattedNew}`);
        }
        for (let k = pairCount; k < removed.length; k++) {
          output.push(chalk.red(`  ${removed[k]}`));
        }
        for (let k = pairCount; k < added.length; k++) {
          output.push(chalk.green(`  ${added[k]}`));
        }
      } else {
        output.push(chalk.green(`  ${line.content}`));
        j++;
      }
    }

    if (i < hunks.length - 1) {
      output.push('');
    }
  }

  return `${output.join('\n')}\n`;
}

export interface StatusLineOptions {
  fileIndex: number;
  fileTotal: number;
  fileName: string;
  filesResolved?: number;
  hunkIndex?: number;
  hunkTotal?: number;
  hunksResolved?: number;
}

export function renderStatusLine(opts: StatusLineOptions): string {
  const lines: string[] = [];

  const fileResolved = opts.filesResolved ?? 0;
  let fileLine = `  File ${opts.fileIndex + 1} of ${opts.fileTotal} · ${opts.fileName}`;
  if (fileResolved > 0) {
    fileLine += ` · ${fileResolved} resolved`;
  }
  if (opts.hunkIndex == null && opts.hunkTotal != null && opts.hunkTotal > 1) {
    fileLine += ` · ${opts.hunkTotal} hunks`;
  }
  lines.push(fileLine);

  if (opts.hunkIndex != null && opts.hunkTotal != null) {
    let hunkLine = `  Hunk ${opts.hunkIndex + 1} of ${opts.hunkTotal}`;
    const hunksResolved = opts.hunksResolved ?? 0;
    if (hunksResolved > 0) {
      hunkLine += ` · ${hunksResolved} resolved`;
    }
    lines.push(hunkLine);
  }

  return lines.join('\n');
}

export function renderSingleHunk(hunk: DiffHunk, options?: DiffRendererOptions): string {
  const width = options?.terminalWidth ?? process.stdout.columns ?? 80;
  const output: string[] = [];

  const hunkLabel = `  @@ ${formatLineRange(hunk.oldStart, hunk.oldLines)}`;
  const remaining = width - hunkLabel.length - 1;
  output.push(`${hunkLabel} ${'─'.repeat(Math.max(0, remaining))}`);

  if (options?.localLabel && options?.remoteLabel) {
    output.push(
      `  ${chalk.red('■')} ${options.localLabel}   ${chalk.green('■')} ${options.remoteLabel}`,
    );
  }

  const { lines } = hunk;
  let j = 0;
  while (j < lines.length) {
    const line = lines[j];
    if (line.type === 'context') {
      output.push(chalk.dim(`  ${line.content}`));
      j++;
    } else if (line.type === 'removed') {
      const removed: string[] = [];
      while (j < lines.length && lines[j].type === 'removed') {
        removed.push(lines[j].content);
        j++;
      }
      const added: string[] = [];
      while (j < lines.length && lines[j].type === 'added') {
        added.push(lines[j].content);
        j++;
      }
      const pairCount = Math.min(removed.length, added.length);
      for (let k = 0; k < pairCount; k++) {
        const { formattedOld, formattedNew } = highlightWordDiff(removed[k], added[k]);
        output.push(`  ${formattedOld}`);
        output.push(`  ${formattedNew}`);
      }
      for (let k = pairCount; k < removed.length; k++) {
        output.push(chalk.red(`  ${removed[k]}`));
      }
      for (let k = pairCount; k < added.length; k++) {
        output.push(chalk.green(`  ${added[k]}`));
      }
    } else {
      output.push(chalk.green(`  ${line.content}`));
      j++;
    }
  }

  return output.join('\n');
}
