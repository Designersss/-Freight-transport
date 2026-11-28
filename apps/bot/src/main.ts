import { parseBotConfig } from "./config.js";
import { createBotHandler } from "./handler.js";
import { createBotInternalApi } from "./internal-api.js";
import { pollTelegram } from "./polling.js";
import { createTelegramTransport } from "./telegram.js";

async function main(): Promise<void> {
  const config = parseBotConfig(process.env);
  const telegram = createTelegramTransport(config.TELEGRAM_BOT_TOKEN);
  const api = createBotInternalApi(config);
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    console.info("MOVARO Telegram bot polling started");
    await pollTelegram(
      telegram,
      createBotHandler(config, api, telegram),
      shutdown.signal,
      (event) => console.error(`MOVARO bot: ${event}`),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

main().catch(() => {
  console.error("MOVARO bot startup failed; check configuration");
  process.exitCode = 1;
});
