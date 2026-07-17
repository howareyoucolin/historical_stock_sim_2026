# Project Agent Guide

This repository keeps agent guidance in `.claude/` so the structure stays
close to Claude Code conventions.

Read only the files relevant to the current task:

## Tools

- `tools/`: reusable analysis tool library. Before writing a new helper, check
  `tools/docs/TOOLS.md` (approved) and `tools/unapproved/INDEX.md` (pending), and
  reuse an existing tool. New AI-created tools go directly in `tools/unapproved/`
  (flat) and are recorded in `tools/unapproved/INDEX.md` — both git-ignored, so
  creating a tool makes NO git changes. Never edit the tracked `tools/docs/TOOLS.md`;
  only the admin does, when promoting a tool into `tools/approved/`. See
  `tools/README.md`.
- **Cardinal data rule:** any tool loading dated data MUST cap it at the current
  simulation date — go through `tools/approved/db.py` (`fetch`), which enforces the
  cap. Never read data dated after the sim date; never issue raw, uncapped SQL for
  dated tables.

## Rules

- `rules/commenting.md`: code commenting conventions for edits.
- `rules/commits.md`: guardrails for staging and committing changes.
- `rules/testing.md`: when to add unit tests for new code changes.
- `rules/react-components.md`: folder tree, styling, and Redux state conventions
  for the browser UI.

## Skills

- `skills/simulation-reporting/SKILL.md`: workflow for building and summarizing
  the structured `report.json` artifact for a completed simulation.
- `skills/scoring-exploration-autopilot/SKILL.md`: workflow for unattended search
  over monthly stock-scoring formulas, optimized for high weighted multi-window gain
  with low cross-window instability and minimal logic variants.
- `skills/stock-trade-simulation/SKILL.md`: workflow for running an automated
  stock trade simulation through the CLI (see also `commands.md`).
- `skills/stock-strategy-autopilot/SKILL.md`: workflow for continuously auto-running
  many simulations, generating/adjusting strategy variants until a stop condition
  or manual stop, leaving an app/market-data suggestion after each run.
- `skills/upload-stock-report/SKILL.md`: workflow for uploading the completed
  session report and companion files to the report website, with an explicit
  secret-key prompt required before any upload attempt.
