import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { setupSweepInterval } from "./domain/expirySweep.js";
import { postBotComment } from "./github/comments.js";

async function start(): Promise<void> {
  const app = await buildApp();

  // Graceful shutdown handlers
  let sweepTimer: ReturnType<typeof setInterval> | undefined;

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      if (sweepTimer) clearInterval(sweepTimer);
      await app.close();
      await prisma.$disconnect();
      app.log.info("Server and database connections closed.");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    const address = await app.listen({
      port: config.PORT,
      host: config.HOST,
    });
    app.log.info(`Patch Wars 2026 Points Tracker running at ${address}`);
    app.log.info(`Environment: ${config.NODE_ENV}`);

    // Trigger (a): sweep every 5 minutes while the process is alive
    sweepTimer = setupSweepInterval(prisma, {
      postReply: async (issueId, kind, body, memberId) => {
        await postBotComment(issueId, kind, body, memberId, { prismaClient: prisma });
      },
    });
    app.log.info("Expiry sweep interval started (every 5 minutes).");
  } catch (err) {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

void start();

