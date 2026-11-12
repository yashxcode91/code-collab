-- CreateTable
CREATE TABLE "branch_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "restoredFromSnapshotId" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_snapshot_files" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "originalFileId" TEXT,
    "path" TEXT NOT NULL,
    "nodeType" "FileNodeType" NOT NULL DEFAULT 'FILE',
    "content" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "branch_snapshot_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_snapshots_projectId_branchId_createdAt_idx" ON "branch_snapshots"("projectId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "branch_snapshots_branchId_createdAt_idx" ON "branch_snapshots"("branchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "branch_snapshot_files_snapshotId_idx" ON "branch_snapshot_files"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_snapshot_files_snapshotId_path_key" ON "branch_snapshot_files"("snapshotId", "path");

-- AddForeignKey
ALTER TABLE "branch_snapshots" ADD CONSTRAINT "branch_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_snapshots" ADD CONSTRAINT "branch_snapshots_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "project_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_snapshots" ADD CONSTRAINT "branch_snapshots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_snapshot_files" ADD CONSTRAINT "branch_snapshot_files_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "branch_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
