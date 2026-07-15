import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile } from '../src/index.js';
import type { CheckOptions } from '../src/types.js';

const OPTS: CheckOptions = { runner: 'local', timeout: 30 };

async function mdFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rc-test-'));
  const file = join(dir, 'README.md');
  await writeFile(file, content, 'utf8');
  return file;
}

describe('checkFile (local runner)', () => {
  it('runs passing blocks and reports counts', async () => {
    const file = await mdFile('```bash\necho hello\n```\n\n```python\nprint(40 + 2)\n```\n');
    const report = await checkFile(file, OPTS);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(2);
    expect(report.steps[1]!.stdout).toContain('42');
  });

  it('persists cwd and env between blocks like a real quickstart', async () => {
    const file = await mdFile(
      [
        '```bash',
        'mkdir -p my-app && cd my-app',
        'export GREETING=ahoj',
        '```',
        '',
        '```bash',
        'test "$(basename "$PWD")" = my-app',
        'test "$GREETING" = ahoj',
        '```',
        '',
      ].join('\n'),
    );
    const report = await checkFile(file, OPTS);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(2);
  });

  it('fails on the broken block and does not run later ones', async () => {
    const file = await mdFile(
      '```bash\nfalse\n```\n\n```bash\necho never\n```\n',
    );
    const report = await checkFile(file, OPTS);
    expect(report.failed).toBe(1);
    expect(report.steps[0]!.status).toBe('failed');
    expect(report.steps[1]).toMatchObject({ status: 'skipped', skipReason: 'previous-failure' });
  });

  it('honours skip directives and per-block timeouts', async () => {
    const file = await mdFile(
      [
        '<!-- readme-check skip -->',
        '```bash',
        'exit 1',
        '```',
        '',
        '<!-- readme-check timeout=1 -->',
        '```bash',
        'sleep 5',
        '```',
        '',
      ].join('\n'),
    );
    const report = await checkFile(file, OPTS);
    expect(report.steps[0]).toMatchObject({ status: 'skipped', skipReason: 'directive' });
    expect(report.steps[1]!.status).toBe('failed');
    expect(report.steps[1]!.timedOut).toBe(true);
  }, 20_000);

  it('runs node blocks and console blocks', async () => {
    const file = await mdFile(
      '```js\nconsole.log("from node", 1 + 1)\n```\n\n```console\n$ echo prompt-stripped\nprompt-stripped\n```\n',
    );
    const report = await checkFile(file, OPTS);
    expect(report.failed).toBe(0);
    expect(report.steps[0]!.stdout).toContain('from node 2');
    expect(report.steps[1]!.stdout).toContain('prompt-stripped');
  });
});
