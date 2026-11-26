import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { SchoolWorkspace } from 'librechat-data-provider';
import SchoolDestination from '../Destination';
import SchoolDashboard from '../Dashboard';
import SchoolCourse from '../Course';
import SchoolLiveView from '../Live';

const mockNewConversation = jest.fn();
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: mockNewConversation }),
}));
jest.mock('~/components/Chat/Menus/OpenSidebar', () => () => null);
jest.mock(
  '~/components/Chat/Messages/Content/MarkdownLite',
  () =>
    ({ content }: { content: string }) => <p>{content}</p>,
);
jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    ...jest.requireActual('librechat-data-provider').dataService,
    getSchoolStatus: jest.fn(),
    getSchoolWorkspace: jest.fn(),
    setSchoolFolderChoice: jest.fn(),
    createSchoolProject: jest.fn(),
    createSchoolChat: jest.fn(),
    getSchoolLiveView: jest.fn(),
    getSchoolCourse: jest.fn(),
    getSchoolCourseChats: jest.fn(),
  },
}));

const workspace: SchoolWorkspace = {
  choice: 'undecided',
  connected: true,
  projects: [],
  courses: [],
  assignments: [],
  truncated: false,
  retrievedAt: '2026-11-25T12:00:00Z',
  timeZone: 'America/Los_Angeles',
  settings: { refreshMs: 30000, viewerRefreshMs: 3000 },
};
function mount(path: string, element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 }, mutations: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: jest.fn() },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/school" element={element} />
          <Route path="/school/courses/:courseId" element={element} />
          <Route path="/school/new" element={element} />
          <Route path="/school/view/:conversationId" element={element} />
          <Route path="/c/:id" element={<p>CHAT_OPENED</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  jest.clearAllMocks();
  (dataService.getSchoolStatus as jest.Mock).mockResolvedValue({
    enabled: true,
    workspace: { enabled: true },
  });
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue(workspace);
});

it('keeps the folder prompt until an explicit persisted choice and leaves empty projects uncreated', async () => {
  let current = workspace;
  (dataService.getSchoolWorkspace as jest.Mock).mockImplementation(async () => current);
  (dataService.setSchoolFolderChoice as jest.Mock).mockImplementation(async (choice) => {
    current = { ...workspace, choice };
    return { choice };
  });
  mount('/school', <SchoolDashboard />);
  await screen.findByRole('heading', { name: 'com_school_folder_prompt' });
  expect(dataService.setSchoolFolderChoice).not.toHaveBeenCalled();
  expect(dataService.createSchoolProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'com_school_deny_folders' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'com_school_folder_prompt' }),
    ).not.toBeInTheDocument(),
  );
  expect(dataService.setSchoolFolderChoice).toHaveBeenCalledWith('denied');
  expect(screen.getByText('com_school_folders_denied')).toBeInTheDocument();
});

it('shows incomplete assignment results as a failure with retry, rather than an empty success', async () => {
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    assignmentsError: 'workspace_partial',
    truncated: true,
  });
  mount('/school', <SchoolDashboard />);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('com_school_no_upcoming')).not.toBeInTheDocument();
  expect(screen.getByText('com_school_workspace_limited')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_school_workspace_retry' }));
  await waitFor(() => expect(dataService.getSchoolWorkspace).toHaveBeenCalledTimes(2));
});

it('starts an assignment chat in the existing course folder through a separate action', async () => {
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    courses: [{ id: 'course-home', name: 'History', canvasCourseId: '1', active: true }],
    assignments: [
      {
        id: '2',
        courseId: '1',
        course: 'History',
        title: 'Essay',
        url: 'https://school.instructure.com/courses/1/assignments/2',
        dueAt: '2099-01-01',
      },
    ],
  });
  (dataService.createSchoolChat as jest.Mock).mockResolvedValue({ conversationId: 'new-id' });
  mount('/school', <SchoolDashboard />);
  const link = await screen.findByRole('link', { name: 'com_school_open_canvas' });
  expect(link).toHaveAttribute('href', 'https://school.instructure.com/courses/1/assignments/2');
  fireEvent.click(screen.getByRole('button', { name: 'com_school_assignment_chat' }));
  await screen.findByText('CHAT_OPENED');
  expect(dataService.createSchoolChat).toHaveBeenCalledWith({
    schoolCourseId: 'course-home',
    assignment: { courseId: '1', id: '2' },
  });
});

it('keeps projects visible when their old course folder is no longer in the dashboard', async () => {
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    projects: [
      { _id: 'project-id', name: 'Research', school: { kind: 'project', homeId: 'old-course' } },
    ],
  });
  mount('/school', <SchoolDashboard />);
  expect(await screen.findByRole('link', { name: 'Research' })).toHaveAttribute(
    'href',
    '/projects/project-id',
  );
});

it('creates a project only after submission and starts the native unsaved chat after a retry', async () => {
  (dataService.createSchoolProject as jest.Mock)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ _id: 'saved-project', name: 'Research' });
  mount('/school/new', <SchoolDestination />);
  const select = await screen.findByRole('combobox');
  fireEvent.change(select, { target: { value: 'new:' } });
  fireEvent.change(screen.getByLabelText('com_school_project_name'), {
    target: { value: 'Research' },
  });
  expect(dataService.createSchoolProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'com_school_start_chat' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'com_school_start_chat' }));
  await screen.findByText('CHAT_OPENED');
  expect(dataService.createSchoolProject).toHaveBeenCalledTimes(2);
  expect(dataService.createSchoolChat).not.toHaveBeenCalled();
  expect(mockNewConversation).toHaveBeenCalledWith({
    template: { chatProjectId: 'saved-project', schoolCourseId: null },
  });
});

it('hides previously loaded viewer text when access is revoked during a refresh', async () => {
  (dataService.getSchoolLiveView as jest.Mock).mockResolvedValueOnce({
    title: 'Shared',
    messages: [{ messageId: 'm', text: 'Saved answer' }],
    refreshMs: 30000,
  });
  const { client } = mount('/school/view/chat-id', <SchoolLiveView />);
  await screen.findByText('Saved answer');
  (dataService.getSchoolLiveView as jest.Mock).mockRejectedValue(new Error('revoked'));
  await act(async () => {
    await client.invalidateQueries([QueryKeys.schoolLiveView, 'chat-id']);
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('Saved answer')).not.toBeInTheDocument();
});

it('starts a quick question in a course independently of the project destination', async () => {
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    courses: [{ id: 'course-id', name: 'History', canvasCourseId: '1' }],
  });
  mount('/school/new?homeId=course-id', <SchoolDestination />);
  const select = await screen.findByRole('combobox');
  expect(select).toHaveValue('course:course-id');
  fireEvent.click(screen.getByRole('button', { name: 'com_school_start_chat' }));
  await screen.findByText('CHAT_OPENED');
  expect(mockNewConversation).toHaveBeenCalledWith({
    template: { chatProjectId: null, schoolCourseId: 'course-id' },
  });
  expect(dataService.createSchoolProject).not.toHaveBeenCalled();
  expect(dataService.createSchoolChat).not.toHaveBeenCalled();
});

it('links courses to their bespoke category and projects to LibreChat projects', async () => {
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    courses: [{ id: 'course-id', name: 'History', canvasCourseId: '1' }],
    projects: [
      { _id: 'project-id', name: 'Research', school: { kind: 'project', homeId: 'course-id' } },
    ],
  });
  mount('/school', <SchoolDashboard />);
  expect(await screen.findByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    '/school/courses/course-id',
  );
  expect(screen.getByRole('link', { name: 'Research' })).toHaveAttribute(
    'href',
    '/projects/project-id',
  );
});

it('offers only existing projects in the assignment action and does not create an empty project', async () => {
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    assignments: [
      {
        id: '2',
        courseId: '1',
        course: 'History',
        title: 'Essay',
        url: 'https://school.instructure.com/courses/1/assignments/2',
      },
    ],
  });
  mount('/school', <SchoolDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'com_school_add_assignment' }));
  expect(screen.getByRole('combobox').children).toHaveLength(1);
  expect(screen.getByText('com_school_no_existing_projects')).toBeInTheDocument();
  expect(screen.queryByLabelText('com_school_project_name')).not.toBeInTheDocument();
  expect(dataService.createSchoolProject).not.toHaveBeenCalled();
});

it('renders the course home with direct chats, child projects, and a retriable chat read failure', async () => {
  (dataService.getSchoolCourse as jest.Mock).mockResolvedValue({
    id: 'course-id',
    name: 'History',
    canvasCourseId: '1',
  });
  (dataService.getSchoolWorkspace as jest.Mock).mockResolvedValue({
    ...workspace,
    projects: [
      { _id: 'project-id', name: 'Research', school: { kind: 'project', homeId: 'course-id' } },
    ],
  });
  (dataService.getSchoolCourseChats as jest.Mock)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({
      chats: [
        { conversationId: 'chat-id', title: 'Quick question', updatedAt: '2026-11-25T12:00:00Z' },
      ],
      nextCursor: null,
    });
  mount('/school/courses/course-id', <SchoolCourse />);
  expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Research' })).toHaveAttribute(
    'href',
    '/projects/project-id',
  );
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'com_school_workspace_retry' }));
  expect(await screen.findByRole('link', { name: 'Quick question' })).toHaveAttribute(
    'href',
    '/c/chat-id',
  );
});
