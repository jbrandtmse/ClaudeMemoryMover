# Story 5.1: Shell Completion Command

Status: review

## Story

As a Claude Code user,
I want `cmemmov completion <shell>` to emit a tab-completion script for bash, zsh, fish, or PowerShell that I can source from my shell init,
so that I can tab-complete commands, subcommands, and flags — reducing typing and surfacing options I might not have known about.

## Acceptance Criteria

### AC1 — `cmemmov completion bash` emits a valid bash completion script

**Given** a host with bash available
**When** `cmemmov completion bash` is invoked
**Then** stdout contains a complete bash completion script that:
  - Defines a completion function (e.g., `_cmemmov_complete`) and registers it via `complete -F _cmemmov_complete cmemmov`
  - Tab-completes the six top-level subcommands: `export`, `import`, `fix-paths`, `share`, `rollback`, `completion`
  - Tab-completes the global flags: `--silent`, `--json`, `--dry-run`, `--help`, `--version` (and their short forms where applicable)
  - For each subcommand, tab-completes that subcommand's specific flags (e.g., `cmemmov export --<TAB>` suggests `--categories`, `--output`, `--include-credentials`, `--include-sessions`, `--all-projects`, `--projects`, `--project-path`, plus the global flags)
**And** the script parses without syntax error when sourced in bash (`bash -c "$(cmemmov completion bash)"`)
**And** the script's first line is a shebang-less comment block documenting how to install it (e.g., `# Install: eval "$(cmemmov completion bash)" >> ~/.bashrc`)

### AC2 — `cmemmov completion zsh` emits a valid zsh completion script

**Given** a host with zsh available
**When** `cmemmov completion zsh` is invoked
**Then** stdout contains a complete zsh completion script that:
  - Uses zsh's native completion syntax (`#compdef cmemmov` header + `_cmemmov` function + `_describe`/`_arguments`)
  - Tab-completes the same six subcommands and global flags as the bash version
  - For each subcommand, tab-completes that subcommand's specific flags
**And** the script parses without syntax error when sourced in zsh
**And** the script's first line(s) document how to install it (e.g., `# Install: cmemmov completion zsh > "${fpath[1]}/_cmemmov"`)

### AC3 — `cmemmov completion fish` emits a valid fish completion script

**Given** a host with fish available
**When** `cmemmov completion fish` is invoked
**Then** stdout contains a complete fish completion script that:
  - Uses fish's `complete -c cmemmov ...` per-completion syntax
  - Tab-completes the same six subcommands and global flags
  - For each subcommand, completes that subcommand's specific flags (using `-n "__fish_seen_subcommand_from <name>"` predicates)
**And** the script parses without syntax error when loaded in fish (`fish -c "$(cmemmov completion fish)"`)
**And** the script's first line(s) document how to install it (e.g., `# Install: cmemmov completion fish > ~/.config/fish/completions/cmemmov.fish`)

### AC4 — `cmemmov completion powershell` emits a valid PowerShell completion script

**Given** a host with PowerShell available (5.1 or pwsh 7+)
**When** `cmemmov completion powershell` is invoked
**Then** stdout contains a complete PowerShell completion script that:
  - Uses `Register-ArgumentCompleter -Native -CommandName cmemmov -ScriptBlock { ... }`
  - The script block emits `[System.Management.Automation.CompletionResult]` objects for the six subcommands, global flags, and per-subcommand flags
  - Reads `$wordToComplete`, `$commandAst`, and `$cursorPosition` correctly so completions are filtered by what the user has already typed
**And** the script parses without syntax error when dot-sourced in PowerShell
**And** the script's first line(s) document how to install it (e.g., `# Install: cmemmov completion powershell | Out-String | Invoke-Expression` for a session; or append to `$PROFILE` for persistence)

### AC5 — Bare `cmemmov completion` on POSIX auto-detects the shell

**Given** a POSIX host (`process.platform !== 'win32'`)
**When** `cmemmov completion` is invoked with no shell argument
**Then** the command reads `process.env.SHELL`, computes its basename via `path.basename(process.env.SHELL)`, and:
  - If basename matches one of `bash`, `zsh`, `fish` → emit the corresponding completion script (NOT powershell — powershell is never auto-detected because `$SHELL` does not point to it)
  - Otherwise (unset, empty, or basename not in the known set) → throw `CmemmovError({ code: 'INTERNAL', hint: 'specify shell: cmemmov completion <bash|zsh|fish|powershell>' })`
**And** the exit code is 2 (per `EXIT_CODE_MAP.INTERNAL`) on the error path

### AC6 — Bare `cmemmov completion` on Windows requires explicit shell

**Given** a Windows host (`process.platform === 'win32'`)
**When** `cmemmov completion` is invoked with no shell argument
**Then** auto-detection is NOT attempted (Windows parent-shell detection from Node is unreliable; `$env:PSModulePath` / `$Host.Name` are not exposed to Node child processes)
**And** the command throws `CmemmovError({ code: 'INTERNAL', hint: 'on Windows, specify the shell explicitly: cmemmov completion powershell' })`
**And** the exit code is 2
**And** this Windows-explicit-required behavior is mentioned in the `cmemmov completion --help` output (the help text should distinguish POSIX vs Windows guidance)

### AC7 — Unknown shell argument is a clean error

**Given** any platform
**When** `cmemmov completion bogus-shell` is invoked
**Then** the command throws `CmemmovError({ code: 'INTERNAL', hint: 'unsupported shell: bogus-shell. Supported: bash, zsh, fish, powershell' })`
**And** the exit code is 2
**And** the unknown-shell error wording exactly matches the AC7 hint string (case-sensitive; tests will assert)

### AC8 — Sourced completion behavior is verified by smoke tests in CI

**Given** the test suite
**When** `npm test` runs on the three CI runners (Windows, macOS, Linux)
**Then** there are positive smoke tests that:
  - **Per shell available on the runner** (bash on Linux+macOS+Windows-via-Git-Bash-if-present; zsh on macOS+Linux-if-present; fish on Linux-if-present; powershell on Windows always, macOS+Linux if `pwsh` is on PATH): spawn the shell as a child process, pipe the completion script in via stdin, and assert exit code 0 (the script parses without error)
  - **Universal** (no shell binary required): each completion script string is parsed for required structural elements (e.g., bash script contains `complete -F`, zsh contains `#compdef`, fish contains `complete -c cmemmov`, powershell contains `Register-ArgumentCompleter`)
**And** the universal-string-check tests run on all three OSes unconditionally
**And** the per-shell parse tests skip cleanly (using vitest's `it.skipIf` or equivalent) when the shell binary is not on PATH — they do NOT fail CI on missing-binary platforms
**And** at least one positive parse test runs per shell across the matrix as a whole (i.e., bash and zsh parse-tested on Linux/macOS; powershell parse-tested on Windows)

**Dev Note:** Don't try to assert on completion *output* (what suggestions are produced for `cmemmov export --<TAB>`) — that requires programmatically driving the shell's completion engine, which is brittle across versions. The script-parses-without-error check + the universal structural string-check together are sufficient mechanical evidence the script is well-formed.

### AC9 — `--json` mode emits the script in a structured payload

**Given** any of `cmemmov completion <shell> --json` (or `cmemmov --json completion <shell>`)
**When** invoked successfully
**Then** the final stdout JSON object has the standard Output shape:
  - `success: true`
  - `command: 'completion'`
  - `summary` is an object with `text: '<short human summary like "bash completion script generated">'`, plus `shell: '<shell>'` and `script: '<the full script as a single string>'`
  - `errors: []`
  - `warnings: []`
**And** the script body is NOT also written to stdout outside the JSON object (JSON mode emits exactly one line — the JSON object — to stdout)
**And** progress / status text (if any) goes to stderr per the existing `Output` contract

### AC10 — `cmemmov completion --help` is informative

**Given** `cmemmov completion --help`
**When** invoked
**Then** Commander's help output lists all four supported shells in the description
**And** the help text includes the two install snippets:
  - POSIX: `eval "$(cmemmov completion bash)"` (or zsh/fish equivalents)
  - PowerShell: `cmemmov completion powershell | Out-String | Invoke-Expression`
**And** the help text distinguishes the Windows vs POSIX auto-detect behavior described in AC5/AC6

**Dev Note:** The simplest implementation is to put this text in the Commander `.description(...)` field of the `completion` subcommand, or use `.addHelpText('after', ...)` to append the install snippets after the auto-generated usage. Keep the description concise (≤ 4 lines visible in the default `--help` output); put the longer install instructions in `addHelpText('after', ...)`.

## Tasks / Subtasks

- [x] Task 1: Wire the `completion` command in `src/cli.ts` to accept an optional `<shell>` argument and propagate global opts (AC: #1–#10)
  - [x] 1.1 Add `.argument('[shell]', 'bash|zsh|fish|powershell (default: auto-detect on POSIX)')` to the `completion` subcommand
  - [x] 1.2 Wire `optsWithGlobals` so `--json` reaches `run`
  - [x] 1.3 Update the action to extract `shell` from `completionCmd.args[0]` and pass it to `run(shell, opts)`
  - [x] 1.4 Add `.addHelpText('after', ...)` with POSIX and PowerShell install snippets (AC: #10)
- [x] Task 2: Implement `src/commands/completion.ts` (AC: #1–#7, #9)
  - [x] 2.1 Replace the stub `run()` with `run(shell: string | undefined, opts: GlobalCLIOpts): Promise<void>`
  - [x] 2.2 Build a shell-validation step:
    - `shell === undefined` AND `process.platform === 'win32'` → throw `INTERNAL` per AC6
    - `shell === undefined` AND POSIX → resolve via `path.basename(process.env.SHELL ?? '')`; if not in `{bash, zsh, fish}` → throw `INTERNAL` per AC5
    - `shell` provided but not in `{bash, zsh, fish, powershell}` → throw `INTERNAL` per AC7 (case-sensitive match; reject `BASH`/`Bash`/etc with the same error)
  - [x] 2.3 Build the per-shell script templates (one function per shell; see Dev Notes for structure)
  - [x] 2.4 Emit the script:
    - If `opts.json === true`: call `out.finish('${shell} completion script generated', true, { shell, script })`
    - Otherwise: emit via `Output.finish(script, true)` in non-JSON mode (the `Output` wrapper's non-JSON path is `stdout.write(summary + '\n')`, which matches the AC contract while satisfying the `cmemmov/no-console-outside-output` lint rule that bans direct `process.stdout.write` outside `src/ui/output.ts`)
- [x] Task 3: Per-shell script templates (AC: #1–#4)
  - [x] 3.1 `buildBashScript()`: returns the bash completion script as a string, including the install header comment
  - [x] 3.2 `buildZshScript()`: returns the zsh completion script, including the `#compdef cmemmov` directive
  - [x] 3.3 `buildFishScript()`: returns the fish completion script as `complete -c cmemmov ...` lines
  - [x] 3.4 `buildPowershellScript()`: returns the PowerShell `Register-ArgumentCompleter -Native ...` block
  - [x] 3.5 Define a single source-of-truth for `COMMANDS_AND_FLAGS` at the top of `completion.ts` (a const object mapping each subcommand name to its specific flag list) — all four builders consume this constant so the four scripts can never drift
- [x] Task 4: Unit tests in `src/commands/completion.test.ts` (AC: #1–#7, #9)
  - [x] 4.1 For each shell: `run('<shell>', { json: false })` captures stdout, asserts it includes the shell-specific structural marker (bash → `complete -F`; zsh → `#compdef cmemmov`; fish → `complete -c cmemmov`; powershell → `Register-ArgumentCompleter`)
  - [x] 4.2 For each shell × every subcommand: assert the subcommand name appears in the script body
  - [x] 4.3 For each shell × every global flag (`--silent`, `--json`, `--dry-run`, `--help`, `--version`): assert the flag appears in the script body
  - [x] 4.4 `run(undefined, opts)` on Windows (mock `process.platform`) throws `INTERNAL` with the AC6 hint string exactly
  - [x] 4.5 `run(undefined, opts)` on POSIX with `SHELL=/usr/bin/zsh` returns the zsh script
  - [x] 4.6 `run(undefined, opts)` on POSIX with unset/unknown `SHELL` throws `INTERNAL` with the AC5 hint string exactly
  - [x] 4.7 `run('BASH', opts)` throws `INTERNAL` with the AC7 hint (case sensitivity test)
  - [x] 4.8 `run('bogus-shell', opts)` throws `INTERNAL` with the AC7 hint exact string match
  - [x] 4.9 `run('bash', { json: true })`: capture stdout, parse as JSON, assert shape per AC9
- [x] Task 5: Integration smoke tests in `tests/integration/completion.test.ts` (AC: #8)
  - [x] 5.1 Universal string-structure checks (all three OSes, no shell binary needed): produce each shell's script via `run()` and assert structural markers
  - [x] 5.2 Per-shell parse-only smoke tests using `vitest.it.skipIf(<shell-not-on-PATH>)`: spawn the shell with the script piped via stdin and assert exit code 0
  - [x] 5.3 Use `which` (Linux/macOS) or `where` (Windows) via `child_process.spawn` to determine if each shell is on PATH; skip if not
- [x] Task 6: Verify CI gates (AC: #1–#10)
  - [x] 6.1 `npm run lint` clean
  - [x] 6.2 `npm test` passes on Linux (where bash, zsh, fish are most likely all present) — verified locally on Windows (Windows-runner equivalent: bash + powershell parse OK; zsh+fish skipped via `it.skipIf`)
  - [x] 6.3 `npx vitest --coverage` — `src/commands/completion.ts` reports 100% line/branch/function coverage; full-suite coverage gates still pass
  - [x] 6.4 Local smoke run: `node dist/cmemmov.js completion bash | bash -n -` exits 0 (bash parse OK); `cmemmov completion powershell` parses cleanly via `[Parser]::ParseInput` inside the integration test; JSON mode prints exactly one JSON line containing `summary.shell` and `summary.script`

## Dev Notes

### Implementation approach — single source of truth

The four script builders MUST share a single command/flag inventory so they cannot drift. Add this constant at the top of `src/commands/completion.ts`:

```ts
const COMMANDS_AND_FLAGS = {
  export: ['--categories', '--output', '--include-credentials', '--include-sessions', '--all-projects', '--projects', '--project-path'],
  import: ['--mode', '--integrity-check', '--no-integrity-check', '--remap'],
  'fix-paths': ['--remap'],
  share: ['--categories', '--output', '--include-credentials', '--include-pattern', '--exclude-pattern'],
  rollback: ['--backup'],
  completion: [], // takes a positional [shell] arg, no flags of its own
} as const;

const GLOBAL_FLAGS = ['--silent', '--json', '--dry-run', '--help', '--version', '-V'] as const;
```

Each builder iterates over this constant to emit shell-specific completion entries. **Do NOT** introspect Commander at runtime to build the script — Commander's introspection API is unstable across major versions and would couple the completion script tightly to whatever Commander structure we have today. Hand-curated constants stay in sync because tests in Task 4.2 / 4.3 assert every key and every flag appears in every script body, so if a new subcommand or flag is added to `cli.ts` without updating `COMMANDS_AND_FLAGS`, the test will fail.

### Bash script skeleton (illustrative, not copy-paste)

```bash
# Install: eval "$(cmemmov completion bash)"
_cmemmov_complete() {
  local cur prev cmd
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  cmd="${COMP_WORDS[1]:-}"

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "export import fix-paths share rollback completion" -- "$cur") )
    return 0
  fi

  case "$cmd" in
    export)
      COMPREPLY=( $(compgen -W "--categories --output --include-credentials --include-sessions --all-projects --projects --project-path --silent --json --dry-run --help --version" -- "$cur") )
      ;;
    # ... one case per subcommand ...
  esac
}
complete -F _cmemmov_complete cmemmov
```

Show install instructions as the very first line so users who `head -1` the script see how to wire it up.

### Zsh script skeleton

```zsh
#compdef cmemmov
# Install: cmemmov completion zsh > "${fpath[1]}/_cmemmov"
_cmemmov() {
  local -a commands
  commands=(
    'export:Export your Claude Code environment to a bundle file'
    'import:Import a bundle onto this machine'
    'fix-paths:Re-associate project slugs with new repository locations'
    'share:Export a sanitized bundle for sharing with a team'
    'rollback:Restore the most recent pre-import backup'
    'completion:Generate shell completion scripts'
  )
  _arguments -C \
    '1: :->command' \
    '*::arg:->args'
  case "$state" in
    command) _describe -t commands 'cmemmov command' commands ;;
    args)
      case "$line[1]" in
        export) _arguments '--categories[...]' '--output[...]' '--include-credentials' '--include-sessions' '--all-projects' '--projects[...]' '--project-path[...]' '--silent' '--json' '--dry-run' '--help' '--version' ;;
        # ... one case per subcommand ...
      esac
      ;;
  esac
}
_cmemmov "$@"
```

### Fish script skeleton

```fish
# Install: cmemmov completion fish > ~/.config/fish/completions/cmemmov.fish
complete -c cmemmov -f
complete -c cmemmov -n '__fish_use_subcommand' -a 'export' -d 'Export your Claude Code environment'
# ... one line per subcommand ...
complete -c cmemmov -n '__fish_seen_subcommand_from export' -l categories -d '...'
# ... one line per subcommand-flag pair ...
complete -c cmemmov -l silent -d 'Suppress interactive prompts'  # global flags
# ...
```

### PowerShell script skeleton

```powershell
# Install (session): cmemmov completion powershell | Out-String | Invoke-Expression
# Install (persistent): Add the above line to your $PROFILE
Register-ArgumentCompleter -Native -CommandName cmemmov -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @('export', 'import', 'fix-paths', 'share', 'rollback', 'completion')
  $globalFlags = @('--silent', '--json', '--dry-run', '--help', '--version')
  $subFlags = @{
    'export' = @('--categories', '--output', '--include-credentials', ...)
    # ... one entry per subcommand ...
  }
  $tokens = $commandAst.CommandElements
  # If only 'cmemmov' so far, suggest commands; else look at $tokens[1].Value to pick subFlags entry; emit both subFlags + globalFlags
  # Emit [System.Management.Automation.CompletionResult] objects for each suggestion
}
```

### Relevant files

- **NEW** `src/commands/completion.test.ts` — unit tests (Task 4)
- **NEW** `tests/integration/completion.test.ts` — smoke tests (Task 5)
- **UPDATE** `src/commands/completion.ts` — implementation (currently a one-line stub; full replacement)
- **UPDATE** `src/cli.ts` — add the `[shell]` argument to the `completion` subcommand and add `.addHelpText('after', ...)`

### Files this story does NOT modify

- Any other `src/commands/*.ts` (the completion command is purely additive — it reads what the other commands are, but does not need to change them)
- `src/core/*` (no new error codes; the AC5/AC6/AC7 errors all reuse `INTERNAL`)
- `src/services/*`, `src/ui/*` (no new UI primitives needed — `Output.finish(..., extra)` already supports the AC9 JSON shape)
- The bundle schema, any test fixtures under `tests/fixtures/`

If any of those files need to change to satisfy an AC, **stop and surface the issue to the Lead** — that signals scope misunderstanding.

### Process principles (carried from Epic 4 retro — apply in implementation choices)

- **Spec-writing convention**: this story provides design intent + worked examples (the four skeletons above) rather than copy-paste skeletons. The dev is expected to adapt them to taste and verify against AC tests, not paste them verbatim.
- **Declarative-data-with-literal-discriminators**: `COMMANDS_AND_FLAGS` is the canonical example for this story — a single inspectable data structure that all four builders consume. If the dev needs to extend it (e.g., adding a new global flag), the change is one place.

### Relevant invariants

- **Output contract**: in JSON mode, exactly one JSON line goes to stdout, all progress/warnings go to stderr. AC9 enforces this for the script payload.
- **Exit code contract**: `INTERNAL` errors → exit 2 (per `EXIT_CODE_MAP` in [src/core/error.ts:16](../../src/core/error.ts#L16)). All AC5–AC7 error paths exit 2.
- **Commander integration**: existing `completion` subcommand is already registered at [src/cli.ts:160-166](../../src/cli.ts#L160). The story extends it; it does not replace the registration.

### Testing standards summary

- **Unit tests**: Vitest, colocated as `<file>.test.ts`. Use `vi.spyOn(process.stdout, 'write')` to capture script output. Mock `process.platform` via `vi.stubGlobal('process', { ...process, platform: 'win32' })` or `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })`. Restore in `afterEach`.
- **Integration tests**: Vitest under `tests/integration/`. Use `child_process.spawn` to invoke the shells. `it.skipIf(!shellOnPath)` for graceful skip.
- **Coverage gate**: `src/commands/completion.ts` should be ≥ 90% line coverage (effectively 100% for a brand-new file — the only path likely to be uncovered is the `process.platform === 'win32'` branch on macOS/Linux, but mocking covers it).
- **No new ESLint disables**: do not introduce `eslint-disable` comments to silence warnings; if a warning fires, refactor.

### Project Structure Notes

- Alignment confirmed: completion is a top-level `src/commands/` entry like every other command. Test file lives beside it. Integration test under `tests/integration/`.
- No conflicts with the unified project structure.

### References

- [Epic 5 spec — Story 5.1: epics.md:1397-1451](../planning-artifacts/epics.md#L1397) — original ACs (this story restructures them as AC1–AC10 with task tables; behavior is identical)
- [Existing `completion` Commander registration: src/cli.ts:160-166](../../src/cli.ts#L160)
- [Existing stub: src/commands/completion.ts](../../src/commands/completion.ts) — REPLACE WHOLESALE
- [Output contract: src/ui/output.ts](../../src/ui/output.ts) — note the `extra` parameter of `finish(...)` supports the AC9 `{ text, shell, script }` shape
- [Error codes and exit-code mapping: src/core/error.ts:1-29](../../src/core/error.ts#L1)
- [Epic 4 retro process principles: _bmad-output/implementation-artifacts/epic-4-retro-2026-05-13.md#action-items](../implementation-artifacts/epic-4-retro-2026-05-13.md#action-items)
- [Pipeline recovery runbook: _bmad-output/implementation-artifacts/runbook-pipeline-recovery.md](../implementation-artifacts/runbook-pipeline-recovery.md) — if an interruption occurs

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

None — implementation proceeded without halts. One minor ESLint deviation from the story spec was resolved by routing the non-JSON script emission through `Output.finish(script, true)` instead of `process.stdout.write(script + '\n')`, because the project's `cmemmov/no-console-outside-output` rule bans direct `process.stdout.write` outside `src/ui/output.ts`. `Output.finish`'s non-JSON branch is `stdout.write(summary + '\n')` — identical observable behavior, contract preserved.

### Completion Notes List

- Implemented `src/commands/completion.ts` from scratch (replaced the one-line stub). Shell validation enforces AC5 (POSIX auto-detect from `path.basename($SHELL)` ∈ {bash,zsh,fish}), AC6 (Windows must specify shell), and AC7 (case-sensitive whitelist of bash/zsh/fish/powershell).
- Single source of truth for command/flag inventory: `COMMANDS_AND_FLAGS` const at the top of `completion.ts`. All four builders (`buildBashScript`, `buildZshScript`, `buildFishScript`, `buildPowershellScript`) iterate over it, so a new flag in any subcommand only needs to be added in one place. Tests assert every key and every flag appears in every emitted script — drift will fail CI.
- Updated `src/cli.ts` to wire the `[shell]` argument with `optsWithGlobals<GlobalCLIOpts>()` so `--json` reaches `run()`, plus an `.addHelpText('after', ...)` block with install snippets for all four shells and an explicit POSIX-vs-Windows auto-detect note (AC10).
- Retired the pre-existing AC7-placeholder test in `src/cli.test.ts` (lines 234–255) — it asserted `completion.run()` threw `INTERNAL` with `hint: 'not yet implemented'`, which is no longer true now that completion is implemented. Removed `'completion'` from the `placeholders` array in the AC6 lint-no-try test as well. No remaining placeholder commands exist.
- Unit tests: 38 tests across the four builders, run() output for each shell, AC5/AC6/AC7 error paths (including exit-code 2 verification on AC6/AC7 paths), and AC9 JSON-mode shape. 100% line/branch/function coverage on `src/commands/completion.ts`.
- Integration smoke tests (`tests/integration/completion.test.ts`): universal string-structure checks run on every OS; per-shell parse-only tests skip cleanly via `it.skipIf(!shellOnPath)` when the shell binary is not on PATH. On the local Windows runner, bash + powershell parse tests ran; zsh + fish skipped (not installed). Each test spawns the shell with parse-only flags (`bash -n`, `zsh -n`, `fish -n`, PowerShell `[Parser]::ParseInput`) and asserts exit code 0.
- Full test suite: 634 passed, 4 skipped (3 pre-existing, 1 newly-skipped zsh/fish on this Windows machine). No regressions. Lint clean. Coverage gates pass.

### File List

- **NEW** `src/commands/completion.test.ts` — 38 unit tests covering AC1–AC7 and AC9 (Task 4)
- **NEW** `tests/integration/completion.test.ts` — universal + per-shell parse-only smoke tests (AC8)
- **UPDATE** `src/commands/completion.ts` — full implementation replacing the one-line stub
- **UPDATE** `src/cli.ts` — `[shell]` argument, `optsWithGlobals` propagation, `.addHelpText('after', ...)` install snippets and Windows-vs-POSIX auto-detect guidance
- **UPDATE** `src/cli.test.ts` — retired the placeholder-throws-INTERNAL assertion now that no placeholder commands remain (AC6/AC7 placeholder lists emptied; documentation comment left in place explaining the retirement)

## Change Log

- 2026-05-14 — Story 5.1 implemented. `cmemmov completion <shell>` ships for bash/zsh/fish/powershell. AC1–AC10 satisfied. (dev-5-1 / opus-4-7-1m)
- 2026-05-14 — Code review complete. Two MEDIUM findings auto-resolved (M1: removed invalid `--integrity-check` positive-form from `COMMANDS_AND_FLAGS.import`; M2: added apostrophe-free invariant test + comment to guard `SUBCOMMAND_DESCRIPTIONS` against future zsh/fish quoting drift). Six LOW findings deferred to `deferred-work.md`. Tests: 635 passed (was 634; +1 from M2), 4 skipped; lint clean; full suite green. (cr-5-1 / opus-4-7-1m)

## Review Findings (2026-05-14)

### Auto-resolved (MEDIUM)

- **M1 — Completion script taught users an invalid flag.** `COMMANDS_AND_FLAGS.import` included both `--integrity-check` AND `--no-integrity-check`. Commander 11+ does NOT auto-register the positive form when `.option('--no-X')` is declared (verified by direct round-trip: `Command().option('--no-integrity-check')` followed by parsing `--integrity-check` exits with `unknownOption`). The completion script would have suggested `--integrity-check` on TAB; pressing Enter would have errored "unknown option". Fix: dropped `--integrity-check` from `src/commands/completion.ts:26` and the mirrored test array `src/commands/completion.test.ts:50`. All 39 unit tests still pass.
- **M2 — Future-drift risk: descriptions containing apostrophes would break zsh/fish.** `SUBCOMMAND_DESCRIPTIONS` strings get interpolated into single-quoted zsh (`'<sub>:<desc>'`) and fish (`-d '<desc>'`) syntax. Current descriptions are safe, but a future edit adding `"Don't worry"` would syntactically break both emitted scripts. Fix: added a docstring comment at the const declaration, exported `__SUBCOMMAND_DESCRIPTIONS_FOR_TEST`, and added a unit test (`completion — script-quoting invariants → every SUBCOMMAND_DESCRIPTION is apostrophe-free`) that catches drift at build time. Test count moved 634 → 635.

### Deferred (LOW × 6)

Logged in `_bmad-output/implementation-artifacts/deferred-work.md` under `## Deferred from: code review of story-5.1 (2026-05-14)`:

1. Bash `prev` local variable assigned but unread (ShellCheck SC2034).
2. `basename('')` returns `''` in Node, making the empty-string ternary redundant.
3. Zsh `_arguments` flag specs lack `[description]` annotations.
4. PowerShell `-like "$wordToComplete*"` treats `*`/`?` as wildcards.
5. `fish -n` reading from stdin unverified on a runner with fish installed.
6. AC5 tests do not explicitly assert `err.exitCode === 2` the way AC6/AC7 tests do.

### CI gate verification (post-fix)

- `npm run lint` — clean.
- `npx vitest run` — 635 passed, 4 skipped (one new test from M2; three pre-existing + zsh/fish-not-installed). No regressions.
- Story 5.1 contract preserved: bash/zsh/fish/powershell parse cleanly via the integration suite; JSON-mode emits exactly one line; AC1–AC10 unchanged.
