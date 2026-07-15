import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecResult, RunnerOptions, Session } from '../types.js';

const execFileP = promisify(execFile);

const WORKDIR = '/work';
const STATE_DIR = '/work/.readme-ci';

/**
 * Runs blocks inside a throwaway Docker container. One container per markdown
 * file, so `cd`/`export`/installed packages persist between blocks and the
 * host stays untouched.
 */
export async function startDockerSession(opts: RunnerOptions = {}): Promise<Session> {
  const image = opts.image ?? 'node:22-bookworm';
  const args = ['run', '-d', '--rm', '-w', WORKDIR];
  if (opts.mount) args.push('-v', `${opts.mount}:${WORKDIR}`);
  args.push(image, 'sleep', 'infinity');

  let id: string;
  try {
    id = (await execFileP('docker', args)).stdout.trim();
  } catch (err) {
    throw new Error(
      `failed to start docker container (image ${image}) – is Docker running?\n${String(err)}`,
    );
  }

  const session: Session = {
    workdir: WORKDIR,
    stateDir: STATE_DIR,
    async writeFile(path, content) {
      await pipeInto(
        ['exec', '-i', id, 'bash', '-c', `mkdir -p "$(dirname '${path}')" && cat > '${path}'`],
        content,
        60_000,
      );
    },
    async runShell(script, timeoutMs) {
      const seconds = Math.ceil(timeoutMs / 1000);
      // coreutils `timeout` inside the container kills the step itself, so a
      // hung block cannot leave a stray process behind the next steps
      return pipeInto(['exec', '-i', id, 'timeout', `${seconds}s`, 'bash', '-s'], script, timeoutMs + 10_000);
    },
    async dispose() {
      await execFileP('docker', ['rm', '-f', id]).catch(() => {});
    },
  };
  return session;
}

function pipeInto(dockerArgs: string[], stdin: string, hardTimeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, hardTimeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = killed ? 124 : (code ?? 1);
      resolve({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut: exitCode === 124,
      });
    });
    child.stdin.end(stdin);
  });
}
