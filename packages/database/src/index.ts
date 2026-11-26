import { PrismaClient, type Prisma } from "../generated/client/index.js";

export type DatabaseClient = PrismaClient;
export type DatabaseTransaction = Prisma.TransactionClient;
export type OutboxPayload = Prisma.InputJsonValue;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

export { appendOutboxEvent, relayOutboxBatch } from "./outbox.js";
