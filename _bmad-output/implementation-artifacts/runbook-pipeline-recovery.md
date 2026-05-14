# Runbook: Pipeline Recovery After an Interruption

**Audience:** Project Lead (or any operator) resuming work after an `epic-cycle` automation run is interrupted mid-flight.
**Scope:** Recovery from power loss, network drop, Vitest worker-pool deadlock, IDE crash, partial git commit, or any failure that leaves a `dev-*` / `cr-*` / story-author agent in an unknown state.
**Owning principle:** *Do not assume any prior work exists. Re-verify what is on disk against the story's File List before continuing. Resume under a fresh unique agent name.*

---

## 1. Detection Signals

Recognise an interruption by any of:

- **Vitest worker-pool deadlock.** Agent log stalls inside a `npm test` / `npm run check` run; no progress for several minutes; CPU idle. The Vitest pool process is alive but no worker reports completion.
- **Missing `shutdown_response`.** A teammate agent's process registration is still present in `C:\Users\Josh\.claude\teams\<team>\config.json` (or `~/.claude/teams/<team>/config.json` on Unix), but no message has been received from it; the agent is unreachable via SendMessage.
- **Dead-name-with-stale-registration.** The agent name (e.g., `cr-4-0`) appears in team config but the underlying process is gone (Task Manager / `ps` shows nothing). Sending a new message to that name fails or hangs.
- **Mid-write `git status` pattern.** `git status --short` shows a mixture of staged and unstaged changes that don't form a coherent commit; or a file shows as deleted but its replacement is untracked; or a partial chunk of an expected edit is present.
- **No `Status: review` flip in the story file** despite the agent claiming the work was complete in its last message.
- **Power loss / IDE crash / network drop** (obvious external trigger).

---

## 2. Verification Steps — what is actually on disk

Run from the repository root before doing anything else.

1. **Working tree status, primary repo:**

   ```
   git -C c:\git\ClaudeMemoryMover status --short
   git -C c:\git\ClaudeMemoryMover log -1 --oneline
   ```

2. **Status of every nested git repo (if multi-agent worktrees are in use):**

   ```
   git -C c:\git\ClaudeMemoryMover\src\MA-* status --short
   ```
   (Adjust the glob to whatever sub-repos the project uses; today this project has none, so the primary repo is sufficient.)

3. **Compare File List vs. disk reality.** Open the story file under
   `_bmad-output/implementation-artifacts/<story>.md` and scan its `### File List`
   section. For each entry: confirm the file exists, is staged or committed, and
   has plausible content (not a half-written stub).

4. **Inspect recent commits.** `git log -5 --oneline` — does the latest commit
   carry the expected story key in its subject? If yes, the dev agent very
   likely completed before the interruption; only post-commit work (e.g., the
   code-review pass, sprint-status update, retro) needs resuming.

5. **Check the sprint-status file:**

   ```
   _bmad-output/implementation-artifacts/sprint-status.yaml
   ```

   Does the story's `development_status` value match what the last completed
   step would have set (`in-progress` / `review` / `done`)? Mismatch is fine —
   it tells you exactly which transition the interruption hit.

**Stop here and reason before mutating anything.** If `git status` looks coherent and the File List matches disk, you can probably skip straight to a fresh agent and tell it to verify and continue. If `git status` looks incoherent, do NOT clean it up automatically — see Section 6.

---

## 3. Team Registration Cleanup

Stale team registrations are the most common cause of "I spawned an agent and it never responded" after an interruption.

1. Open `C:\Users\Josh\.claude\teams\<team>\config.json` (path is OS-specific;
   on Unix it lives under `~/.claude/teams/<team>/config.json`).
2. Look at the `members` (or equivalent) array. Each entry is a registered
   agent name + UUID + role.
3. For any name whose underlying process is gone:
   - **Remove the stale entry** rather than reusing the name. The agent system
     tracks agents by UUID, but humans (and the agent prompt!) refer to them by
     name. Reusing a dead name without cleanup means the next message to that
     name may route to a registration that no process is listening on.
4. Save the file.

**Consequence of reusing a name without cleanup:** SendMessage may silently
deliver to the stale registration, the new agent never hears the message, and
you waste a full spawn cycle wondering why no work is happening.

---

## 4. Resume Procedure

The golden rule: **spawn a fresh agent under a NEW unique name.** Do not try to revive the dead one.

1. **Pick a fresh name.** Suffix the original with `-resume` (or `-resume-2`,
   `-resume-3` if needed): `cr-4-0` → `cr-4-0-resume`. The suffix is for human
   readability; the system only cares that the name is unique within the team.

2. **Give the new agent explicit re-verification instructions.** In its
   spawn prompt, include verbatim:

   > Do not assume any prior work exists. Re-verify the story's File List
   > against `git status` before continuing. If a file in the File List is
   > absent from disk or absent from git, treat that task as incomplete and
   > re-implement it. If `git status` shows uncommitted edits, decide whether
   > to keep, commit, or revert them based on the story's tasks/subtasks
   > checkboxes — do not blindly stash or reset.

3. **Hand it the same story file.** The story file is the source of truth.
   The new agent reads tasks/subtasks checkboxes and the Dev Agent Record and
   resumes from the first unchecked task, *after* re-verifying that the
   checked tasks are actually reflected on disk.

4. **Let the new agent re-run the gates from scratch.** Even if the dead
   agent claimed `npm run check` passed, the new agent should run it again.
   Tests are cheap; a missed regression after a partial commit is not.

---

## 5. Failure-Mode Catalog

Each entry: detection signal + diff (if any) from the generic Section 4
resume procedure.

### Power loss

- **Detection.** Machine restarted; agent processes are gone; team config still
  shows their registrations.
- **Diff from generic.** None. Clean up stale registrations (Section 3), then
  resume under a fresh name (Section 4).
- **Real example.** Story 4.0 CR. The `cr-4-0` agent was spawned and writing
  its initial transcript when grid power dropped. After power returned the
  Lead ran the Section 2 verification, found `dev-4-0`'s work intact and the
  story file's File List matching disk, removed the stale `cr-4-0` registration
  from team config, and spawned a `cr-4-0-resume` agent with the re-verify
  instructions from Section 4. The resume agent ran the full gate suite from
  scratch and produced a clean code review. Total recovery time: ~10 minutes.

### Network drop

- **Detection.** Agent transcript stops mid-token; SendMessage retries fail;
  the agent process may still be alive locally but unreachable.
- **Diff from generic.** Check whether the agent process is actually dead vs.
  just isolated. If still alive locally, you can sometimes wait for the network
  to return and the agent reconnects on its own. If it's been more than a few
  minutes, treat it as dead and follow Sections 3–4.

### Vitest worker-pool deadlock

- **Detection.** Agent is partway through `npm test` or `npm run check`. The
  Node process tree shows the parent vitest process and N worker processes,
  all idle. No CPU activity, no progress for several minutes.
- **Diff from generic.** Kill ONLY the deadlocked vitest tree, not every Node
  process. **Preferred — by PID:** find the vitest PIDs via Task Manager
  (Details tab, sort by command line) or PowerShell
  (`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*vitest*' } | Select-Object ProcessId, CommandLine`)
  and stop those specific PIDs with `Stop-Process -Id <pid>`.
  **DANGER — do NOT run `Get-Process node | Stop-Process` unfiltered.** That
  kills every Node process on the machine, including any other Claude Code
  agents, editor MCP servers, and dev servers running on the host. The
  collateral damage is rarely worth saving the typing.
  Then follow Sections 3–4 to spawn a resume agent. Tell the resume agent to
  re-run the gates and watch for the same deadlock; if it recurs in the same
  test file, that file has a hang bug.

### Partial git commit

- **Detection.** `git status` shows a mix of staged and unstaged changes that
  don't form a coherent unit, or `git log -1` shows a commit whose message
  references work that isn't yet in the working tree.
- **Diff from generic.** **Do NOT `git reset --hard`.** Read the partial
  commit and the unstaged diffs first. If the commit + the unstaged diffs
  together reconstruct the intended change, the right move is to amend the
  commit with the missing pieces (or — preferred — make a follow-on commit).
  If the commit is clearly broken (e.g., references a file that was never
  written), `git reset --soft HEAD~1` is the safest undo because it preserves
  the diff for inspection.

### IDE crash

- **Detection.** Editor process is gone; some open buffers may have been
  unsaved. The agent process, if it was running independently, may still be
  alive.
- **Diff from generic.** Check for editor `.swp` / autosave files in the work
  tree before doing anything. VS Code's `.vscode` workspace state and JetBrains'
  `.idea` directory sometimes hold unsaved edits the editor will offer to
  restore on relaunch. Recover those first, *then* proceed with verification.

---

## 6. What NOT To Do

- **Do NOT `git reset --hard`** to "clean up" an incoherent working tree.
  That destroys uncommitted work — often including the dev agent's
  in-flight edits that you can still recover. If you need to reset, prefer
  `git stash -u` (preserves the changes) or `git reset --soft HEAD~1`
  (preserves the diff).

- **Do NOT reuse a failed agent's name** without first removing its
  registration from the team config. The agent system routes by registration;
  a stale registration silently swallows messages.

- **Do NOT skip the Section 2 verification.** Even if the agent's last
  message claimed "all gates passed," the interruption may have hit *after*
  the message was queued and *before* the actual side effects landed (commit,
  file write, sprint-status update).

- **Do NOT amend the failed agent's last commit** unless you have read the
  diff and understand exactly what it changed. Prefer a new commit on top.

- **Do NOT spawn the resume agent without explicit re-verify instructions.**
  Without them, the resume agent reads the story file's tasks/subtasks
  checkboxes at face value and skips work that may not actually be on disk.

- **Do NOT delete the dead agent's team-config entry without first checking
  whether any sibling agent expects it.** If `cr-4-0` died but `dev-4-0` is
  still alive and waiting for a message from `cr-4-0`, the cleanest move is
  to spawn `cr-4-0-resume` and direct `dev-4-0` to it.
