import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

describe("Health Check and Baseline Routes", () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("GET /health returns 200 and connected status when database is reachable", async () => {
    // Mock DB client returning successful query
    const mockPrismaSuccess = {
      $queryRaw: async () => [{ 1: 1 }],
    } as any;

    app = await buildApp({ prismaClient: mockPrismaSuccess, disableLogging: true });

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
  });

  it("GET /health returns 503 and disconnected status when database is unreachable", async () => {
    // Mock DB client simulating connection failure
    const mockPrismaFailure = {
      $queryRaw: async () => {
        throw new Error("Connection refused: database server down");
      },
    } as any;

    const failApp = await buildApp({ prismaClient: mockPrismaFailure, disableLogging: true });

    const response = await failApp.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("error");
    expect(body.db).toBe("disconnected");
    expect(body.message).toBe("Database unreachable");

    await failApp.close();
  });

  it("serves static index.html for unmatched non-API SPA routes", async () => {
    const mockPrisma = {
      $queryRaw: async () => [{ 1: 1 }],
    } as any;

    const testApp = await buildApp({ prismaClient: mockPrisma, disableLogging: true });

    const response = await testApp.inject({
      method: "GET",
      url: "/leaderboard",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Patch Wars 2026");

    await testApp.close();
  });

  it("returns 404 JSON for unmatched /api routes", async () => {
    const mockPrisma = {
      $queryRaw: async () => [{ 1: 1 }],
    } as any;

    const testApp = await buildApp({ prismaClient: mockPrisma, disableLogging: true });

    const response = await testApp.inject({
      method: "GET",
      url: "/api/unknown-endpoint",
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Not Found");

    await testApp.close();
  });
});
