import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberDashboard } from "../pages/MemberDashboard.js";
import { IssueBoard } from "../pages/IssueBoard.js";
import { MemberLeaderboard } from "../pages/MemberLeaderboard.js";
import { TeamLeaderboard } from "../pages/TeamLeaderboard.js";
import { DashboardData, UserAuth } from "../types.js";

describe("Empty States Verification", () => {
  const mockUser: UserAuth = {
    memberId: "user-1",
    githubLogin: "freshdev",
    displayName: "Fresh Dev",
    department: "pr",
    team: "NEXUS",
    tier: "general",
    isAdmin: false,
  };

  const emptyDashboardData: DashboardData = {
    member: {
      id: "user-1",
      githubLogin: "freshdev",
      displayName: "Fresh Dev",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    },
    scoring: {
      raw: 0,
      capped: 0,
      tierCap: 80,
      capReached: false,
      totalPrs: 0,
      mergedPrs: 0,
      prBreakdown: [],
    },
    limits: {
      activeClaimsCount: 0,
      maxActiveSlots: 2,
      freeActiveSlots: 2,
      easyClaimsCount: 0,
      maxEasyClaims: 3,
      easyRemaining: 3,
      isTech: false,
      techCannotClaimEasy: false,
    },
    activeClaims: [],
    waitlistEntries: [],
    historyClaims: [],
  };

  it("renders empty state for new participant dashboard with no claims or PRs", () => {
    render(<MemberDashboard user={mockUser} initialData={emptyDashboardData} />);

    // Check empty active claims message
    expect(screen.getByTestId("empty-active-claims")).toBeInTheDocument();
    expect(screen.getByText(/You currently have no active claims/i)).toBeInTheDocument();

    // Check empty waitlist message
    expect(screen.getByTestId("empty-waitlist")).toBeInTheDocument();
    expect(screen.getByText(/You are not currently in any waiting queues/i)).toBeInTheDocument();

    // Check empty PRs breakdown message
    expect(screen.getByTestId("empty-prs")).toBeInTheDocument();
    expect(screen.getByText(/No pull requests recorded yet/i)).toBeInTheDocument();
  });

  it("renders empty state on IssueBoard when no issues match filters", () => {
    render(<IssueBoard user={mockUser} initialData={[]} />);

    expect(screen.getByText(/No issues match your current filters/i)).toBeInTheDocument();
  });

  it("renders empty state on MemberLeaderboard when no participants match", () => {
    render(<MemberLeaderboard initialData={[]} />);

    expect(screen.getByText(/No members match the selected filters/i)).toBeInTheDocument();
  });

  it("renders empty state on TeamLeaderboard when no team data exists", () => {
    render(<TeamLeaderboard initialData={[]} />);

    expect(screen.getByText(/No team standings recorded yet/i)).toBeInTheDocument();
  });
});
