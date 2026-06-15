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
- TypeScript incremental cache files such as `tsconfig.tsbuildinfo` are also ignored by git.

## Troubleshooting

- If the dev server will not start, confirm that port `8600` is free.
- If dependencies look out of sync, remove `node_modules` and run `npm install` again.
- If you change scripts or TypeScript settings, rerun `npm run build` to verify the app still compiles cleanly.
