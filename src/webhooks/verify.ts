import crypto from "node:crypto";

/**
 * Computes the expected GitHub X-Hub-Signature-256 header value for a given raw body.
 */
export function computeHubSignature256(rawBody: Buffer, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verifies GitHub X-Hub-Signature-256 HMAC-SHA256 over raw body bytes.
 * Uses crypto.timingSafeEqual for constant-time comparison to prevent timing attacks.
 * Rejects absent, invalid format, length mismatch, or signature mismatch.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }

  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const providedHex = signatureHeader.slice(7).trim();
  if (providedHex.length !== 64) {
    // SHA256 hex digest is exactly 64 characters (32 bytes)
    return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf-8");

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(bodyBuffer);
  const expectedBuffer = hmac.digest();

  let providedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}
