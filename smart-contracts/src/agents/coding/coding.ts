import { z } from 'zod';
import { registerAgent } from '../../registry/registry';
import { Agent, AgentResult, SubTask } from '../../types/agent';
import { VeniceClient } from '../../venice/venice';

const CodingOutputSchema = z.object({
  language: z.string(),
  code: z.string().min(1, 'Code field cannot be empty'),
  explanation: z.string(),
  dependencies: z.array(z.string()),
});

export type CodingOutput = z.infer<typeof CodingOutputSchema>;

const AGENT_ID = 'coding-agent-1';
const AGENT_NAME = 'Coding Agent';
const AGENT_CAPABILITY = 'coding';

export class CodingAgent implements Agent {
  constructor(private readonly venice: VeniceClient) {}

  start(): void {
    // registration happens on module load
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(process.env.VENICE_API_KEY);
  }

  async execute(task: SubTask): Promise<AgentResult> {
    const upstreamContext = task.upstreamResults?.length
      ? `\n\nUpstream context:\n${JSON.stringify(task.upstreamResults, null, 2)}`
      : '';

    const prompt = [
      'You are a code generation assistant. Respond with valid JSON only, no markdown.',
      'Format: {"language":"string","code":"string","explanation":"string","dependencies":["string"]}',
      upstreamContext,
      `\nTask: ${task.prompt}`,
    ].join('\n');

    const model = this.venice.getModelForAgent(AGENT_CAPABILITY);
    const content = await this.venice.complete(prompt, model);

    const parsed = CodingOutputSchema.parse(JSON.parse(content));

    return {
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      capability: AGENT_CAPABILITY,
      data: parsed,
    };
  }
}

registerAgent({
  id: AGENT_ID,
  name: AGENT_NAME,
  capability: AGENT_CAPABILITY,
  priceXLM: 1,
  stellarAddress: '',
});
