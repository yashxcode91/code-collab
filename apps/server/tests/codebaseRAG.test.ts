import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import {
  AiStreamChunkDto,
  RAG_LIMITS,
  SemanticSearchResponseDto,
} from '@codecollab/shared';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { chunkSourceFile } from '../src/modules/ai/chunker';
import {
  OfflineMockEmbeddingProvider,
  validateEmbeddingVector,
} from '../src/modules/ai/providers/embedding.provider';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day7-rag.codecollab.test';
const uidSuffix = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${uidSuffix}${TEST_EMAIL_DOMAIN}`;

interface TestUserSession {
  agent: ReturnType<typeof request.agent>;
  cookieHeader: string;
  id: string;
  username: string;
  email: string;
}

const extractAuthCookie = (setCookie: string[] | string | undefined): string => {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  for (const entry of list) {
    const firstPair = entry.split(';')[0]?.trim();
    if (firstPair && firstPair.startsWith('codecollab_token=')) {
      return firstPair;
    }
  }
  throw new Error('Expected Set-Cookie auth header on registration');
};

const registerSession = async (
  label: string,
  username: string
): Promise<TestUserSession> => {
  const email = makeTestEmail(label);
  const uniqueUsername = `u_${label.slice(0, 6)}_${Math.random().toString(36).slice(2, 8)}`;
  const agent = request.agent(app);

  const res = await agent
    .post('/api/auth/register')
    .set('Origin', TRUSTED_ORIGIN)
    .send({
      email,
      username: uniqueUsername,
      password: 'Password123!',
    });

  expect(res.status).toBe(201);
  return {
    agent,
    cookieHeader: extractAuthCookie(res.headers['set-cookie']),
    id: res.body.data.user.id,
    username: res.body.data.user.username,
    email,
  };
};

const parseSseChunks = (raw: string): AiStreamChunkDto[] => {
  const chunks: AiStreamChunkDto[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr) {
        try {
          chunks.push(JSON.parse(jsonStr));
        } catch {
          // ignore keepalive comments
        }
      }
    }
  }
  return chunks;
};

describe('Day 7 CodeCollab AI V2: Multi-File Semantic Indexing & Project-Aware RAG', () => {
  let server: http.Server;
  let serverPort: number;
  let owner: TestUserSession;
  let collaborator: TestUserSession;
  let projectId: string;
  let defaultBranchId: string;
  let authFileId: string;
  let secretFileId: string;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });

    owner = await registerSession('rag_owner', `rag_own_${uidSuffix}`);
    collaborator = await registerSession('rag_collab', `rag_col_${uidSuffix}`);

    // Create a collaborative workspace
    const projectRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `RAG Architecture Test ${uidSuffix}`,
        language: 'typescript',
      });

    expect(projectRes.status).toBe(201);
    projectId = projectRes.body.data.project.id;
    defaultBranchId = projectRes.body.data.branches[0].id;

    // Add collaborator to the project as EDITOR
    const addMemberRes = await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        identifier: collaborator.email,
        role: 'editor',
      });
    expect(addMemberRes.status).toBe(201);

    // Populate branch with multiple realistic code files
    const authFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'auth.service.ts',
        nodeType: 'file',
        content: `// Authentication & Token Verification Service
export const verifyJwtToken = (token: string): boolean => {
  if (!token) return false;
  return token.startsWith("ey") && token.length > 20;
};

export const hashPassword = async (rawPassword: string): Promise<string> => {
  return "argon2_hashed_" + rawPassword;
};

export const issueSessionCookie = (userId: string): string => {
  return "codecollab_token=" + userId + "; HttpOnly; Secure; SameSite=Lax";
};
`,
      });
    expect(authFileRes.status).toBe(201);
    authFileId = authFileRes.body.data.file.id;

    const secretFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'payment.ts',
        nodeType: 'file',
        content: `// Confidential Payment Gateway Credentials
export const STRIPE_SECRET_KEY = "sk_live_98374928374982374982374";
export const VAULT_MASTER_TOKEN = "vault_master_key_production_access";

export const chargeCreditCard = async (amountCents: number) => {
  console.log("Charging credit card via Stripe:", amountCents);
  return { status: "succeeded", txId: "tx_998811" };
};
`,
      });
    expect(secretFileRes.status).toBe(201);
    secretFileId = secretFileRes.body.data.file.id;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (projectId) {
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    if (owner?.id) {
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, collaborator.id] } },
      });
    }
  });

  // ===================================================================
  // 1. Chunker & Hash Optimization Unit Invariants
  // ===================================================================
  it('1. Chunks multi-line code files with sliding overlap and SHA-256 content hashes', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `const val_${i} = ${i};`);
    const fileContent = lines.join('\n');

    const chunks = chunkSourceFile('file-123', 'src/test.ts', fileContent, {
      targetLines: 60,
      overlapLines: 15,
    });

    // 150 lines with 60 target and 15 overlap:
    // Chunk 0: lines 1-60 (step 45)
    // Chunk 1: lines 46-105
    // Chunk 2: lines 91-150
    expect(chunks.length).toBe(3);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(60);
    expect(chunks[1].startLine).toBe(46);
    expect(chunks[1].endLine).toBe(105);
    expect(chunks[2].startLine).toBe(91);
    expect(chunks[2].endLine).toBe(150);

    // Each chunk must have a valid 64-char hex SHA-256 hash
    for (const chunk of chunks) {
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  // ===================================================================
  // 2. Embedding Dimension Enforcement & Offline Mock Adapter
  // ===================================================================
  it('2. Enforces strict 768-dimension vector length and L2 unit normalization', async () => {
    const provider = new OfflineMockEmbeddingProvider();
    expect(provider.dimension).toBe(768);

    const vec = await provider.embedText('verifyJwtToken authentication credentials');
    expect(vec.length).toBe(768);

    // Assert L2 norm is approximately 1.0 (unit vector)
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 2);

    // Dimension validator accepts 768 and rejects bad dimensions
    expect(() => validateEmbeddingVector(vec, 'test')).not.toThrow();
    expect(() => validateEmbeddingVector(new Array(512).fill(0.1), 'test')).toThrow(
      /Invalid vector dimension: expected exactly 768, got 512/
    );
  });

  // ===================================================================
  // 3. Asynchronous Codebase Indexing & pgvector Persistence
  // ===================================================================
  it('3. Triggers codebase indexing, stores 768-dim vectors in pgvector, and tracks task progress', async () => {
    // Check initial idle status
    const initialStatus = await owner.agent
      .get(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/index/status`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(initialStatus.status).toBe(200);

    // Trigger indexing
    const indexRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/index`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ forceReindex: true });

    expect([200, 202]).toContain(indexRes.status);
    expect(indexRes.body.taskId).toBeDefined();

    // Verify task status reached COMPLETED
    const completedStatus = await owner.agent
      .get(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/index/status`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(completedStatus.status).toBe(200);
    expect(completedStatus.body.status).toBe('COMPLETED');
    expect(completedStatus.body.indexedFiles).toBeGreaterThanOrEqual(2);
    expect(completedStatus.body.totalChunks).toBeGreaterThanOrEqual(2);

    // Verify embeddings in database
    const dbEmbeddings = await prisma.codebaseEmbedding.findMany({
      where: { projectId, branchId: defaultBranchId },
    });
    expect(dbEmbeddings.length).toBeGreaterThanOrEqual(2);
    expect(dbEmbeddings[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ===================================================================
  // 4. Concurrency Lock: Prevents Simultaneous Indexing on Same Branch
  // ===================================================================
  it('4. Concurrency Lock: Prevents duplicate simultaneous indexing tasks on the same branch', async () => {
    // Create a temporary task in PROCESSING state to simulate a long running task
    const mockTask = await prisma.codebaseIndexTask.create({
      data: {
        projectId,
        branchId: defaultBranchId,
        requestedById: owner.id,
        status: 'PROCESSING',
      },
    });

    try {
      const concurrentRes = await owner.agent
        .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/index`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ forceReindex: false });

      expect(concurrentRes.status).toBe(200);
      expect(concurrentRes.body.alreadyRunning).toBe(true);
      expect(concurrentRes.body.taskId).toBe(mockTask.id);
    } finally {
      // Clean up mock task
      await prisma.codebaseIndexTask.delete({ where: { id: mockTask.id } });
    }
  });

  // ===================================================================
  // 5. Semantic Search & Cosine Similarity Retrieval
  // ===================================================================
  it('5. Semantic Search: Retrieves relevant code chunks ranked by cosine similarity', async () => {
    const searchRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/search`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        query: 'How are JWT tokens verified and session cookies issued?',
        topK: 5,
        minScore: 0.1,
      });

    expect(searchRes.status).toBe(200);
    const body: SemanticSearchResponseDto = searchRes.body;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].filePath).toContain('auth.service.ts');
    expect(body.results[0].content).toContain('verifyJwtToken');
    expect(body.results[0].similarity).toBeGreaterThan(0.2);
  });

  // ===================================================================
  // 6. Security Audit: Server-Side Pre-Prompt ACL Filtering
  // ===================================================================
  it('6. Security Invariant: Server-Side Pre-Prompt ACL Filtering drops DENIED files before prompt generation', async () => {
    // Step A: Owner sets fine-grained DENIED ACL on src/secrets/payment.ts for Collaborator
    const setAclRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${defaultBranchId}/files/${secretFileId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        userId: collaborator.id,
        permission: 'denied',
      });
    expect(setAclRes.status).toBe(200);

    // Step B: Owner searches for credit card Stripe keys (Owner SHOULD see payment.ts)
    const ownerSearch = await owner.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/search`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        query: 'Stripe credit card payment secret key',
        topK: 5,
        minScore: 0.1,
      });
    expect(ownerSearch.status).toBe(200);
    const ownerFoundSecret = ownerSearch.body.results.some((r: any) =>
      r.filePath.includes('payment.ts')
    );
    expect(ownerFoundSecret).toBe(true);

    // Step C: Collaborator searches for the EXACT SAME payment keys (Collaborator MUST NOT see payment.ts)
    const collabSearch = await collaborator.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/search`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        query: 'Stripe credit card payment secret key',
        topK: 5,
        minScore: 0.1,
      });
    expect(collabSearch.status).toBe(200);
    const collabFoundSecret = collabSearch.body.results.some((r: any) =>
      r.filePath.includes('payment.ts')
    );
    expect(collabFoundSecret).toBe(false);

    // Step D: Collaborator invokes AI streaming prompt with ragMode: true
    // Verify payment.ts is NOT in citations frame and NOT in AI prompt response
    const sseRes = await collaborator.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'chat',
        prompt: 'Show me the Stripe credit card secret keys and payment gateway code',
        context: {
          ragMode: true,
        },
      });

    expect(sseRes.status).toBe(200);
    const chunks = parseSseChunks(sseRes.text);

    // If citations frame was emitted, it MUST NOT contain payment.ts
    const citationsChunk = chunks.find((c) => c.type === 'citations') as
      | { type: 'citations'; citations: any[] }
      | undefined;

    if (citationsChunk) {
      const leakedSecretCitation = citationsChunk.citations.some((c) =>
        c.filePath.includes('payment.ts')
      );
      expect(leakedSecretCitation).toBe(false);
    }

    // Done message content must not contain the sensitive Stripe key
    const doneChunk = chunks.find((c) => c.type === 'done') as
      | { type: 'done'; message: any }
      | undefined;
    expect(doneChunk).toBeDefined();
    expect(doneChunk?.message.content).not.toContain('sk_live_98374928374982374982374');
  });

  // ===================================================================
  // 7. Security Audit: Multi-Tenant Cross-Project Vector Isolation
  // ===================================================================
  it('7. Multi-Tenant Vector Isolation: Cross-project semantic leakage is mathematically impossible', async () => {
    // Step A: Register foreign tenant User B
    const foreignTenant = await registerSession('tenant_b', 'tenant_b');

    // Step B: User B creates private Project Beta
    const createProjectBRes = await foreignTenant.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `Project Beta Confidential ${uidSuffix}`,
        visibility: 'private',
      });
    expect(createProjectBRes.status).toBe(201);
    const projectBId = createProjectBRes.body.data.project.id;
    const branchBId = createProjectBRes.body.data.branches[0].id;

    // Step C: User B creates sensitive configuration file with unique high-entropy token
    const secretBToken = `super_secret_postgres_credential_${uidSuffix}_xyz98765`;
    const createSecretBFileRes = await foreignTenant.agent
      .post(`/api/projects/${projectBId}/branches/${branchBId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'database.conf',
        nodeType: 'file',
        content: `DATABASE_ADMIN_SECRET_KEY="${secretBToken}";\n// High security internal connection string`,
      });
    expect(createSecretBFileRes.status).toBe(201);

    // Step D: User B indexes Project Beta
    const indexBRes = await foreignTenant.agent
      .post(`/api/projects/${projectBId}/branches/${branchBId}/ai/index`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ forceReindex: true });
    expect([200, 202]).toContain(indexBRes.status);

    // Allow indexing cycle to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Step E: User A (Project Alpha) searches inside Project Alpha for User B's exact confidential secret
    const userASearchRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${defaultBranchId}/ai/search`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        query: `${secretBToken} DATABASE_ADMIN_SECRET_KEY`,
        topK: 5,
        minScore: 0.0,
      });
    expect(userASearchRes.status).toBe(200);

    // Project Alpha search results MUST NEVER contain chunks from Project Beta
    const leakedChunk = userASearchRes.body.results.some((r: any) =>
      r.content.includes(secretBToken)
    );
    expect(leakedChunk).toBe(false);

    // Step F: User A attempts direct API probe on Project Beta's search endpoint -> MUST return 403 Forbidden
    const directProbeRes = await owner.agent
      .post(`/api/projects/${projectBId}/branches/${branchBId}/ai/search`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        query: secretBToken,
        topK: 5,
      });
    expect(directProbeRes.status).toBe(403);
  });

  // ===================================================================
  // 8. Security Audit: Vector Invariant Enforcement
  // ===================================================================
  it('8. Vector Invariant Security: Strict 768-dim validation blocks invalid model outputs and dimension mismatch', () => {
    // 767 dimensions (underflow)
    const shortVector = new Array(767).fill(0.1);
    expect(() => validateEmbeddingVector(shortVector, 'TestProvider')).toThrow(
      /expected exactly 768, got 767/
    );

    // 1536 dimensions (OpenAI Ada dimension mismatch)
    const longVector = new Array(1536).fill(0.1);
    expect(() => validateEmbeddingVector(longVector, 'OpenAiProvider')).toThrow(
      /expected exactly 768, got 1536/
    );

    // Vector with NaN
    const nanVector = new Array(768).fill(0.1);
    nanVector[10] = NaN;
    expect(() => validateEmbeddingVector(nanVector, 'TestProvider')).toThrow(
      /non-finite number/
    );

    // Vector with Infinity
    const infVector = new Array(768).fill(0.1);
    infVector[20] = Infinity;
    expect(() => validateEmbeddingVector(infVector, 'TestProvider')).toThrow(
      /non-finite number/
    );

    // Valid 768 float vector
    const validVector = new Array(768).fill(0.05);
    expect(() => validateEmbeddingVector(validVector, 'ValidProvider')).not.toThrow();
  });

  // ===================================================================
  // 9. Security Audit: Boundary & Denial-of-Service Defenses
  // ===================================================================
  it('9. Boundary Defenses: Files exceeding MAX_FILE_BYTES (250 KB) or binary assets are rejected/skipped', () => {
    // 1. Oversized file (> 250 KB)
    const oversizedContent = 'const x = 1;\n'.repeat(25000); // ~325 KB
    const chunks = chunkSourceFile(
      '00000000-0000-0000-0000-000000000001',
      'src/giant.ts',
      oversizedContent
    );
    expect(chunks.length).toBe(0);

    // 2. Binary PNG asset
    const binaryChunkPng = chunkSourceFile(
      '00000000-0000-0000-0000-000000000002',
      'assets/logo.png',
      '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR...'
    );
    expect(binaryChunkPng.length).toBe(0);

    // 3. Binary ZIP asset
    const binaryChunkZip = chunkSourceFile(
      '00000000-0000-0000-0000-000000000003',
      'dist/bundle.zip',
      'PK\x03\x04...'
    );
    expect(binaryChunkZip.length).toBe(0);
  });

  // ===================================================================
  // 10. Security Audit: Composite Foreign-Key Integrity Guard
  // ===================================================================
  it('10. Foreign-Key Composite Guard: Forged branch IDs belonging to other projects are rejected', async () => {
    // Attempt to invoke search on Project Alpha with an unregistered or forged branch ID
    const fakeBranchId = '00000000-0000-0000-0000-000000000999';
    const forgedRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${fakeBranchId}/ai/search`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        query: 'search query',
        topK: 5,
      });

    // Branch not found in Project Alpha (composite guard)
    expect(forgedRes.status).toBe(404);
  });
});
