import { describe, expect, it } from 'vitest';
import { extractBlocks } from '../src/extract.js';
import { planBlock, wrapStep } from '../src/plan.js';

const md = (s: string) => s.replace(/^ {2}/gm, '').trim() + '\n';

describe('extractBlocks', () => {
  it('extracts fences with language and 1-based start lines', () => {
    const src = md(`
  # Title

  \`\`\`bash
  echo hi
  \`\`\`
  `);
    const blocks = extractBlocks(src, 'README.md');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ lang: 'bash', code: 'echo hi', startLine: 3, file: 'README.md' });
  });

  it('handles ~~~ fences, longer fences and preserves inner backticks', () => {
    const src = md(`
  ~~~python
  print("x")
  ~~~

  \`\`\`\`markdown
  \`\`\`js
  inner
  \`\`\`
  \`\`\`\`
  `);
    const blocks = extractBlocks(src, 'f.md');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lang).toBe('python');
    expect(blocks[1]!.code).toContain('```js');
  });

  it('reads directives from preceding comments (blank lines allowed)', () => {
    const src = md(`
  <!-- readme-check skip -->

  \`\`\`bash
  rm -rf /
  \`\`\`

  <!-- readme-check timeout=42 cwd=examples FOO=bar BAZ=qu=ux -->
  \`\`\`bash
  ls
  \`\`\`
  `);
    const [a, b] = extractBlocks(src, 'f.md');
    expect(a!.directives.skip).toBe(true);
    expect(b!.directives).toEqual({ timeout: 42, cwd: 'examples', env: { FOO: 'bar', BAZ: 'qu=ux' } });
  });

  it('ignores comments separated by prose', () => {
    const src = md(`
  <!-- readme-check skip -->
  Some prose in between.

  \`\`\`bash
  echo run me
  \`\`\`
  `);
    expect(extractBlocks(src, 'f.md')[0]!.directives.skip).toBeUndefined();
  });
});

describe('planBlock', () => {
  const block = (lang: string, code: string) => ({
    lang,
    code,
    startLine: 1,
    file: 'f.md',
    directives: {},
  });

  it('maps shell-family languages to shell steps', () => {
    for (const lang of ['bash', 'sh', 'shell', 'zsh']) {
      const p = planBlock(block(lang, 'echo x'));
      expect('step' in p && p.step.kind).toBe('shell');
    }
  });

  it('strips prompts from console blocks and skips output-only ones', () => {
    const p = planBlock(block('console', '$ npm i\ninstalled 12 packages\n$ npm test'));
    expect('step' in p && p.step.source).toBe('npm i\nnpm test');
    const out = planBlock(block('console', 'just output'));
    expect('skip' in out && out.skip).toBe('no-commands');
  });

  it('skips unsupported languages and honours skip directives', () => {
    expect('skip' in planBlock(block('json', '{}'))).toBe(true);
    const p = planBlock({ ...block('bash', 'x'), directives: { skip: true } });
    expect('skip' in p && p.skip).toBe('directive');
  });
});

describe('wrapStep', () => {
  it('produces a script that restores and persists session state', () => {
    const p = planBlock({ lang: 'bash', code: 'echo hi', startLine: 1, file: 'f', directives: {} });
    const script = wrapStep(('step' in p && p.step)!, { workdir: '/w', stateDir: '/s' });
    expect(script).toContain('set -e');
    expect(script).toContain("cd '/w'");
    expect(script).toContain("pwd > '/s/cwd'");
    expect(script).toContain("> '/s/env'");
  });
});
