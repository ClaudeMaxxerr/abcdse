/**
 * tests/setup.ts — Vitest Global Test Setup Guard
 *
 * STRUCTURAL PRODUCTION PROTECTION GUARD:
 * Tests are physically prohibited from connecting to the production database or the default schema.
 * All tests that touch Postgres MUST use TEST_DATABASE_URL containing '?schema=patchwars_test'.
 */

import { beforeAll } from "vitest";
import { config as dotenvConfig } from "dotenv";

// Load environment variables before test execution
dotenvConfig();

process.env["NODE_ENV"] = "test";

const testDbUrl = process.env["TEST_DATABASE_URL"];

if (!testDbUrl || !testDbUrl.includes("schema=patchwars_test")) {
  const errorMsg =
    "\n================================================================================\n" +
    "FATAL ERROR: TEST RUN REFUSED BY DATABASE PROTECTION GUARD\n" +
    "--------------------------------------------------------------------------------\n" +
    "Running `npm test` requires TEST_DATABASE_URL containing '?schema=patchwars_test'.\n" +
    "Tests are physically prohibited from falling back to DATABASE_URL to guarantee\n" +
    "that production data is never touched or polluted by test fixtures.\n" +
    "================================================================================\n";
  console.error(errorMsg);
  throw new Error("TEST RUN REFUSED: TEST_DATABASE_URL missing or lacking '?schema=patchwars_test'");
}

// Remove production DATABASE_URL from process.env during test runs to prevent accidental fallback
delete process.env["DATABASE_URL"];

beforeAll(() => {
  // Re-verify guard at beforeAll hook execution
  const currentTestUrl = process.env["TEST_DATABASE_URL"];
  if (!currentTestUrl || !currentTestUrl.includes("schema=patchwars_test")) {
    throw new Error("TEST RUN REFUSED: TEST_DATABASE_URL is missing '?schema=patchwars_test'");
  }
});
