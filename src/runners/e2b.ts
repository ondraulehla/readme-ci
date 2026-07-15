import type { ExecResult, RunnerOptions, Session } from '../types.js';

const WORKDIR = '/home/user';
const STATE_DIR = '/home/user/.readme-check';

/**
 * Runs blocks in an E2B cloud sandbox (https://e2b.dev) – full isolation with
 * no local Docker needed. Requires the optional `@e2b/code-interpreter`
 * package and an `E2B_API_KEY` in the environment.
 */
export async function startE2bSession(opts: RunnerOptions = {}): Promise<Session> {
  let SandboxCtor: any;
  try {
    // non-literal specifier so TypeScript doesn't require the optional types
    const specifier = '@e2b/code-interpreter';
    ({ Sandbox: SandboxCtor } = await import(specifier));
  } catch {
    throw new Error(
      "the e2b runner needs the optional dependency – install it with `npm install @e2b/code-interpreter` and set E2B_API_KEY",
    );
  }
  if (!process.env.E2B_API_KEY) {
    throw new Error('E2B_API_KEY is not set – create one at https://e2b.dev/dashboard');
  }

  const sandbox = opts.image
    ? await SandboxCtor.create(opts.image, { timeoutMs: 30 * 60_000 })
    : await SandboxCtor.create({ timeoutMs: 30 * 60_000 });

  return {
    workdir: WORKDIR,
    stateDir: STATE_DIR,
    async writeFile(path, content) {
      await sandbox.files.write(path, content);
    },
    async runShell(script, timeoutMs): Promise<ExecResult> {
      const started = Date.now();
      // commands.run rejects on non-zero exit; both paths carry the output
      try {
        const r = await sandbox.commands.run(script, { timeoutMs });
        return {
          exitCode: r.exitCode ?? 0,
          stdout: r.stdout ?? '',
          stderr: r.stderr ?? '',
          durationMs: Date.now() - started,
          timedOut: false,
        };
      } catch (err: any) {
        const timedOut = /timeout/i.test(String(err?.name ?? err));
        return {
          exitCode: typeof err?.exitCode === 'number' ? err.exitCode : 124,
          stdout: err?.stdout ?? '',
          stderr: err?.stderr ?? String(err),
          durationMs: Date.now() - started,
          timedOut,
        };
      }
    },
    async dispose() {
      await sandbox.kill().catch(() => {});
    },
  };
}
