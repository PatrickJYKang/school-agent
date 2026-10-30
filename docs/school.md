# School pilot

The application keeps LibreChat's standard layout, logo, theme, model menu, dialogs,
file attachments, exports, agents, and permissions. The HTML concept is a reference;
it is not a second frontend or an editor to port into the application.

Planned Microsoft email and OneDrive/SharePoint access is **read-only**, with no
email sending or source write-back. The agreed scope, confidentiality requirements,
and distinction between existing controls and remaining work are in
[`microsoft.md`](microsoft.md). Microsoft is not connected in this pilot yet.

## Working features

- Four institution-provided helpers in the native model menu: Study coach,
  Explain a concept, Writing feedback, and Teaching preparation.
- Automatic read-only Canvas tool calls from those helpers: ask about courses,
  assignments, deadlines, instructions, or rubrics without attaching a file first.
  Calls and results appear in LibreChat's normal tool activity UI.
- Read uploaded PDF, DOCX, ODT, Markdown and text files through the native
  `documents` tool, including PDF page ranges and explicit continuation cursors.
- Follow linked Canvas PDFs and public articles. Assignment/page retrieval keeps
  both Canvas file IDs and external link destinations instead of dropping URLs.
- Public URL reading and Brave web search through the native `web` tool. Search
  uses the institution's credential; the helpers are equipped automatically.
- A Canvas material picker in the composer. Select a course, assignments/rubrics,
  or course pages; preview the selected text; attach it as `canvas-context.md`.
- Native attachment removal and conversation/message Markdown export. Attaching
  a source does not send a message. The original Canvas content is not modified.
- A school guidance dialog with an explanation of selected-source handling.
- Private sharing defaults, school-managed helper configuration, and a monthly
  account allowance using existing LibreChat controls.
- The upstream admin panel for configuration, users, groups, roles, and grants.
  Its create-user form is still an upstream stub; use school SSO, invitations,
  or LibreChat's existing `create-user` command for account provisioning.

The included configuration is a **local pilot**, not a completed institution
deployment. Native agents remain available through My Agents. Publishing helpers
and prompts is off by default; an administrator can enable it for an educator
role/group through configuration profiles and grant the appropriate resource access.
Sharing an agent does not share a person's Canvas connection or chat history.

## Canvas token for local testing

Put the token in `.local/canvas.env` (ignored by Git, file mode 0600):

```dotenv
CANVAS_BASE_URL=https://webb.instructure.com
CANVAS_API_TOKEN=
```

Do not put the token in YAML, source control, or a chat message. With the app
running, import it for the existing local user:

```sh
node scripts/canvas.mjs
```

The importer uses `.local/local-account.json` to authenticate locally, checks that
the Canvas site matches school policy, verifies the Canvas token, and stores the
connection using LibreChat's encrypted per-user credential store. It prints only
safe status and course counts. Other users must connect their own accounts through
the Canvas dialog; they cannot use this token. Disconnecting removes their stored
connection. Changing the institution site requires reconnecting.

The institution chooses the Canvas origin in `interface.school.canvas.baseUrl`.
Users can supply a token, but cannot supply a different destination or arbitrary
API URL. The connector only issues GET requests for the profile check, courses,
assignments, pages, file metadata and file downloads. It never calls submission, grading, roster, messaging, or
administrative write APIs. Rubric definitions are included; student scores and
submission bodies are discarded. All access is still limited by the token's own
Canvas permissions.

Lists and context have configurable limits. When a list reaches its page limit,
the UI says so; oversized selections fail instead of silently truncating text.
Helpers can follow linked documents and external URLs using the reading tools.
Embedded images are not downloaded by the text reader. Canvas content is untrusted source
material, not platform authorization or instructions to the application.

## Documents and public links

Ask a helper to read a linked assignment document, or attach a file using the
normal LibreChat file picker. Originals remain read-only sources. This adds no
Word editor or collaborative document editing system. PDF pages are labeled;
DOCX and ODT extraction has no dependable page numbers. Long reads return
`nextOffset` and, for PDFs, `nextPage`; helpers must disclose incomplete reads.
Supported text formats include TXT, Markdown and CSV. Old `.doc`, slide decks,
OCR and interactive/signed-in browser use are not implemented by this reader.
Scanned PDFs without extractable text return an explicit OCR-needed error.

Uploaded-file access is bound to files admitted into the current chat's context.
Every call rechecks the owner, tenant, expiry and deletion state in the database.
It does not accept filesystem paths or arbitrary file IDs. Parsing reuses
LibreChat's PDF.js and Mammoth/ODT support, with page-aware extraction in a
terminable worker, bounded memory, concurrency, size and duration, and cleanup
after cancellation. Existing file-content filters also inspect extracted text.

`interface.school.documents.enabled` controls document reading (off by default,
enabled in this pilot). Its configurable limits include `maxBytes` (15 MB),
`maxChars` (60,000 per read), `maxExtractedChars`, `pagesPerRead` (20),
`timeoutMs`, `maxConcurrent` and `workerMemoryMb`.

`interface.school.externalLinks.enabled` is the administrator's public-link
fetching toggle and **defaults to true**. Administrators can change it in the
local panel under Features → Interface → More settings → School workspace → External links.
Changes apply on the next tool call, including in existing chats. Search has its
own `interface.school.webSearch.enabled` toggle; disabling page fetching still
permits search snippets when search is enabled. `schoolWeb: true` on a helper
equips the controlled `web` tool. Native tool allowlists/blocklists still apply.
The existing Web Search role permission also gates this tool through LibreChat's
normal runtime loader.

The page reader performs bounded public HTTP(S) GET requests, validates DNS at
connection time and each redirect, blocks private-network destinations, and
executes no page scripts. It sends no Canvas token, login cookies or Brave key to
article sites. It extracts article/main text and preserves links; interactive
pages, paywalls, login-required pages and publisher access denials may fail.
It reports those failures without claiming to have read the source.

Canvas PDF downloads first check course-scoped file permissions, then follow
only configured Canvas storage hosts. The defaults include Instructure's
[documented file domains](https://community.instructure.com/en/kb/articles/485223-unknown).
`canvas.downloadHosts` and `canvas.maxDownloadRedirects` are configurable. The
Canvas bearer token never follows an off-origin redirect; signed download URLs
stay inside the downloader. Results cite canonical Canvas links.

## Brave Search key

Put the institution's local test key in the root `.env` file, already ignored by
Git and restricted to its owner:

```dotenv
BRAVE_SEARCH_API_KEY=
```

Then restart the backend with the local runtime. The pilot's YAML references
`${BRAVE_SEARCH_API_KEY}` at `webSearch.braveApiKey`. Do not paste the key in a
chat. A missing key returns `web_search_unconfigured` while public URL reading
continues to work. For a deployed institution, `webSearch.braveApiKey` can be
stored in the existing encrypted administrator/profile configuration. It is
redacted on admin reads and omitted from student startup data and tool results.
The executing user's resolved institutional/profile configuration is loaded
again for every call; no student's personal search key is used as a fallback.

The [Brave Web Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)
receives the search query and the institution's credential at its fixed endpoint.
Results include titles, URLs and snippets; reading the source is a separate
operation. `interface.school.webSearch.safeSearch` defaults to `strict`; result
count, response size and timeout are configurable. Neither source reading nor
search adds a browser or terminal. Those remain later integrations.

## Institution configuration

Edit `config/local.yaml`, then restart the backend. New deployments leave the
school feature disabled unless `interface.school.enabled` is configured. Settings
are schema-validated and support the upstream profile/override machinery.
The pinned admin panel has a small recorded patch exposing school policy controls
through its existing configuration form. Advanced limits remain editable in YAML
and visible as additional settings. The patch preserves the panel's normal
permissions, profile precedence, revision checks and save behavior.

Canvas tool calling requires both `interface.school.canvas.toolCalling: true`
and `canvas: true` on the helper's model spec. Both default off when omitted.
The pilot enables them for all four helpers. `interface.school.timeZone` sets
the timezone returned with retrieval timestamps and the explicit `currentDate`
(America/Los_Angeles here). The local date stays correct when UTC is already on
the following day. Native `includedTools`/`filteredTools` controls also apply.
The tool has six operations: `list_courses`, `list_assignments`, `list_pages`,
`read_material`, `list_files` and `read_file`. It resolves course IDs from actual Canvas results and can
read assignment instructions and rubric definitions. Lists include due dates
and source links, but do not report whether a student has submitted or completed
an assignment. Existing response, timeout, pagination, and context limits apply.

Tool definitions contain no credentials. Each execution reloads the effective
policy and the executing user's encrypted connection. Disconnecting prevents
the next call, including within an existing chat. Changing the institution site
requires reconnecting. A disconnected helper returns a stable error and directs
the user to the existing Canvas material dialog; no token is entered in chat.
Read-only access can send retrieved course material to the configured model
provider while answering a question. The dialog and school guidance disclose this.
Previously retrieved tool results remain part of that conversation's history.

The pilot uses `gpt-6-luna` for all four helper presets. `modelSpecs.enforce` keeps
ordinary chats on the configured helper presets, with the native Agents endpoint
also available. Helper instructions guide model behavior; they do not enforce
academic policy or replace server permissions. Existing operator controls still
govern agent creation, tools, connections, and group sharing.

The account allowance starts at 10,000,000 internal credits and resets monthly.
This is an application allowance, not an OpenAI billing cap. Change `balance` to
your institution's chosen policy. Public links and public helper publishing are
disabled; private educator sharing should be enabled only for the chosen profile.

SSO, Microsoft 365, and retention use the existing LibreChat implementation and
need the institution's real identity/tenant configuration. The native
[SharePoint/OneDrive picker](https://www.librechat.ai/docs/configuration/sharepoint)
remains available when configured. No fake connection, roster sync, grading
workflow, Word editor, folder orchestration, or real-time document collaboration
was added. Earlier exploration remains in `concept/archive/`.

## Admin panel

The local panel runs at <http://localhost:3000>. It uses the same local admin
account as LibreChat, and is linked from LibreChat's settings. Start it with:

```sh
node scripts/admin.mjs
```

The panel checkout and its dependencies live under ignored `.local/` paths. The
repository, exact revision, license, runtime, and compatibility patch are recorded
in `config/admin.json`. The upstream panel is AGPL-3.0; LibreChat's MIT license
does not replace its separate license. The compatibility patch fixes a `Transport.tsx`
import resolving to `transport.ts` on a case-insensitive filesystem. A separate
`config/admin-school.patch` supplies schema fields and labels for school controls;
it uses the pinned panel's Zod 3 schema format while the backend remains the
authoritative validator. Both patches are applied idempotently by the launcher.

To reproduce the installation in a new checkout:

```sh
gh repo clone LibreChat-AI/admin-panel .local/admin-panel
git -C .local/admin-panel checkout f2601cbf3216a62c12e5f9d21810eb9ada95fa63
npm install --prefix .local/admin-runtime --no-save --package-lock=false bun@1.4.3
cd .local/admin-panel
../admin-runtime/node_modules/.bin/bun install --frozen-lockfile
cd ../..
node scripts/admin.mjs
```

The launcher checks the pinned revision, applies the recorded patch if necessary,
creates a private session-secret file without overwriting one, and runs the
panel's development server on loopback only. It does not change the main app's
global runtime or expose the panel to the network. This is a preview upstream
management application; verify its deployment requirements before institution use.

## Implementation and verification

The Canvas client, API routes, native agent tool, picker, configuration schema, and local importers
are original to this fork. Upstream supplies authentication, encrypted credentials,
configuration profiles, file processing, model presets, sharing permissions,
allowances, the admin panel, and the existing Microsoft picker. No community
Canvas MCP code was copied; its broader tool set was not enabled.

Focused tests cover owner isolation, encryption, config propagation, locked content,
fixed-origin pagination, safe provider errors, response/context limits, selected-only
preview, and explicit attachment. Run from the owning workspace:

```sh
cd packages/api && npx jest src/school --runInBand
cd ../data-schemas && npx jest src/app/interface.spec.ts --runInBand
cd ../../client && npx jest src/components/School/__tests__/Canvas.spec.tsx --runInBand
```

Run `npx tsc --noEmit` in each changed workspace (the API typecheck needs
`NODE_OPTIONS=--max-old-space-size=8192` on this checkout). Build from the root with
`npm run frontend`. The required upstream startup check uses a separate local port:

```sh
E2E_BASE_URL=http://localhost:3098 E2E_CHROMIUM_CHANNEL=chrome npm run lighthouse
```

No class material needs to be sent to a model to verify the connection or picker.
Only an explicitly sent chat uses staged sources. No school account, tenant, or
identity-provider settings are provisioned by these local setup commands.

### Verified locally on October 28, 2026

- Production frontend and shared-package builds passed.
- Typechecks passed in data-provider, data-schemas, API, client, and the upstream
  admin panel. Scoped formatting, import ordering, ESLint, and diff checks passed.
- 66 focused tests passed: 15 Canvas API/client tests, 5 picker tests, and 46
  interface-configuration tests. The full monorepo test suite was not run.
- The upstream startup regression passed with simulated database latency: median
  LCP 3,716.7 ms (limit 4,500), CLS 0.018 (limit 0.1), and TBT 102.5 ms (limit 500).
  This uses the upstream disposable fixture, not live school data.
- The live school Canvas connection returned accessible courses. Assignment selection,
  preview, and native Markdown attachment succeeded. The test attachment was
  removed without sending its contents to a model. Course-page access remains
  subject to Canvas course permissions; a denied request showed the safe error UI.
- A synthetic Study coach chat returned a hint and a follow-up question. The
  encrypted connection and chat survived a page reload; the admin panel signed in
  and displayed live roles and configuration.

Local screenshots, private credentials, and test reports stay under ignored paths.

### Document and web tool checks on October 29, 2026

- 416 focused tests passed: 300 API/tool/credential/role tests, 109 configuration tests,
  6 Canvas UI tests and one admin schema test. The final expiry and tool-definition
  checks were repeated after cleanup. No full monorepo test run was performed.
- Typechecks passed in API, data-provider, data-schemas, client and the pinned
  admin panel. Production builds, scoped import sorting, formatting and lint
  passed. The required startup check passed with median LCP 3,655.7 ms,
  CLS 0.018 and TBT 94.6 ms against the existing upstream budgets.
- A live helper read page 2 of a harmless uploaded PDF through `documents`
  and quoted its instruction with a page citation. A second live request followed
  an actual assignment's linked Canvas PDF and read the requested page range.
  The live chat uses the configured OpenAI model. Private source IDs and source
  contents remain in ignored verification files.
- Assignment retrieval exposed an actual external article URL. The article
  returned HTTP 403 to the public reader; the helper disclosed the denial and
  did not invent its contents. Reading a different public HTML page succeeded.
- The admin panel saved the public-fetching toggle off. An existing chat's next
  tool call returned `web_disabled`. Reverting the override restored fetching
  on the next request, without restarting the chat or backend. The setting was
  left enabled with no test override or pending admin edits.
- Brave HTTP behavior, strict SafeSearch, encrypted institutional credentials,
  missing-key behavior and redaction passed tests with the external API mocked.
  A real Brave query is pending the institution key in `.env`; no key was
  available at verification time. Browser interaction, terminal/filesystem tools,
  OCR and submission-reading permissions remain outside this increment.

### Canvas tool calling checks

- 71 API tests passed across Canvas, helper loading, and native tool definitions;
  all 6 picker tests passed. The eight native Canvas tool tests use a real disposable
  MongoDB and real credential encryption, with Canvas HTTP mocked.
- Tests verify the executing owner, live disconnect, changed institution origin,
  denied profile policy, tool allowlists/blocklists, safe errors, cancellation,
  bounded results, assignment/rubric and page reads, and local date grounding.
- Typechecks passed in API, data-provider, and client. Production builds and scoped
  lint/format checks passed. The startup regression passed with median LCP
  3,690.1 ms, CLS 0.018, and TBT 95.7 ms against the existing upstream budgets.
- A live question about upcoming assignments caused the
  helper to call Canvas twice (courses, then assignments) and cite a real assignment
  link and due date. No attachment or manual course selection was needed. This test
  sent the retrieved course/assignment metadata to the configured OpenAI model.
- A follow-up asking for a named project's instructions triggered `read_material`.
  The helper accurately reported the sparse source text and linked the assignment
  without inventing missing requirements. The final live answer used the correct
  school-local calendar date after the UTC/local-day boundary regression was fixed.
