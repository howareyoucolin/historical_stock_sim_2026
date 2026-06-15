# StockSimulate2026

Small Next.js 13 app-router project running on port `8600`.

## Prerequisites

- Node.js and npm installed locally
- Dependencies installed with `npm install`

## Local Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open the app at `http://localhost:8600`.

## CLI

Start the local app CLI:

```bash
npm run cli
```

This opens an interactive shell where you can run commands such as:

- `help`
- `account init`
- `account deposit 500`
- `account deposit -125.5`
- `stock download AAPL`
- `exit`
- `quit`

You can also run one command directly:

```bash
npm run cli -- help
```

Download historical daily data for a stock code:

```bash
npm run cli -- stock download AAPL
```

Downloaded files are stored at `market-data/<STOCK_CODE>/history.json`.
The current download range is `2000-01-01` through `2026-01-01`.
The CLI is only a controller here; the shared stock-download logic lives in `app/actions/`.
The saved JSON is keyed by date for faster lookup, and each date entry includes only `close`, `isPayoutDate`, and `dividendPerShare`.

## Production Build

Create a production build:

```bash
npm run build
```

Start the production server locally after building:

```bash
npm start
```

The production server also runs on `http://localhost:8600`.

## Project Structure

- `app/layout.tsx`: root layout and shared document shell
- `app/page.tsx`: home page for the app
- `app/globals.css`: global styles
- `app/actions/stock/`: stock-related reusable app logic for CLI and future UI flows
- `cli/`: TypeScript CLI entrypoint and controller-style command dispatch
- `app/actions/stock/download-data.test.ts`: focused tests for the stock download action
- `tsconfig.json`: TypeScript configuration for the project
- `next-env.d.ts` and `global.d.ts`: Next.js and CSS type declarations

## Tech Stack

- Next.js 13
- React 18
- TypeScript

## Useful Notes

- This project uses the Next.js App Router under `app/`.
- Type checking is part of the Next.js production build.
- The repo currently uses `npm` because `package-lock.json` is checked in.
- Build output is written to `.next/`, which is ignored by git.
- Downloaded stock history is written to `market-data/`, which is ignored by git.
- TypeScript incremental cache files such as `tsconfig.tsbuildinfo` are also ignored by git.

## Troubleshooting

- If the dev server will not start, confirm that port `8600` is free.
- If dependencies look out of sync, remove `node_modules` and run `npm install` again.
- If you change scripts or TypeScript settings, rerun `npm run build` to verify the app still compiles cleanly.
