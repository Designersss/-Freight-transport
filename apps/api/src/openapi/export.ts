import { mkdir, writeFile } from "node:fs/promises";
import { parseApiConfig } from "../config/api-config.js";
import { createApp } from "../create-app.js";
import { createOpenApiDocument } from "./document.js";

async function main(): Promise<void> {
  // Documentation generation never connects to a database.
  const app = await createApp(
    parseApiConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://127.0.0.1:1/contract",
    }),
  );
  try {
    const directory = new URL(
      "../../../../packages/client-api/",
      import.meta.url,
    );
    await mkdir(directory, { recursive: true });
    const document = createOpenApiDocument(app);
    await writeFile(
      new URL("openapi.json", directory),
      `${JSON.stringify(document, null, 2)}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch(() => {
  console.error("OpenAPI export failed");
  process.exitCode = 1;
});
