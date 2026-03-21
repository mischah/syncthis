import type { DiffHunk, DiffLine, FileDiff } from '@syncthis/shared';
import { useMemo } from 'react';
import './DiffView.css';

interface DiffViewProps {
  diff: FileDiff;
  mode?: 'unified' | 'hunk';
  activeHunkIndex?: number;
}

const CONTEXT_PAD = 1;

/** Unified mode: full file with all context lines between hunks. */
function buildUnifiedLines(diff: FileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  const { sourceLines, hunks } = diff;
  let pos = 0;

  for (const hunk of hunks) {
    const hunkStart = hunk.startLine - 1;
    for (let i = pos; i < hunkStart; i++) {
      result.push({ type: 'context', text: sourceLines[i] });
    }
    for (const line of hunk.lines) {
      result.push(line);
    }
    pos = hunkStart + hunk.localLines.length;
  }

  for (let i = pos; i < sourceLines.length; i++) {
    result.push({ type: 'context', text: sourceLines[i] });
  }
  return result;
}

/** Hunk mode: single hunk with context padding from sourceLines. */
function buildHunkLines(hunk: DiffHunk, sourceLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  const hunkStart = hunk.startLine - 1;

  const ctxBefore = Math.max(0, hunkStart - CONTEXT_PAD);
  for (let i = ctxBefore; i < hunkStart; i++) {
    result.push({ type: 'context', text: sourceLines[i] });
  }

  for (const line of hunk.lines) {
    result.push(line);
  }

  const afterStart = hunkStart + hunk.localLines.length;
  const afterEnd = Math.min(sourceLines.length, afterStart + CONTEXT_PAD);
  for (let i = afterStart; i < afterEnd; i++) {
    result.push({ type: 'context', text: sourceLines[i] });
  }

  return result;
}

export function DiffView({ diff, mode = 'unified', activeHunkIndex }: DiffViewProps) {
  const linesToRender = useMemo(() => {
    if (mode === 'unified') {
      return buildUnifiedLines(diff);
    }
    const hunk = diff.hunks.find((h) => h.index === activeHunkIndex);
    return hunk ? buildHunkLines(hunk, diff.sourceLines) : [];
  }, [diff, mode, activeHunkIndex]);

  const activeHunk =
    mode === 'hunk' && activeHunkIndex !== undefined
      ? diff.hunks.find((h) => h.index === activeHunkIndex)
      : undefined;

  return (
    <div className="diff-view">
      <div className="diff-legend">
        <span className="diff-legend-local">local version</span>
        <span className="diff-legend-remote">remote version</span>
      </div>
      {activeHunk && <div className="diff-hunk-header">@@ Line {activeHunk.startLine} @@</div>}
      {linesToRender.map((line, li) => (
        <div key={`${line.type}-${li}`} className={`diff-line diff-line-${line.type}`}>
          {line.text || '\u00A0'}
        </div>
      ))}
    </div>
  );
}
