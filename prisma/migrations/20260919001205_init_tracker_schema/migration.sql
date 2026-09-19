-- CreateEnum
CREATE TYPE "Department" AS ENUM ('technical', 'pr', 'social', 'design', 'event_management', 'research_and_development');

-- CreateEnum
CREATE TYPE "Team" AS ENUM ('NEXUS', 'CIPHER', 'BYTE_BRIGADE', 'ASCEND', 'ECHO');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('tech', 'general');

-- CreateEnum
CREATE TYPE "IssueLevel" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('active', 'pr_raised', 'merged', 'expired', 'released', 'rejected');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "githubUserId" BIGINT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "team" "Team" NOT NULL,
    "tier" "Tier" NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "githubRepoId" BIGINT NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "level" "IssueLevel" NOT NULL,
    "spots" INTEGER NOT NULL,
    "githubIssueId" BIGINT NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "commentId" BIGINT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "promotedAt" TIMESTAMP(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "commentId" BIGINT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "position" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "githubPrId" BIGINT NOT NULL,
    "repoId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "countsForScore" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "deliveryUuid" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "actorIp" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotComment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "memberId" TEXT,
    "commentId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_githubUserId_key" ON "Member"("githubUserId");

-- CreateIndex
CREATE INDEX "Member_team_idx" ON "Member"("team");

-- CreateIndex
CREATE INDEX "Member_department_idx" ON "Member"("department");

-- CreateIndex
CREATE INDEX "Member_tier_idx" ON "Member"("tier");

-- CreateIndex
CREATE INDEX "Member_githubLogin_idx" ON "Member"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_githubRepoId_key" ON "Repo"("githubRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_owner_name_key" ON "Repo"("owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_githubIssueId_key" ON "Issue"("githubIssueId");

-- CreateIndex
CREATE INDEX "Issue_level_idx" ON "Issue"("level");

-- CreateIndex
CREATE INDEX "Issue_repoId_idx" ON "Issue"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_repoId_number_key" ON "Issue"("repoId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_commentId_key" ON "Claim"("commentId");

-- CreateIndex
CREATE INDEX "Claim_issueId_status_idx" ON "Claim"("issueId", "status");

-- CreateIndex
CREATE INDEX "Claim_memberId_status_idx" ON "Claim"("memberId", "status");

-- CreateIndex
CREATE INDEX "Claim_status_deadline_idx" ON "Claim"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_memberId_issueId_key" ON "Claim"("memberId", "issueId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_commentId_key" ON "WaitlistEntry"("commentId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_issueId_resolvedAt_position_idx" ON "WaitlistEntry"("issueId", "resolvedAt", "position");

-- CreateIndex
CREATE INDEX "WaitlistEntry_memberId_resolvedAt_idx" ON "WaitlistEntry"("memberId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_memberId_issueId_key" ON "WaitlistEntry"("memberId", "issueId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_githubPrId_key" ON "PullRequest"("githubPrId");

-- CreateIndex
CREATE INDEX "PullRequest_memberId_countsForScore_merged_idx" ON "PullRequest"("memberId", "countsForScore", "merged");

-- CreateIndex
CREATE INDEX "PullRequest_issueId_idx" ON "PullRequest"("issueId");

-- CreateIndex
CREATE INDEX "PullRequest_repoId_idx" ON "PullRequest"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repoId_number_key" ON "PullRequest"("repoId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_deliveryUuid_key" ON "WebhookDelivery"("deliveryUuid");

-- CreateIndex
CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_idx" ON "WebhookDelivery"("status");

-- CreateIndex
CREATE INDEX "AuditLog_actorMemberId_idx" ON "AuditLog"("actorMemberId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_memberId_expiresAt_revokedAt_idx" ON "Session"("memberId", "expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "BotComment_issueId_kind_idx" ON "BotComment"("issueId", "kind");

-- CreateIndex
CREATE INDEX "BotComment_memberId_idx" ON "BotComment"("memberId");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotComment" ADD CONSTRAINT "BotComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotComment" ADD CONSTRAINT "BotComment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
