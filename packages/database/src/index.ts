import { PrismaClient } from "../generated/client/index.js";

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
