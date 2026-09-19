/**
 * oauthState.ts — Phase B5
 *
 * In-memory OAuth state store per CONTEXT.md § 9.8:
 *   - Cryptographically random, single-use, expires in 10 minutes
 *   - Bound to the browser session (we embed the state in the redirect URL and verify on return)
 *   - Consuming the state marks it as used; re-use is rejected
 */

import crypto from "node:crypto";

export const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StateEntry {
  state: string;
  createdAt: number;
  used: boolean;
}

/**
 * We use an in-memory Map for the state store.
 * Single-process assumption is fine for this scale; if horizontal scaling is needed
 * a Redis store can replace this without changing the interface.
 */
const stateStore = new Map<string, StateEntry>();

/** Periodic cleanup of expired entries (every 5 minutes) */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of stateStore.entries()) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(pruneExpired, 5 * 60 * 1000).unref?.();
}

/**
 * Generates and stores a new cryptographically-random OAuth state value.
 * Returns the state string to embed in the GitHub OAuth redirect URL.
 */
export function generateOauthState(): string {
  const state = crypto.randomBytes(32).toString("hex");
  stateStore.set(state, {
    state,
    createdAt: Date.now(),
    used: false,
  });
  return state;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "absent" | "expired" | "reused" };

/**
 * Validates and consumes an OAuth state parameter.
 * A state can only be consumed once (single-use).
 * Returns the reason for rejection if invalid.
 */
export function consumeOauthState(state: string | undefined): ConsumeResult {
  if (!state) return { ok: false, reason: "absent" };

  const entry = stateStore.get(state);
  if (!entry) return { ok: false, reason: "absent" };

  if (entry.used) return { ok: false, reason: "reused" };

  if (Date.now() - entry.createdAt > STATE_TTL_MS) {
    stateStore.delete(state);
    return { ok: false, reason: "expired" };
  }

  // Mark as used (single-use)
  entry.used = true;
  return { ok: true };
}

/** Test helper: directly inject a state entry with custom properties */
export function _testInjectState(state: string, entry: Partial<StateEntry>): void {
  stateStore.set(state, {
    state,
    createdAt: Date.now(),
    used: false,
    ...entry,
  });
}

/** Test helper: clear all states */
export function _testClearStates(): void {
  stateStore.clear();
}
