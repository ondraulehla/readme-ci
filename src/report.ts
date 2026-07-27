import type { FixAttempt } from './fix.js';
import type { FileReport, StepReport } from './types.js';

const tty = process.stdout.isTTY;
const c = (code: number, s: string) => (tty ? `[${code}m${s}[0m` : s);
const green = (s: string) => c(32, s);
const red = (s: string) => c(31, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);

const SKIP_LABEL: Record<string, string> = {
  directive: 'skipped (directive)',
  'unsupported-language': 'skipped',
  'no-commands': 'skipped (no commands)',
  'previous-failure': 'not run (earlier block failed)',
};

function preview(code: string): string {
  const first = code.split('\n').find((l) => l.trim() !== '') ?? '';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

export function printStep(r: StepReport, verbose = false): void {
  const where = dim(`${r.block.file}:${r.block.startLine}`);
  const lang = dim(`[${r.block.lang || '?'}]`);
  const head = `${where} ${lang} ${preview(r.block.code)}`;

  if (r.status === 'skipped') {
    if (r.skipReason === 'unsupported-language') return; // prose examples – stay quiet
    console.log(`  ${dim('○')} ${head} ${dim(`– ${SKIP_LABEL[r.skipReason!]}`)}`);
    return;
  }

  const time = dim(`(${((r.durationMs ?? 0) / 1000).toFixed(1)}s)`);
  if (r.status === 'passed') {
    console.log(`  ${green('✓')} ${head} ${time}`);
    if (verbose && r.stdout?.trim()) console.log(indent(dim(tail(r.stdout, 20))));
    return;
  }

  const why = r.timedOut ? 'timed out' : `exit ${r.exitCode}`;
  console.log(`  ${red('✗')} ${head} ${red(`– ${why}`)} ${time}`);
  const output = [tail(r.stdout ?? '', 15), tail(r.stderr ?? '', 15)].filter(Boolean).join('\n');
  if (output) console.log(indent(output));

  if (process.env.GITHUB_ACTIONS) {
    const msg = `code block failed (${why}): ${preview(r.block.code)}`;
    console.log(`::error file=${r.block.file},line=${r.block.startLine}::${msg}`);
  }
}

export function printFixAttempt(a: FixAttempt, round: number): void {
  const where = dim(`${a.block.file}:${a.block.startLine}`);
  console.log(`\n  🔧 fix attempt ${round} ${where} – ${a.explanation || 'rewriting the failing block'}`);
  for (const l of a.oldCode.split('\n')) console.log(red(`    - ${l}`));
  for (const l of a.newCode.split('\n')) console.log(green(`    + ${l}`));
  console.log('');
}

export function printSummary(reports: FileReport[]): void {
  const passed = reports.reduce((n, r) => n + r.passed, 0);
  const failed = reports.reduce((n, r) => n + r.failed, 0);
  const parts = [green(`${passed} passed`)];
  if (failed) parts.push(red(`${failed} failed`));
  console.log(`\n${bold(failed ? red('✗') : green('✓'))} ${parts.join(', ')}`);
}

function tail(s: string, lines: number): string {
  const all = s.trimEnd().split('\n');
  const cut = all.slice(-lines);
  return (all.length > lines ? ['…', ...cut] : cut).join('\n').trim();
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => `      ${l}`)
    .join('\n');
}
