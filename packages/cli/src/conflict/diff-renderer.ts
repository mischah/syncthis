import { Chalk } from 'chalk';
import { createTwoFilesPatch } from 'diff';

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
  return 5;
}

function makeLine(char: string, width: number): string {
  return char.repeat(width);
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
  output.push(hrLine);

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    const hunkLabel = `  @@ Zeile ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines - 1}`;
    const remaining = width - hunkLabel.length - 1;
    const hunkLine = `${hunkLabel} ${makeLine('─', Math.max(0, remaining))}`;
    output.push(hunkLine);

    for (const line of hunk.lines) {
      if (line.type === 'context') {
        output.push(chalk.dim(`  ${line.content}`));
      } else if (line.type === 'removed') {
        output.push(chalk.red(`  ${line.content}`));
      } else {
        output.push(chalk.green(`  ${line.content}`));
      }
    }

    if (i < hunks.length - 1) {
      output.push('');
    }
  }

  return `${output.join('\n')}\n`;
}
