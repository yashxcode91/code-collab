-- AlterTable
ALTER TABLE "branch_snapshot_files" ADD COLUMN     "deniedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
