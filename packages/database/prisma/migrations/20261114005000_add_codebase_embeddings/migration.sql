-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "IndexTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- Ensure composite uniqueness on parent tables to support composite foreign keys
CREATE UNIQUE INDEX IF NOT EXISTS "project_branches_id_projectId_key" ON "project_branches"("id", "projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "project_files_id_branchId_key" ON "project_files"("id", "branchId");

-- CreateTable
CREATE TABLE "codebase_embeddings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codebase_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codebase_index_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "IndexTaskStatus" NOT NULL DEFAULT 'PENDING',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "indexedFiles" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codebase_index_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Chunk uniqueness per file
CREATE UNIQUE INDEX "codebase_embeddings_fileId_chunkIndex_key" ON "codebase_embeddings"("fileId", "chunkIndex");

-- CreateIndex: Lookup by project & branch
CREATE INDEX "codebase_embeddings_projectId_branchId_idx" ON "codebase_embeddings"("projectId", "branchId");

-- CreateIndex: Lookup by file
CREATE INDEX "codebase_embeddings_fileId_idx" ON "codebase_embeddings"("fileId");

-- CreateIndex: Hash-based deduplication lookup
CREATE INDEX "codebase_embeddings_contentHash_idx" ON "codebase_embeddings"("contentHash");

-- CreateIndex: HNSW index for sub-millisecond approximate cosine similarity
CREATE INDEX "codebase_embeddings_embedding_cosine_idx" ON "codebase_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex: Task listing by branch
CREATE INDEX "codebase_index_tasks_projectId_branchId_createdAt_idx" ON "codebase_index_tasks"("projectId", "branchId", "createdAt" DESC);

-- CreateIndex (Partial): Instant worker FIFO selection for PENDING tasks
CREATE INDEX "codebase_index_tasks_pending_idx" ON "codebase_index_tasks"("createdAt" ASC) WHERE "status" = 'PENDING';

-- CreateIndex (Partial Unique): Prevents multiple simultaneous tasks on the same branch
CREATE UNIQUE INDEX "codebase_index_tasks_one_active_per_branch_idx" ON "codebase_index_tasks"("branchId") WHERE "status" IN ('PENDING', 'PROCESSING');

-- Composite Foreign Keys: Enforces strict relational hierarchy (Project -> Branch -> File)
ALTER TABLE "codebase_embeddings" ADD CONSTRAINT "codebase_embeddings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "codebase_embeddings" ADD CONSTRAINT "codebase_embeddings_branchId_projectId_fkey" FOREIGN KEY ("branchId", "projectId") REFERENCES "project_branches"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "codebase_embeddings" ADD CONSTRAINT "codebase_embeddings_fileId_branchId_fkey" FOREIGN KEY ("fileId", "branchId") REFERENCES "project_files"("id", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "codebase_index_tasks" ADD CONSTRAINT "codebase_index_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "codebase_index_tasks" ADD CONSTRAINT "codebase_index_tasks_branchId_projectId_fkey" FOREIGN KEY ("branchId", "projectId") REFERENCES "project_branches"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "codebase_index_tasks" ADD CONSTRAINT "codebase_index_tasks_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
