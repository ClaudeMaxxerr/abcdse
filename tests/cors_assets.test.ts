/**
 * cors_assets.test.ts
 *
 * Tests verifying CORS scoping, non-throwing origin handling, and static asset serving
 * under various Origin headers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

describe("CORS and Static Assets Origin Handling", () => {
  let app: FastifyInstance;

  const testAssetPath = path.resolve(process.cwd(), "web/dist/assets/test-asset.css");

  beforeEach(async () => {
    // Ensure test asset exists in web/dist/assets
    const testAssetDir = path.dirname(testAssetPath);
    fs.mkdirSync(testAssetDir, { recursive: true });
    fs.writeFileSync(
      testAssetPath,
      "body { background-color: #0d1117; }",
      "utf-8"
    );

    const mockPrisma = {
      issue: {
        findMany: async () => [],
      },
      $queryRaw: async () => [{ 1: 1 }],
    } as any;

    app = await buildApp({
      prismaClient: mockPrisma,
      disableLogging: true,
      webhookSecret: "test-webhook-secret",
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (fs.existsSync(testAssetPath)) {
      try {
        fs.unlinkSync(testAssetPath);
      } catch {}
    }
  });

  it("serves static asset WITH Origin header matching deployed domain (200 OK + body)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assets/test-asset.css",
      headers: {
        origin: "https://patch-wars-tracker.onrender.com",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body).toContain("background-color");
  });

  it("serves static asset WITH unknown Origin header (200 OK, not 500)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assets/test-asset.css",
      headers: {
        origin: "https://evil.example.com",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body).toContain("background-color");
  });

  it("API route with unrecognized origin returns 200 without 5xx and without CORS headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/issues",
      headers: {
        origin: "https://evil.example.com",
      },
    });

    // Must never return 500 on unrecognised origin
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("API route with allowed origin returns 200 WITH CORS headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/issues",
      headers: {
        origin: "https://patch-wars-tracker.onrender.com",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://patch-wars-tracker.onrender.com");
  });
});
