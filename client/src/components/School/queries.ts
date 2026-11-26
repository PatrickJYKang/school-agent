import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MutationKeys } from 'librechat-data-provider';
import { useSchoolQuery } from '~/data-provider/School';

export function useWorkspace() {
  const status = useSchoolQuery();
  const enabled = status.data?.workspace?.enabled === true;
  const workspace = useQuery([QueryKeys.schoolWorkspace], dataService.getSchoolWorkspace, {
    enabled,
    retry: false,
    staleTime: 60000,
    refetchInterval: (data) => data?.settings.refreshMs ?? false,
  });
  return { ...workspace, enabled, status };
}

export function useWorkspaceMutation<Input, Output>(
  key: MutationKeys,
  action: (input: Input) => Promise<Output>,
  onSuccess?: (output: Output) => void,
) {
  const client = useQueryClient();
  return useMutation(action, {
    mutationKey: [key],
    onSuccess: (output) => {
      for (const query of [
        QueryKeys.schoolWorkspace,
        QueryKeys.projects,
        QueryKeys.project,
        QueryKeys.allConversations,
        QueryKeys.projectConversations,
        QueryKeys.schoolViewers,
      ]) {
        void client.invalidateQueries([query]);
      }
      onSuccess?.(output);
    },
  });
}
