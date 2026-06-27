/**
 * Unit tests for ResearchAgent.
 *
 * All tests mock VeniceClient so no real network calls are made.
 * Jest is configured via jest.config.js to use ts-jest.
 */

import { ResearchAgent, deriveConfidence } from './research';
import { VeniceClient, VeniceUnavailableError } from './veniceClient';
import type { AgentResult, AgentError } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid Venice JSON string with the given number of sources. */
function makeVeniceJson(sourceCount: number): string {
  const sources = Array.from({ length: sourceCount }, (_, i) => ({
    url: `https://example.com/source-${i + 1}`,
    title: `Source ${i + 1}`,
  }));
  return JSON.stringify({
    summary: 'Test summary of the research topic.',
    keyFindings: ['Finding one', 'Finding two'],
    sources,
    confidence: 0.8,
  });
}

/** Helper to cast execute result to AgentResult for assertions. */
function asResult(r: AgentResult | AgentError): AgentResult {
  if ('error' in r) throw new Error(`Expected AgentResult but got AgentError: ${r.error}`);
  return r;
}

/** Helper to cast execute result to AgentError for assertions. */
function asError(r: AgentResult | AgentError): AgentError {
  if (!('error' in r)) throw new Error('Expected AgentError but got AgentResult');
  return r;
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

jest.mock('./veniceClient');
const MockedVeniceClient = VeniceClient as jest.MockedClass<typeof VeniceClient>;

beforeEach(() => {
  MockedVeniceClient.mockClear();
});

// ---------------------------------------------------------------------------
// Confidence scoring — parameterised fixture
// ---------------------------------------------------------------------------

describe('deriveConfidence', () => {
  it.each([
    [0, 0.3],
    [1, 0.6],
    [2, 0.6],
    [3, 0.6],
    [4, 0.9],
    [10, 0.9],
  ])('sourceCount=%i → confidence=%f', (sourceCount: number, expected: number) => {
    expect(deriveConfidence(sourceCount)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ResearchAgent.execute — normal path
// ---------------------------------------------------------------------------

describe('ResearchAgent.execute — normal path', () => {
  it('returns a valid AgentResult with all required fields for a non-empty prompt', async () => {
    MockedVeniceClient.prototype.chat = jest.fn().mockResolvedValueOnce(makeVeniceJson(4));

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = await agent.execute({
      taskId: 'task_abc',
      nodeId: 'node_1',
      prompt: 'Research the impact of AI on healthcare.',
    });

    const r = asResult(result);
    expect(r.taskId).toBe('task_abc');
    expect(r.nodeId).toBe('node_1');
    expect(typeof r.summary).toBe('string');
    expect(r.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(r.keyFindings)).toBe(true);
    expect(r.keyFindings.length).toBeGreaterThan(0);
    expect(Array.isArray(r.sources)).toBe(true);
    expect(typeof r.confidence).toBe('number');
  });

  it('applies deterministic confidence scoring (4 sources → 0.9)', async () => {
    MockedVeniceClient.prototype.chat = jest.fn().mockResolvedValueOnce(makeVeniceJson(4));

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = asResult(await agent.execute({ taskId: 't1', nodeId: 'n1', prompt: 'AI in finance' }));

    expect(result.confidence).toBe(0.9);
    expect(result.sources).toHaveLength(4);
  });

  it('applies deterministic confidence scoring (0 sources → 0.3)', async () => {
    MockedVeniceClient.prototype.chat = jest.fn().mockResolvedValueOnce(makeVeniceJson(0));

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = asResult(await agent.execute({ taskId: 't2', nodeId: 'n2', prompt: 'Quantum computing' }));

    expect(result.confidence).toBe(0.3);
  });

  it('includes optional context in the user message', async () => {
    const chatMock = jest.fn().mockResolvedValueOnce(makeVeniceJson(2));
    MockedVeniceClient.prototype.chat = chatMock;

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    await agent.execute({
      taskId: 't3',
      nodeId: 'n3',
      prompt: 'Summarise market trends',
      context: 'Focus on Southeast Asia.',
    });

    const messages = chatMock.mock.calls[0][0];
    const userMsg = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('Focus on Southeast Asia.');
  });
});

// ---------------------------------------------------------------------------
// ResearchAgent.execute — malformed JSON retry
// ---------------------------------------------------------------------------

describe('ResearchAgent.execute — malformed JSON retry', () => {
  it('retries exactly once when the first response is not valid JSON', async () => {
    const chatMock = jest
      .fn()
      .mockResolvedValueOnce('This is NOT json at all.')   // first call: bad
      .mockResolvedValueOnce(makeVeniceJson(2));             // second call: good

    MockedVeniceClient.prototype.chat = chatMock;

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = asResult(await agent.execute({ taskId: 't4', nodeId: 'n4', prompt: 'Blockchain adoption' }));

    // Should have called Venice exactly twice (no third attempt).
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe(0.6); // 2 sources → 0.6
  });

  it('retry call appends the JSON-mode instruction to the user prompt', async () => {
    const chatMock = jest
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(makeVeniceJson(1));

    MockedVeniceClient.prototype.chat = chatMock;

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    await agent.execute({ taskId: 't5', nodeId: 'n5', prompt: 'Climate change research' });

    const retryMessages = chatMock.mock.calls[1][0];
    const retryUserMsg = retryMessages.find((m: { role: string }) => m.role === 'user');
    // The retry must contain the JSON-mode addendum text.
    expect(retryUserMsg.content).toContain('CRITICAL: Your previous response was not valid JSON');
  });

  it('does NOT make a third call if both attempts fail', async () => {
    const chatMock = jest
      .fn()
      .mockResolvedValue('still not valid json');

    MockedVeniceClient.prototype.chat = chatMock;

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = await agent.execute({ taskId: 't6', nodeId: 'n6', prompt: 'Nanotechnology trends' });

    expect(chatMock).toHaveBeenCalledTimes(2); // exactly one retry, no more
    // Returns a structured error, not throws.
    expect(asError(result).error).toBe('VENICE_MALFORMED_RESPONSE');
  });

  it('retries once when the response is valid JSON but fails Zod schema validation', async () => {
    const badSchema = JSON.stringify({ wrong: 'shape' });
    const chatMock = jest
      .fn()
      .mockResolvedValueOnce(badSchema)
      .mockResolvedValueOnce(makeVeniceJson(3));

    MockedVeniceClient.prototype.chat = chatMock;

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = asResult(await agent.execute({ taskId: 't7', nodeId: 'n7', prompt: 'Robotics market' }));

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe(0.6); // 3 sources → 0.6
  });
});

// ---------------------------------------------------------------------------
// ResearchAgent.execute — Venice unavailable
// ---------------------------------------------------------------------------

describe('ResearchAgent.execute — Venice unavailable', () => {
  it('returns { error: "VENICE_UNAVAILABLE" } when first call throws VeniceUnavailableError', async () => {
    MockedVeniceClient.prototype.chat = jest.fn().mockRejectedValueOnce(
      new VeniceUnavailableError('Venice AI is unreachable')
    );

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = await agent.execute({ taskId: 't8', nodeId: 'n8', prompt: 'Space exploration' });

    expect(asError(result).error).toBe('VENICE_UNAVAILABLE');
  });

  it('does NOT throw — returns a plain object', async () => {
    MockedVeniceClient.prototype.chat = jest.fn().mockRejectedValue(
      new VeniceUnavailableError('down')
    );

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });

    // Must resolve, not reject.
    await expect(
      agent.execute({ taskId: 't9', nodeId: 'n9', prompt: 'Fusion energy' })
    ).resolves.toEqual({ error: 'VENICE_UNAVAILABLE' });
  });

  it('returns { error: "VENICE_UNAVAILABLE" } when retry call also throws', async () => {
    const chatMock = jest
      .fn()
      .mockResolvedValueOnce('bad json') // first call: bad JSON triggers retry path
      .mockRejectedValueOnce(new VeniceUnavailableError('down on retry'));

    MockedVeniceClient.prototype.chat = chatMock;

    const agent = new ResearchAgent({ veniceClient: new VeniceClient({ apiKey: 'test-key' }) });
    const result = await agent.execute({ taskId: 't10', nodeId: 'n10', prompt: 'Renewables' });

    expect(asError(result).error).toBe('VENICE_UNAVAILABLE');
    expect(chatMock).toHaveBeenCalledTimes(2);
  });
});
