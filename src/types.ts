/** A fenced code block extracted from a markdown file. */
export interface CodeBlock {
  /** language token from the fence info string, lowercased ('' if none) */
  lang: string;
  /** raw fence content */
  code: string;
  /** 1-based line number of the opening fence */
  startLine: number;
  file: string;
  directives: Directives;
}

/** Per-block controls read from `<!-- readme-check ... -->` comments. */
export interface Directives {
  skip?: boolean;
  /** seconds */
  timeout?: number;
  /** run the block in this directory (relative to the session workdir) */
  cwd?: string;
  env?: Record<string, string>;
}

export type StepKind = 'shell' | 'node' | 'python';

/** An executable unit derived from a code block. */
export interface Step {
  block: CodeBlock;
  kind: StepKind;
  /** source to execute (console prompts already stripped, etc.) */
  source: string;
}

export type SkipReason = 'directive' | 'unsupported-language' | 'no-commands' | 'previous-failure';

export interface StepReport {
  block: CodeBlock;
  status: 'passed' | 'failed' | 'skipped';
  skipReason?: SkipReason;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  timedOut?: boolean;
}

export interface FileReport {
  file: string;
  steps: StepReport[];
  passed: number;
  failed: number;
  skipped: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/** A live sandbox (docker container, E2B sandbox, or local temp dir). */
export interface Session {
  readonly workdir: string;
  readonly stateDir: string;
  /** write an auxiliary file (interpreter sources) into the session */
  writeFile(path: string, content: string): Promise<void>;
  /** run a bash script (passed on stdin) inside the session */
  runShell(script: string, timeoutMs: number): Promise<ExecResult>;
  dispose(): Promise<void>;
}

export interface RunnerOptions {
  /** docker image (docker runner) or E2B template (e2b runner) */
  image?: string;
  /** absolute host path to mount read-write at the session workdir (docker/local) */
  mount?: string;
  verbose?: boolean;
}

export interface CheckOptions extends RunnerOptions {
  runner: 'docker' | 'e2b' | 'local';
  /** default per-block timeout in seconds */
  timeout: number;
}
