import { BookOpen, ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useWorkspace } from './queries';
import { useLocalize } from '~/hooks';

/** Courses are separate from LibreChat projects; a course can contain both chats and projects. */
export default function Courses({ toggleNav }: { toggleNav?: () => void }) {
  const query = useWorkspace();
  const localize = useLocalize();
  const { pathname } = useLocation();
  if (!query.enabled) return null;
  return (
    <details open className="px-2 py-2">
      <summary className="text-text-secondary flex cursor-pointer items-center gap-2 px-2 py-1 text-sm font-medium">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        {localize('com_school_courses')}
      </summary>
      {query.isLoading && (
        <p role="status" className="text-text-secondary px-2 text-xs">
          {localize('com_school_workspace_loading')}
        </p>
      )}
      {query.isError && (
        <button
          type="button"
          className="text-text-secondary px-2 text-xs underline"
          onClick={() => void query.refetch()}
        >
          {localize('com_school_workspace_retry')}
        </button>
      )}
      <ul className="space-y-1">
        {query.data?.courses.map((course) => {
          const href = `/school/courses/${encodeURIComponent(course.id)}`;
          return (
            <li key={course.id}>
              <Link
                to={href}
                onClick={toggleNav}
                aria-current={pathname === href ? 'page' : undefined}
                className="hover:bg-surface-hover aria-[current=page]:bg-surface-active flex items-center gap-2 rounded-lg px-2 py-2 text-sm"
              >
                <BookOpen className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{course.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {query.data?.courses.length === 0 && (
        <Link className="text-text-secondary block px-2 py-1 text-xs underline" to="/school">
          {localize('com_school_folder_prompt')}
        </Link>
      )}
    </details>
  );
}
