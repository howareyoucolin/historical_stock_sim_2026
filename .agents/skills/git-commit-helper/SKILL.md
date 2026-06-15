---
name: git-commit-helper
description: Draft and finalize a git commit for the current repository by inspecting staged changes, proposing exactly 3 commit-message options, and waiting for the user to choose and confirm one before committing. Use when asked to commit staged work, draft a commit message, or "commit this for me" with a short `(action): (message)` format where the message text stays under 80 characters.
---

# Commit Staged Changes

Create a single-line git commit from the staged diff only after the user picks
one of 3 candidate messages and confirms the choice.

## Commit format

```text
(action): (message less than 80 chars)
```

- `action` is a short commit type such as `feat`, `fix`, `chore`, `docs`,
  `refactor`, `style`, or `test`.
- `message` must be under 80 characters.
- Create a subject line only. Do not add a body unless the user explicitly asks.

## Workflow

### 1. Check for staged files first

Run:

```bash
git status --porcelain
```

Treat a line as staged when column 1 is non-space. If there are no staged files,
stop immediately and tell the user there is nothing staged to commit.

Do not auto-stage files.

### 2. Read only the staged diff

Use the staged changes to understand what is being committed:

```bash
git diff --cached --stat
git diff --cached
```

Base all candidate messages on the staged content, not on unstaged edits.

### 3. Propose exactly 3 commit messages

Show the user exactly 3 alternatives in a numbered list. Each option must
already follow the required format:

```text
feat: add hello world homepage
fix: correct chart tooltip overflow
chore: reorganize local codex skill folders
```

Keep the message text under 80 characters for every option.

Pick actions that fit the change. Make the 3 options meaningfully different
instead of trivial wording swaps.

### 4. Wait for user choice and confirmation

Ask the user to choose one option by number and confirm that it should be used.
Do not commit until the user explicitly confirms.

If the user rejects all 3 options, propose a revised set or use the user's
replacement message if it matches the format.

### 5. Commit only after confirmation

Once the user confirms, run:

```bash
git commit -m "action: message"
```

Then show a brief confirmation such as the new commit summary from:

```bash
git log -1 --stat
```

## Guardrails

- Do not commit if no files are staged.
- Do not auto-stage files.
- Do not skip the 3-option step.
- Do not skip explicit user confirmation.
- Do not exceed the required message length.
