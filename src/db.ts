import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: config.DATABASE_URL,
      },
    },
    log: config.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalThis.prismaGlobal ?? createPrismaClient();

if (config.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
