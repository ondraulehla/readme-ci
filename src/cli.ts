#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { checkFile } from './index.js';
import { printFixAttempt, printStep, printSummary } from './report.js';
import type { CheckOptions, FileReport } from './types.js';

const HELP = `readme-ci – run the code blocks in your README and fail when they break

Usage
  readme-ci [files...] [options]        (default file: README.md)

Options
  --runner <docker|e2b|local>   where blocks run (default: docker)
  --image <name>                docker image / E2B template (default: node:22-bookworm)
  --mount <path>                mount a host directory as the working dir (docker/local)
  --timeout <seconds>           per-block timeout (default: 300)
  --fix                         on failure, ask an AI model to repair the block,
                                apply the edit in place and re-run. Uses
                                ANTHROPIC_API_KEY, or your Claude Code login
                                (the claude CLI) when no key is set.
  --fix-model <id>              model for --fix (default: claude-sonnet-5)
  --fix-attempts <n>            max repair rounds per file (default: 3)
  --verbose                     print stdout of passing blocks too
  -h, --help                    show this help
  -v, --version                 print version

Control individual blocks with comments in the markdown:
  <!-- readme-ci skip -->
  <!-- readme-ci timeout=600 -->
  <!-- readme-ci cwd=examples FOO=bar -->

Docs & examples: https://github.com/ondraulehla/readme-ci`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      runner: { type: 'string', default: 'docker' },
      image: { type: 'string' },
      mount: { type: 'string' },
      timeout: { type: 'string', default: '300' },
      fix: { type: 'boolean', default: false },
      'fix-model': { type: 'string', default: 'claude-sonnet-5' },
      'fix-attempts': { type: 'string', default: '3' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    const { createRequire } = await import('node:module');
    console.log(createRequire(import.meta.url)('../package.json').version);
    return 0;
  }

  const runner = values.runner as CheckOptions['runner'];
  if (!['docker', 'e2b', 'local'].includes(runner)) {
    console.error(`unknown runner '${runner}' – expected docker, e2b or local`);
    return 2;
  }
  const timeout = Number(values.timeout);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    console.error(`invalid --timeout '${values.timeout}'`);
    return 2;
  }
  if (runner === 'local') {
    console.error('⚠ local runner executes blocks directly on this machine – only use on markdown you trust\n');
  }

  const opts: CheckOptions = {
    runner,
    image: values.image,
    mount: values.mount ? resolve(values.mount) : undefined,
    timeout,
    verbose: values.verbose,
  };

  const files = positionals.length > 0 ? positionals : ['README.md'];
  const reports: FileReport[] = [];
  for (const file of files) {
    console.log(`\n${file}`);
    if (values.fix) {
      const { fixFile } = await import('./fix.js');
      const result = await fixFile(
        file,
        {
          ...opts,
          fixModel: values['fix-model'],
          fixAttempts: Math.max(1, Number(values['fix-attempts']) || 3),
        },
        (step) => printStep(step, opts.verbose),
        undefined,
        (attempt, round) => printFixAttempt(attempt, round),
      );
      if (result.fixed) console.log(`\n  🔧 ${file} repaired – review the change with git diff`);
      reports.push(result.report);
    } else {
      reports.push(await checkFile(file, opts, (step) => printStep(step, opts.verbose)));
    }
  }
  printSummary(reports);
  return reports.some((r) => r.failed > 0) ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(2);
  });
