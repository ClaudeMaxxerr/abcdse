import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { mintAppJwt, GitHubAppTokenManager } from "../src/github/auth.js";
import { GitHubApiClient } from "../src/github/client.js";

describe("GitHub App Authentication & Installation Token Manager", () => {
  // Generate real RSA keypair for JWT signing tests
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const appId = "123456";
  const installationId = "7891011";

  it("mints a valid RS256 JWT with correct claims", () => {
    const now = Date.now();
    const jwt = mintAppJwt(appId, privateKey, now);

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf-8"));
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"));

    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
    expect(payload.iss).toBe(appId);
    expect(payload.iat).toBe(Math.floor(now / 1000) - 60);
    expect(payload.exp).toBe(Math.floor(now / 1000) + 600);
  });

  it("installation token refresh triggers before expiry", async () => {
    let fetchCalls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          token: `token-v${fetchCalls}`,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour lifetime
        }),
      } as any;
    });

    const tokenManager = new GitHubAppTokenManager(
      { appId, privateKey, installationId },
      5 * 60 * 1000, // 5 min refresh threshold
      mockFetch
    );

    // Initial fetch
    const t1 = await tokenManager.getInstallationToken();
    expect(t1).toBe("token-v1");
    expect(fetchCalls).toBe(1);

    // Call again within valid window -> returns cached token without calling API
    const t2 = await tokenManager.getInstallationToken();
    expect(t2).toBe("token-v1");
    expect(fetchCalls).toBe(1);

    // Advance simulated time to 4 minutes before expiry (inside 5 min threshold)
    const simulatedFutureMs = Date.now() + 56 * 60 * 1000;
    expect(tokenManager.isTokenExpiringSoon(simulatedFutureMs)).toBe(true);

    // Call tokenManager at simulated future time -> triggers token refresh before expiry!
    const t3 = await tokenManager.getInstallationToken(installationId, simulatedFutureMs);
    expect(t3).toBe("token-v2");
    expect(fetchCalls).toBe(2);
  });

  it("thin client retries on 5xx errors and respects rate limits", async () => {
    let attempts = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        // First attempt: simulate 503 Service Unavailable
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "Service Unavailable",
        } as any;
      }
      if (attempts === 2) {
        // Second attempt: simulate 429 Too Many Requests with Retry-After: 1
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "1" }),
          text: async () => "Rate limit reached",
        } as any;
      }
      // Third attempt: success
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ id: 42, title: "Success" }),
      } as any;
    });

    const sleepCalls: number[] = [];
    const mockSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const client = new GitHubApiClient({
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      maxRetries: 3,
    });

    const res = await client.request<{ id: number }>("/repos/test/test/issues/1");
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(42);
    expect(attempts).toBe(3);
    expect(sleepCalls.length).toBe(2);
  });
});
