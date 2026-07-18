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
- `skills/scoring-script-autopilot/SKILL.md`: workflow for unattended invention and
  backtesting of regime-aware stock-scoring SCRIPTS (Python, may branch on market
  regime) across the four anchored windows, ranking the universe monthly and holding
  the top 15 at linear-decay rank weights; optimizes justified_gain, records each run
  to report_scoring_experiments and what it learned to report_scoring_lessons.
- `skills/scoring-script-autopilot-v2/SKILL.md`: V2 of the scoring-script lab. Same
  script contract and no-look-ahead engine, but a better evaluation framework —
  all rolling 5-year windows (monthly step) + the four anchored windows, every
  window scored RELATIVE TO A BENCHMARK (same deposits/dates/dividends/methodology),
  equal window weighting, dispersion reference-only. Optimizes
  relative_return = mean over rolling windows of (1+strategy)/(1+benchmark); records
  to the parallel report_scoring_*_v2 tables. Runs `tools/unapproved/scoring_lab_v2.py`.
  V1 remains available unchanged.
- `skills/stock-trade-simulation/SKILL.md`: workflow for running an automated
  stock trade simulation through the CLI (see also `commands.md`).
- `skills/stock-strategy-autopilot/SKILL.md`: workflow for continuously auto-running
  many simulations, generating/adjusting strategy variants until a stop condition
  or manual stop, leaving an app/market-data suggestion after each run.
- `skills/upload-stock-report/SKILL.md`: workflow for uploading the completed
  session report and companion files to the report website, with an explicit
  secret-key prompt required before any upload attempt.
