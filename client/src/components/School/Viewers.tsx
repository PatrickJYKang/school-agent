import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import {
  Button,
  Input,
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import { WorkspaceError, WorkspaceLoading } from './Layout';
import { useSchoolQuery } from '~/data-provider/School';
import { useWorkspaceMutation } from './queries';
import { useLocalize } from '~/hooks';

export default function SchoolViewers({ conversationId }: { conversationId?: string | null }) {
  const localize = useLocalize();
  const { data } = useSchoolQuery();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const id = conversationId ?? '';
  const viewers = useQuery([QueryKeys.schoolViewers, id], () => dataService.getSchoolViewers(id), {
    enabled: open && id !== '' && id !== 'new',
    retry: false,
    staleTime: 0,
  });
  const add = useWorkspaceMutation(MutationKeys.schoolViewer, dataService.addSchoolViewer, () =>
    setEmail(''),
  );
  const remove = useWorkspaceMutation(MutationKeys.schoolViewer, dataService.removeSchoolViewer);
  if (!data?.workspace?.viewersEnabled || !id || id === 'new') return null;
  const busy = add.isLoading || remove.isLoading;
  return (
    <>
      <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(true)}>
        {localize('com_school_viewers')}
      </Button>
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogContent showCloseButton>
          <OGDialogTitle>{localize('com_school_viewers')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_school_viewers_note')}</OGDialogDescription>
          <p className="text-text-secondary text-sm">{localize('com_school_viewers_text_only')}</p>
          <label className="block space-y-2">
            <span>{localize('com_school_view_link')}</span>
            <Input
              readOnly
              value={`${window.location.origin}/school/view/${encodeURIComponent(id)}`}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="text-text-secondary text-xs">{localize('com_school_link_private')}</p>
          {viewers.isLoading && <WorkspaceLoading />}
          {viewers.isError ? (
            <WorkspaceError retry={() => void viewers.refetch()} />
          ) : (
            <ul className="space-y-2">
              {viewers.data?.map((viewer) => (
                <li key={viewer.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm break-words">
                    {viewer.name} · {viewer.email}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => remove.mutate({ conversationId: id, viewer: viewer.id })}
                  >
                    {localize('com_school_revoke')}
                  </Button>
                </li>
              ))}
              {viewers.data?.length === 0 && (
                <li className="text-text-secondary text-sm">{localize('com_school_no_viewers')}</li>
              )}
            </ul>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate({ conversationId: id, email: email.trim() });
            }}
          >
            <label className="block space-y-2">
              <span>{localize('com_school_viewer_email')}</span>
              <Input
                type="email"
                value={email}
                maxLength={254}
                required
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {(add.isError || remove.isError) && (
              <WorkspaceError error={add.error ?? remove.error} />
            )}
            <Button type="submit" disabled={busy || !email.trim()}>
              {localize('com_school_add_viewer')}
            </Button>
          </form>
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
