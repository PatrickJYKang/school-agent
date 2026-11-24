# Dashboard courses projects and chat viewers

Agreed direction, November 24, 2026. The school home page will surface upcoming
Canvas assignments and routes into AI work. Course folders organize personal
work automatically after permission; projects collect ongoing work and common
assignment context. Collaborators can read an explicitly shared chat as it
changes, while the owner retains control of the conversation and assistant.

This is the next user-experience specification under [scope.md](scope.md).
The dashboard, Canvas folder associations and live viewer mode are planned work,
not implemented capabilities of the current prototype.

## Home dashboard

Use a dashboard as the school landing page rather than an empty New chat screen.
Show upcoming assignments with course, title, due date and distinct actions:

- **Open in Canvas** opens the authoritative assignment page.
- **Start chat** opens a chat with that assignment's admitted context and files
  the chat directly under its course folder, without creating a project.
- **Add to project** selects an existing personal project and adds the assignment
  to that project's common context. Offer projects in the course first, with a
  way to select another course's project or an unfiled project.

Use the signed-in person's permitted Canvas material and effective dates, with
the school timezone and source freshness visible. Upcoming due dates do not
establish whether work is submitted or complete: the current connector excludes
submission/grade data. Keep Canvas responsible for submission, grading and the
authoritative assignment record.

Distinguish disconnected Canvas, loading, no upcoming due dates, partial results
and failure with retry. A bounded or failed refresh must not look like a complete
empty assignment list. Reuse native styling and keep the main assignment link
and its chat/project buttons separately accessible by keyboard.

## Persistent course folder choice

Keep a dashboard prompt visible until the person explicitly chooses **Allow** or
**Don't allow** automatic creation and refresh of Canvas course folders. Closing
the browser, navigating away or waiting does not answer it. Persist the decision
for that user and Canvas account/site, across devices and sessions, and provide
a setting to change it. Normal token refresh does not reset the choice. This
prompt is not a request for browser push notifications.

With Allow, create and maintain one app folder per accessible active Canvas
course, using stable course identity rather than the display name. Course roots
may be empty; do not manufacture a project or chat for every assignment. Refresh
without duplicating folders, and retain existing work when a course concludes or
becomes unavailable. Do not delete local work in response to a partial course list.

With Don't allow, stop automatic folder creation/refresh and dismiss the prompt.
Manual Canvas use remains available under its own connection permissions. Before
the choice, do not create course folders automatically; folder-dependent actions
can bring the same choice into view. Existing manually created/root projects and
unfiled chat remain usable. With no Canvas connection, explain that one is needed
and let Allow lead into connection setup. Don't allow remains available without
connecting. Connection failure offers retry without creating folders or treating
silence as consent.

These are personal app folders, not new folders in Canvas, OneDrive, SharePoint
or Git. Enrollment, teaching a course or seeing its folder grants no access to
another person's chats.

## New chat destination

The generic **New chat** button first opens a destination picker with these choices:

| Choice                              | Result                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| No folder                           | Start an unfiled chat.                                    |
| A course root                       | Start a chat directly in that course folder.              |
| An existing project in a course     | Start a chat with that project's common context.          |
| A new project in a course           | Name/create a personal project there and start a chat.    |
| A new project with no course folder | Name/create an unfiled personal project and start a chat. |

Existing unfiled projects are also valid destinations. An assignment's Start chat
action already supplies the destination and should bypass this generic picker.
Creating a project is deliberate; a brief worksheet question needs no project.
Do not create an empty project merely because someone opened and cancelled the picker.

## Project assignment context

A project has one optional home course folder and can reference multiple Canvas
assignments. Related assignments may come from different courses; adding one
does not duplicate or silently move the project. The same assignment may be
useful in several projects.

Adding an assignment imports its admitted instructions, rubric and source
references into project context. That context applies across **all chats in the
project**, including the next turn in an existing chat, rather than only the chat
that added it. Selected document contents follow the same owned-source admission
rules. A list of Canvas links alone does not satisfy this requirement.

Keep an inspectable project source list with freshness and unavailable/partial
states. Import/refresh/removal changes the project context revision used by
subsequent turns; historical replies remain historical. Keep short assignment
material in context and use bounded project retrieval for longer documents, with
visible coverage/limits. All admitted assignments must remain available to every
project chat without the person manually attaching them again.

Common assignment context is distinct from automatically combining every chat's
transcript. Keep assistance guidance attached to each assignment/activity. A
permissive instruction for one assignment cannot authorize another activity or
override institution tool/source restrictions.

## View only collaborators

The owner can explicitly grant named people, including teachers, view-only access
to a conversation. Viewers see the latest saved chat and receive updates without
the owner publishing a new snapshot. Explain that the grant includes existing
history and future chat updates, and show the owner a persistent sharing indicator.

Viewers cannot send/edit/delete messages, change context or settings, trigger
tools, run/cancel the assistant or invite other people into the owner's chat.
Keep one owner and the existing execution identity. This adds live reading, not
multi-author chat, comments or parallel agents.

Scope the grant to that conversation and explicitly included attachments/outputs.
It does not reveal every chat or source in its project, another course folder,
or the owner's connected account. File requests and update subscriptions must
check the viewer's current grant; revocation ends further access and updates.
Show only chat-visible content, not private operational traces or credentials.

Native published snapshots remain a separate sharing mode with their existing
behavior. Do not silently turn existing links into ongoing access. The first live
viewer implementation can use authenticated polling; live token-by-token
streaming is not required to show current saved messages automatically.

## Reuse and implementation order

Reuse LibreChat's personal Chat Projects, project context revisions, native
conversation UI, files, permissions and people picker. Reuse the school Canvas
client, per-user connection and bounded material reader. Native snapshots supply
sharing precedents but do not implement the requested live view.

1. Add owner-scoped course folders and the persisted undecided/allowed/denied
   preference. Extend personal projects with an optional course home and admitted
   assignment references. Direct course chats need a course destination; a chat
   inside a project derives its course home from that project.
2. Build the dashboard and destination picker on those contracts. Bound and cache
   course/assignment reads without serial per-assignment startup queries.
3. Connect Add to project to shared assignment context and verify it across new
   and existing chats. Extend source admission deliberately rather than allowing
   arbitrary model-supplied file or assignment IDs.
4. Add explicit conversation-view grants and an authorized latest-chat read/update
   path. Reuse snapshot ACL mechanisms where suitable without weakening existing
   owner-only mutation, tool and connection paths.
5. Verify loading, denial, empty/partial results, errors, cancellation, persistence,
   multiple-course/project associations, context refresh and viewer revocation.
   Keep backend behavior in TypeScript, storage contracts in data-schemas, shared
   API/config in data-provider and copy localized in native React components.

The underlying changes are bounded associations, source/context handling and a
new read permission. They do not require a new LMS, shared filesystem or
collaborative editor. Course/project context still needs the same ownership,
resource limits and current-policy checks as direct chat attachments.

## References

- [LibreChat Projects](https://www.librechat.ai/docs/features/projects): personal
  chat grouping, common instructions/files and context changes on later turns.
- [LibreChat Shareable Links](https://www.librechat.ai/docs/features/shareable_links):
  published snapshots, which do not automatically include future messages.
- [Canvas Assignments API](https://developerdocs.instructure.com/services/canvas/resources/assignments):
  assignment information and dates. Use the person's permitted source view.
