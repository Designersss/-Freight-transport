import { parseWorkerConfig } from "./config.js";
import { startWorker } from "./worker.js";

async function main(): Promise<void> {
  const worker = await startWorker(parseWorkerConfig(process.env));
  const shutdown = () => {
    void worker.stop().catch(() => {
      console.error("Worker shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch(() => {
  console.error("Worker startup failed; check configuration, database and migrations");
  process.exitCode = 1;
});
