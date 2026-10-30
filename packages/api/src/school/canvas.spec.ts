import { resolveSchoolConfig, canvasContextRequestSchema } from 'librechat-data-provider';
import { canvasOrigin, canvasText, createCanvasClient } from './canvas';

const settings = resolveSchoolConfig({
  canvas: { enabled: true, baseUrl: 'https://school.instructure.com' },
})!.canvas;
const json = (body: object, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { headers });

describe('read-only Canvas client', () => {
  it('rejects non-institution origins and URL credentials before sending a token', () => {
    for (const value of [
      'http://school.instructure.com',
      'https://a:b@school.instructure.com',
      'https://127.0.0.1',
      'https://localhost',
      'https://school.instructure.com/api/v1/courses',
      'https://school.instructure.com?token=x',
    ]) {
      expect(() => canvasOrigin(value)).toThrow('canvas_unconfigured');
    }
    expect(canvasOrigin('https://school.instructure.com/')).toBe('https://school.instructure.com');
  });
  it('follows same-resource pagination, strips unrelated fields, and sends only GETs', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValueOnce(
        json(
          [{ id: 1, name: 'Biology', course_code: 'BIO', enrollments: [{ grades: 'private' }] }],
          {
            link: '<https://school.instructure.com/api/v1/courses?per_page=50&page=2>; rel="next"',
          },
        ),
      )
      .mockResolvedValueOnce(json([{ id: 2, name: 'History', course_code: 'HIST' }]));
    const client = createCanvasClient({
      baseUrl: 'https://school.instructure.com',
      token: 'private-token',
      settings,
      fetchFn,
    });
    expect(await client.courses()).toEqual({
      items: [
        { id: '1', name: 'Biology', code: 'BIO' },
        { id: '2', name: 'History', code: 'HIST' },
      ],
      truncated: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toContain('enrollment_state=active');
    for (const [, options] of fetchFn.mock.calls)
      expect(options).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer private-token' },
      });
  });
  it.each([
    'https://attacker.example/api/v1/courses?page=2',
    'https://school.instructure.com/api/v1/users?grades=1',
  ])('refuses pagination outside the selected resource: %s', async (next) => {
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(json([], { link: `<${next}>; rel="next"` }));
    await expect(
      createCanvasClient({
        baseUrl: 'https://school.instructure.com',
        token: 'private-token',
        settings,
        fetchFn,
      }).courses(),
    ).rejects.toMatchObject({ code: 'canvas_invalid_response' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('reports a bounded list instead of silently pretending it fetched everything', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockImplementation(async () =>
        json([{ id: 1, name: 'Biology' }], {
          link: '<https://school.instructure.com/api/v1/courses?page=2>; rel="next"',
        }),
      );
    const result = await createCanvasClient({
      baseUrl: 'https://school.instructure.com',
      token: 'token',
      settings: { ...settings, maxPages: 1 },
      fetchFn,
    }).courses();
    expect(result.truncated).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('builds a Markdown source with rubric criteria and canonical links, never student grades', async () => {
    const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>().mockResolvedValue(
      json({
        id: 7,
        name: 'Creek investigation',
        description: '<p>Compare sites.</p><script>steal()</script>',
        rubric: [
          {
            description: 'Evidence',
            points: 5,
            ratings: [{ description: 'Clear link', points: 5 }],
          },
        ],
        submission: { score: 3, body: 'private student work' },
      }),
    );
    const result = await createCanvasClient({
      baseUrl: 'https://school.instructure.com',
      token: 'secret',
      settings,
      fetchFn,
    }).context([{ kind: 'assignment', courseId: '2', id: '7' }]);
    expect(result.markdown).toContain('https://school.instructure.com/courses/2/assignments/7');
    expect(result.markdown).toContain('Evidence (5 points)');
    expect(result.markdown).toContain('Clear link');
    expect(result.markdown).not.toMatch(/private student work|steal\(\)|secret/);
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://school.instructure.com/api/v1/courses/2/assignments/7',
    );
  });
  it('never discloses locked course material', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(
        json({ url: 'hidden-page', title: 'Locked', body: 'private', locked_for_user: true }),
      );
    await expect(
      createCanvasClient({
        baseUrl: 'https://school.instructure.com',
        token: 'secret',
        settings,
        fetchFn,
      }).context([{ kind: 'page', courseId: '2', id: 'hidden-page' }]),
    ).rejects.toMatchObject({ code: 'canvas_forbidden' });
  });
  it('limits selected context and upstream response size', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockImplementation(async () =>
        json({ id: 7, name: 'Long assignment', description: 'x'.repeat(2000) }),
      );
    const client = createCanvasClient({
      baseUrl: 'https://school.instructure.com',
      token: 'secret',
      settings: { ...settings, maxContextChars: 1000 },
      fetchFn,
    });
    await expect(
      client.context([{ kind: 'assignment', courseId: '2', id: '7' }]),
    ).rejects.toMatchObject({ code: 'canvas_too_large' });
    const small = createCanvasClient({
      baseUrl: 'https://school.instructure.com',
      token: 'secret',
      settings: { ...settings, maxResponseBytes: 10 },
      fetchFn,
    });
    await expect(small.verify()).rejects.toMatchObject({ code: 'canvas_too_large' });
  });
  it('returns stable safe failures without treating a provider 401 as an expired local session', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(new Response('token=secret internal error', { status: 401 }));
    await expect(
      createCanvasClient({
        baseUrl: 'https://school.instructure.com',
        token: 'secret',
        settings,
        fetchFn,
      }).verify(),
    ).rejects.toMatchObject({
      code: 'canvas_unauthorized',
      message: 'canvas_unauthorized',
      status: 400,
    });
  });
  it('sanitizes active markup and rejects traversal-shaped selections', () => {
    expect(canvasText('<p>A &amp; B</p><style>secret</style><p>C</p>')).toBe('A & B\nC');
    for (const id of ['../secret', '1?include=submissions', '..'])
      expect(
        canvasContextRequestSchema.safeParse({ selections: [{ courseId: '1', kind: 'page', id }] })
          .success,
      ).toBe(false);
  });
});
