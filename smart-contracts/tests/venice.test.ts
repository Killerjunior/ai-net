import { EventEmitter } from 'events';
import axios from 'axios';
import { VeniceClient } from '../src/venice/venice';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeSuccessResponse = (content: string) => ({
  data: { choices: [{ message: { content } }] },
});

const makeStreamResponse = (lines: string[]) => {
  const emitter = new EventEmitter();
  setTimeout(() => {
    for (const line of lines) {
      emitter.emit('data', Buffer.from(line));
    }
    emitter.emit('end');
  }, 0);
  return { data: emitter };
};

describe('VeniceClient', () => {
  let client: VeniceClient;

  beforeEach(() => {
    process.env.VENICE_API_KEY = 'test-key';
    client = new VeniceClient();
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.VENICE_API_KEY;
  });

  describe('complete', () => {
    it('returns a full string response for a simple prompt', async () => {
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('Hello from Venice'));
      const result = await client.complete('Say hello', 'venice-xl');
      expect(result).toBe('Hello from Venice');
    });

    it('resolves model via routing map when capability name is passed', async () => {
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('ok'));
      await client.complete('prompt', 'research');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ model: 'venice-xl' }),
        expect.any(Object),
      );
    });

    it('uses direct model id when not in routing map', async () => {
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('ok'));
      await client.complete('prompt', 'custom-model');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ model: 'custom-model' }),
        expect.any(Object),
      );
    });

    it('throws when VENICE_API_KEY is not set', async () => {
      delete process.env.VENICE_API_KEY;
      const noKeyClient = new VeniceClient();
      await expect(noKeyClient.complete('prompt', 'venice-xl')).rejects.toThrow(
        'VENICE_API_KEY is not configured',
      );
    });

    it('reads API key exclusively from process.env.VENICE_API_KEY', async () => {
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('ok'));
      await client.complete('prompt', 'venice-xl');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
      );
    });

    it('throws when response has no content', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { choices: [] } });
      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow(
        'Venice returned an empty response',
      );
    });

    it('truncates prompt to 200 chars in logs', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('ok'));
      const longPrompt = 'x'.repeat(300);
      await client.complete(longPrompt, 'venice-xl');
      const logArg: string = consoleSpy.mock.calls[0][0];
      expect(logArg).toContain('x'.repeat(200) + '…');
      expect(logArg).not.toContain('x'.repeat(201) + 'x');
      consoleSpy.mockRestore();
    });

    it('spreads extra options into the request body', async () => {
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('ok'));
      await client.complete('prompt', 'venice-xl', { temperature: 0.5, max_tokens: 100 });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ temperature: 0.5, max_tokens: 100 }),
        expect.any(Object),
      );
    });
  });

  describe('stream', () => {
    it('calls onChunk for each SSE content delta and resolves after [DONE]', async () => {
      const sseLines = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        'data: [DONE]\n',
      ];
      mockedAxios.post.mockResolvedValueOnce(makeStreamResponse(sseLines));

      const chunks: string[] = [];
      await client.stream('prompt', 'venice-xl', (c) => chunks.push(c));

      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('calls onChunk multiple times before resolving', async () => {
      const sseLines = [
        'data: {"choices":[{"delta":{"content":"A"}}]}\n',
        'data: {"choices":[{"delta":{"content":"B"}}]}\n',
        'data: {"choices":[{"delta":{"content":"C"}}]}\n',
        'data: [DONE]\n',
      ];
      mockedAxios.post.mockResolvedValueOnce(makeStreamResponse(sseLines));

      const onChunk = jest.fn();
      await client.stream('prompt', 'venice-xl', onChunk);

      expect(onChunk).toHaveBeenCalledTimes(3);
    });

    it('resolves only after stream ends', async () => {
      const emitter = new EventEmitter();
      mockedAxios.post.mockResolvedValueOnce({ data: emitter });

      let resolved = false;
      const streamPromise = client
        .stream('prompt', 'venice-xl', () => {})
        .then(() => {
          resolved = true;
        });

      // Allow axios mock promise to resolve and stream listeners to be registered
      await new Promise<void>((r) => setImmediate(r));

      expect(resolved).toBe(false);
      emitter.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"x"}}]}\n'));
      expect(resolved).toBe(false);
      emitter.emit('end');

      await streamPromise;
      expect(resolved).toBe(true);
    });

    it('rejects when stream emits an error', async () => {
      const emitter = new EventEmitter();
      mockedAxios.post.mockResolvedValueOnce({ data: emitter });

      const streamPromise = client.stream('prompt', 'venice-xl', () => {});

      // Wait for axios mock to resolve and the error listener to be registered
      await new Promise<void>((r) => setImmediate(r));

      emitter.emit('error', new Error('stream error'));

      await expect(streamPromise).rejects.toThrow('stream error');
    });

    it('ignores malformed SSE lines', async () => {
      const sseLines = [
        'data: not-json\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
        'data: [DONE]\n',
      ];
      mockedAxios.post.mockResolvedValueOnce(makeStreamResponse(sseLines));

      const chunks: string[] = [];
      await client.stream('prompt', 'venice-xl', (c) => chunks.push(c));

      expect(chunks).toEqual(['ok']);
    });
  });

  describe('model routing', () => {
    const cases: Array<[string, string]> = [
      ['research', 'venice-xl'],
      ['risk', 'venice-xl'],
      ['coding', 'venice-code'],
      ['design', 'venice-xl'],
      ['report', 'venice-xl'],
    ];

    it.each(cases)('getModelForAgent("%s") returns "%s"', (capability, expected) => {
      expect(client.getModelForAgent(capability)).toBe(expected);
    });

    it('falls back to venice-xl for unknown capability', () => {
      expect(client.getModelForAgent('unknown')).toBe('venice-xl');
    });
  });

  describe('circuit breaker', () => {
    it('opens after 3 consecutive failures', async () => {
      mockedAxios.post.mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 3; i++) {
        await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow('server error');
      }

      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow(
        'Circuit breaker is OPEN',
      );
      // axios.post was called exactly 3 times — 4th call was rejected without hitting the network
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('rejects calls immediately in open state without hitting the network', async () => {
      mockedAxios.post.mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 3; i++) {
        await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow();
      }

      jest.clearAllMocks();

      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow(
        'Circuit breaker is OPEN',
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('transitions closed → open → half-open → closed', async () => {
      const dateSpy = jest.spyOn(Date, 'now');
      let now = 1_000_000;
      dateSpy.mockImplementation(() => now);

      // Closed → Open: trigger 3 failures
      mockedAxios.post.mockRejectedValue(new Error('server error'));
      for (let i = 0; i < 3; i++) {
        await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow('server error');
      }

      // Verify OPEN: call rejected without hitting network
      jest.clearAllMocks();
      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow(
        'Circuit breaker is OPEN',
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();

      // Advance clock past 60s cooldown
      now += 60_001;

      // Open → Half-open → Closed: successful probe closes the circuit
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('probe ok'));
      const result = await client.complete('prompt', 'venice-xl');
      expect(result).toBe('probe ok');

      // Verify CLOSED: subsequent calls work normally without circuit error
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('normal'));
      await expect(client.complete('prompt', 'venice-xl')).resolves.toBe('normal');

      dateSpy.mockRestore();
    });

    it('reopens from half-open on failure', async () => {
      const dateSpy = jest.spyOn(Date, 'now');
      let now = 1_000_000;
      dateSpy.mockImplementation(() => now);

      // Trigger OPEN
      mockedAxios.post.mockRejectedValue(new Error('server error'));
      for (let i = 0; i < 3; i++) {
        await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow();
      }

      // Advance to HALF_OPEN
      now += 60_001;

      // Probe fails → back to OPEN
      mockedAxios.post.mockRejectedValue(new Error('still down'));
      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow('still down');

      // Immediately rejected again — circuit is OPEN
      jest.clearAllMocks();
      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow(
        'Circuit breaker is OPEN',
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();

      dateSpy.mockRestore();
    });

    it('resets failure count after a success', async () => {
      mockedAxios.post.mockRejectedValue(new Error('err'));

      // 2 failures — not yet open
      for (let i = 0; i < 2; i++) {
        await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow();
      }

      // 1 success — resets counter
      mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('ok'));
      await expect(client.complete('prompt', 'venice-xl')).resolves.toBe('ok');

      // 2 more failures — still not open (counter was reset)
      mockedAxios.post.mockRejectedValue(new Error('err'));
      for (let i = 0; i < 2; i++) {
        await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow('err');
      }

      // 3rd failure in new run opens it
      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow('err');
      await expect(client.complete('prompt', 'venice-xl')).rejects.toThrow(
        'Circuit breaker is OPEN',
      );
    });
  });
});
