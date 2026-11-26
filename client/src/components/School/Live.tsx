import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { WorkspaceLayout, WorkspaceLoading, WorkspaceError } from './Layout';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useLocalize } from '~/hooks';

export default function SchoolLiveView() {
  const { conversationId = '' } = useParams();
  const localize = useLocalize();
  const query = useQuery(
    [QueryKeys.schoolLiveView, conversationId],
    () => dataService.getSchoolLiveView(conversationId),
    {
      retry: false,
      staleTime: 0,
      cacheTime: 0,
      refetchInterval: (data) => data?.refreshMs ?? false,
      refetchOnWindowFocus: true,
    },
  );
  // An authorization failure hides cached content immediately, including after revocation.
  if (query.isError)
    return (
      <WorkspaceLayout title={localize('com_school_live_view')}>
        <WorkspaceError error={query.error} retry={() => void query.refetch()} />
      </WorkspaceLayout>
    );
  if (!query.data) return <WorkspaceLoading />;
  return (
    <WorkspaceLayout title={query.data.title}>
      <div className="border-border-light space-y-2 rounded-lg border p-3 text-sm" role="status">
        <p>{localize('com_school_live_note')}</p>
        <p className="text-text-secondary">{localize('com_school_viewers_text_only')}</p>
      </div>
      {query.data.messages.length === 0 && <p>{localize('com_school_view_empty')}</p>}
      <div className="space-y-6">
        {query.data.messages.map((message) => (
          <article key={message.messageId} className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold">
              {localize(message.isCreatedByUser ? 'com_school_author' : 'com_school_assistant')}
            </h2>
            <div className="markdown prose max-w-none">
              <MarkdownLite content={message.text} codeExecution={false} images={false} />
            </div>
          </article>
        ))}
      </div>
      {query.data.truncated && (
        <p role="status" className="text-text-secondary text-sm">
          {localize('com_school_view_limited')}
        </p>
      )}
    </WorkspaceLayout>
  );
}
