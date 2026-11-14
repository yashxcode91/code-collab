-- CreateEnum
CREATE TYPE "SandboxStatus" AS ENUM ('STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED');

-- CreateTable
CREATE TABLE "preview_sandboxes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "containerId" VARCHAR(128),
    "containerName" VARCHAR(128) NOT NULL,
    "internalIp" VARCHAR(64),
    "status" "SandboxStatus" NOT NULL DEFAULT 'STARTING',
    "ports" INTEGER[] DEFAULT ARRAY[5173]::INTEGER[],
    "primaryPort" INTEGER NOT NULL DEFAULT 5173,
    "memoryLimitMb" INTEGER NOT NULL DEFAULT 512,
    "cpuLimit" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "previewToken" TEXT,
    "errorMessage" TEXT,
    "lastPingAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preview_sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "preview_sandboxes_projectId_branchId_key" ON "preview_sandboxes"("projectId", "branchId");

-- CreateIndex
CREATE INDEX "preview_sandboxes_projectId_status_idx" ON "preview_sandboxes"("projectId", "status");

-- AddForeignKey
ALTER TABLE "preview_sandboxes" ADD CONSTRAINT "preview_sandboxes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_sandboxes" ADD CONSTRAINT "preview_sandboxes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "project_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
