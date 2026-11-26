import { schoolChatPath } from '../routing';

it('retains the course when a first send normalizes the URL to /c/new', () => {
  const course = 'a'.repeat(24);
  expect(schoolChatPath('/c/new', `?courseId=${course}&q=private-draft`, true)).toBe(
    `/c/new?courseId=${course}&workspace=1`,
  );
});
it('keeps an unfiled first send in the native composer, preserves projects, and leaves feature-off routing alone', () => {
  expect(schoolChatPath('/c/new', '?workspace=1', true)).toBe('/c/new?workspace=1');
  expect(schoolChatPath('/c/new?projectId=project', '?courseId=bad', true)).toBe(
    '/c/new?projectId=project&workspace=1',
  );
  expect(schoolChatPath('/c/new', '?workspace=1', false)).toBe('/c/new');
  expect(schoolChatPath('/c/saved', '?courseId=bad', true)).toBe('/c/saved');
});
