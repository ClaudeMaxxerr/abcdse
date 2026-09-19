import { GitHubAppTokenManager } from "./auth.js";

export interface GitHubClientOptions {
  tokenManager?: GitHubAppTokenManager;
  installationId?: string;
  baseUrl?: string;
  maxRetries?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export class GitHubApiClient {
  private tokenManager?: GitHubAppTokenManager;
  private installationId?: string;
  private baseUrl: string;
  private maxRetries: number;
  private fetchFn: typeof fetch;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(options: GitHubClientOptions = {}) {
    this.tokenManager = options.tokenManager;
    this.installationId = options.installationId;
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Executes an authenticated request to the GitHub API with rate limit handling and 5xx retries.
   */
  public async request<T = unknown>(
    endpoint: string,
    init: RequestInit = {}
  ): Promise<{ status: number; data: T; headers: Headers }> {
    let token: string | undefined;
    if (this.tokenManager) {
      token = await this.tokenManager.getInstallationToken(this.installationId);
    }

    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    
    let attempt = 0;

    while (true) {
      const headers = new Headers(init.headers);
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `token ${token}`);
      }
      if (!headers.has("Accept")) {
        headers.set("Accept", "application/vnd.github.v3+json");
      }
      if (!headers.has("User-Agent")) {
        headers.set("User-Agent", "PatchWars-Tracker-2026");
      }

      const response = await this.fetchFn(url, {
        ...init,
        headers,
      });

      // 1. Success
      if (response.ok) {
        let data: T;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          data = (await response.json()) as T;
        } else {
          data = (await response.text()) as unknown as T;
        }
        return { status: response.status, data, headers: response.headers };
      }

      // 2. Rate Limit Handling (Primary & Secondary)
      const isRateLimit =
        response.status === 403 ||
        response.status === 429;

      if (isRateLimit && attempt < this.maxRetries) {
        attempt++;
        let waitMs = 1000 * Math.pow(2, attempt);

        // Secondary rate limit: Retry-After header (seconds)
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds) && seconds > 0) {
            waitMs = seconds * 1000;
          }
        } else {
          // Primary rate limit: x-ratelimit-reset (unix timestamp in seconds)
          const resetHeader = response.headers.get("x-ratelimit-reset");
          const remainingHeader = response.headers.get("x-ratelimit-remaining");
          if (resetHeader && remainingHeader === "0") {
            const resetTimeSec = parseInt(resetHeader, 10);
            if (!isNaN(resetTimeSec)) {
              const diffMs = resetTimeSec * 1000 - Date.now();
              if (diffMs > 0 && diffMs < 60000) { // cap sleep to 60s for reasonable timeout
                waitMs = diffMs + 500;
              }
            }
          }
        }

        await this.sleepFn(waitMs);
        continue;
      }

      // 3. 5xx Server Errors (Temporary GitHub outage)
      if (response.status >= 500 && attempt < this.maxRetries) {
        attempt++;
        const backoffMs = 1000 * Math.pow(2, attempt);
        await this.sleepFn(backoffMs);
        continue;
      }

      // If we reach here, request failed and retries exhausted
      const errorText = await response.text();
      throw new Error(`GitHub API error ${response.status} on ${init.method || "GET"} ${url}: ${errorText}`);
    }
  }

  /**
   * Helper to post a comment on an issue or pull request.
   */
  public async createIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<{ id: number; html_url: string }> {
    const result = await this.request<{ id: number; html_url: string }>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body }),
      }
    );
    return result.data;
  }
}
