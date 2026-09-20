/**
 * scoring.ts — Phase B4
 *
 * Implements the derived scoring service per CONTEXT.md §§ 2.3, 2.6, 9.12.
 * Scores are DERIVED on read and NEVER stored in the database.
 */

import { PrismaClient, Team, Tier, IssueLevel, Department } from "@prisma/client";

export interface PRScoringBreakdown {
  prId: string;
  prNumber: number;
  repoName: string;
  issueNumber: number;
  level: IssueLevel;
  merged: boolean;
  countsForScore: boolean;
  points: number;
}

export interface MemberScoreResult {
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
  prBreakdown: PRScoringBreakdown[];
}

export interface TeamBonusBreakdown {
  winner: boolean;
  runnerUp: boolean;
  mostParticipation: boolean;
  totalBonus: number;
  bonusPoints: number;
}

export interface TeamScoreResult {
  team: Team;
  teamName: string;
  memberScores: MemberScoreResult[];
  challengeTotal: number;
  totalPrs: number;
  mergedPrs: number;
  bonuses: TeamBonusBreakdown;
  grandTotal: number;
}

/**
 * Point matrix per CONTEXT.md § 2.3:
 * Easy: 5 raised, 10 merged
 * Medium: 5 raised, 15 merged
 * Hard: 5 raised, 20 merged
 */
export function getPRPoints(level: IssueLevel, merged: boolean, countsForScore: boolean): number {
  if (!countsForScore) return 0;
  if (!merged) return 5;

  switch (level) {
    case IssueLevel.easy:
      return 10;
    case IssueLevel.medium:
      return 15;
    case IssueLevel.hard:
      return 20;
    default:
      return 5;
  }
}

/**
 * Tier cap per CONTEXT.md § 2.2:
 * Tech tier: 60 points max
 * General tier: 80 points max
 */
export function getTierCap(tier: Tier): number {
  return tier === Tier.tech ? 60 : 80;
}

/**
 * Derives a MemberScoreResult synchronously from loaded member data.
 */
export function computeMemberScoreFromData(member: any): MemberScoreResult {
  const prBreakdown: PRScoringBreakdown[] = (member.pullRequests || []).map((pr: any) => {
    const level = pr.issue?.level ?? IssueLevel.easy;
    const points = getPRPoints(level, pr.merged, pr.countsForScore);
    return {
      prId: pr.id,
      prNumber: pr.number,
      repoName: pr.issue?.repo?.name ?? "unknown",
      issueNumber: pr.issue?.number ?? 0,
      level,
      merged: pr.merged,
      countsForScore: pr.countsForScore,
      points,
    };
  });

  const raw = prBreakdown.reduce((sum, item) => sum + item.points, 0);
  const tierCap = getTierCap(member.tier);
  const capped = Math.min(raw, tierCap);

  const totalPrs = (member.pullRequests || []).filter((pr: any) => pr.countsForScore).length;
  const mergedPrs = (member.pullRequests || []).filter((pr: any) => pr.countsForScore && pr.merged).length;

  return {
    memberId: member.id,
    displayName: member.displayName,
    githubLogin: member.githubLogin,
    department: member.department,
    team: member.team,
    tier: member.tier,
    raw,
    tierCap,
    capped,
    totalPrs,
    mergedPrs,
    prBreakdown,
  };
}

/**
 * Calculates a single member's score and PR breakdown.
 */
export async function getMemberScore(
  db: PrismaClient | any,
  memberId: string
): Promise<MemberScoreResult> {
  const member = await db.member.findUnique({
    where: { id: memberId },
    include: {
      pullRequests: {
        include: {
          issue: {
            include: {
              repo: true,
            },
          },
        },
        orderBy: { openedAt: "asc" },
      },
    },
  });

  if (!member) {
    throw new Error(`Member with ID ${memberId} not found.`);
  }

  return computeMemberScoreFromData(member);
}

/**
 * Calculates all member scores sorted by capped score descending.
 * Uses a single batch query rather than N+1 queries.
 */
export async function getAllMemberScores(
  db: PrismaClient | any
): Promise<MemberScoreResult[]> {
  const members = await db.member.findMany({
    include: {
      pullRequests: {
        include: {
          issue: {
            include: {
              repo: true,
            },
          },
        },
        orderBy: { openedAt: "asc" },
      },
    },
  });

  let scores: MemberScoreResult[];
  // If a mock DB returns only { id } stubs, fall back to getMemberScore per id
  if (members.length > 0 && members[0].pullRequests === undefined && members[0].id) {
    scores = await Promise.all(
      members.map((m: { id: string }) => getMemberScore(db, m.id))
    );
  } else {
    scores = members.map((m: any) => computeMemberScoreFromData(m));
  }

  return scores.sort((a, b) => {
    if (b.capped !== a.capped) return b.capped - a.capped;
    if (b.raw !== a.raw) return b.raw - a.raw;
    if (b.mergedPrs !== a.mergedPrs) return b.mergedPrs - a.mergedPrs;
    return a.githubLogin.localeCompare(b.githubLogin);
  });
}

const ALL_TEAMS: Team[] = [
  Team.NEXUS,
  Team.CIPHER,
  Team.BYTE_BRIGADE,
  Team.ASCEND,
  Team.ECHO,
];

/**
 * Computes team bonuses and grand totals according to CONTEXT.md § 2.6:
 *  - Winner (+20): highest team challenge score
 *  - Runner-up (+15): second highest
 *  - Most Participation (+15): team other than the winner whose members raised the most PRs total (countsForScore = true)
 *
 * Tie-breaking rules:
 *  - Winner / Runner-up: challengeTotal desc -> mergedPrs desc -> alphabetical teamName asc
 *  - Most Participation: totalPrs desc -> mergedPrs desc -> alphabetical teamName asc
 */
export function computeTeamBonuses(
  rawTeams: Omit<TeamScoreResult, "bonuses" | "grandTotal">[]
): TeamScoreResult[] {
  if (rawTeams.length === 0) return [];

  // Sort by challenge standings with tie-breakers
  const rankedForChallenge = [...rawTeams].sort((a, b) => {
    if (b.challengeTotal !== a.challengeTotal) return b.challengeTotal - a.challengeTotal;
    if (b.mergedPrs !== a.mergedPrs) return b.mergedPrs - a.mergedPrs;
    return a.teamName.localeCompare(b.teamName);
  });

  const firstCandidate = rankedForChallenge[0] ?? null;
  const winnerTeam =
    firstCandidate && (firstCandidate.challengeTotal > 0 || firstCandidate.totalPrs > 0)
      ? firstCandidate
      : null;

  const secondCandidate = rankedForChallenge.length > 1 ? rankedForChallenge[1] : null;
  const runnerUpTeam =
    winnerTeam && secondCandidate && (secondCandidate.challengeTotal > 0 || secondCandidate.totalPrs > 0)
      ? secondCandidate
      : null;

  // Most participation: non-winner teams with at least 1 PR raised (totalPrs > 0)
  const nonWinners = winnerTeam
    ? rankedForChallenge.filter((t) => t.team !== winnerTeam.team)
    : [];

  const rankedForParticipation = [...nonWinners]
    .filter((t) => t.totalPrs > 0)
    .sort((a, b) => {
      if (b.totalPrs !== a.totalPrs) return b.totalPrs - a.totalPrs;
      if (b.mergedPrs !== a.mergedPrs) return b.mergedPrs - a.mergedPrs;
      return a.teamName.localeCompare(b.teamName);
    });

  const mostParticipationTeam = rankedForParticipation[0] ?? null;

  return rawTeams.map((team) => {
    const isWinner = winnerTeam ? team.team === winnerTeam.team : false;
    const isRunnerUp = runnerUpTeam ? team.team === runnerUpTeam.team : false;
    const isMostParticipation = mostParticipationTeam ? team.team === mostParticipationTeam.team : false;

    let bonusPoints = 0;
    if (isWinner) bonusPoints += 20;
    if (isRunnerUp) bonusPoints += 15;
    if (isMostParticipation) bonusPoints += 15;

    return {
      ...team,
      bonuses: {
        winner: isWinner,
        runnerUp: isRunnerUp,
        mostParticipation: isMostParticipation,
        totalBonus: bonusPoints,
        bonusPoints,
      },
      grandTotal: team.challengeTotal + bonusPoints,
    };
  }).sort((a, b) => {
    if (b.grandTotal !== a.grandTotal) return b.grandTotal - a.grandTotal;
    if (b.challengeTotal !== a.challengeTotal) return b.challengeTotal - a.challengeTotal;
    if (b.mergedPrs !== a.mergedPrs) return b.mergedPrs - a.mergedPrs;
    return a.teamName.localeCompare(b.teamName);
  });
}

/**
 * Calculates team standings and scores for all teams.
 * Individual caps are applied per member BEFORE summing into team total.
 */
export async function getTeamScores(
  db: PrismaClient | any
): Promise<TeamScoreResult[]> {
  const allMembers = await getAllMemberScores(db);

  const teamMap = new Map<Team, MemberScoreResult[]>();
  for (const team of ALL_TEAMS) {
    teamMap.set(team, []);
  }

  for (const member of allMembers) {
    const list = teamMap.get(member.team) ?? [];
    list.push(member);
    teamMap.set(member.team, list);
  }

  const rawTeams = ALL_TEAMS.map((team) => {
    const members = teamMap.get(team) ?? [];
    const challengeTotal = members.reduce((sum, m) => sum + m.capped, 0);
    const totalPrs = members.reduce((sum, m) => sum + m.totalPrs, 0);
    const mergedPrs = members.reduce((sum, m) => sum + m.mergedPrs, 0);

    return {
      team,
      teamName: team,
      memberScores: members,
      challengeTotal,
      totalPrs,
      mergedPrs,
    };
  });

  return computeTeamBonuses(rawTeams);
}
