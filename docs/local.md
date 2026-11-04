# Local development baseline

This fork starts from LibreChat `v0.8.9-rc1`, commit
`8d3da9bbb220a0a96be9330a2e1cbd385fb786d5` (an upstream prerelease).
The school branch was synchronized with LibreChat `main` on November 1, 2026,
through `f4154b649efa37e1345ccc517a4d8d1ed2178c82` (Agents SDK 4.2.1).
The accepted school concept remains in [`concept/`](../concept/index.html).
The application now includes the focused school pilot described in
[`school.md`](school.md), using LibreChat's default visual design.

## First setup

Use Node **24.22.1** (the repository's `.nvmrc`) and npm **11.13.0**.
If using nvm, run `nvm install` and `nvm use` from the repository root.
Docker Desktop must be running for MongoDB.

```sh
node scripts/local.mjs
docker compose -f compose.local.yml up -d --wait
SCARF_ANALYTICS=false npm ci --no-audit
npm run frontend
npm run backend
```

Open <http://localhost:3080>. Local registration uses the upstream defaults;
the first account in this isolated database becomes its administrator. These setup
commands do not create accounts or configure model keys, school identity providers,
Canvas, or Microsoft connections. Model inference needs a separately configured
provider key; a successful page load does not verify AI responses. Local credentials
belong in ignored files and must not be committed.

The app binds to `127.0.0.1:3080`. MongoDB binds to `127.0.0.1:27019` and persists
in the `school-agent-local_mongodb` Docker volume. The ignored `.env` contains
unique local secrets; rerunning `scripts/local.mjs` preserves it. This is a local
development configuration, not an institution deployment configuration.
`config/local.yaml` selects the local school configuration. The environment
explicitly declares one backend process (`SCHEDULES_SINGLE_PROCESS=true`); do not
reuse that assertion for a deployment with multiple replicas. Search and the RAG/file
indexing service are not started here. Plain-text/Markdown context uses the native
file-processing path. The admin panel is started separately with `node scripts/admin.mjs`.

## Optional project-local toolchain

If another project requires a different global Node version, install these tools
without changing the machine's default:

```sh
npm install --prefix .local/toolchain --no-save --package-lock=false node@24.22.1 npm@11.13.0
export PATH="$PWD/.local/toolchain/node_modules/.bin:$PATH"
node --version
npm --version
```

The `.local/` directory ignores its contents. Select this PATH in each new shell
before running the setup/build commands above.

## Daily development

```sh
docker compose -f compose.local.yml up -d --wait
npm run backend:dev
```

For frontend hot reload, use another terminal:

```sh
PORT=3090 BACKEND_PORT=3080 npm run frontend:dev
```

Open <http://localhost:3090> for the development UI. Backend-only authentication
callbacks use the configured origin on port 3080; configure matching origins when
adding federated login. Rebuild the relevant shared workspaces when their code
changes (`npm run build:packages`), and use `npm run frontend` before checking the
production build on port 3080.

Stop Node with Ctrl+C. Stop MongoDB without deleting its data:

```sh
docker compose -f compose.local.yml stop
```

`origin` is the school fork; `upstream` is `LibreChat-AI/LibreChat`. The school
configuration and selected-context Canvas workflow are implemented. See
[`school.md`](school.md) for current features, setup, and remaining institution
configuration.

An optional local **Study workspace** agent now provides native terminal execution
and persistent chat files. See [terminal.md](terminal.md) for setup, approval
controls, startup commands and the limits of a personal-machine sandbox.

## Verification

The November 1, 2026 upstream synchronization was checked with the pinned local
toolchain:

- Lockfile installation and the full production frontend/shared-package build passed.
- TypeScript checks passed for all six affected TypeScript workspaces and the chat
  package's consumer fixture.
- 1,228 focused tests passed across 32 suites: school tools, agent/tool wiring,
  credential and file ownership, school configuration, the Canvas composer and chat
  components.
- The local YAML validated with all four school helpers enabled.
- The isolated startup regression passed using the production build: median LCP
  3,545.1 ms (limit 4,500), CLS 0.018 (limit 0.1), and TBT 51.0 ms (limit 500).
  The database latency hook remained enabled at 250 ms per query.
- The staged upstream changes contained no matches for actual local credentials
  and no private `.env` or `.local/` paths.

The baseline was checked on October 28, 2026 with the pinned local toolchain:

- Lockfile dependency installation and `npm run frontend` completed.
- The local YAML passed LibreChat's configuration schema.
- MongoDB became healthy; `/health`, `/readyz`, and `/login` returned 200.
- `/api/user` returned 401 without authentication.
- The production login form loaded in the browser without console errors.
- Local setup preserved an existing `.env` and its 0600 permissions.
- Formatting, ESLint for the setup script, and `git diff --check` passed.
- The startup performance regression passed: median LCP 3,675.7 ms (limit 4,500),
  CLS 0.018 (limit 0.1), and TBT 94.9 ms (limit 500), with simulated database latency.
- OpenAI was configured separately through secure key setup. A Responses API request
  and a real LibreChat conversation both succeeded using `gpt-6-luna`. The key is
  stored only in the ignored local environment; no credential is bundled here.

The upstream startup performance regression uses a disposable database and test
accounts. Run it on a different port from the working app (Chrome must be installed
for this browser selection):

```sh
E2E_BASE_URL=http://localhost:3098 E2E_CHROMIUM_CHANNEL=chrome npm run lighthouse
```

To reuse an existing production build, use `npm run lighthouse:run` with the same
environment variables. Reports stay in the ignored `.lighthouse/` directory. This
check does not validate real model inference or school integrations. The full
monorepo test suite has not been run; focused school checks are recorded separately
in [`school.md`](school.md).
