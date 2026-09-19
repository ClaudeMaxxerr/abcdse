import { describe, it, expect } from "vitest";
import { postBotComment } from "../src/github/comments.js";

describe("postBotComment Idempotency and Database Recording", () => {
  it("refuses to post the same kind twice on the same issue for the same member", async () => {
    const recordedComments: any[] = [];

    const mockDb = {
      botComment: {
        findFirst: async ({ where }: any) => {
          return recordedComments.find(
            (c) =>
              c.issueId === where.issueId &&
              c.kind === where.kind &&
              c.memberId === where.memberId
          );
        },
        create: async ({ data }: any) => {
          const rec = { id: `bc-${recordedComments.length + 1}`, ...data };
          recordedComments.push(rec);
          return rec;
        },
      },
      issue: {
        findUnique: async () => ({
          id: "issue-1",
          number: 10,
          repo: { owner: "AARVAK-VSET", name: "aqua-sense" },
        }),
      },
    } as any;

    // First attempt -> should succeed and record in DB
    const res1 = await postBotComment(
      "issue-1",
      "claim_accepted",
      "Your claim has been accepted! You have 48 hours to raise a PR.",
      "member-1",
      { prismaClient: mockDb }
    );

    expect(res1.posted).toBe(true);
    expect(res1.commentId).toBeDefined();
    expect(recordedComments).toHaveLength(1);

    // Second attempt with identical (issueId, kind, memberId) -> should refuse to post!
    const res2 = await postBotComment(
      "issue-1",
      "claim_accepted",
      "Your claim has been accepted! You have 48 hours to raise a PR.",
      "member-1",
      { prismaClient: mockDb }
    );

    expect(res2.posted).toBe(false);
    expect(res2.reason).toContain("already posted");
    expect(recordedComments).toHaveLength(1); // No new record created

    // Different kind on same issue & member -> should succeed
    const res3 = await postBotComment(
      "issue-1",
      "claim_expired",
      "Your claim has expired.",
      "member-1",
      { prismaClient: mockDb }
    );

    expect(res3.posted).toBe(true);
    expect(recordedComments).toHaveLength(2);

    // Same kind on different member -> should succeed
    const res4 = await postBotComment(
      "issue-1",
      "claim_accepted",
      "Claim accepted for member 2",
      "member-2",
      { prismaClient: mockDb }
    );

    expect(res4.posted).toBe(true);
    expect(recordedComments).toHaveLength(3);
  });
});
