import type { CodeBlock, Directives } from './types.js';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
const DIRECTIVE = /^ {0,3}<!--\s*readme-check\b(.*?)-->\s*$/;

/**
 * Extract fenced code blocks from markdown source, together with any
 * `<!-- readme-check ... -->` directive comments that immediately precede
 * them (blank lines in between are allowed).
 */
export function extractBlocks(markdown: string, file: string): CodeBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: CodeBlock[] = [];

  let open: { marker: string; lang: string; startLine: number; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (open) {
      const fenceChar = open.marker[0]!;
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1]![0] === fenceChar && close[1]!.length >= open.marker.length) {
        blocks.push({
          lang: open.lang,
          code: open.body.join('\n'),
          startLine: open.startLine,
          file,
          directives: directivesBefore(lines, open.startLine - 1),
        });
        open = null;
      } else {
        open.body.push(line);
      }
      continue;
    }

    const m = line.match(FENCE_OPEN);
    if (m) {
      // info strings containing a backtick are not valid fence openers
      if (m[1]![0] === '`' && m[2]!.includes('`')) continue;
      open = {
        marker: m[1]!,
        lang: (m[2]!.trim().split(/\s+/)[0] ?? '').toLowerCase(),
        startLine: i + 1,
        body: [],
      };
    }
  }

  return blocks;
}

/** Collect directives from comment lines directly above `fenceIndex` (0-based). */
function directivesBefore(lines: string[], fenceIndex: number): Directives {
  const d: Directives = {};
  for (let i = fenceIndex - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const m = line.match(DIRECTIVE);
    if (!m) break;
    applyDirective(d, m[1]!.trim());
  }
  return d;
}

function applyDirective(d: Directives, body: string): void {
  for (const token of body.split(/\s+/).filter(Boolean)) {
    if (token === 'skip') {
      d.skip = true;
    } else if (token.startsWith('timeout=')) {
      const n = Number(token.slice('timeout='.length));
      if (Number.isFinite(n) && n > 0) d.timeout = n;
    } else if (token.startsWith('cwd=')) {
      d.cwd = token.slice('cwd='.length);
    } else if (token.includes('=')) {
      const eq = token.indexOf('=');
      d.env = { ...d.env, [token.slice(0, eq)]: token.slice(eq + 1) };
    }
  }
}
