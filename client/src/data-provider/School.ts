import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';

export function useSchoolQuery() {
  return useQuery([QueryKeys.school], dataService.getSchoolStatus, {
    staleTime: 60_000,
    retry: false,
  });
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
