import { Link } from 'react-router-dom';
import { Button } from '@librechat/client';
import { dataService, MutationKeys } from 'librechat-data-provider';
import type { TChatProject } from 'librechat-data-provider';
import { useWorkspace, useWorkspaceMutation } from './queries';
import { WorkspaceError } from './Layout';
import { useLocalize } from '~/hooks';

export default function SchoolProject({ project }: { project: TChatProject }) {
  const query = useWorkspace();
  const localize = useLocalize();
  const refresh = useWorkspaceMutation(
    MutationKeys.schoolSource,
    dataService.addSchoolProjectSource,
  );
  const remove = useWorkspaceMutation(
    MutationKeys.schoolSource,
    dataService.removeSchoolProjectSource,
  );
  if (!query.enabled) return null;
  const busy = refresh.isLoading || remove.isLoading;
  if (project.school?.kind === 'course')
    return (
      <section
        className="mt-3 space-y-2 text-sm"
        aria-label={localize('com_school_course_projects')}
      >
        <p className="font-semibold">{localize('com_school_course_projects')}</p>
        <ul className="space-y-1">
          {query.data?.projects
            .filter((p) => p.school?.homeId === project._id)
            .map((p) => (
              <li key={p._id}>
                <Link className="underline" to={`/projects/${encodeURIComponent(p._id)}`}>
                  {p.name}
                </Link>
              </li>
            ))}
        </ul>
        <Button asChild size="sm" variant="outline">
          <Link to={`/school/new?homeId=${encodeURIComponent(project._id)}`}>
            {localize('com_school_work_here')}
          </Link>
        </Button>
      </section>
    );
  const home = query.data?.projects.find((p) => p._id === project.school?.homeId);
  return (
    <section className="mt-3 space-y-2 text-sm" aria-label={localize('com_school_project_sources')}>
      {home && (
        <Link className="underline" to={`/projects/${encodeURIComponent(home._id)}`}>
          {home.name}
        </Link>
      )}
      <h2 className="font-semibold">{localize('com_school_project_sources')}</h2>
      <p className="text-text-secondary">{localize('com_school_project_context_note')}</p>
      <p className="text-text-secondary text-xs">
        {localize('com_school_context_revision', { revision: project.contextRevision ?? 0 })}
      </p>
      {(project.school?.sources ?? []).map((source) => (
        <div
          key={`${source.courseId}/${source.id}`}
          className="border-border-light space-y-2 rounded-lg border p-3"
        >
          <a className="underline" href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
          <p className="text-text-secondary text-xs">
            {localize('com_school_retrieved', {
              date: new Date(source.retrievedAt).toLocaleString(),
            })}
          </p>
          <details>
            <summary className="cursor-pointer">{localize('com_school_source_preview')}</summary>
            <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
              {source.markdown}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                refresh.mutate({ projectId: project._id, courseId: source.courseId, id: source.id })
              }
            >
              {localize('com_school_refresh')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                remove.mutate({ projectId: project._id, courseId: source.courseId, id: source.id })
              }
            >
              {localize('com_school_remove_source')}
            </Button>
          </div>
        </div>
      ))}
      {(refresh.isError || remove.isError) && (
        <WorkspaceError error={refresh.error ?? remove.error} />
      )}
      <Button asChild variant="outline" size="sm">
        <Link to="/school">{localize('com_school_find_assignment')}</Link>
      </Button>
    </section>
  );
}
