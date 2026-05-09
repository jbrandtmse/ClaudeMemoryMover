---
description: Run the BMAD epic development cycle (sprint planning → stories → retro) using Agent Teams with spawn-on-demand coordination.
argument-hint: <epic-or-range>  # e.g. "2" or "2-5"
allowed-tools: Agent, Bash, Edit, Glob, Grep, Read, Skill, TeamCreate, TeamDelete, SendMessage, Write
---

# /epic-cycle — BMAD Epic Development Cycle (Agent Teams)

Runs the full BMAD development implementation cycle for one epic or a range of epics, using Agent Teams with the spawn-on-demand pattern. You are the **Lead** orchestrator. Coordinate teammates by name; run gate skills yourself.

**Argument:** `$ARGUMENTS` — single epic number (`3`) or inclusive range (`2-5`). If empty, ask the user which epic(s) to run before doing anything else.

---

## 0. Pre-flight — Agent Teams must be enabled

Before doing anything else, verify Agent Teams is on in this session:

- The `Agent` tool must accept a `name:` parameter.
- `SendMessage`, `TeamCreate`, and `TeamDelete` tools must be available.

If any of those are missing, **stop immediately** and tell the user:

> Agent Teams is not enabled. This workflow depends on it. Either: (A) ask me to use the `update-config` skill to set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `settings.json`, or (B) edit `~/.claude/settings.json` (or `.claude/settings.json`) to add `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`. Then fully restart Claude Code (the running session can't pick it up) and re-run `/epic-cycle`.

Do **not** attempt single-agent fallbacks. The design assumes named, addressable teammates.

If pre-flight passes, announce: `Agent Teams confirmed enabled. Starting epic cycle.`

---

## 1. Parse the epic range

- `3` → process epic 3 only.
- `2-5` → process epics 2, 3, 4, 5 in order.
- Anything else → ask the user to clarify before proceeding.

Read `_bmad-output/planning-artifacts/epics.md` and `_bmad-output/implementation-artifacts/sprint-status.yaml` to confirm the requested epics exist. If any do not, stop and report.

---

## 2. Create the team

Call `TeamCreate` with `team_name: "epic-cycle-{first}-{last}"` (e.g., `epic-cycle-2-5` or `epic-cycle-3-3`). You stay as the lead — teammates are spawned on-demand per story.

---

## 3. Per-epic loop

For each epic `N` in the requested range, in order:

### 3.1 Sprint planning (Lead, via Skill tool — pipeline gate)

Run `/bmad-sprint-planning` directly using the `Skill` tool. Do **not** spawn an agent for this. Wait for it to finish. If it surfaces issues (status mismatches, missing stories, etc.), pause and tell the user before continuing.

Log: `Epic N — sprint planning complete.`

### 3.2 Retrospective review + Story X.0 (Lead — mandatory gate)

This step closes the loop between retrospectives and sprint planning. **It is mandatory** even if all items end up deferred — the Story X.0 file documents the triage decision.

1. Look for the previous epic's retro: `_bmad-output/implementation-artifacts/epic-{N-1}-retro-*.md` (use Glob).
2. If `N == 1` or no retro file exists → log "no previous retrospective found, skipping Story X.0" and continue to 3.3.
3. If a retro exists, read it. Also read `_bmad-output/implementation-artifacts/deferred-work.md` if it exists.
4. Extract: action items (with status), deferred review findings, preparation tasks for the current epic.
5. **Triage every item** into one of three buckets:
   - **Include in Story X.0** — relevant to this epic's codebase or blocking quality.
   - **Defer with rationale** — not relevant yet (e.g., belongs to a future epic).
   - **Drop** — already resolved or no longer applicable.
6. Run `/bmad-create-story` via the `Skill` tool with args: `Story {N}.0: Epic {N-1} Deferred Cleanup`. Capture the resulting story file path. The story file must include the full triage table (item, source, decision, rationale).
7. Even if every item is dropped/deferred, create Story X.0 anyway so the triage is recorded.

Log: `Epic N — retrospective review complete; Story N.0 created at {path}` (or "no retro found").

### 3.3 Build the story list for epic N

Read both:

- `_bmad-output/planning-artifacts/epics.md` (the planned story list)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (may contain extras: cleanup stories, hotfixes)

Combine into a single ordered list, **including Story N.0 if it was just created**. Skip stories whose status in `sprint-status.yaml` is already `done`/`completed` (resume support).

### 3.4 Per-story loop

For each story `S` in epic `N` (in order):

#### 3.4.1 Lead creates the story (pipeline gate)

Run `/bmad-create-story` via the `Skill` tool yourself. Capture the **story file path** from the skill output — you will pass it to the developer.

Do **not** delegate this step. Story creation is a deliberate gate that prevents agents from racing ahead.

#### 3.4.2 Spawn the developer (task-in-prompt)

Spawn a fresh agent:

- `subagent_type: "bmad-agent-dev"` if available, otherwise `"general-purpose"`.
- `name: "dev-{N}-{S}"` (e.g., `dev-2-3`). **Always unique per story** — never reuse generic names like `developer`.
- `mode: "bypassPermissions"`.
- `team_name: "<the team you created>"`.
- Embed the full task in the prompt — do not rely on a follow-up `SendMessage`.

Prompt template:

> **CRITICAL — Single-Task Agent:**
> - You will execute exactly ONE task: implement Story `{N}.{S}` from `{story_file_path}`.
> - Use the `Skill` tool to invoke `/bmad-dev-story`. Do NOT interpret the skill logic inline.
> - When done, send a single completion message to the lead (`team-lead`) including:
>   - All files created or modified, with full paths
>   - Key design decisions
>   - Any issues encountered and how you resolved them
> - After sending the completion message, STOP completely.
> - Do NOT call TaskList. Do NOT use TaskCreate or TaskUpdate. Do NOT look for more work.
> - Approve any shutdown request immediately.
> - If requirements are ambiguous, send a clarification message to the lead and wait for a response — do NOT proceed on assumptions.

Wait for the developer's completion message. **Capture the file list** from that message — the code reviewer needs it.

#### 3.4.3 Shut the developer down

Send `SendMessage(to: "dev-{N}-{S}", message: { type: "shutdown_request" })`. **Wait for the `shutdown_response` with `approve: true`** before spawning the next agent. An idle notification is not the same as shutdown approval — do not act on idle alone, or you'll get a name collision.

#### 3.4.4 Spawn the code reviewer (task-in-prompt)

- `subagent_type: "general-purpose"` (or a code-review-specific type if installed).
- `name: "cr-{N}-{S}"`.
- `mode: "bypassPermissions"`.
- `team_name: "<the team>"`.

Prompt template:

> **CRITICAL — Single-Task Agent:**
> - You will review the implementation of Story `{N}.{S}` (story file: `{story_file_path}`).
> - The developer modified these files:
>   {bulleted list of files from dev's completion message}
> - Use the `Skill` tool to invoke `/bmad-code-review` against those files.
> - **Auto-resolve all HIGH and MEDIUM severity issues** using best judgment and BMAD guidance. Document each fix.
> - **Log any deferred findings to `_bmad-output/implementation-artifacts/deferred-work.md`** — do not leave deferrals only in the story file.
> - When done, send a single completion message to the lead (`team-lead`) including:
>   - Files modified during review fixes (full paths)
>   - Issues resolved (severity + summary)
>   - Issues deferred (severity + summary + path in deferred-work.md)
> - After sending the completion message, STOP. Approve shutdown immediately.
> - Do NOT call TaskList, TaskCreate, or TaskUpdate.

Wait for the reviewer's completion message. Capture any additional files modified during review fixes.

#### 3.4.5 Shut the code reviewer down

Same shutdown sequence as the developer. Wait for `shutdown_response: approve: true` before continuing.

#### 3.4.6 Lead commits and pushes (submodules first)

The full file list is `dev_files ∪ reviewer_fix_files`.

1. Check submodule status:
   - `git -C src/MA status --short`
   - `git -C src/MALIB status --short`
2. **For each submodule with changes**, in this order:
   - `git -C <submodule> add <changed files>`
   - `git -C <submodule> commit -m "<feat/fix message scoped to the story>"`
   - `git -C <submodule> push`
3. **Then in the parent repo**:
   - `git add <parent files> src/MA src/MALIB` (only stage submodule pointers if they advanced)
   - `git commit -m "<feat/fix message scoped to the story>"`
   - `git push`

Never push the parent before the submodules. A parent push referencing unpushed submodule SHAs leaves other developers with broken checkouts.

If there are no changes in a submodule, skip its commit step.

#### 3.4.7 Story completion log

Append a brief entry to your in-conversation log:

```
Story {N}.{S} — {title}
  Files: {short list or count}
  Decisions: {1–3 bullets}
  Auto-resolved: {count of HIGH/MED issues fixed}
  User input required: {none | brief description}
```

Move on to the next story.

### 3.5 End-of-epic — retrospective decision (user gate)

After every story in epic `N` is done:

1. Tell the user, in the main conversation: `Epic {N} is complete. Would you like to run a retrospective before moving on? (yes/no)`
2. **Wait for the user's actual answer.** Do not proceed automatically.
3. If **yes**: invoke `/bmad-retrospective` via the `Skill` tool yourself. Run it **in interactive mode** — surface every elicitation prompt to the user and wait for real answers. Do not auto-answer them; auto-answers produce a worthless retro. (`bypassPermissions` for tool calls is fine; the elicitation flow is what must reach the user.)
4. If **no**: log `Epic {N} — retrospective skipped by user.`

Log: `Epic N — complete.` Continue to the next epic in the range.

---

## 4. End of run — clean up the team

After the last epic finishes:

1. Confirm no teammates are still alive (any active `dev-*` or `cr-*` should already have been shut down per-story).
2. Call `TeamDelete` to remove the team.
3. Print a final summary to the user: epics processed, stories completed, retros run, anything that needed user input.

---

## Hard rules (do not violate)

- **Skill tool, always.** Every BMAD skill call (`/bmad-sprint-planning`, `/bmad-create-story`, `/bmad-dev-story`, `/bmad-code-review`, `/bmad-retrospective`) must go through the `Skill` tool. Never let an agent interpret skill logic inline — say so explicitly in spawn prompts.
- **Lead-owned gates.** `bmad-sprint-planning`, `bmad-create-story`, and `bmad-retrospective` are run by you, not by spawned agents.
- **`bypassPermissions` for every spawned agent.** Otherwise the pipeline stalls on every file edit.
- **Retrospective is interactive.** No auto-answering its prompts. Permission mode is unrelated to elicitation flow.
- **Unique agent names per story.** `dev-{N}-{S}`, `cr-{N}-{S}` — never `developer` / `code-reviewer`.
- **Task-in-prompt over spawn-then-message.** Embed the task in the spawn prompt; agents sometimes go idle without picking up `SendMessage` dispatches.
- **Wait for `shutdown_response: approve: true`** before reusing a name — idle ≠ shut down.
- **Submodules push first**, then parent. Never the reverse.
- **No TaskList / TaskCreate / TaskUpdate.** Coordinate via spawn-on-demand and direct messages only. Tell agents the same.
- **Do not normalize known failures.** If tests fail, fix or formally defer in `deferred-work.md` immediately.
- **Pause for the user only when** acceptance criteria are ambiguous, multiple reasonable designs need their preference, or proceeding would risk security/compliance/performance/interop. Otherwise resolve high/medium issues yourself per BMAD guidance.

## Handling clarifications from agents

If a teammate sends a clarification message (not a completion message):

1. **Do not shut them down** — they are waiting, not finished.
2. Surface the question to the user with the Story ID and relevant context.
3. Wait for the user's answer.
4. Relay the answer back via `SendMessage` as a hard constraint.
5. The agent resumes; eventually you'll get a completion message. Then proceed with normal shutdown.

A clarification is "I have a question, please advise." A completion is "I'm done, here are the results." Differentiate.
