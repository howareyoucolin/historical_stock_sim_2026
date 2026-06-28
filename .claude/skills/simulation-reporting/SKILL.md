---
name: simulation-reporting
description: Build and summarize a simulation report for this project using `report build`. Use when the user asks to build, rebuild, refine, review, or explain a simulation report, or when a completed stock-trade simulation reaches its final end date and should be concluded with `report build`. Do not use for mid-simulation checkpoints unless the user explicitly asks for an interim report.
---

# Simulation Reporting

Use this skill when the task is about creating or working with the structured
`report.json` artifact for a simulation run.

## What this skill is for

- Building `report.json` with `report build`
- Rebuilding a report with richer metadata
- Summarizing a saved report back to the user
- Enforcing the repo's timing rule: final report at the end of the run, not in
  the middle, unless the user explicitly asks for an interim report

Read `commands.md` at the repo root for the current CLI flags and output shape.

## Timing rules

- Build the report automatically only when the simulation has reached or passed
  its agreed final end date.
- Do not build a midway report just because the user paused at a year boundary,
  checkpoint, or partial stage of the simulation.
- If the user explicitly asks for a report before the final end date, it is okay
  to build an interim report.

## Required behavior

1. Use the CLI command:
   - `npm run cli -- report build --json`
2. Prefer filling in metadata when known:
   - `--strategy=<name>`
   - `--strategy-version=<version>`
   - `--strategy-summary=<text>`
   - `--objective=<title>`
   - `--objective-metric=<metric>`
   - `--objective-constraint=<text>` (repeatable)
   - `--market-regime=<label>`
   - `--volatility-level=<label>`
   - `--note=<text>`
3. If the user already gave strategy/objective/context details earlier in the
   run, reuse them when building the report rather than dropping to defaults.
4. If key metadata is unknown and the user did not ask to refine it, building
   the report with defaults is acceptable; tell the user which fields stayed
   generic.

## Output expectations

After building the report:

- Tell the user where the file was written.
- Give a short summary of the most important outcomes:
  - simulation end date
  - ending value, total return, and annualized return
  - how it compared to the built-in benchmark (equal-weight S&P 500 index — the
    `benchmark` block in `report.json`, invested on the same deposit schedule)
  - drawdown or concentration if notable
- If metadata fields were left generic, mention that clearly and offer to
  rebuild with better inputs.

## Guardrails

- Do not invent strategy/objective/context details that were never provided.
- Do not build the report early unless the user explicitly asks for an interim
  report.
- Keep the summary concise; the report file itself is the durable artifact.
