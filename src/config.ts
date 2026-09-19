import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

// Load environment variables from .env file into process.env before parsing
dotenvConfig();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z
    .string()
    .default("3000")
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid PORT number: ${val}`);
      }
      return parsed;
    }),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((url) => url.startsWith("postgresql://") || url.startsWith("postgres://"), {
      message: "DATABASE_URL must be a valid PostgreSQL connection string",
    })
    .refine((url) => url.includes("pgbouncer=true"), {
      message: "DATABASE_URL must carry '?pgbouncer=true' for Supabase transaction pooler support",
    }),
  DIRECT_URL: z
    .string()
    .min(1, "DIRECT_URL is required")
    .refine((url) => url.startsWith("postgresql://") || url.startsWith("postgres://"), {
      message: "DIRECT_URL must be a valid PostgreSQL connection string",
    }),
  TEST_DATABASE_URL: z
    .string()
    .optional()
    .refine((url) => !url || url.includes("schema=patchwars_test"), {
      message: "TEST_DATABASE_URL must include '?schema=patchwars_test' (or '&schema=patchwars_test')",
    }),
  TEST_DIRECT_URL: z
    .string()
    .optional()
    .refine((url) => !url || url.includes("schema=patchwars_test"), {
      message: "TEST_DIRECT_URL must include '?schema=patchwars_test' (or '&schema=patchwars_test')",
    }),
  ADMIN_GITHUB_USER_IDS: z
    .string()
    .min(1, "ADMIN_GITHUB_USER_IDS is required")
    .transform((val) => {
      const ids = val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          try {
            return BigInt(s);
          } catch {
            throw new Error(`Invalid numeric GitHub user ID in ADMIN_GITHUB_USER_IDS: '${s}'`);
          }
        });
      if (ids.length === 0) {
        throw new Error("ADMIN_GITHUB_USER_IDS must contain at least one numeric GitHub user ID");
      }
      return ids;
    }),
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN is required")
    .transform((val) => {
      const origins = val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (origins.length === 0) {
        throw new Error("CORS_ORIGIN must contain at least one allowed origin");
      }
      if (origins.includes("*")) {
        throw new Error("Wildcard '*' is strictly forbidden in CORS_ORIGIN for security");
      }
      return origins;
    }),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters long for cryptographic security"),
  
  // Future phases optional credentials
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional().default("163014815"),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Phase B3 — claim engine
  // Shared secret for POST /internal/sweep (used by external schedulers)
  SWEEP_SECRET: z.string().optional(),
  // Numeric GitHub User ID of the bot's own user account (to ignore self-comments)
  GITHUB_APP_BOT_USER_ID: z
    .string()
    .optional()
    .transform((val) => (val ? BigInt(val) : undefined)),

  // Phase B4 — PR tracking and scoring
  // Any PR merged after this timestamp scores zero
  FINAL_DEADLINE: z
    .string()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),

  // Phase B7 — dynamic TTL and bot dry-run configuration
  CLAIM_TTL_HOURS: z
    .string()
    .default("48")
    .transform((val) => {
      const parsed = parseFloat(val);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid CLAIM_TTL_HOURS: '${val}' (must be a positive number)`);
      }
      return parsed;
    }),
  BOT_DRY_RUN: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function parseConfig(envInput: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(envInput);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => ` - [${issue.path.join(".")}]: ${issue.message}`)
      .join("\n");
    throw new Error(
      `\n==================================================\nCONFIGURATION ERROR: Missing or invalid environment variables:\n${errorDetails}\n==================================================\n`
    );
  }
  return result.data;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    try {
      cachedConfig = parseConfig(process.env);
    } catch (err) {
      // In test mode, allow tests to handle exception; in runtime, log and exit
      if (process.env["NODE_ENV"] !== "test") {
        console.error((err as Error).message);
        process.exit(1);
      }
      throw err;
    }
  }
  return cachedConfig;
}

export const config = getConfig();
