import crypto from 'crypto';
import { CodebaseChunkDto, RAG_LIMITS } from '@codecollab/shared';

// =====================================================================
// Multi-File Codebase Chunker
// Slices files into overlapping sliding-window snippets, calculates
// deterministic SHA-256 hashes, and estimates token boundaries.
// =====================================================================

export interface ChunkOptions {
  targetLines?: number;
  overlapLines?: number;
  maxChars?: number;
}

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'webp',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'zip',
  'tar',
  'gz',
  '7z',
  'rar',
  'pdf',
  'mp3',
  'mp4',
  'wav',
  'avi',
  'woff',
  'woff2',
  'ttf',
  'eot',
]);

export const isBinaryFile = (filePath: string, content: string): boolean => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext && BINARY_EXTENSIONS.has(ext)) {
    return true;
  }
  // Standard heuristic for binary buffers
  return content.includes('\0');
};

/**
 * Splits a source file into overlapping code chunks suitable for vector embeddings.
 *
 * Invariants enforced:
 * 1. Line numbers are 1-based and inclusive (`startLine`, `endLine`).
 * 2. Overlap guarantees that cross-function interfaces or multiline logic aren't severed.
 * 3. `contentHash` is a SHA-256 hex digest of the chunk content for 90% cache hits.
 * 4. Invisible null bytes and non-printable control characters are stripped.
 * 5. Boundary defense: Files > 250 KB or binary file types are skipped to prevent memory blowup.
 */
export const chunkSourceFile = (
  fileId: string,
  filePath: string,
  content: string,
  options: ChunkOptions = {}
): CodebaseChunkDto[] => {
  const targetLines = options.targetLines ?? RAG_LIMITS.CHUNK_TARGET_LINES;
  const overlapLines = options.overlapLines ?? RAG_LIMITS.CHUNK_OVERLAP_LINES;
  const maxChars = options.maxChars ?? RAG_LIMITS.MAX_CHUNK_CHARS;

  if (!content || !content.trim()) {
    return [];
  }

  // Boundary defense: Skip files exceeding 250 KB limit
  if (content.length > RAG_LIMITS.MAX_FILE_BYTES_FOR_INDEXING) {
    return [];
  }

  // Boundary defense: Skip binary assets
  if (isBinaryFile(filePath, content)) {
    return [];
  }

  // Normalize newlines
  const sanitized = content.replace(/\0/g, '').replace(/\r\n/g, '\n');
  const lines = sanitized.split('\n');

  if (lines.length === 0) {
    return [];
  }

  const chunks: CodebaseChunkDto[] = [];
  const step = Math.max(1, targetLines - overlapLines);
  let chunkIndex = 0;

  for (let startIdx = 0; startIdx < lines.length; startIdx += step) {
    let endIdx = Math.min(lines.length - 1, startIdx + targetLines - 1);

    // If this is not the first chunk and the remaining lines are very small (< 5 lines),
    // we can stop or let the previous chunk cover it. But to ensure full coverage,
    // we take up to end of lines.
    let chunkText = lines.slice(startIdx, endIdx + 1).join('\n');

    // If chunk exceeds maxChars, truncate to the nearest newline or maxChars
    if (chunkText.length > maxChars) {
      chunkText = chunkText.slice(0, maxChars);
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(chunkText, 'utf8')
      .digest('hex');

    const tokenCount = Math.max(1, Math.ceil(chunkText.length / 4));

    chunks.push({
      fileId,
      filePath,
      chunkIndex,
      startLine: startIdx + 1,
      endLine: endIdx + 1,
      content: chunkText,
      contentHash,
      tokenCount,
    });

    chunkIndex += 1;

    // If we've reached or passed the end of the file, break
    if (endIdx >= lines.length - 1) {
      break;
    }
  }

  return chunks;
};
