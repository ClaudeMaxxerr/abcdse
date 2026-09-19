import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TeamLeaderboard } from "../pages/TeamLeaderboard.js";
import { MemberLeaderboard } from "../pages/MemberLeaderboard.js";
import { IssueBoard } from "../pages/IssueBoard.js";
import { MemberDashboard } from "../pages/MemberDashboard.js";
import { TeamScore, MemberScore, IssueItem, DashboardData, UserAuth } from "../types.js";

describe("Public & Authenticated Pages Comprehensive Rendering", () => {
  const mockTeamData: TeamScore[] = [
    {
      team: "NEXUS",
      teamName: "Team Nexus",
      challengeTotal: 210,
      totalPrs: 15,
      mergedPrs: 12,
      bonuses: {
        winner: 0,
        runnerUp: 0,
        mostParticipation: 35,
        totalBonus: 35,
      },
      grandTotal: 245,
      members: [
        {
          memberId: "alice-id",
          displayName: "Alice Smith",
          githubLogin: "alice",
          department: "technical",
          team: "NEXUS",
          tier: "tech",
          raw: 75,
          tierCap: 60,
          capped: 60,
          totalPrs: 4,
          mergedPrs: 4,
        },
      ],
    },
    {
      team: "CIPHER",
      teamName: "Team Cipher",
      challengeTotal: 170,
      totalPrs: 10,
      mergedPrs: 8,
      bonuses: {
        winner: 0,
        runnerUp: 0,
        mostParticipation: 15,
        totalBonus: 15,
      },
      grandTotal: 185,
      members: [],
    },
  ];

  const mockMemberData: MemberScore[] = [
    {
      memberId: "alice-id",
      displayName: "Alice Smith",
      githubLogin: "alice",
      department: "technical",
      team: "NEXUS",
      tier: "tech",
      raw: 75,
      tierCap: 60,
      capped: 60,
      totalPrs: 4,
      mergedPrs: 4,
    },
    {
      memberId: "bob-id",
      displayName: "Bob Jones",
      githubLogin: "bobjones",
      department: "events",
      team: "CIPHER",
      tier: "general",
      raw: 30,
      tierCap: 80,
      capped: 30,
      totalPrs: 2,
      mergedPrs: 2,
    },
  ];

  const mockIssues: IssueItem[] = [
    {
      id: "issue-1",
      repoOwner: "org",
      repoName: "client-sdk",
      number: 101,
      title: "Fix authentication header encoding",
      level: "easy",
      spotsTotal: 1,
      spotsTaken: 0,
      isAvailable: true,
      githubUrl: "https://github.com/org/client-sdk/issues/101",
      claimTemplate: "Claiming this issue",
      claims: [],
      occupiedTeams: [],
      waitlistCount: 0,
      waitlist: [],
    },
    {
      id: "issue-2",
      repoOwner: "org",
      repoName: "backend-core",
      number: 202,
      title: "Implement redis cluster failover",
      level: "hard",
      spotsTotal: 3,
      spotsTaken: 2,
      isAvailable: true,
      githubUrl: "https://github.com/org/backend-core/issues/202",
      claimTemplate: "Claiming this issue",
      claims: [
        {
          id: "claim-10",
          memberId: "alice-id",
          githubLogin: "alice",
          displayName: "Alice Smith",
          team: "NEXUS",
          status: "active",
          createdAt: new Date().toISOString(),
          deadline: new Date(Date.now() + 3600000 * 5).toISOString(),
          isExpired: false,
        },
      ],
      occupiedTeams: ["NEXUS"],
      waitlistCount: 1,
      waitlist: [],
    },
  ];

  const mockTechUser: UserAuth = {
    memberId: "user-tech",
    githubLogin: "alice",
    displayName: "Alice Smith",
    department: "technical",
    team: "NEXUS",
    tier: "tech",
    isAdmin: false,
  };

  const mockDashboardData: DashboardData = {
    member: {
      id: "user-tech",
      githubLogin: "alice",
      displayName: "Alice Smith",
      department: "technical",
      team: "NEXUS",
      tier: "tech",
      isAdmin: false,
    },
    scoring: {
      raw: 75,
      capped: 60,
      tierCap: 60,
      capReached: true,
      totalPrs: 2,
      mergedPrs: 2,
      prBreakdown: [
        {
          prId: "pr-1",
          issueId: "issue-2",
          repoOwner: "org",
          repoName: "backend-core",
          issueNumber: 202,
          issueTitle: "Implement redis cluster failover (PR)",
          level: "hard",
          prNumber: 301,
          status: "merged",
          pointsAwarded: 50,
          createdAt: new Date().toISOString(),
          mergedAt: new Date().toISOString(),
        },
        {
          prId: "pr-2",
          issueId: "issue-1",
          repoOwner: "org",
          repoName: "client-sdk",
          issueNumber: 101,
          issueTitle: "Fix authentication header encoding",
          level: "medium",
          prNumber: 405,
          status: "merged",
          pointsAwarded: 25,
          createdAt: new Date().toISOString(),
          mergedAt: new Date().toISOString(),
        },
      ],
    },
    limits: {
      activeClaimsCount: 1,
      maxActiveSlots: 2,
      freeActiveSlots: 1,
      easyClaimsCount: 0,
      maxEasyClaims: 0,
      easyRemaining: 0,
      isTech: true,
      techCannotClaimEasy: true,
    },
    activeClaims: [
      {
        id: "claim-1",
        issueId: "issue-2",
        repoOwner: "org",
        repoName: "backend-core",
        issueNumber: 202,
        issueTitle: "Implement redis cluster failover",
        level: "hard",
        status: "active",
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        deadline: new Date(Date.now() + 3600000 * 5).toISOString(),
        githubUrl: "https://github.com/org/backend-core/issues/202",
      },
    ],
    waitlistEntries: [
      {
        id: "wait-1",
        issueId: "issue-3",
        queuePosition: 1,
        repoOwner: "org",
        repoName: "docs",
        issueNumber: 5,
        issueTitle: "Update SDK quickstart guides",
        level: "medium",
        createdAt: new Date().toISOString(),
        githubUrl: "https://github.com/org/docs/issues/5",
      },
    ],
    historyClaims: [],
  };

  it("renders Team Leaderboard with rank, scores, and expandable member breakdown", () => {
    render(<TeamLeaderboard initialData={mockTeamData} />);

    expect(screen.getByText("Team Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Team Nexus")).toBeInTheDocument();
    expect(screen.getByText("Team Cipher")).toBeInTheDocument();

    // Check rank 1 final score
    expect(screen.getByText("245")).toBeInTheDocument();
    expect(screen.getByText("+35 pts")).toBeInTheDocument();

    // Click on team row to expand member breakdown
    const teamRow = screen.getByText("Team Nexus");
    fireEvent.click(teamRow);

    expect(screen.getByText(/Team Nexus — Member Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/★ TIER CAP REACHED \(75 raw\)/i)).toBeInTheDocument();
  });

  it("renders Member Leaderboard with explicit Cap indicator and scores", () => {
    render(<MemberLeaderboard initialData={mockMemberData} />);

    expect(screen.getByText("Member Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();

    // Alice is at cap (60)
    expect(screen.getByText(/Tier Cap Reached \(60 pts\)/i)).toBeInTheDocument();
  });

  it("renders Issue Board with issues and proactive rule warnings", () => {
    render(<IssueBoard user={mockTechUser} initialData={mockIssues} />);

    expect(screen.getByText(/Issue Board/i)).toBeInTheDocument();
    expect(screen.getByText("Fix authentication header encoding")).toBeInTheDocument();
    expect(screen.getByText("Implement redis cluster failover")).toBeInTheDocument();

    // Alice is in Technical department, so proactive warning is shown
    expect(screen.getByText(/Technical department members are strictly forbidden from claiming Easy issues/i)).toBeInTheDocument();
  });

  it("renders Member Dashboard with claim countdowns, cap fixture, and waitlist position", () => {
    render(<MemberDashboard user={mockTechUser} initialData={mockDashboardData} />);

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByTestId("cap-hit-badge")).toBeInTheDocument();
    expect(screen.getByText(/TECH tier ceiling \(60 pts\)/i)).toBeInTheDocument();

    // Check active claim rendered with deadline countdown
    expect(screen.getByText("Implement redis cluster failover")).toBeInTheDocument();
    expect(screen.getByTestId("countdown-active")).toBeInTheDocument();

    // Check waitlist position
    expect(screen.getByText("Position #1")).toBeInTheDocument();

    // Check PR breakdown
    expect(screen.getByText(/Pull Requests & Scoring Breakdown \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText("+50 pts")).toBeInTheDocument();
    expect(screen.getByText("+25 pts")).toBeInTheDocument();
  });
});
