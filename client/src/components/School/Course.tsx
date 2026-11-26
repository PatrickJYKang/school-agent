import { Button } from '@librechat/client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { WorkspaceLayout, WorkspaceError, WorkspaceLoading } from './Layout';
import { useWorkspace, useSchoolCourse } from './queries';
import { useLocalize } from '~/hooks';

export default function Course() {
  const { courseId = '' } = useParams();
  const localize = useLocalize();
  const workspace = useWorkspace();
  const course = useSchoolCourse(courseId);
  const chats = useInfiniteQuery(
    [QueryKeys.schoolCourseChats, courseId],
    ({ pageParam }) => dataService.getSchoolCourseChats(courseId, pageParam),
    {
      enabled: workspace.enabled && Boolean(course.data),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      retry: false,
      refetchInterval: workspace.data?.settings.refreshMs ?? false,
    },
  );
  if (workspace.status.isLoading) return <WorkspaceLoading />;
  if (workspace.status.isError)
    return <WorkspaceError retry={() => void workspace.status.refetch()} />;
  if (!workspace.enabled) return <Navigate to="/c/new" replace />;
  if (course.isLoading || workspace.isLoading) return <WorkspaceLoading />;
  if (course.isError || workspace.isError)
    return (
      <WorkspaceError
        retry={() => {
          void course.refetch();
          void workspace.refetch();
        }}
      />
    );
  if (!course.data) return <WorkspaceError />;
  const projects =
    workspace.data?.projects.filter((project) => project.school?.homeId === courseId) ?? [];
  return (
    <WorkspaceLayout title={course.data.name}>
      <Link className="text-text-secondary text-sm underline" to="/school">
        {localize('com_school_workspace')}
      </Link>
      <p className="text-text-secondary">{localize('com_school_course_note')}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to={`/c/new?courseId=${encodeURIComponent(courseId)}`}>
            {localize('com_school_start_chat')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/school/new?newHomeId=${encodeURIComponent(courseId)}`}>
            {localize('com_school_new_course_project')}
          </Link>
        </Button>
      </div>
      <section aria-labelledby="school-course-projects" className="space-y-3">
        <h2 id="school-course-projects" className="text-lg font-semibold">
          {localize('com_school_course_projects')}
        </h2>
        <ul className="space-y-2">
          {projects.map((project) => (
            <li key={project._id}>
              <Link className="underline" to={`/projects/${encodeURIComponent(project._id)}`}>
                {project.name}
              </Link>
            </li>
          ))}
        </ul>
        {projects.length === 0 && (
          <p className="text-text-secondary text-sm">{localize('com_school_course_no_projects')}</p>
        )}
        {workspace.data?.truncated && (
          <p role="status" className="text-text-secondary text-sm">
            {localize('com_school_workspace_limited')}
          </p>
        )}
      </section>
      <section aria-labelledby="school-course-chats" className="space-y-3">
        <h2 id="school-course-chats" className="text-lg font-semibold">
          {localize('com_school_course_chats')}
        </h2>
        {chats.isLoading && <p role="status">{localize('com_school_workspace_loading')}</p>}
        {chats.isError && <WorkspaceError retry={() => void chats.refetch()} />}
        {!chats.isError && chats.data?.pages[0]?.chats.length === 0 && (
          <p className="text-text-secondary">{localize('com_school_course_empty')}</p>
        )}
        <ul className="space-y-2">
          {chats.data?.pages
            .flatMap((page) => page.chats)
            .map((chat) => (
              <li key={chat.conversationId} className="border-border-light rounded-lg border p-3">
                <Link
                  className="font-medium underline"
                  to={`/c/${encodeURIComponent(chat.conversationId)}`}
                >
                  {chat.title}
                </Link>
                <p className="text-text-secondary text-xs">
                  {new Date(chat.updatedAt).toLocaleString()}
                </p>
              </li>
            ))}
        </ul>
        {chats.hasNextPage && (
          <Button
            variant="outline"
            disabled={chats.isFetchingNextPage}
            onClick={() => void chats.fetchNextPage()}
          >
            {localize('com_school_more_chats')}
          </Button>
        )}
      </section>
    </WorkspaceLayout>
  );
}
