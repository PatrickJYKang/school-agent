import { isAxiosError } from 'axios';
import { Link } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import type { ReactNode } from 'react';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize } from '~/hooks';

export function WorkspaceLayout({ title, children }: { title: string; children: ReactNode }) {
  const localize = useLocalize();
  return (
    <main className="bg-surface-primary text-text-primary h-full overflow-y-auto">
      <header className="border-border-light flex items-center gap-2 border-b p-3">
        <OpenSidebar />
        <Button asChild variant="ghost">
          <Link to="/school">{localize('com_school_workspace')}</Link>
        </Button>
        <Button asChild className="ms-auto" size="sm">
          <Link to="/school/new">{localize('com_ui_new_chat')}</Link>
        </Button>
      </header>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function WorkspaceLoading() {
  const localize = useLocalize();
  return (
    <div role="status" className="flex items-center gap-2 p-4">
      <Spinner />
      {localize('com_school_workspace_loading')}
    </div>
  );
}

export function WorkspaceError({ retry, error }: { retry?: () => void; error?: unknown }) {
  const localize = useLocalize();
  const code = isAxiosError<{ code?: string }>(error) ? error.response?.data?.code : undefined;
  let message = localize('com_school_workspace_error');
  switch (code) {
    case 'workspace_content_blocked':
      message = localize('com_school_content_blocked');
      break;
    case 'document_blocked':
      message = localize('com_school_document_blocked');
      break;
    case 'workspace_context_limit':
      message = localize('com_school_context_limit');
      break;
    case 'workspace_viewer_unavailable':
      message = localize('com_school_viewer_unavailable');
      break;
    case 'workspace_conflict':
      message = localize('com_school_context_conflict');
      break;
    case 'workspace_limit':
      message = localize('com_school_folder_limit');
      break;
    case 'canvas_not_connected':
      message = localize('com_school_connect_dashboard');
      break;
  }
  return (
    <div role="alert" className="border-border-light rounded-lg border p-3 text-sm">
      <p>{message}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          {localize('com_school_workspace_retry')}
        </Button>
      )}
    </div>
  );
}

export const workspaceSelectClass =
  'border-border-light bg-surface-primary text-text-primary w-full rounded-lg border p-2 text-sm';
