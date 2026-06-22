---
name: upload-stock-report
description: Upload the completed simulation session files to the report website. Use when the user asks to upload, publish, send, sync, or submit `user-sessions/report.json` together with the companion session files to the stock report server. Always ask the user for the secret key before attempting the upload.
---

# Upload Stock Report

Use this skill when the task is to send the current session artifacts from
`user-sessions/` to the stock report website endpoint.

## What this skill is for

- Uploading the latest completed session report to the report website
- Sending the companion session artifacts that belong with the report
- Reusing the project's current filename-based upload contract

The report website currently expects these five files from `user-sessions/`:

- `account.json`
- `history.log`
- `meta.json`
- `report.json`
- `values.log`

The current endpoint behavior is:

- `report.json` is read and stored in the database
- the other four files are copied into server storage and referenced by path

## Required behavior

1. Before doing anything that uploads, explicitly ask the user for the secret
   key.
2. Do not guess, invent, default, or reuse an old secret key unless the user
   clearly provides it in the current request context.
3. Confirm the required files exist under `user-sessions/` before attempting the
   upload.
4. Use the report website upload endpoint only after the key is provided.
5. Tell the user whether the upload succeeded and include the returned report id
   when available.

## Request shape

The stock report website currently accepts a POST to:

- `https://stock.369usa.com/insert.php?key=<SECRET>`

With these form fields:

- `report_json_file=report.json`
- `account_json_file=account.json`
- `history_log_file=history.log`
- `meta_json_file=meta.json`
- `values_log_file=values.log`

## Suggested command pattern

From the `simulator/` directory, a typical upload command is:

```bash
curl -X POST 'https://stock.369usa.com/insert.php?key=<SECRET>' \
  -d 'report_json_file=report.json' \
  -d 'account_json_file=account.json' \
  -d 'history_log_file=history.log' \
  -d 'meta_json_file=meta.json' \
  -d 'values_log_file=values.log'
```

This assumes the production report website is configured to read the source
session files from this repo's `simulator/user-sessions/` directory or an
equivalent server-side path mapping.

## Guardrails

- Never upload before asking for the secret key.
- Never print or commit the secret key into repo files.
- If any of the five files are missing, stop and tell the user exactly which
  ones are absent.
- If the server returns an error, report the exact response briefly and do not
  claim success.
- Treat this as a finalization/publishing action, not a background side effect.
