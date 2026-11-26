import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSchoolCourse } from './queries';
import { useLocalize } from '~/hooks';

export default function CourseBadge({ id }: { id: string }) {
  const query = useSchoolCourse(id);
  const localize = useLocalize();
  return (
    <Link
      className="text-text-secondary flex items-center gap-1 text-sm"
      to={`/school/courses/${encodeURIComponent(id)}`}
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      {query.data?.name ?? localize('com_school_courses')}
    </Link>
  );
}
