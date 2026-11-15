/**
 * Automated Live Production Stack Integration & Regression Test Suite
 * Tests the entire running Devnolith Docker Compose stack over port 80.
 */
import http from 'node:http';
import WebSocket from 'ws';

const BASE_URL = 'http://localhost';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

async function makeRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; data: string; json?: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;

    const reqHeaders: Record<string, string> = {
      origin: BASE_URL,
      ...(options.headers || {}),
    };

    if (postData && !reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers: reqHeaders,
        timeout: 15000,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let json: any = undefined;
          try {
            json = JSON.parse(rawData);
          } catch {
            // not json
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            data: rawData,
            json,
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${path} timed out after 15s`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function parseCookies(headers: http.IncomingHttpHeaders): Record<string, string> {
  const setCookie = headers['set-cookie'];
  const cookies: Record<string, string> = {};
  if (!setCookie) return cookies;

  const rawList = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const str of rawList) {
    const parts = str.split(';')[0].split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  }
  return cookies;
}

function formatCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function runTest(name: string, fn: () => Promise<void>) {
  process.stdout.write(`• Testing ${name}... `);
  try {
    await fn();
    console.log(`\x1b[32mPASSED\x1b[0m`);
    results.push({ name, passed: true });
  } catch (err: any) {
    console.log(`\x1b[31mFAILED\x1b[0m`);
    console.error(`  Error: ${err.message}`);
    results.push({ name, passed: false, error: err.message });
  }
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`  Devnolith Production Live Diagnostic & Verification`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`======================================================\n`);

  let sessionCookies: Record<string, string> = {};
  let csrfToken = '';
  let authToken = '';
  let testUserId = '';
  let testProjectId = '';

  // 1. Gateway Health
  await runTest('Nginx Gateway Health Route (/nginx-health)', async () => {
    const res = await makeRequest('/nginx-health');
    if (res.statusCode !== 200 || !res.data.includes('healthy')) {
      throw new Error(`Expected 200 OK with 'healthy', got status ${res.statusCode}: ${res.data}`);
    }
  });

  // 2. Gateway Security Headers & SPA
  await runTest('Gateway Security Headers & SPA Entrypoint (/)', async () => {
    const res = await makeRequest('/');
    if (res.statusCode !== 200) {
      throw new Error(`Expected 200 OK for SPA root, got ${res.statusCode}`);
    }
    if (!res.headers['x-content-type-options']) {
      throw new Error(`Missing X-Content-Type-Options header`);
    }
    if (!res.data.includes('<div id="root">') && !res.data.includes('<!DOCTYPE html>')) {
      throw new Error(`Response does not look like Vite index.html`);
    }
  });

  // 3. Backend API Health
  await runTest('Backend Server Health Endpoint (/api/health)', async () => {
    const res = await makeRequest('/api/health');
    if (res.statusCode !== 200) {
      throw new Error(`Expected 200 OK, got ${res.statusCode}: ${res.data}`);
    }
    if (!res.json?.success || !res.json?.data?.services?.database || !res.json?.data?.services?.redis) {
      throw new Error(`Unhealthy services reported: ${JSON.stringify(res.json)}`);
    }
  });

  // 4. CSRF Defense Verification (Origin Matching)
  await runTest('CSRF Defense Verification (Allowed Origin)', async () => {
    // A request with wrong origin must be blocked with 403 CSRF_INVALID_ORIGIN
    const blockedRes = await makeRequest('/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'http://malicious-site.com',
      },
      body: { email: 'test@example.com', password: 'password' },
    });
    if (blockedRes.statusCode !== 403) {
      throw new Error(`Expected 403 for malicious origin, got ${blockedRes.statusCode}`);
    }
  });

  // 5. User Registration
  const testEmail = `prod-test-${Date.now()}@devnolith.com`;
  const testPassword = 'Password123!Secure';
  const testUsername = `testuser_${Date.now().toString().slice(-6)}`;

  await runTest('User Registration (/api/auth/register)', async () => {
    const res = await makeRequest('/api/auth/register', {
      method: 'POST',
      headers: {
        'x-csrf-token': csrfToken,
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        email: testEmail,
        username: testUsername,
        password: testPassword,
      },
    });

    if (res.statusCode !== 201 && res.statusCode !== 200) {
      throw new Error(`Registration failed (${res.statusCode}): ${res.data}`);
    }

    const cookies = parseCookies(res.headers);
    sessionCookies = { ...sessionCookies, ...cookies };
    authToken = res.json?.data?.tokens?.accessToken || '';
    testUserId = res.json?.data?.user?.id || '';
  });

  // 6. User Login
  await runTest('User Login (/api/auth/login)', async () => {
    const res = await makeRequest('/api/auth/login', {
      method: 'POST',
      headers: {
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        identifier: testEmail,
        password: testPassword,
      },
    });

    if (res.statusCode !== 200) {
      throw new Error(`Login failed (${res.statusCode}): ${res.data}`);
    }

    const cookies = parseCookies(res.headers);
    sessionCookies = { ...sessionCookies, ...cookies };
    authToken = res.json?.data?.tokens?.accessToken || authToken;
  });

  // 7. Authenticated User Profile (/api/auth/me)
  await runTest('Authenticated Profile Check (/api/auth/me)', async () => {
    const res = await makeRequest('/api/auth/me', {
      headers: {
        authorization: `Bearer ${authToken}`,
        cookie: formatCookieHeader(sessionCookies),
      },
    });

    if (res.statusCode !== 200) {
      throw new Error(`Failed to fetch /api/auth/me (${res.statusCode}): ${res.data}`);
    }
    if (res.json?.data?.user?.email !== testEmail) {
      throw new Error(`Email mismatch in /api/auth/me: ${JSON.stringify(res.json)}`);
    }
  });

  // 8. Create Project Workspace
  let branchId = '';
  await runTest('Create Project Workspace (/api/projects)', async () => {
    const res = await makeRequest('/api/projects', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        'x-csrf-token': csrfToken,
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        name: `Production Verification Project ${Date.now()}`,
        description: 'Automated production suite verification project',
        visibility: 'PRIVATE',
      },
    });

    if (res.statusCode !== 201 && res.statusCode !== 200) {
      throw new Error(`Project creation failed (${res.statusCode}): ${res.data}`);
    }

    testProjectId = res.json?.data?.project?.id || res.json?.data?.id || '';
    if (!testProjectId) {
      throw new Error(`No project id returned: ${JSON.stringify(res.json)}`);
    }

    // Get default branch
    const branchRes = await makeRequest(`/api/projects/${testProjectId}`, {
      headers: {
        authorization: `Bearer ${authToken}`,
        cookie: formatCookieHeader(sessionCookies),
      },
    });
    const defaultBranch = branchRes.json?.data?.branches?.find((b: any) => b.isDefault) || branchRes.json?.data?.branches?.[0];
    branchId = defaultBranch?.id || '';
    if (!branchId) {
      throw new Error(`Failed to resolve default branch ID from project detail`);
    }
  });

  // 9. Execute Code in Sandbox via BullMQ Worker (C++ Execution)
  await runTest('Execute C++ Code via Isolated Worker Sandbox (/api/projects/.../runs)', async () => {
    const runRes = await makeRequest(`/api/projects/${testProjectId}/branches/${branchId}/runs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        language: 'cpp',
        sourceCode: `#include <iostream>\nint main() { std::cout << "DEVNOLITH_PROD_CPP_OK" << std::endl; return 0; }`,
      },
    });

    if (runRes.statusCode !== 202 && runRes.statusCode !== 200 && runRes.statusCode !== 201) {
      throw new Error(`Failed to queue execution run (${runRes.statusCode}): ${runRes.data}`);
    }

    const runId = runRes.json?.data?.run?.id || runRes.json?.data?.id || '';
    if (!runId) {
      throw new Error(`No runId returned: ${JSON.stringify(runRes.json)}`);
    }

    // Poll for completion (max 25s)
    let completed = false;
    const startMs = Date.now();
    while (Date.now() - startMs < 25000) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await makeRequest(`/api/projects/${testProjectId}/runs/${runId}`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          cookie: formatCookieHeader(sessionCookies),
        },
      });

      const status = pollRes.json?.data?.run?.status || pollRes.json?.data?.status;
      if (status === 'COMPLETED') {
        const stdout = pollRes.json?.data?.run?.stdout || pollRes.json?.data?.stdout || '';
        if (!stdout.includes('DEVNOLITH_PROD_CPP_OK')) {
          throw new Error(`Run completed but stdout does not contain expected string. Got: ${stdout}`);
        }
        completed = true;
        break;
      } else if (status === 'FAILED') {
        const stderr = pollRes.json?.data?.run?.stderr || pollRes.json?.data?.stderr || '';
        throw new Error(`Run failed with error: ${stderr}`);
      }
    }

    if (!completed) {
      throw new Error(`Execution run timed out waiting for worker`);
    }
  });

  // 10. Execute Code in Sandbox via BullMQ Worker (Python Execution)
  await runTest('Execute Python Code via Isolated Worker Sandbox (/api/projects/.../runs)', async () => {
    const runRes = await makeRequest(`/api/projects/${testProjectId}/branches/${branchId}/runs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        language: 'python',
        sourceCode: `print("DEVNOLITH_PROD_PYTHON_OK")`,
      },
    });

    if (runRes.statusCode !== 202 && runRes.statusCode !== 200 && runRes.statusCode !== 201) {
      throw new Error(`Failed to queue python run (${runRes.statusCode}): ${runRes.data}`);
    }

    const runId = runRes.json?.data?.run?.id || runRes.json?.data?.id || '';
    let completed = false;
    const startMs = Date.now();
    while (Date.now() - startMs < 20000) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await makeRequest(`/api/projects/${testProjectId}/runs/${runId}`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          cookie: formatCookieHeader(sessionCookies),
        },
      });

      const status = pollRes.json?.data?.run?.status || pollRes.json?.data?.status;
      if (status === 'COMPLETED') {
        const stdout = pollRes.json?.data?.run?.stdout || pollRes.json?.data?.stdout || '';
        if (!stdout.includes('DEVNOLITH_PROD_PYTHON_OK')) {
          throw new Error(`Run completed but stdout unexpected: ${stdout}`);
        }
        completed = true;
        break;
      } else if (status === 'FAILED') {
        throw new Error(`Run failed: ${pollRes.json?.data?.stderr}`);
      }
    }

    if (!completed) {
      throw new Error(`Python execution run timed out`);
    }
  });

  // 11. Live Preview Sandbox Lifecycle (Start -> Preview Proxy -> Stop)
  await runTest('Live Preview Sandbox Lifecycle (/api/projects/.../sandbox/start)', async () => {
    const startRes = await makeRequest(`/api/projects/${testProjectId}/sandbox/start`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        branchId,
        primaryPort: 5173,
      },
    });

    if (startRes.statusCode !== 200 && startRes.statusCode !== 201) {
      throw new Error(`Failed to start preview sandbox (${startRes.statusCode}): ${startRes.data}`);
    }

    const sandbox = startRes.json?.data?.sandbox || startRes.json?.data;
    if (sandbox.status !== 'RUNNING' && sandbox.status !== 'STARTING') {
      throw new Error(`Sandbox in invalid state: ${JSON.stringify(sandbox)}`);
    }

    // Wait 2s for container to bind port
    await new Promise((r) => setTimeout(r, 2000));

    // Test proxying via gateway /preview/:projectId/:port/
    const previewRes = await makeRequest(`/preview/${testProjectId}/5173/?token=${encodeURIComponent(sandbox.previewToken || '')}`);
    if (previewRes.statusCode !== 200) {
      throw new Error(`Preview gateway proxy returned status ${previewRes.statusCode}: ${previewRes.data.slice(0, 200)}`);
    }

    // Verify preview content
    if (!previewRes.data.includes('Your CodeCollab Project is Live!') && !previewRes.data.includes('<!DOCTYPE html>')) {
      throw new Error(`Preview content unexpected: ${previewRes.data.slice(0, 300)}`);
    }

    // 12. Test Terminal WebSocket connection while container is running
    await runTest('Interactive Terminal WebSocket (/terminal/:projectId)', async () => {
      const wsUrl = `ws://localhost/terminal/${encodeURIComponent(testProjectId)}?token=${encodeURIComponent(sandbox.previewToken || '')}`;
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {
          headers: {
            origin: 'http://localhost',
            cookie: formatCookieHeader(sessionCookies),
          },
        });
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connection timed out after 5s'));
        }, 5000);

        ws.on('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    });

    // Stop sandbox
    const stopRes = await makeRequest(`/api/projects/${testProjectId}/sandbox/stop`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        cookie: formatCookieHeader(sessionCookies),
      },
      body: {
        branchId,
      },
    });

    if (stopRes.statusCode !== 200) {
      throw new Error(`Failed to stop sandbox (${stopRes.statusCode}): ${stopRes.data}`);
    }
  });

  // Print Summary
  console.log(`\n======================================================`);
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    console.log(`\x1b[32m🎉 ALL ${results.length}/${results.length} LIVE PRODUCTION TESTS PASSED!\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m❌ ${failed.length}/${results.length} TESTS FAILED:\x1b[0m`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
