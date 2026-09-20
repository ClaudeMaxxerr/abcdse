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
    winner: number;
    runnerUp: number;
    mostParticipation: number;
    totalBonus: number;
  };
  grandTotal: number;
  members: MemberScore[];
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
