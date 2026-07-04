---
name: upload-stock-report
description: Upload the completed simulation session files to the report website. Use when the user asks to upload, publish, send, sync, or submit `user-sessions/default/report.json` together with the companion session files to the stock report server. Always ask the user for the secret key before attempting the upload.
---

# Upload Stock Report

Use this skill when the task is to send the current session artifacts from
`user-sessions/` to the stock report website endpoint.

## What this skill is for

- Uploading the latest completed session report to the report website
- Sending the companion session artifacts that belong with the report
- Reusing the project's current upload contract

The report website currently expects these five files from `user-sessions/default/`:

- `account.json`
- `history.log`
- `meta.json`
- `report.json`
- `values.log`

The current endpoint behavior is:

- `report.json` is read and stored in the database
- the other four files are copied into server storage and referenced by path
- the preferred production flow is multipart file upload

## Required behavior

1. Before doing anything that uploads, explicitly ask the user for the secret
   key.
2. Do not guess, invent, default, or reuse an old secret key unless the user
   clearly provides it in the current request context.
3. Confirm the required files exist under `user-sessions/` before attempting the
   upload.
4. Always upload to the **production** endpoint `https://stock.369usa.com/insert.php`,
   and only after the key is provided. Never upload to a local or dev instance
   (e.g. `localhost`) — production is the only supported target. Do not ask the
   user which target to use; it is always production.
5. Tell the user whether the upload succeeded and include the returned report id
   when available.
6. **After a successful upload only** (the server returns `ok: true` with a
   report id), clear the session for a clean next start: run
   `npm run cli -- account init`, which empties the entire `user-sessions/`
   directory and writes a fresh default account. The published copy already lives
   on the report
   website, so the local reset loses nothing. If the upload failed, do **not**
   clear — leave the session intact so it can be retried.

## Request shape

Uploads always go to the production report website (and only there):

- `https://stock.369usa.com/insert.php?key=<SECRET>`

With these multipart form fields:

- `report_json_file=@simulator/user-sessions/default/report.json`
- `account_json_file=@simulator/user-sessions/default/account.json`
- `history_log_file=@simulator/user-sessions/default/history.log`
- `meta_json_file=@simulator/user-sessions/default/meta.json`
- `values_log_file=@simulator/user-sessions/default/values.log`

## Suggested command pattern

From the repo root, a typical upload command is:

```bash
curl -X POST 'https://stock.369usa.com/insert.php?key=<SECRET>' \
  -F 'report_json_file=@simulator/user-sessions/default/report.json' \
  -F 'account_json_file=@simulator/user-sessions/default/account.json' \
  -F 'history_log_file=@simulator/user-sessions/default/history.log' \
  -F 'meta_json_file=@simulator/user-sessions/default/meta.json' \
  -F 'values_log_file=@simulator/user-sessions/default/values.log'
```

## Guardrails

- Always upload to production `https://stock.369usa.com/` — never to a local or
  dev instance, and never prompt the user to choose a target.
- Never upload before asking for the secret key.
- Never print or commit the secret key into repo files.
- If any of the five files are missing, stop and tell the user exactly which
  ones are absent.
- If the server returns an error, report the exact response briefly and do not
  claim success.
- Treat this as a finalization/publishing action, not a background side effect.
