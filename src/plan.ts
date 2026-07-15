import type { CodeBlock, SkipReason, Step, StepKind } from './types.js';

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh']);
const CONSOLE_LANGS = new Set(['console', 'terminal', 'shell-session']);
const NODE_LANGS = new Set(['js', 'javascript', 'node', 'mjs']);
const PYTHON_LANGS = new Set(['python', 'py', 'python3']);

export type Planned = { step: Step } | { skip: SkipReason; block: CodeBlock };

/** Decide how (and whether) each block runs. */
export function planBlock(block: CodeBlock): Planned {
  if (block.directives.skip) return { skip: 'directive', block };

  let kind: StepKind;
  let source = block.code;

  if (SHELL_LANGS.has(block.lang)) {
    kind = 'shell';
  } else if (CONSOLE_LANGS.has(block.lang)) {
    // `console` blocks mix commands and output – execute only the `$ `-prefixed lines
    const commands = source
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[$>] /.test(l))
      .map((l) => l.slice(2));
    if (commands.length === 0) return { skip: 'no-commands', block };
    kind = 'shell';
    source = commands.join('\n');
  } else if (NODE_LANGS.has(block.lang)) {
    kind = 'node';
  } else if (PYTHON_LANGS.has(block.lang)) {
    kind = 'python';
  } else {
    return { skip: 'unsupported-language', block };
  }

  return { step: { block, kind, source } };
}

const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/**
 * Wrap a step in the session-state preamble: restore the working directory and
 * exported environment left behind by the previous block, run the step with
 * `set -e` semantics, and persist the state again on success. This is what
 * lets a quickstart do `cd my-app` in one block and `npm test` in the next.
 */
export function wrapStep(
  step: Step,
  opts: { workdir: string; stateDir: string; auxFile?: string },
): string {
  const { workdir, stateDir, auxFile } = opts;
  const env = Object.entries(step.block.directives.env ?? {})
    .map(([k, v]) => `export ${k}=${q(v)}`)
    .join('\n');

  const body =
    step.kind === 'shell'
      ? step.source
      : step.kind === 'node'
        ? `node ${q(auxFile!)}`
        : `python3 ${q(auxFile!)}`;

  return [
    'set -e',
    `mkdir -p ${q(stateDir)}`,
    `if [ -f ${q(stateDir + '/cwd')} ]; then cd "$(cat ${q(stateDir + '/cwd')})"; else cd ${q(workdir)}; fi`,
    `set -a; [ -f ${q(stateDir + '/env')} ] && . ${q(stateDir + '/env')} || true; set +a`,
    env,
    step.block.directives.cwd ? `cd ${q(step.block.directives.cwd)}` : '',
    body,
    `pwd > ${q(stateDir + '/cwd')}`,
    // environments can contain names bash cannot re-declare (npm exports
    // `npm_package_bin_readme-check=...`, hyphen included) – persist only
    // variables that source back cleanly
    `export -p | grep -E '^declare -x [A-Za-z_][A-Za-z0-9_]*(=|$)' > ${q(stateDir + '/env')} || true`,
  ]
    .filter(Boolean)
    .join('\n');
}
