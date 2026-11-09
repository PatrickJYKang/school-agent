import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchoolBrowser from '../Browser';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    ...jest.requireActual('librechat-data-provider').dataService,
    getSchoolStatus: jest.fn(),
    getSchoolBrowser: jest.fn(),
    stopSchoolBrowser: jest.fn(),
    restartSchoolBrowser: jest.fn(),
  },
}));
const status = dataService.getSchoolStatus as jest.Mock;
const read = dataService.getSchoolBrowser as jest.Mock;
const stop = dataService.stopSchoolBrowser as jest.Mock;
const restart = dataService.restartSchoolBrowser as jest.Mock;
function mount(conversationId = 'conversation-a') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 }, mutations: { retry: false } },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return render(
    <QueryClientProvider client={client}>
      <SchoolBrowser index={0} conversationId={conversationId} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  status.mockResolvedValue({ enabled: true, browser: { enabled: true } });
  read.mockResolvedValue({
    status: 'ready',
    url: 'https://example.com/',
    title: 'Example Domain',
    image: 'aW1hZ2U=',
  });
});
test('only exposes the entry point when institution policy enables browsing', async () => {
  status.mockResolvedValue({ enabled: true, browser: { enabled: false } });
  mount();
  await waitFor(() => expect(status).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'com_school_browser' })).not.toBeInTheDocument();
});
test('shows actual page status and screenshot and permits explicit stop/restart', async () => {
  read.mockResolvedValueOnce({
    status: 'ready',
    url: 'https://example.com/',
    title: 'Example Domain',
    image: 'aW1hZ2U=',
  });
  stop.mockImplementation(async () => {
    read.mockResolvedValue({ status: 'closed', stopped: true });
    return { status: 'closed', stopped: true };
  });
  restart.mockImplementation(async () => {
    read.mockResolvedValue({ status: 'closed' });
    return { status: 'closed' };
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'com_school_browser' }));
  expect(await screen.findByRole('link', { name: 'Example Domain' })).toHaveAttribute(
    'href',
    'https://example.com/',
  );
  expect(screen.getByRole('img', { name: 'com_school_browser_image' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_school_browser_stop' }));
  expect(await screen.findByText('com_school_browser_stopped')).toBeInTheDocument();
  expect(stop).toHaveBeenCalledWith('conversation-a');
  fireEvent.click(screen.getByRole('button', { name: 'com_school_browser_restart' }));
  await waitFor(() => expect(restart).toHaveBeenCalledWith('conversation-a'));
});
test('shows an empty state for a new chat without querying a session', async () => {
  mount('new');
  fireEvent.click(await screen.findByRole('button', { name: 'com_school_browser' }));
  expect(await screen.findByText('com_school_browser_empty')).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});
test('reports failure and retries status without exposing service diagnostics', async () => {
  read
    .mockRejectedValueOnce(new Error('private upstream details'))
    .mockResolvedValue({ status: 'closed' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'com_school_browser' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('com_school_browser_failure');
  expect(screen.queryByText('private upstream details')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
  expect(await screen.findByText('com_school_browser_empty')).toBeInTheDocument();
});
