import { describe, it, expect } from "vitest";
import { Team, Department, Tier } from "@prisma/client";
import {
  getTeamDisplayName,
  TEAM_DISPLAY_NAMES,
  deriveTierFromDepartment,
} from "../src/domain/teams.js";

describe("Teams and Departments Domain Model", () => {
  it("correctly maps all 5 Team enum values to display names", () => {
    expect(getTeamDisplayName(Team.NEXUS)).toBe("Nexus");
    expect(getTeamDisplayName(Team.CIPHER)).toBe("Cipher");
    expect(getTeamDisplayName(Team.BYTE_BRIGADE)).toBe("Byte Brigade");
    expect(getTeamDisplayName(Team.ASCEND)).toBe("Ascend");
    expect(getTeamDisplayName(Team.ECHO)).toBe("Echo");

    expect(Object.keys(TEAM_DISPLAY_NAMES)).toHaveLength(5);
  });

  it("correctly derives Tier from Department according to rules", () => {
    // Technical -> tech tier (cap 60, no easy issues)
    expect(deriveTierFromDepartment(Department.technical)).toBe(Tier.tech);

    // All other 5 departments -> general tier (cap 80, max 3 easy issues)
    expect(deriveTierFromDepartment(Department.pr)).toBe(Tier.general);
    expect(deriveTierFromDepartment(Department.social)).toBe(Tier.general);
    expect(deriveTierFromDepartment(Department.design)).toBe(Tier.general);
    expect(deriveTierFromDepartment(Department.event_management)).toBe(Tier.general);
    expect(deriveTierFromDepartment(Department.research_and_development)).toBe(Tier.general);
  });
});
