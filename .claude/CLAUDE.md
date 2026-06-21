# Project Agent Guide

This repository keeps agent guidance in `.claude/` so the structure stays
close to Claude Code conventions.

Read only the files relevant to the current task:

## Rules

- `rules/commenting.md`: code commenting conventions for edits.
- `rules/commits.md`: guardrails for staging and committing changes.
- `rules/testing.md`: when to add unit tests for new code changes.
- `rules/react-components.md`: folder tree, styling, and Redux state conventions
  for the browser UI.

## Skills

- `skills/git-commit-helper/SKILL.md`: workflow for drafting and finalizing a
  git commit.
- `skills/simulation-reporting/SKILL.md`: workflow for building and summarizing
  the structured `report.json` artifact for a completed simulation.
- `skills/stock-trade-simulation/SKILL.md`: workflow for running an automated
  stock trade simulation through the CLI (see also `commands.md`).
- `skills/update-market-data/SKILL.md`: workflow for refreshing the per-stock
  market data (re-download history, re-scrape EPS, rebuild data files) and
  extending the data date range (see also `commands.md`).
