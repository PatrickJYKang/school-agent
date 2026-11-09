import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';

export function useSchoolQuery() {
  return useQuery([QueryKeys.school], dataService.getSchoolStatus, {
    staleTime: 60_000,
    retry: false,
  });
}

export function useSchoolBrowser(conversationId: string, enabled: boolean) {
  return useQuery(
    [QueryKeys.schoolBrowser, conversationId],
    () => dataService.getSchoolBrowser(conversationId),
    {
      enabled: enabled && conversationId !== 'new' && conversationId.length >= 8,
      retry: false,
      staleTime: 0,
      refetchInterval: enabled ? 2000 : false,
    },
  );
}

export function useCanvasCourses(enabled: boolean) {
  return useQuery([QueryKeys.canvasCourses], dataService.getCanvasCourses, {
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useCanvasMaterials(
  courseId: string,
  kind: 'assignment' | 'page',
  enabled: boolean,
) {
  return useQuery(
    [QueryKeys.canvasMaterials, courseId, kind],
    () => dataService.getCanvasMaterials(courseId, kind),
    { enabled: enabled && courseId !== '', staleTime: 60_000, retry: false },
  );
}
