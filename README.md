# readme-ci

**Run the code blocks in your README. Fail CI when your quickstart breaks.**

Every README promises `npm install && npm start` works. Then a dependency
bumps, a flag is renamed, a file moves – and the first thing every new user
sees is broken. Nobody notices, because nobody *executes* their docs.

`readme-ci` executes them. It extracts the fenced code blocks from your
markdown, runs them top-to-bottom in an isolated sandbox – state carries over
between blocks exactly like a reader following along – and exits non-zero the
moment a step breaks. Put it in CI and your quickstart can never silently rot
again.

```console
$ readme-ci examples/demo.md

examples/demo.md
  ✓ examples/demo.md:10 [bash] mkdir hello-app && cd hello-app (0.4s)
  ✓ examples/demo.md:18 [bash] test -f package.json (0.3s)
  ✓ examples/demo.md:26 [js] const pkg = { name: 'hello-app' }; (0.5s)
  ✓ examples/demo.md:30 [python] print("2 + 2 =", 2 + 2) (0.4s)
  ✓ examples/demo.md:36 [console] $ echo it works (0.3s)
  ○ examples/demo.md:44 [bash] curl -fsSL https://example.com/install.sh | sh – skipped (directive)

✓ 5 passed
```

## Quickstart

<!-- readme-ci skip -->
```bash
npx readme-ci
```

By default blocks run in a **throwaway Docker container** (`node:22-bookworm`),
so your machine is never touched. One container per file – `cd`, exported
variables and installed packages persist from block to block.

Or as a **GitHub Action**:

```yaml
jobs:
  readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ondraulehla/readme-ci@main
        with:
          files: README.md docs/getting-started.md
```

## How it works

1. Fenced blocks are extracted with their line numbers.
2. Each block is planned by language:
   - `bash` / `sh` / `shell` / `zsh` → run as a shell script (`set -e`)
   - `console` / `terminal` → only the `$ `-prefixed lines run; output lines are prose
   - `js` / `javascript` → run with `node`
   - `python` / `py` → run with `python3`
   - anything else (`json`, `yaml`, …) → ignored automatically
3. Blocks execute in order inside one session. Working directory and
   environment survive between blocks, so multi-step quickstarts just work.
4. The first failing block fails the file (broken step ⇒ the rest is
   meaningless), prints the captured output, and – inside GitHub Actions –
   annotates the exact line of your markdown.

## Controlling blocks

Add a comment right above a fence:

```markdown
<!-- readme-ci skip -->
<!-- readme-ci timeout=600 -->
<!-- readme-ci cwd=examples NODE_ENV=production -->
```

| directive     | effect                                              |
| ------------- | --------------------------------------------------- |
| `skip`        | never run this block                                |
| `timeout=N`   | per-block timeout in seconds (default 300)          |
| `cwd=path`    | run in this directory (relative to the session)     |
| `KEY=value`   | export an environment variable for this block       |

## Runners

| runner            | isolation                | needs                                   |
| ----------------- | ------------------------ | --------------------------------------- |
| `docker` (default)| container per file       | Docker                                  |
| `e2b`             | cloud sandbox per file   | `npm i @e2b/code-interpreter` + `E2B_API_KEY` |
| `local`           | none – temp dir on host  | nothing (only for markdown you trust)   |

<!-- readme-ci skip -->
```bash
# pick the image your quickstart expects
readme-ci --runner docker --image python:3.12-bookworm docs/tutorial.md

# no Docker around? run in an E2B cloud sandbox
E2B_API_KEY=... readme-ci --runner e2b README.md

# test the README against the repo it documents
readme-ci --runner docker --mount . README.md
```

## `--fix`: let a model repair the block

When a step fails, `readme-ci --fix` sends the failing block and its captured
output to an AI model, applies the proposed edit to the markdown **in place**,
and re-runs – up to `--fix-attempts` times. You review the result like any
other change: `git diff`.

Two ways to authenticate, in order of precedence:

<!-- readme-ci skip -->
```bash
# 1. an Anthropic API key (direct Messages API call – no SDK, still zero deps)
ANTHROPIC_API_KEY=... readme-ci --fix README.md

# 2. no key? if you use Claude Code, your existing login is enough –
#    readme-ci talks to the local `claude` CLI instead
readme-ci --fix README.md
```

Only the failing block is ever edited, earlier blocks' side effects stay in
place for the re-run, and `<no_fix/>` from the model ends the loop cleanly.

In CI, generate a long-lived token with `claude setup-token` and expose it as
the `CLAUDE_CODE_OAUTH_TOKEN` secret – the `claude` CLI picks it up.

### PR mode: robot breaks it, robot fixes it, human merges

With `fix-pr: 'true'` the action opens a pull request containing the repaired
markdown whenever `--fix` changed anything, so the fix lands through normal
review instead of dying with the runner workspace:

```yaml
jobs:
  readme:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: ondraulehla/readme-ci@main
        with:
          files: README.md
          fix-pr: 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Why not just unit tests?

Unit tests check your code. `readme-ci` checks the **contract with your
users**: the exact commands you tell them to type. Those are the commands
that break most often – install steps, CLI flags, config files – and the
breakage is invisible until someone churns.

## Roadmap

- more languages (go, rust, ruby) and `Dockerfile`/compose-aware sessions
- assertions on block output (`<!-- readme-ci expect="2 + 2 = 4" -->`)

## Contributing

Issues and PRs welcome. The whole tool is small, typed and dependency-free –
[`src/extract.ts`](src/extract.ts) parses, [`src/plan.ts`](src/plan.ts) plans,
[`src/runners/`](src/runners) executes. CI runs `readme-ci` on this repo's
own docs in all three runners.

## License

MIT © Ondřej Úlehla
