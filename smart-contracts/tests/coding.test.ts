import { CodingAgent, CodingOutput } from '../src/agents/coding/coding';
import { getAgent } from '../src/registry/registry';
import { VeniceClient } from '../src/venice/venice';

const makeVenice = (response: object) => ({
  complete: jest.fn().mockResolvedValue(JSON.stringify(response)),
  getModelForAgent: jest.fn().mockReturnValue('venice-code'),
  stream: jest.fn(),
});

const baseCodeResponse = {
  language: 'typescript',
  code: 'const add = (a: number, b: number): number => a + b;',
  explanation: 'A simple function that adds two numbers.',
  dependencies: [],
};

describe('CodingAgent', () => {

  it('returns valid CodingOutput for a code generation prompt', async () => {
    const venice = makeVenice(baseCodeResponse);
    const agent = new CodingAgent(venice as unknown as VeniceClient);
    const result = await agent.execute({
      prompt: 'Write a function to add two numbers',
    });
    const output = result.data as CodingOutput;

    expect(output.language).toBe('typescript');
    expect(output.code).toBe(baseCodeResponse.code);
    expect(output.explanation).toBeTruthy();
    expect(Array.isArray(output.dependencies)).toBe(true);
  });

  it('uses venice-code model via getModelForAgent', async () => {
    const venice = makeVenice(baseCodeResponse);
    const agent = new CodingAgent(venice as unknown as VeniceClient);
    await agent.execute({ prompt: 'Write a function' });

    expect(venice.getModelForAgent).toHaveBeenCalledWith('coding');
    expect(venice.complete).toHaveBeenCalledWith(
      expect.any(String),
      'venice-code',
    );
  });

  it('Zod rejects response missing code field', async () => {
    const venice = makeVenice({
      language: 'ts',
      explanation: '',
      dependencies: [],
    });
    const agent = new CodingAgent(venice as unknown as VeniceClient);
    await expect(agent.execute({ prompt: 'test' })).rejects.toThrow();
  });

  it('registers with capability "coding" on module load', () => {
    const meta = getAgent('coding-agent-1');
    expect(meta?.capability).toBe('coding');
  });

  it('includes upstream context when upstreamResults are provided', async () => {
    const venice = makeVenice(baseCodeResponse);
    const agent = new CodingAgent(venice as unknown as VeniceClient);
    await agent.execute({
      prompt: 'Write a function',
      upstreamResults: [
        {
          agentId: 'research-1',
          agentName: 'Research Agent',
          capability: 'research',
          data: { summary: 'Growing market identified' },
        },
      ],
    });

    const promptArg = venice.complete.mock.calls[0][0] as string;
    expect(promptArg).toContain('Growing market identified');
  });

  it('healthCheck returns false when VENICE_API_KEY is not set', async () => {
    delete process.env.VENICE_API_KEY;
    const venice = makeVenice(baseCodeResponse);
    const agent = new CodingAgent(venice as unknown as VeniceClient);
    const healthy = await agent.healthCheck();
    expect(healthy).toBe(false);
  });
});
