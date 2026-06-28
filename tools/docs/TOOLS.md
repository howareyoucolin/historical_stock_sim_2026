# Tool Catalog

Index of reusable simulator tools. **Consult this file before creating a new tool**
to avoid duplicates — prefer extending an existing tool over writing a new one.

- **Status** — `Approved` (reviewed, git-tracked, production-ready in `approved/`)
  or `Unapproved` (AI-generated, pending admin review in `unapproved/`, not committed).
- New tools default to `unapproved/<category>/`. An administrator promotes vetted
  tools into `approved/<category>/` and updates this catalog.

> **Cardinal rule:** every tool that loads dated data MUST cap results at the current
> simulation date (see `approved/database/db.py`). Never return rows dated after it.

| Tool | Purpose | Inputs | Outputs | Location | Status |
|------|---------|--------|---------|----------|--------|
| `db` | Date-safe DB access layer. `simulation_date()` + `fetch()` that hard-caps every read at the sim date (clamps any `as_of` to `min(as_of, sim_date)`). The foundation all data-access tools build on. | table, columns, where/params, `as_of` (optional) | list of dict rows, all dated ≤ sim date | `approved/database/db.py` | Approved |
| `price_loader` | Load a stock's daily price history (close/adj_close/volume), capped at the sim date. The canonical Agent → Price Loader → Database path. | `symbol`, `--as-of` (optional), `--limit`, `--json` | daily bars (oldest-first), JSON or table | `approved/database/price_loader.py` | Approved |

## Categories

`database/` · `indicators/` · `financials/` · `portfolio/` · `screening/` ·
`reporting/` · `utilities/` — present under both `approved/` and `unapproved/`.

## Adding a tool (checklist)

1. Search this catalog for an existing tool that already does it.
2. If none, create it under `unapproved/<category>/` (one clear responsibility).
3. For any dated data, go through `db.fetch()` (or a loader built on it) — never
   issue raw, uncapped SQL.
4. Add a row to the table above with Status `Unapproved`.
5. The administrator reviews and, if accepted, moves it to `approved/<category>/`
   and flips its Status to `Approved`.
