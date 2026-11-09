import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import { useSchoolBrowser, useSchoolQuery } from '~/data-provider/School';
import { useLocalize } from '~/hooks';

export default function SchoolBrowser({
  conversationId,
  index,
}: {
  conversationId?: string | null;
  index: number;
}) {
  const localize = useLocalize();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: school } = useSchoolQuery();
  const id = conversationId ?? 'new';
  const query = useSchoolBrowser(id, open && school?.browser?.enabled === true);
  const mutation = useMutation(
    ({ restart, scope }: { restart: boolean; scope: string }) =>
      restart ? dataService.restartSchoolBrowser(scope) : dataService.stopSchoolBrowser(scope),
    {
      mutationKey: [MutationKeys.controlSchoolBrowser],
      onSuccess: (data, variables) => {
        cache.setQueryData([QueryKeys.schoolBrowser, variables.scope], data);
        void cache.invalidateQueries([QueryKeys.schoolBrowser, variables.scope]);
      },
    },
  );
  if (index !== 0 || !school?.browser?.enabled) return null;
  const state = query.data;
  const failure = Boolean(query.error || (mutation.variables?.scope === id && mutation.error));
  const loading = query.isFetching && !state;
  const canControl = state?.stopped || state?.status === 'ready' || state?.status === 'busy';
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={localize('com_school_browser')}
      >
        <Globe className="mr-2 size-4" aria-hidden="true" />
        {localize('com_school_browser')}
      </Button>
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogContent showCloseButton>
          <OGDialogTitle>{localize('com_school_browser')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_school_browser_description')}</OGDialogDescription>
          {loading && id !== 'new' && <p role="status">{localize('com_school_browser_loading')}</p>}
          {failure && <p role="alert">{localize('com_school_browser_failure')}</p>}
          {(!state || state.status === 'closed') && !failure && !loading && (
            <p>
              {localize(state?.stopped ? 'com_school_browser_stopped' : 'com_school_browser_empty')}
            </p>
          )}
          {state?.url && (
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link underline"
            >
              {state.title || state.url}
            </a>
          )}
          {state?.status === 'busy' && (
            <p role="status">{localize('com_school_browser_working')}</p>
          )}
          {state?.image && (
            <img
              src={`data:image/png;base64,${state.image}`}
              alt={localize('com_school_browser_image')}
              className="max-h-96 w-full rounded-lg object-contain"
            />
          )}
          {failure && (
            <Button
              variant="outline"
              onClick={() => {
                mutation.reset();
                void query.refetch();
              }}
            >
              {localize('com_ui_retry')}
            </Button>
          )}
          {id !== 'new' && (
            <Button
              variant="outline"
              disabled={mutation.isLoading || !canControl}
              onClick={() => mutation.mutate({ scope: id, restart: state?.stopped === true })}
            >
              {localize(state?.stopped ? 'com_school_browser_restart' : 'com_school_browser_stop')}
            </Button>
          )}
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
