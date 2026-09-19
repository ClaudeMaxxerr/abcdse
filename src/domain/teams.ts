import { Team, Department, Tier } from "@prisma/client";

/**
 * Single authoritative mapping from Team enum to user-facing display name.
 * Use this everywhere in queries, templates, UI, and tests. Never hardcode display strings.
 */
export const TEAM_DISPLAY_NAMES: Record<Team, string> = {
  [Team.NEXUS]: "Nexus",
  [Team.CIPHER]: "Cipher",
  [Team.BYTE_BRIGADE]: "Byte Brigade",
  [Team.ASCEND]: "Ascend",
  [Team.ECHO]: "Echo",
} as const;

/**
 * Returns the canonical display name for a Team enum value.
 */
export function getTeamDisplayName(team: Team): string {
  const name = TEAM_DISPLAY_NAMES[team];
  if (!name) {
    throw new Error(`Unknown team enum value: ${team}`);
  }
  return name;
}

/**
 * Derives participant rule Tier from Department.
 * Technical department -> tech tier (Points cap 60, Medium/Hard only, 0 Easy).
 * All other five departments -> general tier (Points cap 80, max 3 Easy).
 */
export function deriveTierFromDepartment(department: Department): Tier {
  if (department === Department.technical) {
    return Tier.tech;
  }
  return Tier.general;
}

export const DEPARTMENT_DISPLAY_NAMES: Record<Department, string> = {
  [Department.technical]: "Technical",
  [Department.pr]: "PR",
  [Department.social]: "Social",
  [Department.design]: "Design",
  [Department.event_management]: "Event Management",
  [Department.research_and_development]: "Research & Development",
} as const;
