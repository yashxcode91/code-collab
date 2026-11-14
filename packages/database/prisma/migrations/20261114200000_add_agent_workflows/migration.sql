-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('PLANNING', 'EXECUTING', 'VERIFYING', 'SELF_HEALING', 'AWAITING_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AgentToolStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "AgentFileChangeType" AS ENUM ('CREATE', 'MODIFY', 'DELETE');

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Multi-File Refactor',
    "prompt" TEXT NOT NULL,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'PLANNING',
    "model" TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "selfHealingAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxSelfHealingAttempts" INTEGER NOT NULL DEFAULT 3,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_plan_steps" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT,
    "toolName" TEXT NOT NULL,
    "inputPayload" JSONB NOT NULL,
    "outputPayload" JSONB,
    "status" "AgentToolStatus" NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_staged_files" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT,
    "filePath" TEXT NOT NULL,
    "changeType" "AgentFileChangeType" NOT NULL DEFAULT 'MODIFY',
    "originalContent" TEXT,
    "stagedContent" TEXT NOT NULL,
    "originalVersion" INTEGER,
    "originalContentHash" VARCHAR(64),
    "isApplied" BOOLEAN NOT NULL DEFAULT false,
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_staged_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_sessions_projectId_branchId_createdAt_idx" ON "agent_sessions"("projectId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "agent_sessions_userId_createdAt_idx" ON "agent_sessions"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_plan_steps_sessionId_stepNumber_key" ON "agent_plan_steps"("sessionId", "stepNumber");

-- CreateIndex
CREATE INDEX "agent_plan_steps_sessionId_stepNumber_idx" ON "agent_plan_steps"("sessionId", "stepNumber" ASC);

-- CreateIndex
CREATE INDEX "agent_tool_calls_sessionId_createdAt_idx" ON "agent_tool_calls"("sessionId", "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_staged_files_sessionId_filePath_key" ON "agent_staged_files"("sessionId", "filePath");

-- CreateIndex
CREATE INDEX "agent_staged_files_sessionId_idx" ON "agent_staged_files"("sessionId");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_branchId_projectId_fkey" FOREIGN KEY ("branchId", "projectId") REFERENCES "project_branches"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_plan_steps" ADD CONSTRAINT "agent_plan_steps_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_staged_files" ADD CONSTRAINT "agent_staged_files_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
