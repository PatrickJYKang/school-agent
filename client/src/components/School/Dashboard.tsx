import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { dataService, MutationKeys } from 'librechat-data-provider';
import {
  Button,
  Input,
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import type { SchoolAssignment, SchoolWorkspace } from 'librechat-data-provider';
import { WorkspaceLayout, WorkspaceLoading, WorkspaceError, workspaceSelectClass } from './Layout';
import { useWorkspace, useWorkspaceMutation } from './queries';
import { useLocalize } from '~/hooks';

function AddAssignment({
  assignment,
  workspace,
  close,
}: {
  assignment: SchoolAssignment;
  workspace: SchoolWorkspace;
  close: () => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const homeId = workspace.projects.find((p) => p.school?.courseId === assignment.courseId)?._id;
  const projects = workspace.projects
    .filter((p) => p.school?.kind !== 'course')
    .sort((a, b) => Number(b.school?.homeId === homeId) - Number(a.school?.homeId === homeId));
  const create = useWorkspaceMutation(MutationKeys.schoolProject, dataService.createSchoolProject);
  const add = useWorkspaceMutation(
    MutationKeys.schoolSource,
    dataService.addSchoolProjectSource,
    (project) => {
      close();
      navigate(`/projects/${encodeURIComponent(project._id)}`);
    },
  );
  const busy = create.isLoading || add.isLoading;
  async function submit() {
    const homeId = workspace.projects.find((p) => p.school?.courseId === assignment.courseId)?._id;
    try {
      const id = projectId || (await create.mutateAsync({ name: name.trim(), homeId }))._id;
      await add.mutateAsync({ projectId: id, courseId: assignment.courseId, id: assignment.id });
    } catch {
      /* Mutation state supplies safe UI copy. */
    }
  }
  return (
    <OGDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <OGDialogContent showCloseButton>
        <OGDialogTitle>{localize('com_school_add_assignment')}</OGDialogTitle>
        <OGDialogDescription>{localize('com_school_project_context_note')}</OGDialogDescription>
        <p className="font-medium">{assignment.title}</p>
        <label className="space-y-2">
          <span>{localize('com_school_destination')}</span>
          <select
            className={workspaceSelectClass}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={busy}
          >
            <option value="">{localize('com_school_new_project')}</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!projectId && (
          <label className="space-y-2">
            <span>{localize('com_school_project_name')}</span>
            <Input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {(create.isError || add.isError) && <WorkspaceError error={create.error ?? add.error} />}
        <Button disabled={busy || (!projectId && !name.trim())} onClick={() => void submit()}>
          {localize(busy ? 'com_school_workspace_saving' : 'com_school_add_assignment')}
        </Button>
      </OGDialogContent>
    </OGDialog>
  );
}

export default function SchoolDashboard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const query = useWorkspace();
  const [assignment, setAssignment] = useState<SchoolAssignment | null>(null);
  const choice = useWorkspaceMutation(
    MutationKeys.schoolFolderChoice,
    dataService.setSchoolFolderChoice,
  );
  const chat = useWorkspaceMutation(
    MutationKeys.schoolChat,
    dataService.createSchoolChat,
    (result) => navigate(`/c/${encodeURIComponent(result.conversationId)}`),
  );
  if (query.status.isLoading) return <WorkspaceLoading />;
  if (query.status.isError) return <WorkspaceError retry={() => void query.status.refetch()} />;
  if (!query.enabled) return <Navigate to="/c/new" replace />;
  if (query.isError)
    return (
      <WorkspaceLayout title={localize('com_school_workspace')}>
        <WorkspaceError retry={() => void query.refetch()} />
      </WorkspaceLayout>
    );
  if (!query.data) return <WorkspaceLoading />;
  const workspace = query.data;
  const courses = workspace.projects.filter((p) => p.school?.kind === 'course');
  const courseIds = new Set(courses.map((course) => course._id));
  const unfiled = workspace.projects.filter(
    (p) => p.school?.kind !== 'course' && (!p.school?.homeId || !courseIds.has(p.school.homeId)),
  );
  const choiceButtons = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={choice.isLoading} onClick={() => choice.mutate('allowed')}>
        {localize('com_school_allow_folders')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={choice.isLoading}
        onClick={() => choice.mutate('denied')}
      >
        {localize('com_school_deny_folders')}
      </Button>
    </div>
  );
  return (
    <WorkspaceLayout title={localize('com_school_workspace')}>
      <p className="text-text-secondary">{localize('com_school_workspace_intro')}</p>
      {workspace.choice === 'unavailable' && <WorkspaceError retry={() => void query.refetch()} />}
      {workspace.choice === 'undecided' && (
        <section
          aria-labelledby="school-consent"
          className="border-border-light bg-surface-secondary space-y-3 rounded-xl border p-4"
        >
          <h2 id="school-consent" className="font-semibold">
            {localize('com_school_folder_prompt')}
          </h2>
          <p className="text-sm">{localize('com_school_folder_note')}</p>
          {choiceButtons}
        </section>
      )}
      {(workspace.choice === 'allowed' || workspace.choice === 'denied') && (
        <details className="border-border-light rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer">
            {localize(
              workspace.choice === 'allowed'
                ? 'com_school_folders_allowed'
                : 'com_school_folders_denied',
            )}
          </summary>
          <div className="mt-3 space-y-3">
            <p>{localize('com_school_folder_note')}</p>
            {choiceButtons}
          </div>
        </details>
      )}
      {choice.isError && <WorkspaceError error={choice.error} />}
      {!workspace.connected && (
        <section className="border-border-light space-y-2 rounded-lg border p-4">
          <p>{localize('com_school_connect_dashboard')}</p>
          <Button asChild variant="outline">
            <Link to="/c/new?setup=canvas">{localize('com_school_canvas')}</Link>
          </Button>
        </section>
      )}
      <section aria-labelledby="school-upcoming" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="school-upcoming" className="text-lg font-semibold">
            {localize('com_school_upcoming')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {localize('com_school_refresh')}
          </Button>
        </div>
        <p className="text-text-secondary text-xs">
          {localize('com_school_due_note')} ·{' '}
          {new Date(workspace.retrievedAt).toLocaleString(undefined, {
            timeZone: workspace.timeZone,
            timeZoneName: 'short',
          })}
        </p>
        {workspace.assignmentsError && <WorkspaceError retry={() => void query.refetch()} />}
        {workspace.connected &&
          !workspace.assignmentsError &&
          workspace.assignments.length === 0 && (
            <p className="text-text-secondary">{localize('com_school_no_upcoming')}</p>
          )}
        {workspace.assignments.map((item) => (
          <article
            key={`${item.courseId}/${item.id}`}
            className="border-border-light space-y-3 rounded-xl border p-4"
          >
            <div>
              <p className="text-text-secondary text-sm">{item.course}</p>
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-text-secondary text-sm">
                {item.dueAt
                  ? new Date(item.dueAt).toLocaleString(undefined, {
                      timeZone: workspace.timeZone,
                      timeZoneName: 'short',
                    })
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={item.url} target="_blank" rel="noreferrer">
                  {localize('com_school_open_canvas')}
                </a>
              </Button>
              <Button
                size="sm"
                disabled={chat.isLoading}
                onClick={() =>
                  chat.mutate({
                    projectId: courses.find((p) => p.school?.courseId === item.courseId)?._id,
                    assignment: { courseId: item.courseId, id: item.id },
                  })
                }
              >
                {localize('com_school_assignment_chat')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAssignment(item)}>
                {localize('com_school_add_assignment')}
              </Button>
            </div>
          </article>
        ))}
        {chat.isError && <WorkspaceError error={chat.error} />}
        {workspace.truncated && (
          <p role="status" className="text-text-secondary text-sm">
            {localize('com_school_workspace_limited')}
          </p>
        )}
      </section>
      <section aria-labelledby="school-courses" className="space-y-3">
        <h2 id="school-courses" className="text-lg font-semibold">
          {localize('com_school_courses_projects')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {courses.map((course) => (
            <article
              key={course._id}
              className="border-border-light space-y-2 rounded-xl border p-4"
            >
              <Link
                className="font-semibold underline"
                to={`/projects/${encodeURIComponent(course._id)}`}
              >
                {course.name}
              </Link>
              <ul className="space-y-2 text-sm">
                {workspace.projects
                  .filter((p) => p.school?.homeId === course._id)
                  .map((p) => (
                    <li key={p._id}>
                      <Link className="underline" to={`/projects/${encodeURIComponent(p._id)}`}>
                        {p.name}
                      </Link>
                    </li>
                  ))}
              </ul>
              <Button asChild size="sm" variant="ghost">
                <Link to={`/school/new?homeId=${encodeURIComponent(course._id)}`}>
                  {localize('com_school_work_here')}
                </Link>
              </Button>
            </article>
          ))}
          {unfiled.map((p) => (
            <article key={p._id} className="border-border-light rounded-xl border p-4">
              <Link
                className="font-semibold underline"
                to={`/projects/${encodeURIComponent(p._id)}`}
              >
                {p.name}
              </Link>
              <p className="text-text-secondary text-xs">
                {localize('com_school_unfiled_project')}
              </p>
            </article>
          ))}
        </div>
        {workspace.projects.length === 0 && (
          <p className="text-text-secondary">{localize('com_school_no_folders')}</p>
        )}
      </section>
      {assignment && (
        <AddAssignment
          assignment={assignment}
          workspace={workspace}
          close={() => setAssignment(null)}
        />
      )}
    </WorkspaceLayout>
  );
}
