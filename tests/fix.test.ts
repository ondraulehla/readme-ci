import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrompt, fixFile, parseCompletion, replaceBlock } from '../src/fix.js';
import { extractBlocks } from '../src/extract.js';
import type { FixOptions } from '../src/fix.js';

const OPTS: FixOptions = { runner: 'local', timeout: 30, fixModel: 'test', fixAttempts: 3 };

async function mdFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rc-fix-'));
  const file = join(dir, 'README.md');
  await writeFile(file, content, 'utf8');
  return file;
}

describe('parseCompletion', () => {
  it('extracts explanation and fixed block', () => {
    const r = parseCompletion(
      '<explanation>typo in command</explanation>\n<fixed_block>\necho ok\n</fixed_block>',
    );
    expect(r).toEqual({ code: 'echo ok', explanation: 'typo in command' });
  });

  it('returns null for <no_fix/> or malformed output', () => {
    expect(parseCompletion('<no_fix/>')).toBeNull();
    expect(parseCompletion('sorry, cannot help')).toBeNull();
  });
});

describe('replaceBlock', () => {
  it('replaces exactly the targeted block body', () => {
    const md = '# T\n\n```bash\nold line\n```\n\n```bash\nkeep me\n```\n';
    const block = extractBlocks(md, 'f.md')[0]!;
    const out = replaceBlock(md, block, 'new line 1\nnew line 2');
    expect(out).toContain('new line 1\nnew line 2');
    expect(out).not.toContain('old line');
    expect(out).toContain('keep me');
    // still exactly two blocks afterwards
    expect(extractBlocks(out, 'f.md')).toHaveLength(2);
  });
});

describe('buildPrompt', () => {
  it('includes the failing code, output and the file for context', () => {
    const md = '```bash\nboom\n```\n';
    const block = extractBlocks(md, 'f.md')[0]!;
    const prompt = buildPrompt(md, {
      block,
      status: 'failed',
      exitCode: 127,
      stdout: '',
      stderr: 'boom: command not found',
    });
    expect(prompt).toContain('boom');
    expect(prompt).toContain('command not found');
    expect(prompt).toContain('Exit code: 127');
  });
});

describe('fixFile', () => {
  it('applies the model fix, re-runs and turns the file green', async () => {
    const file = await mdFile('# T\n\n```bash\nechoo "hi"\n```\n');
    const result = await fixFile(file, OPTS, undefined, async (_system, prompt) => {
      expect(prompt).toContain('echoo');
      return '<explanation>fix typo</explanation>\n<fixed_block>\necho "hi"\n</fixed_block>';
    });
    expect(result.fixed).toBe(true);
    expect(result.report.failed).toBe(0);
    expect(result.attempts).toHaveLength(1);
    expect(await readFile(file, 'utf8')).toContain('echo "hi"');
  });

  it('gives up cleanly when the model returns <no_fix/>', async () => {
    const file = await mdFile('```bash\nfalse\n```\n');
    const result = await fixFile(file, OPTS, undefined, async () => '<no_fix/>');
    expect(result.fixed).toBe(false);
    expect(result.attempts).toHaveLength(0);
    expect(result.report.failed).toBe(1);
  });

  it('stops after fixAttempts rounds when fixes keep failing', async () => {
    const file = await mdFile('```bash\nfalse\n```\n');
    let calls = 0;
    const result = await fixFile(file, { ...OPTS, fixAttempts: 2 }, undefined, async () => {
      calls++;
      return `<explanation>still wrong</explanation>\n<fixed_block>\nfalse # attempt ${calls}\n</fixed_block>`;
    });
    expect(calls).toBe(2);
    expect(result.fixed).toBe(false);
    expect(result.report.failed).toBe(1);
  });

  it('does not touch files that already pass', async () => {
    const file = await mdFile('```bash\ntrue\n```\n');
    const before = await readFile(file, 'utf8');
    const result = await fixFile(file, OPTS, undefined, async () => {
      throw new Error('model must not be called');
    });
    expect(result.report.failed).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(before);
  });
});
