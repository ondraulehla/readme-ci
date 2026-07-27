import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExecResult, RunnerOptions, Session } from '../types.js';

/**
 * Runs blocks directly on the host in a temp directory. No isolation –
 * only use on markdown you trust (your own README in your own CI).
 */
export async function startLocalSession(opts: RunnerOptions = {}): Promise<Session> {
  const workdir = opts.mount ?? (await mkdtemp(join(tmpdir(), 'readme-ci-')));
  const created = !opts.mount;
  const stateDir = await mkdtemp(join(tmpdir(), 'readme-ci-state-'));

  return {
    workdir,
    stateDir,
    async writeFile(path, content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    },
    runShell(script, timeoutMs) {
      return new Promise<ExecResult>((resolve) => {
        const started = Date.now();
        const child = spawn('bash', ['-s'], { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({
            exitCode: timedOut ? 124 : (code ?? 1),
            stdout,
            stderr,
            durationMs: Date.now() - started,
            timedOut,
          });
        });
        child.stdin.end(script);
      });
    },
    async dispose() {
      await rm(stateDir, { recursive: true, force: true });
      if (created) await rm(workdir, { recursive: true, force: true });
    },
  };
}
