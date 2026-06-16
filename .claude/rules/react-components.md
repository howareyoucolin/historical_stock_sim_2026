# React Component Rules

These apply to the browser UI under `app/components/` and the Redux store under
`app/store/`.

## Folder tree

- Give each component its own folder named in `PascalCase`. Nest a
  subcomponent's folder inside its parent's folder so the directory tree mirrors
  the render tree (component → subcomponent → subsubcomponent).
- Each component folder holds:
  - `index.tsx`: the component (always `.tsx`, never `.ts`, because it renders
    JSX). The exported component name matches the folder name.
  - `style.css`: the styles owned by that component.
  - `actions.ts`: only when the component triggers async work (thunks). Omit it
    for components that just render or dispatch a plain slice action inline.
- Keep presentational helpers shared by several components in
  `app/components/shared/` (e.g. formatting), not duplicated per component.

## Styling

- One plain `style.css` per component, imported at the top of its `index.tsx`.
  In the Next.js App Router these are global-scoped, so keep class names
  unique to the component.
- Put shared primitives and design tokens in `app/globals.css` (CSS variables,
  resets, reusable form/modal chrome, gain/loss tone classes). Do not re-declare
  them in component files.

## State and data flow

- Manage shared state with Redux Toolkit in `app/store/`: one `createSlice` per
  concern, composed in `store/index.ts`, with typed `useAppSelector` /
  `useAppDispatch` hooks in `store/hooks.ts`.
- Do not prop-drill. A component reads what it needs with `useAppSelector` and
  changes state with `useAppDispatch`; pass props only for genuinely local,
  parent-owned values.
- A component's `actions.ts` holds its async thunks typed as `AppThunk`. Thunks
  read state via `getState()` and dispatch slice actions; they do not mutate
  state directly.
- When two components need the same async behavior, export the thunk once from
  the owning component's `actions.ts` and import it, rather than duplicating the
  fetch logic.
- Keep transient view-only state (e.g. a calendar's visible month) as local
  `useState`; only shared or cross-component state belongs in the store.

## Client boundaries

- Mark interactive components with `'use client'`. Provide the store through a
  single client `Provider` boundary near the root, not per component.
