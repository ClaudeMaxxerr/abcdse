import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export function createPrismaClient(): PrismaClient {
  const isTest =
    config.NODE_ENV === "test" ||
    process.env["NODE_ENV"] === "test" ||
    Boolean(process.env["VITEST"]);

  let resolvedUrl: string;

  if (isTest) {
    const testUrl = process.env["TEST_DATABASE_URL"] || config.TEST_DATABASE_URL;
    if (!testUrl || !testUrl.includes("schema=patchwars_test")) {
      throw new Error(
        "TEST RUN REFUSED: Database connection string is missing required '?schema=patchwars_test' parameter. Tests must use TEST_DATABASE_URL and are physically prohibited from falling back to production DATABASE_URL."
      );
    }
    resolvedUrl = testUrl;
  } else {
    resolvedUrl = config.DATABASE_URL;
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: resolvedUrl,
      },
    },
    log: config.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalThis.prismaGlobal ?? createPrismaClient();

if (config.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
