# Repository Guidelines

## Project Structure & Module Organization
Core Remix code lives in `app/`, with routes under `app/routes/`, reusable services in `app/services/`, and Prisma access via `app/db.server.ts`. Generated build artifacts land in `build/`, static assets in `public/`, and database schema plus migrations in `prisma/`. Automated tests sit in `__tests__/`, while Shopify extension packages reside under `extensions/` (managed as workspaces).

## Build, Test, and Development Commands
Use `npm run dev` to launch the Shopify-connected dev server (opens a tunnel and syncs config). `npm run build` compiles the Remix app for production, and `npm run start` serves the compiled output locally. Run `npm run setup` to generate Prisma client code and apply migrations, and `npm run lint` to check ESLint/Prettier formatting. Execute `npm test` for the Jest suite or `npm run test:watch` while iterating.

## Coding Style & Naming Conventions
TypeScript is required across the Remix app. Prefer 2-space indentation and let Prettier defaults drive punctuation (notably double quotes in imports/strings). Components use `PascalCase`, utilities and services use `camelCase`, and route files follow Remix naming (e.g., `app/routes/app._index.tsx`, `app/routes/webhooks.app.uninstalled.tsx`). Keep modules focused and colocate tests or mocks in `__tests__` with matching names. ESLint inherits Remix defaults, and Prettier adjustments should be applied via your editor or `npm run lint -- --fix`.

## Testing Guidelines
Jest with Testing Library powers unit and integration coverage. Place specs alongside peers in `__tests__/` with the `*.test.ts` suffix (e.g., `aeo.service.test.ts`). Aim to cover service contracts for Shopify APIs, Prisma-backed persistence, and UI loaders/actions. Run `npm test` before pushing; for iterative debugging, prefer `npm run test:watch`.

## Commit & Pull Request Guidelines
Recent history favors concise, lower-case summaries that note UI progress (e.g., `seo page ui 30%`). Follow that tone: three to six words describing scope, optionally tracking completion. Push feature branches, then open PRs detailing the change, how it was verified (`npm test`, screenshots of Polaris views), linked issues, and any Shopify CLI steps run. Highlight schema or config edits (`shopify.app.toml`, `prisma/schema.prisma`) so reviewers can reapply them locally.

## Environment & Configuration
Environment variables are managed through the Shopify CLI; run `npm run env pull` or `npm run env push` as needed, keeping secrets out of Git. When altering database structure, update `prisma/schema.prisma` and regenerate via `npm run setup`. For app configuration, edit `shopify.app.toml` and `shopify.web.toml`, then sync changes with `npm run config:link` or `npm run config:use`.
