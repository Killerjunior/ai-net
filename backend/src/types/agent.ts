export interface AgentRegistration {
  id: string;
  type: string;
  endpoint: string;
  cost: number;
}

export interface AgentRegistry {
  getAgents(agentType: string): AgentRegistration[] | Promise<AgentRegistration[]>;
}

