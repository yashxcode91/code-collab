-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "execution_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fileId" TEXT,
    "userId" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "entryFileName" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "initialStdin" TEXT,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "stdoutTruncated" BOOLEAN NOT NULL DEFAULT false,
    "stderrTruncated" BOOLEAN NOT NULL DEFAULT false,
    "exitCode" INTEGER,
    "failureKind" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT,
    "fileId" TEXT,
    "type" "ChatMessageType" NOT NULL DEFAULT 'USER',
    "content" TEXT NOT NULL,
    "fileName" TEXT,
    "lineNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execution_runs_projectId_branchId_createdAt_idx" ON "execution_runs"("projectId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "execution_runs_userId_createdAt_idx" ON "execution_runs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "execution_runs_status_idx" ON "execution_runs"("status");

-- CreateIndex
CREATE INDEX "chat_messages_projectId_createdAt_idx" ON "chat_messages"("projectId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "project_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "project_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "project_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "project_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
