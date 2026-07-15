import { readFile } from 'node:fs/promises';
import { extractBlocks } from './extract.js';
import { planBlock, wrapStep } from './plan.js';
import { startDockerSession } from './runners/docker.js';
import { startE2bSession } from './runners/e2b.js';
import { startLocalSession } from './runners/local.js';
import type { CheckOptions, FileReport, Session, StepReport } from './types.js';

export { extractBlocks } from './extract.js';
export { planBlock, wrapStep } from './plan.js';
export * from './types.js';
export { fixFile, replaceBlock, parseCompletion, buildPrompt, anthropicComplete, claudeCliComplete, defaultComplete } from './fix.js';
export type { FixOptions, FixResult, FixAttempt, Complete } from './fix.js';

async function startSession(opts: CheckOptions): Promise<Session> {
  switch (opts.runner) {
    case 'docker':
      return startDockerSession(opts);
    case 'e2b':
      return startE2bSession(opts);
    case 'local':
      return startLocalSession(opts);
  }
}

/**
 * Check one markdown file: run its code blocks top-to-bottom in a fresh
 * session, stopping at the first failure (a broken quickstart makes the
 * remaining steps meaningless).
 */
export async function checkFile(
  file: string,
  opts: CheckOptions,
  onStep?: (report: StepReport) => void,
): Promise<FileReport> {
  const markdown = await readFile(file, 'utf8');
  const blocks = extractBlocks(markdown, file);
  const steps: StepReport[] = [];
  let failedAlready = false;

  const session = await startSession(opts);
  try {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const planned = planBlock(block);

      let report: StepReport;
      if ('skip' in planned) {
        report = { block, status: 'skipped', skipReason: planned.skip };
      } else if (failedAlready) {
        report = { block, status: 'skipped', skipReason: 'previous-failure' };
      } else {
        const step = planned.step;
        let auxFile: string | undefined;
        if (step.kind !== 'shell') {
          const ext = step.kind === 'node' ? 'mjs' : 'py';
          auxFile = `${session.stateDir}/step-${i + 1}.${ext}`;
          await session.writeFile(auxFile, step.source);
        }
        const script = wrapStep(step, {
          workdir: session.workdir,
          stateDir: session.stateDir,
          auxFile,
        });
        const timeoutMs = (block.directives.timeout ?? opts.timeout) * 1000;
        const result = await session.runShell(script, timeoutMs);
        report = {
          block,
          status: result.exitCode === 0 ? 'passed' : 'failed',
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
        };
        if (report.status === 'failed') failedAlready = true;
      }

      steps.push(report);
      onStep?.(report);
    }
  } finally {
    await session.dispose();
  }

  return {
    file,
    steps,
    passed: steps.filter((s) => s.status === 'passed').length,
    failed: steps.filter((s) => s.status === 'failed').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
  };
}
