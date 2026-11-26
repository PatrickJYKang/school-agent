import { useState } from 'react';
import { Button, Input } from '@librechat/client';
import { dataService, MutationKeys } from 'librechat-data-provider';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceLayout, WorkspaceLoading, WorkspaceError, workspaceSelectClass } from './Layout';
import { useWorkspace, useWorkspaceMutation } from './queries';
import { useLocalize, useNewConvo } from '~/hooks';

export default function SchoolDestination() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { newConversation } = useNewConvo();
  const [params] = useSearchParams();
  const query = useWorkspace();
  const [destination, setDestination] = useState(() => {
    if (params.get('newHomeId')) return `new:${params.get('newHomeId')}`;
    if (params.get('homeId')) return `course:${params.get('homeId')}`;
    return 'none';
  });
  const [name, setName] = useState('');
  const create = useWorkspaceMutation(MutationKeys.schoolProject, dataService.createSchoolProject);
  const busy = create.isLoading;
  const isNew = destination.startsWith('new:');
  async function start() {
    let projectId: string | undefined;
    let schoolCourseId: string | undefined;
    try {
      if (isNew) {
        const homeId = destination.slice(4) || undefined;
        projectId = (await create.mutateAsync({ name: name.trim(), homeId }))._id;
        setDestination(`project:${projectId}`);
      } else if (destination.startsWith('course:')) schoolCourseId = destination.slice(7);
      else if (destination.startsWith('project:')) projectId = destination.slice(8);
    } catch {
      return;
    }
    let search = 'workspace=1';
    if (projectId) search = `projectId=${encodeURIComponent(projectId)}`;
    else if (schoolCourseId) search = `courseId=${encodeURIComponent(schoolCourseId)}`;
    navigate(`/c/new?${search}`);
    newConversation({
      template: { chatProjectId: projectId ?? null, schoolCourseId: schoolCourseId ?? null },
    });
  }
  if (query.status.isLoading) return <WorkspaceLoading />;
  if (query.status.isError) return <WorkspaceError retry={() => void query.status.refetch()} />;
  if (!query.enabled) return <Navigate to="/c/new" replace />;
  if (query.isError) return <WorkspaceError retry={() => void query.refetch()} />;
  if (!query.data) return <WorkspaceLoading />;
  const courses = query.data.courses;
  const projects = query.data.projects;
  return (
    <WorkspaceLayout title={localize('com_school_choose_destination')}>
      <p className="text-text-secondary">{localize('com_school_destination_note')}</p>
      <form
        className="max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label className="block space-y-2">
          <span>{localize('com_school_destination')}</span>
          <select
            className={workspaceSelectClass}
            value={destination}
            disabled={busy}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="none">{localize('com_school_no_folder')}</option>
            {courses.map((p) => (
              <option key={p.id} value={`course:${p.id}`}>
                {p.name}
              </option>
            ))}
            {projects.map((p) => (
              <option key={p._id} value={`project:${p._id}`}>
                {courses.find((c) => c.id === p.school?.homeId)?.name
                  ? `${courses.find((c) => c.id === p.school?.homeId)?.name} / `
                  : ''}
                {p.name}
              </option>
            ))}
            <option value="new:">{localize('com_school_new_unfiled')}</option>
            {courses.map((p) => (
              <option key={`new-${p.id}`} value={`new:${p.id}`}>
                {localize('com_school_new_in_course', { name: p.name })}
              </option>
            ))}
            {!isNew &&
              destination.startsWith('project:') &&
              !projects.some((p) => destination === `project:${p._id}`) && (
                <option value={destination}>{name}</option>
              )}
          </select>
        </label>
        {isNew && (
          <label className="block space-y-2">
            <span>{localize('com_school_project_name')}</span>
            <Input
              value={name}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        )}
        {create.isError && <WorkspaceError error={create.error} />}
        <Button type="submit" disabled={busy || (isNew && !name.trim())}>
          {localize(busy ? 'com_school_workspace_saving' : 'com_school_start_chat')}
        </Button>
      </form>
    </WorkspaceLayout>
  );
}
