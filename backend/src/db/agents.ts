import Database from "better-sqlite3";
import path from "path";

export interface AgentRecord {
  id: string;
  capabilities: string[];
  pricingXLM: number;
  endpoint: string;
  stellarPublicKey: string;
  reputationScore: number;
  lastSeenAt: string;
}

let _agentDb: Database.Database | null = null;

export function getAgentDb(dbPath?: string): Database.Database {
  if (!_agentDb) {
    const filePath = dbPath ?? path.join(process.cwd(), "agents.db");
    _agentDb = new Database(filePath);
    _agentDb.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id               TEXT PRIMARY KEY,
        capabilities     TEXT NOT NULL,
        pricingXLM       REAL NOT NULL,
        endpoint         TEXT NOT NULL,
        stellarPublicKey TEXT NOT NULL,
        reputationScore  REAL NOT NULL DEFAULT 0,
        lastSeenAt       TEXT NOT NULL
      )
    `);
  }
  return _agentDb;
}

export function closeAgentDb(): void {
  _agentDb?.close();
  _agentDb = null;
}

export interface AgentDb {
  upsert(agent: AgentRecord): void;
  findById(id: string): AgentRecord | undefined;
  list(filters?: { capability?: string; minReputation?: number; maxPriceXLM?: number }): AgentRecord[];
  delete(id: string): void;
  updateReputation(id: string, delta: number): void;
}

export function createAgentDb(db: Database.Database): AgentDb {
  return {
    upsert(agent: AgentRecord): void {
      db.prepare(`
        INSERT INTO agents (id, capabilities, pricingXLM, endpoint, stellarPublicKey, reputationScore, lastSeenAt)
        VALUES (@id, @capabilities, @pricingXLM, @endpoint, @stellarPublicKey, @reputationScore, @lastSeenAt)
        ON CONFLICT(id) DO UPDATE SET
          capabilities = excluded.capabilities,
          pricingXLM = excluded.pricingXLM,
          endpoint = excluded.endpoint,
          stellarPublicKey = excluded.stellarPublicKey,
          lastSeenAt = excluded.lastSeenAt
      `).run({
        ...agent,
        capabilities: JSON.stringify(agent.capabilities)
      });
    },

    findById(id: string): AgentRecord | undefined {
      const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as any;
      if (!row) return undefined;
      return {
        ...row,
        capabilities: JSON.parse(row.capabilities)
      };
    },

    list(filters?: { capability?: string; minReputation?: number; maxPriceXLM?: number }): AgentRecord[] {
      let query = "SELECT * FROM agents WHERE 1=1";
      const params: any[] = [];
      
      if (filters?.minReputation !== undefined) {
        query += " AND reputationScore >= ?";
        params.push(filters.minReputation);
      }
      if (filters?.maxPriceXLM !== undefined) {
        query += " AND pricingXLM <= ?";
        params.push(filters.maxPriceXLM);
      }
      if (filters?.capability !== undefined) {
        query += " AND EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = ?)";
        params.push(filters.capability);
      }

      const rows = db.prepare(query).all(...params) as any[];
      return rows.map(row => ({
        ...row,
        capabilities: JSON.parse(row.capabilities)
      }));
    },

    delete(id: string): void {
      db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    },

    updateReputation(id: string, delta: number): void {
      db.prepare("UPDATE agents SET reputationScore = reputationScore + ? WHERE id = ?").run(delta, id);
    }
  };
}
