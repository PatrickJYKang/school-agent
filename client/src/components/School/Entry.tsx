import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceError, WorkspaceLoading } from './Layout';
import { useSchoolQuery } from '~/data-provider/School';
import ChatRoute from '~/routes/ChatRoute';

export default function SchoolEntry({ landing = false }: { landing?: boolean }) {
  const { conversationId } = useParams();
  const [params] = useSearchParams();
  const school = useSchoolQuery();
  // Existing chats and explicit project/setup links keep the native chat path.
  if (!landing && (conversationId !== 'new' || params.size > 0)) return <ChatRoute />;
  if (school.isLoading) return <WorkspaceLoading />;
  if (school.isError) return <WorkspaceError retry={() => void school.refetch()} />;
  if (school.data?.workspace?.enabled) return <Navigate to="/school" replace />;
  return landing ? <Navigate to="/c/new" replace /> : <ChatRoute />;
}
