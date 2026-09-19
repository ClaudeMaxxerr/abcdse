import { TeamScore, MemberScore, IssueItem, UserAuth, DashboardData } from "./types.js";

const API_BASE = "";

export async function fetchTeamLeaderboard(): Promise<TeamScore[]> {
  const res = await fetch(`${API_BASE}/api/leaderboard/teams`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load team leaderboard: ${res.statusText}`);
  const data = await res.json();
  return data.teams || [];
}

export async function fetchMemberLeaderboard(): Promise<MemberScore[]> {
  const res = await fetch(`${API_BASE}/api/leaderboard/members`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load member leaderboard: ${res.statusText}`);
  const data = await res.json();
  return data.members || [];
}

export async function fetchIssues(): Promise<IssueItem[]> {
  const res = await fetch(`${API_BASE}/api/issues`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load issues: ${res.statusText}`);
  const data = await res.json();
  return data.issues || [];
}

export async function fetchAuthMe(): Promise<UserAuth | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

export async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch(`${API_BASE}/api/dashboard`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load dashboard: ${res.statusText}`);
  return await res.json();
}

export async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/csrf`, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.csrfToken || null;
  } catch {
    return null;
  }
}

export async function postLogout(): Promise<boolean> {
  try {
    const csrfToken = await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken || "",
      },
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function completeRegistration(department: string, team: string): Promise<boolean> {
  const csrfToken = await fetchCsrfToken();
  const res = await fetch(`${API_BASE}/api/registration/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken || "",
    },
    credentials: "include",
    body: JSON.stringify({ department, team }),
  });
  return res.ok;
}
