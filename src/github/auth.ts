import crypto from "node:crypto";

export interface GitHubAppAuthConfig {
  appId: string;
  privateKey: string;
  installationId?: string;
}

export interface CachedInstallationToken {
  token: string;
  expiresAt: Date;
}

function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.isBuffer(data) ? data.toString("base64") : Buffer.from(data).toString("base64");
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Mints an RS256 JWT for GitHub App authentication.
 * Valid for up to 10 minutes, with a 60-second backdate to allow for clock drift.
 */
export function mintAppJwt(appId: string, privateKeyPem: string, currentTimeMs = Date.now()): string {
  const nowSec = Math.floor(currentTimeMs / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iat: nowSec - 60,
    exp: nowSec + 600, // 10 minutes maximum
    iss: appId,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(message);
  const signature = signer.sign(privateKeyPem);
  const encodedSignature = base64UrlEncode(signature);

  return `${message}.${encodedSignature}`;
}

/**
 * Token manager that caches installation tokens and automatically refreshes them
 * before expiry (default: refreshes if less than 5 minutes remaining).
 */
export class GitHubAppTokenManager {
  private cachedToken: CachedInstallationToken | null = null;
  private refreshThresholdMs: number;

  constructor(
    private config: GitHubAppAuthConfig,
    refreshThresholdMs = 5 * 60 * 1000,
    private fetchFn: typeof fetch = globalThis.fetch
  ) {
    this.refreshThresholdMs = refreshThresholdMs;
  }

  public isTokenExpiringSoon(currentTimeMs = Date.now()): boolean {
    if (!this.cachedToken) {
      return true;
    }
    const timeUntilExpiry = this.cachedToken.expiresAt.getTime() - currentTimeMs;
    return timeUntilExpiry <= this.refreshThresholdMs;
  }

  public getCachedToken(): CachedInstallationToken | null {
    return this.cachedToken;
  }

  public setCachedToken(token: string, expiresAt: Date): void {
    this.cachedToken = { token, expiresAt };
  }

  /**
   * Retrieves an installation access token, refreshing it automatically if expired
   * or within the refresh threshold window.
   */
  public async getInstallationToken(installationId?: string, currentTimeMs = Date.now()): Promise<string> {
    const targetInstallationId = installationId ?? this.config.installationId;
    if (!targetInstallationId) {
      throw new Error("GitHub App installation ID is required to fetch installation token");
    }

    if (this.cachedToken && !this.isTokenExpiringSoon(currentTimeMs)) {
      return this.cachedToken.token;
    }

    // Refresh token
    const jwt = mintAppJwt(this.config.appId, this.config.privateKey, currentTimeMs);
    const response = await this.fetchFn(
      `https://api.github.com/app/installations/${targetInstallationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "PatchWars-Tracker-2026",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to exchange JWT for installation access token: HTTP ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { token: string; expires_at: string };
    const expiresAt = new Date(data.expires_at);

    this.setCachedToken(data.token, expiresAt);
    return data.token;
  }
}
