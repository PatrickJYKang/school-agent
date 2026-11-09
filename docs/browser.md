# Browser use architecture options

Implementation update, November 8, 2026. The local School browser uses pinned
Playwright MCP for public rendered-page reading, observed-link navigation, back
navigation and screenshots. It uses native LibreChat activity/image delivery and
a status/preview dialog with Stop and explicit restart. See the
[scoped audit and operating guide](browser-audit.md) for setup and deployment
limits. Local student tabs and whole-desktop control remain future capabilities.

## Separate where the browser runs from how it is controlled

Playwright, an extension and computer use answer different questions and can be
combined. Playwright provides a browser control interface. An extension can
connect that interface to an existing local browser. Screenshot-based computer
use lets a model act through rendered pixels when structured page controls do
not describe the task well. None of these decides who owns the session, what the
agent may disclose or whether an action is authorized.

| Choice                                                      | Useful for                                                                              | Main tradeoff                                                                                                            | Proposed place                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Separate hosted browser controlled by Playwright            | Interactive research, rendered pages, finding sources, inspecting web tools             | Needs its own browser session and execution infrastructure; no automatic access to student sign-ins                      | First browser mode                                |
| Extension connecting selected local tabs                    | Working with the page the student is viewing, including an existing sign-in             | Real account authority and content enter the agent's reach; needs browser deployment, binding and revocation controls    | Later optional mode                               |
| Screenshot and pointer control inside a browser environment | Canvas-based interfaces, maps, diagrams and controls missing from useful page structure | Less semantic information about targets and action consequences; requires visual verification and tighter action scoping | Capability added to either browser mode as needed |
| Full desktop computer use                                   | Native applications and OS dialogs                                                      | Much wider device access and operational burden                                                                          | Deferred alongside local machine agents           |

The initial browser should handle multi-step work such as opening several
public sources, navigating a data explorer or inspecting a simulation. Keep
Brave search and public URL reading for simpler retrieval. Canvas assignments
and future read-only Microsoft mail/files should continue to use their bounded
API connectors, rather than becoming browser scraping workflows.

## Recommended first implementation

Use a school-controlled Linux browser service, separate from the offline Python
execution service in [execution.md](execution.md). Give each user's task an
isolated browser process/profile in a disposable execution boundary. A Playwright
context separates cookies and storage, but it is not a VM or a complete
cross-student security boundary. Preserve Chromium's own sandbox too.

Expose the selected browser through LibreChat's existing tool/MCP and activity
paths. Use a broker to bind the authenticated owner, conversation, browser
session, current policy and allowed operations. Prefer ordinary page text,
accessibility targets and verified references for interaction; return a bounded
screenshot when the page's appearance matters. Re-observe after actions, bind
approval to the actual target and stop if the page changed while someone decided.

Do not give the student agent a raw Playwright/CDP connection, arbitrary script
evaluation, cookie export, unrestricted uploads, arbitrary filesystem access or a
general browser-server shell. Exposing a tool name allowlist is insufficient if
one remaining tool runs arbitrary server-side JavaScript. Keep the driver and
network enforcement outside any model-generated code.

Run browser traffic through an enforced network boundary that denies private
networks, cloud metadata, the app's administrative/control endpoints and local
files. Apply controls to redirects, subresources, DNS resolution, popups,
WebSockets and downloads, not just the initial navigation. Playwright MCP's own
origin filters are documented as convenience controls, not a security boundary.
Keep institution domain policy and per-task access distinct: the student cannot
authorize a site that the institution has disabled.

The implemented surface uses public sites without saved account sessions.
Downloads are cancelled, mutating HTTP methods and WebSockets are blocked, and
popups are closed. There are no model-facing typing, arbitrary click, script,
upload, cookie or debugging operations. Common credential-bearing URLs and the
configured school/account hosts are denied. Future permitted downloads must use
owned File storage. Do not mount the Python workspace into this network-enabled
browser. Bound runs, support cancellation and verify final page state.

Sign-in is a later addition to hosted browsing. It needs a user-controlled login
handoff, per-user encrypted session handling, disconnect/deletion and provider
approval. A server browser does not inherit the student's device identity or
sign-in. School device-compliance and authentication policies can prevent it from
logging in; treat that as a deployment constraint, not something to bypass.

## Read operations and real account authority

For the first mode, admit research navigation and page reading. Do not offer
autonomous submission, posting, purchasing, account changes or file uploads.
Some pages mutate state during navigation and some GET requests have side
effects; a generic browser cannot guarantee read-only source access merely by
blocking POST requests or asking the model to avoid writes. Exclude sensitive
signed-in applications from this first mode.

For any later interaction with private accounts, classify and enforce actions
before dispatch, with user handoff when the boundary cannot be established.
Microsoft sending/writing remains excluded by the agreed study scope even if a
browser session can technically perform it. A browser login is not a read-only
OAuth grant. Keep browsers disabled in sensitive Microsoft conversations until
the persistent conversation restrictions in [backend.md](backend.md) are enforced.
Webpage text and page-defined tools cannot grant additional access.

## Local tabs as a later mode

The useful local capability is “Use this tab” or “Read this page,” not a general
device agent. A content-capture extension can start with a user-invoked selected
tab permission, bounded text and a visible capture action. It need not grant
filesystem, terminal or full desktop access. Explain that selected page content
will be sent to the school's backend and approved model provider.

Interactive control of an authenticated tab is a larger capability than capture.
It can send messages, submit assignments or change records using the logged-in
account. Require a separate opt-in, institution-approved sites, a visible set of
controlled tabs, immediate disconnect and separate write-action policy. Do not
silently promote a capture grant into control. An extension using Chrome's
debugger API has broader technical power than a simple active-tab content script.

An integration must bind the local extension to the right authenticated app user
and task using short-lived, scoped authorization and an outbound authenticated
connection. Do not expose CDP publicly, copy browser cookies to the school
server or configure a shared extension token for all students. Verify actual
tab ownership and revocation under concurrent tasks. Page focus or tab titles
alone do not prove permission.

An extension is worth exploring when existing logged-in pages become central to
the product. It is not required for the public research browser, and it does not
require enabling local Python or filesystem agents. Supporting another browser
family and managed installation adds work that needs concrete school demand.

## Native user experience

Keep browser steps in the existing chat activity view. A small browser panel
shows the current page/origin and progress, with **Open**, **Stop** and an optional
user-control handoff. Screenshots help users check what happened. Do not embed
arbitrary third-party pages directly in the app's origin or assume an iframe
will work; a remote view is a separate delivery problem.

If local tabs are added, label the mode clearly as **Your browser** and require
the student to select a tab. A hosted browser and a local tab must not look like
the same authority. Research can return citations and ordinary Markdown/images;
there is no new document editor or attempt to replace the websites being used.

## Reuse and remaining work

[Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) already
provides structured snapshots, page actions, screenshots, isolated-profile
options and connection to browsers. LibreChat already supports MCP and native
tool activity. Evaluate a pinned subset behind a school-owned broker before
building another browser driver. Exclude its arbitrary-code tools and do not
assume connecting a shared MCP endpoint creates isolated per-user sessions.

The [Playwright extension](https://github.com/microsoft/playwright/tree/main/packages/extension#readme)
already connects existing signed-in tabs, asks users to select tabs and approve
connections, and groups tabs by client. Its example local connection is useful
as a precedent; it is not a complete school-hosted authorization relay. Preserve
explicit approval rather than adopting its optional connection-approval bypass.

[OpenAI computer-use interfaces](https://developers.openai.com/api/docs/guides/tools-computer-use)
support both selected structured browser operations and screenshot-based
computer actions in an application-supplied environment. They provide another
model adapter if needed; this project can preserve its existing LibreChat agent
runtime and model choices. Choosing a computer-use model does not require local
desktop control or an OpenAI-hosted browser.

Build an initial fixture with public-page navigation, extraction, a visually
interpreted page and cancellation. Verify per-user isolation, policy changes
mid-run, malicious page instructions, target changes during approval, denied
network destinations including redirects, bounded downloads and cleanup. Then
try representative public educational sites. Add authenticated browsing only
after deciding whether hosted sign-in or selected local tabs fits the actual
school workflows better.

## Source details

- [Playwright browser contexts](https://playwright.dev/docs/browser-contexts):
  cookie/storage isolation; it does not establish OS or VM isolation.
- [Playwright Docker guidance](https://playwright.dev/docs/docker): sandbox/user
  requirements and the limitations of its testing-oriented container image.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
  and [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger):
  distinguish temporary selected-page access from a CDP control connection.
- [Microsoft Conditional Access browser requirements](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-conditions#supported-browsers):
  browser/device identity affects whether an authenticated session can satisfy
  school policy. Actual Webb policy remains a question for Mr. Guyer.
