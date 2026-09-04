import { Pipe, PipeTransform } from '@angular/core';
import { AcpMessage } from './acp.service';
import type { EmbeddedResource } from './acp-websocket.service';
import { renderMarkdownSync } from '../utils/markdown.util';

export interface EditDiffInfo {
  additions: number;
  deletions: number;
  diff: string;
}

export interface ReadInfo {
  offset?: number;
  limit?: number;
  lineStart?: number;
  lineEnd?: number;
  totalLines?: number;
}

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  lineNum?: number;
  content: string;
}

@Pipe({ name: 'editDiff', standalone: true, pure: true })
export class EditDiffPipe implements PipeTransform {
  transform(message: AcpMessage): EditDiffInfo | null {
    if (message.toolKind !== 'edit') return null;
    const rawOutput = message.toolRawOutput as any;
    const filediff = rawOutput?.metadata?.filediff;
    if (filediff) {
      return {
        additions: filediff.additions || 0,
        deletions: filediff.deletions || 0,
        diff: filediff.patch || ''
      };
    }
    const diff = rawOutput?.metadata?.diff;
    if (diff) {
      const additions = (diff.match(/^\+[^+]/gm) || []).length;
      const deletions = (diff.match(/^-[^-]/gm) || []).length;
      return { additions, deletions, diff };
    }
    return null;
  }
}

@Pipe({ name: 'readInfo', standalone: true, pure: true })
export class ReadInfoPipe implements PipeTransform {
  transform(message: AcpMessage): ReadInfo | null {
    if (message.toolKind !== 'read') return null;
    const rawInput = message.toolRawInput as any;
    const rawOutput = message.toolRawOutput as any;
    const display = rawOutput?.metadata?.display;
    return {
      offset: rawInput?.offset,
      limit: rawInput?.limit,
      lineStart: display?.lineStart,
      lineEnd: display?.lineEnd,
      totalLines: display?.totalLines
    };
  }
}

@Pipe({ name: 'parseDiff', standalone: true, pure: true })
export class ParseDiffPipe implements PipeTransform {
  transform(diff: string): DiffLine[] {
    const lines: DiffLine[] = [];
    if (!diff) return lines;
    
    const diffLines = diff.split('\n');
    let lineNum = 0;
    
    for (const line of diffLines) {
      if (line.startsWith('Index:') || line.startsWith('===') || 
          line.startsWith('---') || line.startsWith('+++')) {
        continue;
      }
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        lineNum = parseInt(hunkMatch[1], 10);
        continue;
      }
      if (line.startsWith('+')) {
        lines.push({ type: 'add', lineNum, content: line.slice(1) });
        lineNum++;
      } else if (line.startsWith('-')) {
        lines.push({ type: 'del', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        lines.push({ type: 'context', lineNum, content: line.slice(1) });
        lineNum++;
      }
    }
    return lines;
  }
}

@Pipe({ name: 'formatMessage', standalone: true, pure: true })
export class FormatMessagePipe implements PipeTransform {
  transform(content: string): string {
    return renderMarkdownSync(content);
  }
}

@Pipe({ name: 'resourceName', standalone: true, pure: true })
export class ResourceNamePipe implements PipeTransform {
  transform(block: EmbeddedResource): string {
    const uri = block.resource.uri;
    return uri.split(/[\\/]/).pop() || uri;
  }
}

@Pipe({ name: 'completedCount', standalone: true, pure: true })
export class CompletedCountPipe implements PipeTransform {
  transform(message: AcpMessage): number {
    const rawOutput = message.toolRawOutput as any;
    const fromOutput = rawOutput?.metadata?.todos;
    if (Array.isArray(fromOutput) && fromOutput.length > 0) {
      return fromOutput.filter((t: any) => t.status === 'completed').length;
    }
    const rawInput = message.toolRawInput as any;
    const fromInput = rawInput?.todos;
    if (Array.isArray(fromInput) && fromInput.length > 0) {
      return fromInput.filter((t: any) => t.status === 'completed').length;
    }
    return 0;
  }
}
