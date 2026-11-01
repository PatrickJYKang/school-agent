# Microsoft development access: read-only

This records the agreed scope for discussion with school IT and the supporting
faculty member. It is a development proposal, not a security certification or an
email draft. Microsoft access is not configured in the local pilot, and no
Outlook agent tool has been implemented.

The implementation design, including connection ownership, restricted execution
and content lifecycle, is in [`backend.md`](backend.md).

## What the user should be able to do

- Connect their own school account, initially with only the developer admitted
  to the pilot.
- Find and read relevant email and attachments.
- Select and read OneDrive/SharePoint documents the account can already access.
- Ask questions about those sources and receive answers or new working text
  inside the assistant.

The Microsoft connection is read-only. It must not send email, save drafts into
Outlook, change read/unread flags, move or delete messages, edit source files,
create cloud folders, or change sharing permissions. Generating text or a file
inside the assistant does not grant permission to write it back to Microsoft.
There is no planned later stage enabling email sending or Microsoft writes.

## What school IT would enable

The first request is help establishing a school-controlled development
connection to the developer's account. The school chooses the approved hosting
and sign-in arrangement and retains the ability to restrict or revoke access.
The meeting should establish who can maintain ordinary development configuration
and who handles institutional approvals.

Use delegated, read-only access: the backend acts for the signed-in person and
cannot exceed that person's access. Requesting a backend connection does not
require tenant-wide application access.

An implementation reference for the meeting, not a checklist for the first email:

| Capability                                                | Candidate delegated permission                               |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| Read the signed-in user's mailbox                         | Microsoft Graph `Mail.Read`                                  |
| Read only the user's own OneDrive                         | Microsoft Graph `Files.Read`                                 |
| Read accessible OneDrive and SharePoint files when needed | Microsoft Graph `Files.Read.All`                             |
| Use the existing LibreChat SharePoint picker              | SharePoint `AllSites.Read`, alongside Graph file-read access |

Sign-in, identity and connection refresh also need configuration. Exact grants
should follow the chosen implementation. No send or write scopes belong in the
request. A school-provided test account or selected test workspace is an option
if IT prefers that boundary.

Mail-read consent covers mailbox access; choosing a message in the UI does not
make the Microsoft token message-scoped. Similarly, file selection alone does
not turn broad file-read consent into a file-scoped permission. Any narrower
application selection boundary must be enforced by the backend and tested.

Sources: [Microsoft permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference),
[delegated access](https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview),
and [LibreChat's existing picker setup](https://www.librechat.ai/docs/configuration/sharepoint).

## Confidentiality requirements to agree before connecting real data

Read-only access protects originals from modification. It does not prevent
retrieved information from being copied into a model request, chat history,
logs, exports or another tool's request.

The Microsoft integration needs these explicit boundaries:

1. **Limit retrieval.** Begin with the developer's account and relevant selected
   messages/files. Do not ingest or index the whole mailbox or drive. Define
   bounds for search results, attachments and source text.
2. **Control AI disclosure.** Agree which content may reach which model provider
   and under what account/contract. Show sources being used. Do not describe
   cloud inference as local-only or assume a provider's training/retention policy.
3. **Keep credentials out of model context.** Microsoft authorization stays in
   the connection layer. The model receives source content and safe references,
   not access tokens or signed download URLs. Recheck identity and authorization
   on each tool call and test disconnect/revocation behavior.
4. **Control other outbound tools.** Email and documents are untrusted material.
   They must not be able to instruct the agent to send private text to a public
   URL or search provider. The first sensitive-data pilot should have public web
   tools disabled in its effective profile until an enforceable disclosure policy
   is implemented and tested. Prompt instructions alone are insufficient.
5. **Define storage and deletion.** Agree whether source text remains in chat
   history, how long it is retained, who can administer/read the store, and how
   chats, files, backups and diagnostics are deleted. Keep audit metadata useful
   without routinely logging message bodies, attachments or credentials.
6. **Enforce the read-only boundary at Microsoft and in tools.** Do not grant
   write/send scopes and merely hide buttons. Do not use authenticated browser
   or terminal sessions to bypass the API boundary. Use read operations that do
   not change mailbox state.

## Existing baseline and remaining work

The current Canvas/document/web pilot already has server-side policy checks,
owner/tenant checks for uploaded documents, safe error codes, encrypted per-user
Canvas credentials, private sharing defaults, bounded downloads and parsing, and
protection against public fetches reaching private-network addresses. Private
local configuration, credentials, chat logs and runtime files stay outside Git.

These are foundations to reuse, not evidence that a Microsoft integration has
been secured. The Microsoft connection, mail tools, source-selection enforcement,
cross-tool disclosure controls, institution-approved model/data handling and
retention arrangements remain to be implemented or validated.

The current pilot persists conversation/tool content and uploaded files. Its
private chat sharing defaults and encrypted connection credentials do not mean
that all stored conversation data is encrypted at rest or ephemeral. No such
guarantee should be made to IT without deployment-specific verification. Existing
content-filter hooks are not a guarantee of automatic sensitive-data removal.

For the meeting, explain the read-only/account boundary and the proposed data
flow, then ask IT to help establish an acceptable development setup. A broader
student rollout is a separate decision.
