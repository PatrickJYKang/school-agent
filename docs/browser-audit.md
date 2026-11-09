# School browser scope and operating guide

November 8, 2026. This implements the public School browser in a local Linux
container deployment for development and evaluation. Student rollout still needs
a dedicated host, deployment review and stronger separation of user workloads.
It does not connect student browsers or enable local device agents.

## User experience

Select **School helpers → School browser**. The helper can open public HTTP(S)
pages, read rendered accessibility snapshots, follow their admitted link refs,
go back and show screenshots. Native activity/image delivery returns results to
chat. The **School browser** composer button shows status, source and screenshot.
**Stop browser** closes its process and blocks browsing until the user chooses
**Restart browser**. Restart opens a fresh session, without restoring cookies.
Agent `close` and idle expiry release resources without pausing future requests.

There is no typing, arbitrary clicking, form filling, upload, code evaluation,
cookie export, debugger, page-defined tool dispatch or sign-in workflow. Following
a link navigates to its observed URL rather than running its click handler.
Search and simple fetching remain existing separate tools.

## Incorporated components

| Component                | Pinned input                                            | Reviewed use                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Playwright MCP | 0.0.84, Apache-2.0                                      | Private stdio connection/process per session; fixed broker operations. No raw MCP endpoint or unsafe script tool is exposed.                                                     |
| Playwright               | 1.65.0-alpha-2026-10-30, required by that MCP release   | Lockfile pins the browser build. Chromium's sandbox is enabled. This prerelease engine needs release review before school deployment.                                            |
| Stripe Smokescreen       | v0.1.0, `609eb8931420453daf5893509be0b25b21bd9edb`, MIT | Public-IP egress proxy. The inspected dialer uses the admitted IP, preventing a second unconstrained DNS lookup before connection. Private/self-address filtering stays enabled. |
| MCP TypeScript SDK       | 1.32.2 in the isolated runtime                          | Patched from the initially selected 1.29.0 after its advisory report. Uses stdio, without HTTP MCP, OAuth or experimental tasks.                                                 |
| Zod                      | 4.6.7 in the isolated runtime                           | Patched constrained-collection advisory. Requests also have a 64 KiB pre-validation body limit.                                                                                  |
| Hono Node adapter        | Override 2.1.3                                          | Removes the remaining transitive static-path advisory; its HTTP adapter is unused by this stdio integration.                                                                     |

The scoped audit covered entry points, exposed capabilities, network routing,
ownership, cancellation, disclosure and known dependency advisories. It is not a
complete audit of Chromium, Smokescreen or LibreChat. The isolated dependency tree
is in `services/browser/package-lock.json`; the existing LibreChat dependency tree
was not upgraded. A clean npm advisory report is not proof of containment.

Smokescreen runs on our infrastructure. It requires no Stripe account or payment
integration and sends no browsing telemetry to Stripe. Proxy request logging is
disabled here. Requested websites still receive normal browser traffic.

## Boundaries and remaining risks

- The worker has only an internal Docker network. Smokescreen provides public
  egress. A separate Nginx gateway publishes only the authenticated session API
  on `127.0.0.1:3118`. There is no direct internet route, published CDP/MCP port,
  Docker socket, app-data mount or shared Python workspace.
- The trusted Playwright hook admits GET/HEAD URLs, applies host policy to
  redirects/subresources, blocks WebSockets, closes popups and cancels downloads.
  The proxy independently validates DNS/IPs. Chromium proxies loopback too;
  QUIC and non-proxied WebRTC are disabled.
- Every session gets its own browser process/profile and small environment
  allowlist. Child processes do not receive the service token or model/source
  credentials. The backend derives session scope from tenant, user and chat
  using HMAC; model input cannot choose another owner or raw worker scope.
- Institution tool/policy checks run on each tool invocation and before new
  content reaches the model. Revocation withholds results and closes the session.
  Safe error codes replace raw driver diagnostics. A proxy-denied page is reported
  as a denial, not a successfully retrieved source.
- User Stop is retained in an owner-scoped marker on the private state volume,
  surviving normal worker restart. The agent cannot clear it. Marker capacity is
  bounded; retention or cleanup failure fences execution. Profiles and scratch
  files are removed when their processes close.

The worker is non-root, with dropped host capabilities, a read-only root and
bounded temporary storage, memory, CPU and process count. Chromium's namespace
sandbox stays on. The Playwright seccomp profile adds `chroot` for initialization
inside the unprivileged namespace; no host `SYS_ADMIN`/`SYS_CHROOT` capability is
added and the browser sandbox is not disabled.

Separate profiles are not separate kernels. This small local worker hosts several
browser processes inside one container. Before rollout, deploy a separate isolated
workload per principal/task on dedicated infrastructure and validate hard teardown
and individual resource accounting. No school VM has been provisioned here.

GET/page scripts can have website side effects. Fresh profiles and the limited
surface constrain them but cannot guarantee universal read-only website access.
URL checks cannot identify every capability encoded in a link. Keep private
source histories out of this evaluation; this does not implement the proposed
sensitive Microsoft conversation profile or general data-loss prevention.
Microsoft/Canvas account hosts are also denied by the local proxy policy.

Screenshots delivered into chat use the existing owned File/history pipeline.
End-to-end deletion, backups and operator-access policy still need verification.
Pause markers contain opaque hashes, not page contents; conversation-deletion and
long-term marker retention integration remain deployment work.

## Setup and policy

Use the existing Node 24 toolchain and Docker Desktop:

```sh
node scripts/browser.mjs setup
# Restart LibreChat to load the new private browser-service token.
npm run backend
```

Setup preserves existing app credentials and writes a separate service token and
worker limits to ignored `.env` / `.local/browser.env` with mode 0600. Daily commands
are `node scripts/browser.mjs up`, `status`, and `stop`.

`interface.school.browser` controls enablement, trusted service URL/token reference,
host policy, output, action, timeout and lifecycle limits. It defaults off; the
local YAML enables a separate helper. Existing four helpers keep their tools.
Token references are limited to `SCHOOL_BROWSER_*`, not arbitrary provider secrets.
The global runtime ceilings are generated from `config/browser.json`; profile
overrides cannot enlarge those worker ceilings.

Defaults: two simultaneous sessions, 30 actions, 20-second request timeout,
two-minute idle expiry and ten-minute active lifetime. The container has a
2 GiB/two-CPU limit. The pause-marker cap defaults to 1,000. Measure workloads
before expanding these budgets.

For a remote host, use verified HTTPS, limit API ingress to the app and keep
worker/proxy/debug interfaces private. Keep the network-enabled browser separate
from offline Python. Hosting, transport and institutional retention remain
deployment work.

## Repeatable verification

```sh
node scripts/browser-check.mjs --restart-check
docker compose -f compose.browser.yml exec -T browser node < services/browser/guard-check.cjs
npm audit --prefix services/browser --omit=dev
```

The service check uses synthetic tasks on Microsoft's public JavaScript demo:
rendering, screenshot, observed-link navigation, separate sessions, missing-token
rejection, simultaneous-request ownership, Stop during launch, Stop across a worker
restart, explicit restart, denied private/account URLs, private DNS destinations and
arbitrary-code rejection. All 13 service checks passed on November 8. The guard
fixture's five checks passed: blocked mutating methods,
private subresources, WebSockets, popups and downloads. Its trusted test code is
not an agent-accessible tool. Test artifacts stay in `.local/`.

The focused backend run passed 130 tests across eight suites; the browser/Canvas
component run passed ten tests across two suites. The shared configuration suite
passed 577 tests. Production builds, scoped lint and TypeScript checks passed in
the API, data-provider and client workspaces. A native agent chat also retrieved
the demo, delivered a real screenshot and exercised the user's Stop/restart controls.
The isolated Lighthouse run passed its delayed-database budgets: median LCP
3,520 ms, CLS 0.0181 and blocking time 59 ms across three cold navigations.

## Sources and attribution

- [Playwright MCP](https://github.com/microsoft/playwright-mcp): reused browser
  implementation and its warning that origin filters are not a security boundary.
- [Smokescreen pinned source](https://github.com/stripe/smokescreen/tree/609eb8931420453daf5893509be0b25b21bd9edb):
  DNS/IP admission, pinned dialing, configuration and MIT license.
- [Playwright seccomp source](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json)
  and [Docker guidance](https://playwright.dev/docs/docker): source of the namespace
  profile; the local `chroot` allowance is described above.
