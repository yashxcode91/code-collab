import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';

const TRUSTED_ORIGIN = 'http://localhost:5173';
// Isolated email suffix so cleanup in beforeAll/afterAll never affects auth/oauth test suites or dev accounts
const TEST_EMAIL_DOMAIN = '@vitest-projects.codecollab.test';
const runId = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${runId}${TEST_EMAIL_DOMAIN}`;

interface TestUserSession {
  // supertest.agent retains its own cookie jar across requests, simulating an independent logged-in browser
  agent: ReturnType<typeof request.agent>;
  id: string;
  username: string;
  email: string;
}

/**
 * Helper that registers a user through our real `/api/auth/register` endpoint
 * and returns an isolated `request.agent` already holding that user's HttpOnly JWT cookie.
 */
const registerSession = async (
  label: string,
  username: string
): Promise<TestUserSession> => {
  const email = makeTestEmail(label);
  const agent = request.agent(app);

  const res = await agent
    .post('/api/auth/register')
    .set('Origin', TRUSTED_ORIGIN)
    .send({
      email,
      username,
      password: 'Password123!',
    });

  expect(res.status).toBe(201);
  return {
    agent,
    id: res.body.data.user.id,
    username: res.body.data.user.username,
    email,
  };
};

/**
 * Integration test suite for Day 3 Step 3 (`/api/projects`):
 * Tests workspace transactions, starter files, path traversal + `parentKey = 'ROOT'` uniqueness,
 * IDOR/RBAC boundaries, cross-project parameter spoofing, Git-like BFS branch cloning,
 * protected branches, exclusive file locks + leave cleanup, inherited folder ACLs (DENIED/READ_ONLY)
 * + branch carryover, folder move cycles, locked-descendant delete guard, and `expectedVersion` CAS conflicts.
 */
describe('Studio Workspaces, Branches, Locks & Fine-Grained ACLs (/api/projects)', () => {
  let owner: TestUserSession;
  let editor: TestUserSession;
  let viewer: TestUserSession;
  let outsider: TestUserSession;

  let projectId: string;
  let mainBranchId: string;
  let readmeFileId: string;
  let srcFolderId: string;
  let srcIndexFileId: string;
  let utilsFolderId: string;
  let utilsMathFileId: string;

  beforeAll(async () => {
    // Wipe any leftover test users from interrupted runs (PostgreSQL cascades projects/branches/files)
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    // Spin up 4 parallel user sessions (`<= 20` chars for RegisterSchema username validation)
    [owner, editor, viewer, outsider] = await Promise.all([
      registerSession('owner', `proj_${runId}_owner`),
      registerSession('editor', `proj_${runId}_editor`),
      registerSession('viewer', `proj_${runId}_viewer`),
      registerSession('outsider', `proj_${runId}_out`),
    ]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    // Close DB and Redis sockets cleanly so Vitest exits without open-handle hangs
    await prisma.$disconnect();
    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  });

  it('rejects unauthenticated requests & invalid UUIDs and provisions starter workspace atomically', async () => {
    // 1. Missing HttpOnly auth cookie -> 401
    const unauth = await request(app).get('/api/projects');
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe('UNAUTHORIZED');

    // 2. Malformed UUID route parameter -> 400 INVALID_ID before hitting Postgres
    const badUuid = await owner.agent.get('/api/projects/not-a-uuid');
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.error.code).toBe('INVALID_ID');

    // 3. Create TypeScript workspace (requires trusted Origin header for CSRF check)
    const createRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'Collab Demo',
        description: 'Step 4 integration test workspace',
        language: 'typescript',
        isPublic: false,
        maxConcurrentEditors: 4,
        preventSameLineEdit: true,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);

    const { project, branches, members } = createRes.body.data;
    expect(project.name).toBe('Collab Demo');
    expect(project.language).toBe('typescript');
    expect(project.isPublic).toBe(false);
    expect(project.currentUserRole).toBe('owner');
    expect(project.maxConcurrentEditors).toBe(4);
    expect(project.preventSameLineEdit).toBe(true);

    // Default `main` branch and owner membership must exist inside the same transaction
    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe('main');
    expect(branches[0].isDefault).toBe(true);
    expect(branches[0].isProtected).toBe(false);

    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(owner.id);
    expect(members[0].role).toBe('owner');
    expect(members[0].user.email).toBeUndefined();

    projectId = project.id;
    mainBranchId = branches[0].id;

    // 4. Starter files (`README.md`, `src/`, `src/index.ts`) must exist on `main`
    const treeRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files`
    );
    expect(treeRes.status).toBe(200);

    const files = treeRes.body.data.files as Array<{
      id: string;
      name: string;
      parentId: string | null;
      nodeType: 'file' | 'folder';
      effectivePermission: string;
    }>;

    const readme = files.find((f) => f.name === 'README.md' && f.parentId === null);
    const srcFolder = files.find((f) => f.name === 'src' && f.nodeType === 'folder');
    expect(readme).toBeDefined();
    expect(srcFolder).toBeDefined();

    const indexTs = files.find(
      (f) => f.name === 'index.ts' && f.parentId === srcFolder!.id
    );
    expect(indexTs).toBeDefined();
    expect(readme!.effectivePermission).toBe('edit');
    expect(indexTs!.effectivePermission).toBe('edit');

    readmeFileId = readme!.id;
    srcFolderId = srcFolder!.id;
    srcIndexFileId = indexTs!.id;

    // 5. Opening a file returns its starter text, while opening a folder rejects 400
    const readmeDetail = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`
    );
    expect(readmeDetail.status).toBe(200);
    expect(readmeDetail.body.data.file.content).toContain('# Collab Demo');
    expect(readmeDetail.body.data.file.version).toBe(1);

    const folderOpenAttempt = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}`
    );
    expect(folderOpenAttempt.status).toBe(400);
    expect(folderOpenAttempt.body.error.code).toBe('FOLDER_NOT_OPENABLE');
  });

  it('blocks path traversal names and enforces root sibling uniqueness (parentKey = ROOT)', async () => {
    // 1. Reject traversal/slash filenames via SafeNodeNameSchema
    const traversalRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        parentId: null,
        name: '../evil.ts',
        nodeType: 'file',
      });
    expect(traversalRes.status).toBe(400);
    expect(traversalRes.body.error.code).toBe('VALIDATION_ERROR');

    const slashRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        parentId: srcFolderId,
        name: 'nested/bad.ts',
        nodeType: 'file',
      });
    expect(slashRes.status).toBe(400);
    expect(slashRes.body.error.code).toBe('VALIDATION_ERROR');

    // 2. Reject unsafe Git-like branch names containing `..`
    const badBranchRes = await owner.agent
      .post(`/api/projects/${projectId}/branches`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'feat..bad' });
    expect(badBranchRes.status).toBe(400);
    expect(badBranchRes.body.error.code).toBe('VALIDATION_ERROR');

    // 3. Duplicate root file must collide on `@@unique([branchId, parentKey, name])`
    const dupRootRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        parentId: null,
        name: 'README.md',
        nodeType: 'file',
        content: '# Duplicate attempt',
      });
    expect(dupRootRes.status).toBe(409);
    expect(dupRootRes.body.error.code).toBe('FILE_EXISTS');
  });

  it('enforces IDOR privacy, cross-project parameter spoofing guards, and viewer vs editor RBAC', async () => {
    // 1. Non-member cannot read a private workspace or its files
    const outsiderProjectRes = await outsider.agent.get(`/api/projects/${projectId}`);
    expect(outsiderProjectRes.status).toBe(403);
    expect(outsiderProjectRes.body.error.code).toBe('PROJECT_FORBIDDEN');

    const outsiderFilesRes = await outsider.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files`
    );
    expect(outsiderFilesRes.status).toBe(403);
    expect(outsiderFilesRes.body.error.code).toBe('PROJECT_FORBIDDEN');

    // 2. Owner invites `editor` (by email) and `viewer` (by username); collaborator emails never leak
    const addEditorRes = await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: editor.email, role: 'editor' });
    expect(addEditorRes.status).toBe(201);
    expect(addEditorRes.body.data.member.role).toBe('editor');
    expect(addEditorRes.body.data.member.user.email).toBeUndefined();

    const addViewerRes = await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: viewer.username, role: 'viewer' });
    expect(addViewerRes.status).toBe(201);
    expect(addViewerRes.body.data.member.role).toBe('viewer');

    // Non-owner cannot invite collaborators
    const editorInviteAttempt = await editor.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: outsider.username, role: 'viewer' });
    expect(editorInviteAttempt.status).toBe(403);
    expect(editorInviteAttempt.body.error.code).toBe('INSUFFICIENT_ROLE');

    // 3. Viewer can read files (with `effectivePermission: 'read_only'`) but cannot create or edit
    const viewerReadRes = await viewer.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcIndexFileId}`
    );
    expect(viewerReadRes.status).toBe(200);
    expect(viewerReadRes.body.data.file.effectivePermission).toBe('read_only');

    const viewerCreateRes = await viewer.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ parentId: null, name: 'viewer_hack.ts', nodeType: 'file' });
    expect(viewerCreateRes.status).toBe(403);
    expect(viewerCreateRes.body.error.code).toBe('INSUFFICIENT_ROLE');

    const viewerEditRes = await viewer.agent
      .patch(`/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: 'viewer overwrite attempt' });
    expect(viewerEditRes.status).toBe(403);
    expect(viewerEditRes.body.error.code).toBe('INSUFFICIENT_ROLE');

    // 4. Cross-project parameter spoofing: mixing Project B's branchId/fileId into Project A's URL must fail 404
    const publicProjRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'Public Python Sandbox',
        language: 'python',
        isPublic: true,
      });
    expect(publicProjRes.status).toBe(201);

    const projectBId = publicProjRes.body.data.project.id as string;
    const branchBId = publicProjRes.body.data.branches[0].id as string;
    const filesBRes = await owner.agent.get(
      `/api/projects/${projectBId}/branches/${branchBId}/files`
    );
    // Folders sort ahead of files (`orderBy: [{ nodeType: 'desc' }]`), so pick a FILE node explicitly
    const fileB = (
      filesBRes.body.data.files as Array<{ id: string; nodeType: string }>
    ).find((f) => f.nodeType === 'file');
    expect(fileB).toBeDefined();
    const fileBId = fileB!.id;

    const mixedBranchRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${branchBId}/files`
    );
    expect(mixedBranchRes.status).toBe(404);
    expect(mixedBranchRes.body.error.code).toBe('BRANCH_NOT_FOUND');

    const mixedFileRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${fileBId}`
    );
    expect(mixedFileRes.status).toBe(404);
    expect(mixedFileRes.body.error.code).toBe('FILE_NOT_FOUND');

    // 5. Public workspace lets an outsider view read-only without blocking, while still rejecting mutations
    const outsiderPublicRead = await outsider.agent.get(
      `/api/projects/${projectBId}/branches/${branchBId}/files/${fileBId}`
    );
    expect(outsiderPublicRead.status).toBe(200);
    expect(outsiderPublicRead.body.data.file.effectivePermission).toBe('read_only');

    const outsiderPublicWrite = await outsider.agent
      .patch(`/api/projects/${projectBId}/branches/${branchBId}/files/${fileBId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: '# unauthorized edit' });
    expect(outsiderPublicWrite.status).toBe(403);
    expect(outsiderPublicWrite.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('clones nested file trees via BFS into new branches and enforces branch protection', async () => {
    // 1. Build a multi-level folder tree on `main`: `src/utils/math.ts`
    const createUtilsRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        parentId: srcFolderId,
        name: 'utils',
        nodeType: 'folder',
      });
    expect(createUtilsRes.status).toBe(201);
    utilsFolderId = createUtilsRes.body.data.file.id;

    const initialMathContent = 'export const add = (a: number, b: number) => a + b;\n';
    const createMathRes = await editor.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        parentId: utilsFolderId,
        name: 'math.ts',
        nodeType: 'file',
        content: initialMathContent,
      });
    expect(createMathRes.status).toBe(201);
    utilsMathFileId = createMathRes.body.data.file.id;

    // 2. Editor cuts a feature branch from `main`; BFS must clone all nested UUIDs cleanly
    const branchRes = await editor.agent
      .post(`/api/projects/${projectId}/branches`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'feat/math-helper',
        sourceBranchId: mainBranchId,
      });
    expect(branchRes.status).toBe(201);

    const featBranch = branchRes.body.data.branch;
    expect(featBranch.name).toBe('feat/math-helper');
    expect(featBranch.parentBranchId).toBe(mainBranchId);
    expect(featBranch.isDefault).toBe(false);
    expect(featBranch.isProtected).toBe(false);

    const featFilesRes = await editor.agent.get(
      `/api/projects/${projectId}/branches/${featBranch.id}/files`
    );
    expect(featFilesRes.status).toBe(200);

    const featFiles = featFilesRes.body.data.files as Array<{
      id: string;
      name: string;
      parentId: string | null;
      nodeType: 'file' | 'folder';
    }>;

    const clonedSrc = featFiles.find((f) => f.name === 'src' && f.parentId === null);
    const clonedUtils = featFiles.find(
      (f) => f.name === 'utils' && f.parentId === clonedSrc?.id
    );
    const clonedMath = featFiles.find(
      (f) => f.name === 'math.ts' && f.parentId === clonedUtils?.id
    );
    expect(clonedSrc).toBeDefined();
    expect(clonedUtils).toBeDefined();
    expect(clonedMath).toBeDefined();

    // Cloned nodes must have brand-new UUIDs (never sharing primary keys with `main`)
    expect(clonedSrc!.id).not.toBe(srcFolderId);
    expect(clonedUtils!.id).not.toBe(utilsFolderId);
    expect(clonedMath!.id).not.toBe(utilsMathFileId);

    // Editing `math.ts` on the feature branch must NOT mutate `main`
    const featEditRes = await editor.agent
      .patch(
        `/api/projects/${projectId}/branches/${featBranch.id}/files/${clonedMath!.id}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: 'export const multiply = (a: number, b: number) => a * b;\n' });
    expect(featEditRes.status).toBe(200);

    const mainMathCheck = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
    );
    expect(mainMathCheck.status).toBe(200);
    expect(mainMathCheck.body.data.file.content).toBe(initialMathContent);

    // 3. Default `main` branch cannot be deleted even by the owner
    const delMainRes = await owner.agent
      .delete(`/api/projects/${projectId}/branches/${mainBranchId}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(delMainRes.status).toBe(400);
    expect(delMainRes.body.error.code).toBe('CANNOT_DELETE_DEFAULT_BRANCH');

    // 4. Protecting `main` blocks editor writes on `main` while owner + feature branches remain writable
    const protectRes = await owner.agent
      .patch(`/api/projects/${projectId}/branches/${mainBranchId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ isProtected: true });
    expect(protectRes.status).toBe(200);
    expect(protectRes.body.data.branch.isProtected).toBe(true);

    const editorOnProtectedMain = await editor.agent
      .patch(`/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: '# Blocked edit on protected main' });
    expect(editorOnProtectedMain.status).toBe(403);
    expect(editorOnProtectedMain.body.error.code).toBe('BRANCH_PROTECTED');

    const editorPermCheck = await editor.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`
    );
    expect(editorPermCheck.status).toBe(200);
    expect(editorPermCheck.body.data.file.effectivePermission).toBe('read_only');

    // Workspace owner bypasses branch protection
    const ownerOnProtectedMain = await owner.agent
      .patch(`/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: '# Updated by owner on protected main\n' });
    expect(ownerOnProtectedMain.status).toBe(200);

    // Unprotect `main` cleanly before lock/ACL tests
    const unprotectRes = await owner.agent
      .patch(`/api/projects/${projectId}/branches/${mainBranchId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ isProtected: false });
    expect(unprotectRes.status).toBe(200);
  });

  it('enforces exclusive checkout locks, leave cleanup, inherited folder ACLs, and branch ACL carryover', async () => {
    // 1. Exclusive file lock: editor locks `math.ts`; even owner cannot overwrite it while locked
    const lockRes = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.data.file.lockedById).toBe(editor.id);

    const ownerLockedWrite = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: '// should fail while locked' });
    expect(ownerLockedWrite.status).toBe(403);
    expect(ownerLockedWrite.body.error.code).toBe('FILE_LOCKED');

    const secondLockRes = await owner.agent
      .post(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(secondLockRes.status).toBe(409);
    expect(secondLockRes.body.error.code).toBe('FILE_ALREADY_LOCKED');

    // 2. When a collaborator voluntarily leaves, their orphaned file locks release atomically
    const leaveRes = await editor.agent
      .delete(`/api/projects/${projectId}/members/${editor.id}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(leaveRes.status).toBe(200);

    const ownerAfterLeave = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: '// lock released cleanly after leave\n' });
    expect(ownerAfterLeave.status).toBe(200);
    expect(ownerAfterLeave.body.data.file.lockedById).toBeNull();

    // Re-invite editor to verify per-folder/per-file ACL inheritance
    const reinviteRes = await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: editor.email, role: 'editor' });
    expect(reinviteRes.status).toBe(201);

    // 3. Setting DENIED on `src/` hides the entire subtree AND blocks direct descendant IDs
    const denySrcRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor.id, permission: 'denied' });
    expect(denySrcRes.status).toBe(200);
    expect(denySrcRes.body.data.rule.permission).toBe('denied');

    const editorSidebarRes = await editor.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files`
    );
    expect(editorSidebarRes.status).toBe(200);
    const visibleNames = (
      editorSidebarRes.body.data.files as Array<{ name: string }>
    ).map((f) => f.name);
    expect(visibleNames).toContain('README.md');
    expect(visibleNames).not.toContain('src');
    expect(visibleNames).not.toContain('index.ts');
    expect(visibleNames).not.toContain('utils');
    expect(visibleNames).not.toContain('math.ts');

    // Direct GET on nested file ID must walk ancestors and still reject 403 FILE_ACCESS_DENIED
    const directDeniedRes = await editor.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
    );
    expect(directDeniedRes.status).toBe(403);
    expect(directDeniedRes.body.error.code).toBe('FILE_ACCESS_DENIED');

    // 4. Branch ACL carryover: cutting a new branch must copy ACL overrides so users cannot bypass them
    const bypassBranchRes = await editor.agent
      .post(`/api/projects/${projectId}/branches`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'feat/try-bypass', sourceBranchId: mainBranchId });
    expect(bypassBranchRes.status).toBe(201);
    const bypassBranchId = bypassBranchRes.body.data.branch.id as string;

    const bypassListRes = await editor.agent.get(
      `/api/projects/${projectId}/branches/${bypassBranchId}/files`
    );
    expect(bypassListRes.status).toBe(200);
    const bypassNames = (
      bypassListRes.body.data.files as Array<{ name: string }>
    ).map((f) => f.name);
    expect(bypassNames).toContain('README.md');
    expect(bypassNames).not.toContain('src');
    expect(bypassNames).not.toContain('math.ts');

    // 5. Downgrading `src/` ACL to READ_ONLY lets editor view descendants but blocks writes/creates/locks
    const readOnlySrcRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor.id, permission: 'read_only' });
    expect(readOnlySrcRes.status).toBe(200);

    const readNestedRes = await editor.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
    );
    expect(readNestedRes.status).toBe(200);
    expect(readNestedRes.body.data.file.effectivePermission).toBe('read_only');

    const writeNestedRes = await editor.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: '// blocked by inherited read_only' });
    expect(writeNestedRes.status).toBe(403);
    expect(writeNestedRes.body.error.code).toBe('FILE_READ_ONLY');

    const lockNestedRes = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(lockNestedRes.status).toBe(403);
    expect(lockNestedRes.body.error.code).toBe('FILE_READ_ONLY');

    // Removing the ACL override restores editor's full write rights
    const clearAclRes = await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}/access/${editor.id}`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(clearAclRes.status).toBe(200);

    const restoredPermRes = await editor.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}`
    );
    expect(restoredPermRes.status).toBe(200);
    expect(restoredPermRes.body.data.file.effectivePermission).toBe('edit');
  });

  it('blocks folder move cycles & deleting folders with locked children, and enforces expectedVersion CAS', async () => {
    // 1. Folder cycle guard: moving `src/` into itself or its subfolder `src/utils/` fails 400
    const selfCycleRes = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ parentId: srcFolderId });
    expect(selfCycleRes.status).toBe(400);
    expect(selfCycleRes.body.error.code).toBe('FOLDER_CYCLE');

    const descendantCycleRes = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ parentId: utilsFolderId });
    expect(descendantCycleRes.status).toBe(400);
    expect(descendantCycleRes.body.error.code).toBe('FOLDER_CYCLE');

    // 2. Locked-descendant delete guard: deleting `src/` while `src/utils/math.ts` is locked fails 403
    const editorRelock = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(editorRelock.status).toBe(200);

    const deleteLockedFolder = await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcFolderId}`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(deleteLockedFolder.status).toBe(403);
    expect(deleteLockedFolder.body.error.code).toBe('DESCENDANT_LOCKED');

    // Owner rescue-unlock clears the blocking lock cleanly
    const ownerRescueUnlock = await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${utilsMathFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(ownerRescueUnlock.status).toBe(200);
    expect(ownerRescueUnlock.body.data.file.lockedById).toBeNull();

    // 3. Optimistic concurrency control (`expectedVersion` CAS): stale version rejects 409 with latest content
    const latestRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`
    );
    expect(latestRes.status).toBe(200);
    const baseVersion = latestRes.body.data.file.version as number;

    const winningSave = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        content: '# Winner concurrent edit\n',
        expectedVersion: baseVersion,
      });
    expect(winningSave.status).toBe(200);
    expect(winningSave.body.data.file.version).toBe(baseVersion + 1);

    const staleSave = await editor.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${readmeFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        content: '# Stale conflicting edit\n',
        expectedVersion: baseVersion,
      });
    expect(staleSave.status).toBe(409);
    expect(staleSave.body.error.code).toBe('FILE_VERSION_CONFLICT');
    expect(staleSave.body.error.details.version).toBe(baseVersion + 1);
    expect(staleSave.body.error.details.content).toBe('# Winner concurrent edit\n');
  });
});
