import { VeniceClient, VeniceUnavailableError } from '../../../src/agents/research/veniceClient';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content } }],
    }),
  };
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'fail' }),
  };
}

describe('research VeniceClient adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('delegates chat requests to the shared Venice client', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('adapter response'));

    const client = new VeniceClient({ apiKey: 'test-key', baseUrl: 'https://test.local' });
    const result = await client.chat(
      [
        { role: 'system', content: 'Research carefully.' },
        { role: 'user', content: 'Topic' },
      ],
      { model: 'research-model' }
    );

    const [url, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(result).toBe('adapter response');
    expect(url).toBe('https://test.local/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(body.model).toBe('research-model');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Research carefully.' },
      { role: 'user', content: 'Topic' },
    ]);
  });

  it('keeps the research adapter error contract', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401));

    const client = new VeniceClient({ apiKey: 'test-key', baseUrl: 'https://test.local' });

    await expect(client.chat([{ role: 'user', content: 'Topic' }])).rejects.toThrow(
      VeniceUnavailableError
    );
  });
});
