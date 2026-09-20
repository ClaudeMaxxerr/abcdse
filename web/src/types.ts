export type Department = "technical" | "pr" | "research_and_development" | "event_management" | "social_and_design";
export type Team = "NEXUS" | "CIPHER" | "BYTE_BRIGADE" | "ASCEND" | "ECHO";
export type Tier = "tech" | "general";
export type Level = "easy" | "medium" | "hard";

export interface TeamScore {
  team: Team;
  teamName: string;
  challengeTotal: number;
  totalPrs: number;
  mergedPrs: number;
  bonuses: {
    winner: boolean | number;
    runnerUp: boolean | number;
    mostParticipation: boolean | number;
    totalBonus: number;
    bonusPoints?: number;
  };
  grandTotal: number;
  members: MemberScore[];
}

export interface TeamLeaderboardResponse {
  teams: TeamScore[];
  isEventOver?: boolean;
  finalDeadline?: string | null;
}

export interface MemberScore {
  memberId: string;
  displayName: string;
  githubLogin: string;
  department: Department;
  team: Team;
  tier: Tier;
  raw: number;
  tierCap: number;
  capped: number;
  totalPrs: number;
  mergedPrs: number;
}

export interface PrBreakdownItem {
  prId: string;
  issueId: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  level: Level;
  prNumber: number;
  status: "raised" | "merged" | "closed";
  pointsAwarded: number;
  createdAt: string;
  mergedAt: string | null;
}

export interface IssueClaim {
  id: string;
  memberId: string;
  displayName: string;
  githubLogin: string;
  team: Team;
  status: "active" | "pr_raised" | "merged" | "expired";
  createdAt: string;
  deadline: string;
  isExpired: boolean;
}

export interface IssueWaitlistEntry {
  id: string;
  queuePosition: number;
  displayName: string;
  githubLogin: string;
  team: Team;
}

export interface IssueItem {
  id: string;
  repoOwner: string;
  repoName: string;
  number: number;
  title: string;
  level: Level;
  spotsTotal: number;
  spotsTaken: number;
  isAvailable: boolean;
  githubUrl: string;
  claimTemplate: string;
  occupiedTeams: Team[];
  claims: IssueClaim[];
  waitlistCount: number;
  waitlist: IssueWaitlistEntry[];
}

export interface UserAuth {
  memberId: string;
  githubLogin: string;
  displayName: string;
  department: Department;
  team: Team;
  tier: Tier;
  isAdmin: boolean;
}

export interface DashboardData {
  member: {
    id: string;
    githubLogin: string;
    displayName: string;
    department: Department;
    team: Team;
    tier: Tier;
    isAdmin: boolean;
    canEditProfile?: boolean;
  };
  scoring: {
    raw: number;
    capped: number;
    tierCap: number;
    potentialPoints?: number;
    capReached: boolean;
    totalPrs: number;
    mergedPrs: number;
    prBreakdown: PrBreakdownItem[];
  };
  limits: {
    activeClaimsCount: number;
    maxActiveSlots: number;
    freeActiveSlots: number;
    easyClaimsCount: number;
    maxEasyClaims: number;
    easyRemaining: number;
    isTech: boolean;
    techCannotClaimEasy: boolean;
    committedClaimsCount?: number;
    claimsNeededToReachCap?: number;
    maxClaimsAllowed?: number | null;
    isClaimBlockedByCap?: boolean;
    capCoveredBlockedReason?: string | null;
  };
  activeClaims: Array<{
    id: string;
    issueId: string;
    repoOwner: string;
    repoName: string;
    issueNumber: number;
    issueTitle: string;
    level: Level;
    status: string;
    createdAt: string;
    deadline: string;
    githubUrl: string;
  }>;
  waitlistEntries: Array<{
    id: string;
    issueId: string;
    queuePosition: number;
    repoOwner: string;
    repoName: string;
    issueNumber: number;
    issueTitle: string;
    level: Level;
    createdAt: string;
    githubUrl: string;
  }>;
  historyClaims: Array<{
    id: string;
    issueId: string;
    repoOwner: string;
    repoName: string;
    issueNumber: number;
    issueTitle: string;
    level: Level;
    status: string;
    createdAt: string;
    deadline: string;
  }>;
}

export interface TeamDetailMember {
  member: {
    id: string;
    displayName: string;
    githubLogin: string;
    department: Department;
    tier: Tier;
    tierCap: number;
    cap: number;
  };
  raw: number;
  capped: number;
  potentialPoints: number;
  totalPrs: number;
  mergedPrs: number;
  activeClaims: Array<{
    id: string;
    issueId: string;
    repo: string;
    repoOwner: string;
    repoName: string;
    issueNumber: number;
    issueTitle: string;
    title: string;
    level: Level;
    claimedAt: string;
    deadline: string;
  }>;
  prs: Array<{
    id: string;
    prNumber: number;
    repo: string;
    repoName: string;
    issueNumber: number;
    linkedIssueNumber: number;
    issueTitle: string;
    title: string;
    level: Level;
    points: number;
    currentValue: number;
    merged: boolean;
    countsForScore: boolean;
    openedAt: string;
  }>;
}

export interface TeamDetailResponse {
  statusCode: number;
  team: Team;
  teamName: string;
  challengeTotal: number;
  totalPrs: number;
  mergedPrs: number;
  rollup: {
    activeClaims: { easy: number; medium: number; hard: number; total: number };
    prs: { easy: number; medium: number; hard: number; total: number };
    mergedPrs: { easy: number; medium: number; hard: number; total: number };
  };
  members: TeamDetailMember[];
}
