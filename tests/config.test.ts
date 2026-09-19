import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

describe("Configuration Validation", () => {
  const validBaseEnv = {
    NODE_ENV: "test",
    PORT: "3000",
    HOST: "127.0.0.1",
    DATABASE_URL: "postgresql://user:pass@pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5",
    DIRECT_URL: "postgresql://user:pass@db.supabase.co:5432/postgres",
    ADMIN_GITHUB_USER_IDS: "174175300, 999888777",
    CORS_ORIGIN: "http://localhost:3000,http://127.0.0.1:3000",
    SESSION_SECRET: "a_very_secure_secret_that_is_at_least_32_characters_long_12345",
  };

  it("successfully parses valid environment variables", () => {
    const config = parseConfig(validBaseEnv);
    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.DATABASE_URL).toContain("pgbouncer=true");
    expect(config.ADMIN_GITHUB_USER_IDS).toEqual([174175300n, 999888777n]);
    expect(config.CORS_ORIGIN).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
    expect(config.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects missing DATABASE_URL", () => {
    const env = { ...validBaseEnv, DATABASE_URL: undefined };
    expect(() => parseConfig(env)).toThrow(/DATABASE_URL/);
  });

  it("rejects DATABASE_URL without pgbouncer=true flag", () => {
    const env = {
      ...validBaseEnv,
      DATABASE_URL: "postgresql://user:pass@pooler.supabase.com:6543/postgres",
    };
    expect(() => parseConfig(env)).toThrow(/pgbouncer=true/);
  });

  it("rejects missing DIRECT_URL", () => {
    const env = { ...validBaseEnv, DIRECT_URL: undefined };
    expect(() => parseConfig(env)).toThrow(/DIRECT_URL/);
  });

  it("rejects non-numeric ADMIN_GITHUB_USER_IDS", () => {
    const env = { ...validBaseEnv, ADMIN_GITHUB_USER_IDS: "not_a_number" };
    expect(() => parseConfig(env)).toThrow(/Invalid numeric GitHub user ID/);
  });

  it("rejects wildcard '*' in CORS_ORIGIN for security", () => {
    const env = { ...validBaseEnv, CORS_ORIGIN: "*" };
    expect(() => parseConfig(env)).toThrow(/Wildcard '\*' is strictly forbidden/);
  });

  it("rejects SESSION_SECRET shorter than 32 characters", () => {
    const env = { ...validBaseEnv, SESSION_SECRET: "short_secret" };
    expect(() => parseConfig(env)).toThrow(/at least 32 characters/);
  });

  it("rejects invalid PORT numbers", () => {
    const env = { ...validBaseEnv, PORT: "99999" };
    expect(() => parseConfig(env)).toThrow(/Invalid PORT number/);
  });

  it("defaults CLAIM_TTL_HOURS to 48 when unspecified", () => {
    const config = parseConfig(validBaseEnv);
    expect(config.CLAIM_TTL_HOURS).toBe(48);
  });

  it("parses valid custom CLAIM_TTL_HOURS", () => {
    const env = { ...validBaseEnv, CLAIM_TTL_HOURS: "72" };
    const config = parseConfig(env);
    expect(config.CLAIM_TTL_HOURS).toBe(72);
  });

  it("rejects invalid CLAIM_TTL_HOURS (non-positive or NaN)", () => {
    expect(() => parseConfig({ ...validBaseEnv, CLAIM_TTL_HOURS: "0" })).toThrow(/CLAIM_TTL_HOURS/);
    expect(() => parseConfig({ ...validBaseEnv, CLAIM_TTL_HOURS: "-5" })).toThrow(/CLAIM_TTL_HOURS/);
    expect(() => parseConfig({ ...validBaseEnv, CLAIM_TTL_HOURS: "abc" })).toThrow(/CLAIM_TTL_HOURS/);
  });
});
