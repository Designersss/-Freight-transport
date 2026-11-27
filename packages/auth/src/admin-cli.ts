import { Pool } from "pg";
import { createFirstAdmin } from "./admin-bootstrap.js";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Production activation is not accepted");
  if (
    process.argv.length !== 2 ||
    process.stdin.isTTY ||
    !process.env.DATABASE_URL
  )
    throw new Error("Use a trusted stdin pipe and explicit DATABASE_URL");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) throw new Error("Invalid input");
    chunks.push(bytes);
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    if (!(await createFirstAdmin(pool, input)))
      throw new Error("Administrator already exists");
    console.log("First administrator created");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // Do not print validation details, connection strings or credentials.
  console.error("Administrator creation refused");
  process.exitCode = 1;
});
