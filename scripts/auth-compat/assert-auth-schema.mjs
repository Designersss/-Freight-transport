import assert from "node:assert/strict";
import { getMigrations } from "better-auth/db/migration";

// The test must not silently repair a missing or incompatible Prisma migration.
export async function assertAuthSchema(options) {
  const plan = await getMigrations(options);
  assert.deepEqual(plan.toBeCreated, [], "Missing Better Auth tables");
  assert.deepEqual(plan.toBeAdded, [], "Missing Better Auth fields");
  assert.deepEqual(plan.toBeAddedIndexes, [], "Missing Better Auth indexes");
  assert.deepEqual(plan.unsafeChanges, [], "Unsafe Better Auth schema changes");
}
