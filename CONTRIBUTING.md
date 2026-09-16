# Development conventions

Use the existing feature folders when adding code. Keep changes focused and preserve stored field names and external URLs unless the change includes compatibility handling.

## Names and layout

| Kind                                    | Convention                | Example                                               |
| --------------------------------------- | ------------------------- | ----------------------------------------------------- |
| React component                         | PascalCase, `.tsx`        | `LeaveHistory.tsx`                                    |
| React hook                              | `use` + PascalCase, `.ts` | `usePunchClock.ts`                                    |
| Utility, action, type module, or script | kebab-case                | `google-calendar.ts`, `schema-base.mjs`               |
| Feature folder or static route segment  | kebab-case                | `leave-management/`, `tv-dashboard/`                  |
| Test                                    | kebab-case + `.test.mjs`  | `access.test.mjs`                                     |
| Next.js entrypoint                      | Framework filename        | `page.tsx`, `layout.tsx`, `route.ts`, `middleware.ts` |

Next.js route groups and dynamic parameters keep their framework syntax, such as `(portal)`, `[ticketId]`, and `[...path]`. Public avatar filenames keep their existing numeric IDs.

Use camelCase for functions and values, PascalCase for types and components, and UPPER_SNAKE_CASE for fixed module constants where the surrounding module follows that convention. Database fields keep their existing snake_case names. Do not rename persisted keys solely for style.

Shared client-safe types belong in `src/types`. Database document types stay in `src/lib/db/collections.ts`. Use `@/` imports across features and relative imports within a feature. Match filename case exactly so imports work on both Windows and Linux.

## Formatting

Prettier is the formatting source of truth: two spaces, single quotes in JavaScript and TypeScript, semicolons, trailing commas, and a 100-column target. JSX attributes use double quotes. EditorConfig and Git attributes keep text files UTF-8 with LF endings.

Use braces for every conditional and loop body, including one-line guards. Keep imports together at the top, after any framework directive, and separate them from declarations with a blank line. ESLint enforces these rules. Import shared client/server contracts from `src/types` instead of defining parallel copies.

Run `npm run format` before submitting a change. Generated Next.js files, dependencies, the lockfile, build output, and environment files are excluded. Both schema files are maintained by hand and are formatted with the source.

## Comments

Explain constraints, reasons, units, and edge cases that are not clear from the code. Keep the explanation close to the relevant statement. Use `//` for implementation notes and JSDoc when a caller needs an API contract. Short CSS and JSX section labels are fine when they help navigate a large file.

Avoid change histories, decorative banners, commented-out code, and prose that repeats a function name. Describe the current behavior. Keep examples and rationale where they protect permissions, payroll rounding, date handling, or file compatibility. Preserve compiler directives and document any lint exceptions narrowly.

## Checks

Use Node.js 22.15 or newer for the test runner's module hooks.

```bash
npm run format:check
npm run check:names
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run check` runs formatting, naming, lint, type checks, and tests together. Regenerate Next.js route types through development or a build after changing route folders.
