import { createApp } from "./api/app";
import { startAgentSync } from "./registry/sync";

const PORT = Number(process.env.PORT ?? 3000);

startAgentSync();
const { httpServer } = createApp();
httpServer.listen(PORT, () => console.log(`ai-net backend listening on :${PORT}`));
