/** Keep the school destination while the native first-send flow normalizes its new-chat URL. */
export function schoolChatPath(path: string, search: string, enabled: boolean): string {
  if (!enabled) return path;
  const [pathname, query] = path.split('?');
  if (pathname !== '/c/new') return path;
  const params = new URLSearchParams(query);
  const courseId = new URLSearchParams(search).get('courseId');
  if (!params.has('projectId') && courseId && /^[a-f\d]{24}$/i.test(courseId)) {
    params.set('courseId', courseId);
  }
  params.set('workspace', '1');
  return `${pathname}?${params.toString()}`;
}
