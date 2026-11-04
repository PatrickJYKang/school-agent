# Local terminal execution

The private **Study workspace** agent can run Bash and Python, read results and
create Markdown working files through LibreChat's existing code tools and approval
cards. Each chat receives a separate persistent checkout. This is a development
setup on the operator's machine, not a school deployment boundary.

## Setup and daily use

Start the local app as described in [local.md](local.md), using Node 24.22.1 and
Docker Desktop. Initial setup downloads the pinned upstream source, builds its
worker and starts the separate execution control services:

```sh
node scripts/terminal.mjs setup
# Restart the LibreChat backend to load the new local Code API settings.
node scripts/terminal.mjs pair
node scripts/terminal.mjs agent
node scripts/terminal.mjs run
```

Agent installation uses the existing local administrator recorded in
`.local/local-account.json`. Its login is authenticated; setup does not create an
account, change roles or configure a model key. Repeating `agent` preserves the
saved agent and any subsequent edits. `setup` preserves existing keys, pairing and
working files, and stops rather than replacing conflicting app settings.

Select **My Agents → Study workspace** in the normal model selector. The workspace
selects automatically. Ask, for example, “Use Python to check this calculation
and save the result as Markdown.” Inspect the proposed command, select **Approve**
and **Continue**. A rejected command stays unexecuted. Commands and file changes
use the native **Ask before changes** controls; ordinary school helpers keep their
current tools.

On subsequent starts, use two shells for the app and foreground worker:

```sh
node scripts/terminal.mjs up
node scripts/terminal.mjs run
```

`status` lists the execution services. Stop the foreground worker with Ctrl+C,
then use `node scripts/terminal.mjs stop`. Stopping preserves service volumes,
pairing and chat files. A worker must remain running for chat commands to work.
Private setup state is in ignored `.local/terminal/`; source is in ignored
`.local/code-interpreter/`. Neither directory belongs in Git or an attachment.

## Scope and isolation

The app talks to a JWT-authenticated Code API at `127.0.0.1:3112`; the paired
native SRT worker runs commands. `LOCAL_MODE=false` is deliberate: upstream local
mode bypasses authentication. Both native Code API base URLs point locally, so
these credentials cannot fall back to the hosted LibreChat execution service.
The stateful agent is the supported entry point; a legacy execution request with
the wrong profile is rejected.

The native sandbox denies access to the operator's home except the selected
workspace, restricts writes to that workspace and private scratch space, and
denies command network access, local binding and Unix sockets. System runtimes
and public system files remain readable; this is not an empty filesystem. The
worker is started with a small environment allowlist, without OpenAI, Canvas,
Microsoft, Brave or application authentication secrets. Pairing material is kept
outside command workspaces and explicitly protected by the upstream worker.
Code API, gateway and worker control traffic runs outside the command sandbox.
Only API and gateway ports bind to loopback; Redis and object storage are on an
internal Docker network. Service credentials are separated by role.

Commands default to 10 seconds and are capped at 30 seconds by the deployment
configuration. Upstream bounds returned command output. Files persist in private
per-chat checkouts under `.local/terminal/chats/`; shell variables and processes
are fresh each call. The worker permits up to 32 conversation worktrees and two
workspace lease slots. This does not add shared-folder collaboration or merging.

**Use a dedicated VM or stronger execution service before admitting untrusted
student code.** Native macOS provides no hard descendant-process or VM resource
boundary: deliberately daemonized processes can outlive a command, and writable
Git workspaces retain upstream trust-model limitations. Approval is a user review
step, not proof that a command is safe. Keep personal secrets out of the workspace.
Deleting a chat has not been verified to delete its worker checkout, volumes or
exports; a retention/deletion policy is still needed.

This agent has execution and uploaded-document reading, without Canvas, public
search, Microsoft account tools or browser automation. Uploaded documents are
untrusted inputs. Binary artifact downloads/imports and the worker file relay
have not been wired end to end; text files can be read back through native tools.
The shell uses available host runtimes; network package installation and
programmatic tool calling are not enabled here. Model inference still uses the
app's separately configured provider and incurs its normal costs.

## Pairing and recovery

One-time pairing stores an owner-only identity. The running worker refreshes its
short-lived credential. Durable offline recovery requires an HTTPS server
identity upstream and is disabled on this HTTP loopback setup. If a worker has
been offline long enough for its credential to expire, stop it and arrange an
explicit re-pairing rather than deleting identity or quarantine state to force
startup. The setup command intentionally refuses to overwrite an existing
identity. Restarting the services or worker preserves existing identity.

## Sources and recorded changes

The app uses LibreChat's existing agent, workspace, command approval, Bash and file
tool interfaces. The worker and control plane come from the Apache-2.0
[LibreChat Code Interpreter](https://github.com/LibreChat-AI/code-interpreter/tree/a3207a75c8327ba1c9526eff8b06f3588f3739ed),
matching the source pinned by the app's vendored code package. The exact revision
and local patch are recorded in [terminal.json](../config/terminal.json).

[macos.patch](../config/terminal/macos.patch) fixes directory enumeration through
held descriptors on Darwin. `/dev/fd/<directory>` cannot be enumerated there; the
patch uses `fdopendir` and native `readdir` on a descriptor-relative duplicate for
file listing, Git snapshots and scratch cleanup. It preserves ancestry checks,
no-follow opens, entry limits and descriptor cleanup. Setup applies it only to
the pinned source and recognizes an already-applied patch.

The object store is MinIO, built from its pinned source by
[minio.Dockerfile](../config/terminal/minio.Dockerfile), under **AGPL-3.0-only**.
Review its license obligations before distributing a deployment. The execution
service and native worker are separate from LibreChat; no proprietary workspace
format or custom execution protocol is introduced.

The fork also fixes model-spec enforcement for a saved agent when the
administrator explicitly admits the `agents` endpoint. Supplied specs are still
validated, ordinary school presets remain enforced, and saved-agent resource
authorization still runs. This fixes the native entry point without disabling
model policy globally.

## Verification

Run the real local boundary check while the services, backend and worker are up:

```sh
node scripts/terminal/check.mjs
```

It uses synthetic data and the native tool/API path, without model inference.
It checks missing-token rejection, Python execution, saved-file persistence,
separate chat instances, blocked reads/writes outside the workspace, denied
loopback network access and command timeout reporting. Results stay privately in
`.local/terminal/checks.json`. These checks sample the boundary; they are not a
security audit or proof of containment against malicious code.

On November 4, 2026, all eight real boundary checks and the live chat calculation
passed. The native UI displayed the approval request, actual stdout and exit code
zero, with a Markdown file saved and read back. The API/model-policy/agent-access
regressions passed 360 tests across eight suites; the API typecheck passed. The
patched worker passed 117 checks covering root access, sandbox policy, scratch
cleanup, workspace instances and Git worktrees. One broader upstream fixture,
“linked worktree Git guard is removed when sandbox initialization fails,” also
failed unchanged in an isolated copy of the original pinned source: its setup is
rejected before reaching the injected initialization error. That baseline failure
is unresolved, not counted as a passing check. The production startup regression
passed with median LCP 3,842.3 ms (4,500 limit), CLS 0.018 and TBT 105.4 ms, including
250 ms simulated database latency per query.
