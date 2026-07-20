import { onChainContracts, resetTestDatabase } from "./helpers";
import { closeAgentDb } from "../../backend/src/db/agents";
import { closeTaskDb } from "../../backend/src/db/tasks";

module.exports = async () => {
  onChainContracts.clearAll();
  closeAgentDb();
  closeTaskDb();
};
