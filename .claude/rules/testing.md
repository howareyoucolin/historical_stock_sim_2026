# Testing Rules

- Add unit tests for new code when they meaningfully protect behavior,
  logic, or edge cases that could regress.
- Do not add tests for trivial changes, simple content edits, or code where
  a test would add more noise than confidence.
- Prefer a small number of focused tests over broad or repetitive coverage.
- When adding tests, target the new or changed behavior instead of trying to
  retroactively cover unrelated areas.
- If you choose not to add tests, make sure that decision is intentional and
  based on the size, risk, and complexity of the change.
