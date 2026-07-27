import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { checkFile } from './index.js';
import { extractBlocks } from './extract.js';
import type { CheckOptions, CodeBlock, FileReport, StepReport } from './types.js';

/** Produce a completion for a prompt – injectable so tests run without a key. */
export type Complete = (system: string, prompt: string) => Promise<string>;

export interface FixOptions extends CheckOptions {
  /** Anthropic model id */
  fixModel: string;
  /** max fix attempts per file */
  fixAttempts: number;
}

export interface FixAttempt {
  block: CodeBlock;
  oldCode: string;
  newCode: string;
  explanation: string;
}

const SYSTEM = `You repair broken quickstart code blocks in README files.
You are given the full markdown, the single failing code block, and the captured
output of running it. Earlier blocks succeeded and their side effects (created
files, working directory, environment) are still in place when the fixed block
runs. Propose the smallest change to the FAILING BLOCK ONLY that makes it work
while preserving the documented intent.

Reply with exactly:
<explanation>one short sentence</explanation>
<fixed_block>
the complete corrected content of the failing block, no code fences
</fixed_block>

If the failure cannot be fixed by editing this block alone, reply with <no_fix/>.`;

export function buildPrompt(markdown: string, step: StepReport): string {
  const b = step.block;
  return [
    `Failing block (${b.file}:${b.startLine}, language ${b.lang || 'unknown'}):`,
    '<failing_block>',
    b.code,
    '</failing_block>',
    '',
    `Exit code: ${step.exitCode}${step.timedOut ? ' (timed out)' : ''}`,
    '<stdout>',
    (step.stdout ?? '').slice(-4000),
    '</stdout>',
    '<stderr>',
    (step.stderr ?? '').slice(-4000),
    '</stderr>',
    '',
    'Full markdown file for context:',
    '<markdown>',
    markdown.slice(0, 24_000),
    '</markdown>',
  ].join('\n');
}

/**
 * Completer backed by the local `claude` CLI (Claude Code) – uses whatever
 * login the user already has (subscription or CLAUDE_CODE_OAUTH_TOKEN), so no
 * separate API key is needed.
 */
export function claudeCliComplete(model: string): Complete {
  return (system, prompt) =>
    new Promise((resolve, reject) => {
      // when readme-ci itself runs inside a Claude Code session, the inherited
      // ANTHROPIC_BASE_URL points at the host session's proxy and breaks the
      // nested CLI's own auth - drop it for the child in that case
      const env = { ...process.env };
      if (env.CLAUDECODE) delete env.ANTHROPIC_BASE_URL;
      const child = spawn('claude', ['-p', '--model', model], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('failed to spawn the claude CLI'));
      });
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`));
      });
      child.stdin.end(`${system}\n\n${prompt}`);
    });
}

/**
 * Pick the completer for --fix: a raw API key wins, otherwise fall back to
 * the Claude Code CLI when it is installed.
 */
export function defaultComplete(model: string): Complete {
  if (process.env.ANTHROPIC_API_KEY) return anthropicComplete(model);
  if (cliAvailable()) return claudeCliComplete(model);
  return async () => {
    throw new Error(
      '--fix needs ANTHROPIC_API_KEY, or the `claude` CLI (Claude Code) installed and logged in',
    );
  };
}

function cliAvailable(): boolean {
  try {
    return spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
}

/** Completer for the Anthropic Messages API via plain fetch (no SDK). */
export function anthropicComplete(model: string): Complete {
  return async (system, prompt) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('--fix needs ANTHROPIC_API_KEY in the environment');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).map((c) => c.text ?? '').join('');
  };
}

export function parseCompletion(text: string): { code: string; explanation: string } | null {
  if (/<no_fix\s*\/>/.test(text)) return null;
  const code = text.match(/<fixed_block>\r?\n?([\s\S]*?)\r?\n?<\/fixed_block>/)?.[1];
  if (code === undefined) return null;
  const explanation = text.match(/<explanation>([\s\S]*?)<\/explanation>/)?.[1]?.trim() ?? '';
  return { code, explanation };
}

/** Replace the body of the block that opens on `startLine` (1-based). */
export function replaceBlock(markdown: string, block: CodeBlock, newCode: string): string {
  const lines = markdown.split(/\r?\n/);
  const openIdx = block.startLine - 1;
  const marker = lines[openIdx]?.trim().match(/^(`{3,}|~{3,})/)?.[1];
  if (!marker) throw new Error(`no fence found at ${block.file}:${block.startLine}`);
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (m && m[1]![0] === marker[0] && m[1]!.length >= marker.length) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) throw new Error(`unclosed fence at ${block.file}:${block.startLine}`);
  return [...lines.slice(0, openIdx + 1), ...newCode.split('\n'), ...lines.slice(closeIdx)].join(
    '\n',
  );
}

export interface FixResult {
  report: FileReport;
  attempts: FixAttempt[];
  fixed: boolean;
}

/**
 * Run a file; on failure ask the model for a repaired block, apply it to the
 * file in place (review with `git diff`) and re-run – up to `fixAttempts`
 * times. Returns the final report and every applied attempt.
 */
export async function fixFile(
  file: string,
  opts: FixOptions,
  onStep?: (r: StepReport) => void,
  complete: Complete = defaultComplete(opts.fixModel),
  onAttempt?: (a: FixAttempt, round: number) => void,
): Promise<FixResult> {
  const attempts: FixAttempt[] = [];
  let report = await checkFile(file, opts, onStep);

  for (let round = 1; report.failed > 0 && round <= opts.fixAttempts; round++) {
    const failing = report.steps.find((s) => s.status === 'failed')!;
    const markdown = await readFile(file, 'utf8');
    // re-anchor the block in the current file content (earlier rounds edited it)
    const block = extractBlocks(markdown, file).find(
      (b) => b.startLine === failing.block.startLine,
    );
    if (!block) break;

    const completion = await complete(SYSTEM, buildPrompt(markdown, { ...failing, block }));
    const fix = parseCompletion(completion);
    if (!fix || fix.code.trim() === block.code.trim()) break;

    await writeFile(file, replaceBlock(markdown, block, fix.code), 'utf8');
    const attempt: FixAttempt = {
      block,
      oldCode: block.code,
      newCode: fix.code,
      explanation: fix.explanation,
    };
    attempts.push(attempt);
    onAttempt?.(attempt, round);

    report = await checkFile(file, opts, onStep);
  }

  return { report, attempts, fixed: attempts.length > 0 && report.failed === 0 };
}
