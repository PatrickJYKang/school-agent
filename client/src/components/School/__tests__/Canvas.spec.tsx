import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TConversation } from 'librechat-data-provider';
import SchoolCanvas from '../Canvas';

const mockUpload = jest.fn().mockResolvedValue(true);
jest.mock('~/hooks/Files', () => ({
  useFileHandlingNoChatContext: () => ({ handleFiles: mockUpload }),
}));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    ...jest.requireActual('librechat-data-provider').dataService,
    getSchoolStatus: jest.fn(),
    getCanvasCourses: jest.fn(),
    getCanvasMaterials: jest.fn(),
    getCanvasContext: jest.fn(),
    connectSchoolCanvas: jest.fn(),
    disconnectSchoolCanvas: jest.fn(),
  },
}));

const status = {
  enabled: true,
  name: 'School',
  guidance: 'Check your evidence.',
  canvas: { enabled: true, baseUrl: 'https://school.instructure.com', connected: true },
};
const mockStatus = dataService.getSchoolStatus as jest.Mock;
const mockCourses = dataService.getCanvasCourses as jest.Mock;
const mockMaterials = dataService.getCanvasMaterials as jest.Mock;
const mockContext = dataService.getCanvasContext as jest.Mock;
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 }, mutations: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: jest.fn() },
  });
  return render(
    <QueryClientProvider client={client}>
      <SchoolCanvas
        index={0}
        conversation={
          { conversationId: 'new', endpoint: 'openAI', model: 'gpt-6-luna' } as TConversation
        }
        disabled={false}
        files={new Map()}
        setFiles={jest.fn()}
        setFilesLoading={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('Canvas material picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus.mockResolvedValue(status);
    mockCourses.mockResolvedValue({
      items: [{ id: '2', name: 'Biology', code: 'BIO' }],
      truncated: false,
    });
    mockMaterials.mockResolvedValue({
      items: [
        {
          id: '7',
          kind: 'assignment',
          title: 'Creek lab',
          url: 'https://school.instructure.com/courses/2/assignments/7',
        },
      ],
      truncated: false,
    });
    mockContext.mockResolvedValue({
      filename: 'canvas-context.md',
      markdown: '# Creek lab\nSource: https://school.instructure.com/courses/2/assignments/7',
      sources: [],
    });
  });
  it('does not fetch course content until the user opens the picker', async () => {
    mount();
    await screen.findByText('com_school_canvas');
    expect(mockCourses).not.toHaveBeenCalled();
    expect(mockContext).not.toHaveBeenCalled();
  });
  it('previews only selected items and requires a separate action to attach Markdown', async () => {
    mount();
    fireEvent.click(await screen.findByText('com_school_canvas'));
    await screen.findByText('Biology');
    fireEvent.change(screen.getByRole('combobox', { name: 'com_school_course' }), {
      target: { value: '2' },
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Creek lab' }));
    expect(mockContext).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('com_school_preview'));
    await screen.findByText('com_school_attach');
    expect(mockContext).toHaveBeenCalledWith([{ courseId: '2', kind: 'assignment', id: '7' }]);
    expect(mockUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('com_school_attach'));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    const [files, resource] = mockUpload.mock.calls[0];
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe('canvas-context.md');
    expect(resource).toBe('context');
  });
  it('clears prior course selections and preview when the course changes', async () => {
    mockCourses.mockResolvedValue({
      items: [
        { id: '2', name: 'Biology' },
        { id: '3', name: 'History' },
      ],
      truncated: false,
    });
    mount();
    fireEvent.click(await screen.findByText('com_school_canvas'));
    await screen.findByText('Biology');
    const select = screen.getByRole('combobox', { name: 'com_school_course' });
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Creek lab' }));
    fireEvent.change(select, { target: { value: '3' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'com_school_preview' })).toBeDisabled(),
    );
    expect(mockUpload).not.toHaveBeenCalled();
  });
  it('does not show school controls when the deployment disables the feature', async () => {
    mockStatus.mockResolvedValue({ ...status, enabled: false });
    mount();
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(screen.queryByText('com_school_canvas')).not.toBeInTheDocument();
  });
  it('shows a safe error and lets the user retry a failed course request', async () => {
    mockCourses.mockRejectedValueOnce({
      response: { data: { code: 'canvas_unavailable', message: 'private provider response' } },
    });
    mount();
    fireEvent.click(await screen.findByText('com_school_canvas'));
    expect(await screen.findByRole('alert')).toHaveTextContent('com_school_canvas_unavailable');
    expect(screen.queryByText('private provider response')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_school_retry' }));
    await screen.findByText('Biology');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mockCourses).toHaveBeenCalledTimes(2);
  });
  it('discloses automatic Canvas access when enabled by school policy', async () => {
    mockStatus.mockResolvedValue({ ...status, canvas: { ...status.canvas, toolCalling: true } });
    mount();
    fireEvent.click(await screen.findByText('com_school_canvas'));
    expect(await screen.findByText('com_school_canvas_tools_note')).toBeInTheDocument();
    expect(mockContext).not.toHaveBeenCalled();
  });
});
