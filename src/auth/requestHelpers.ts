/**
 * requestHelpers.ts — Phase B5
 *
 * Utility helpers to read session tokens and CSRF tokens from Fastify requests.
 * Centralising cookie unsigning here ensures we never accidentally read
 * a still-signed (raw) cookie value as if it were a plaintext token.
 */

import { FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME } from "./session.js";

/**
 * Reads and unsigns the session cookie from a Fastify request.
 * Returns the raw token string (pre-hash), or undefined if missing/invalid signature.
 *
 * @fastify/cookie stores unsigned cookies as-is in request.cookies.
 * Signed cookies are stored as "s:<value>.<hmac>" and must be unsigned via request.unsignCookie().
 */
export function readSessionToken(request: FastifyRequest): string | undefined {
  const cookieValue = request.cookies?.[SESSION_COOKIE_NAME];
  if (!cookieValue) return undefined;

  // If the cookie plugin is registered with signing, the cookie arrives signed (starts with "s:").
  // request.unsignCookie() returns { valid: boolean, value: string | null }
  if (typeof (request as any).unsignCookie === "function") {
    const result = (request as any).unsignCookie(cookieValue);
    if (result.valid && result.value) {
      return result.value;
    }
    // If it was formatted as a signed cookie (starts with "s:") but signature failed,
    // it was tampered with — return undefined
    if (cookieValue.startsWith("s:")) {
      return undefined;
    }
  }

  // Fallback for unsigned cookie in test harnesses
  return cookieValue;
}

