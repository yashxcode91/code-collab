import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXECUTION_LIMITS } from '@codecollab/shared';
import { resolveSafeEntry, validateRunnerImage } from '../config/runtimes';
import {
  executeInDockerSandbox,
  reconcileOrphanedDockerResources,
  type ActiveExecutionHandle,
} from './dockerRunner';

describe('resolveSafeEntry & validateRunnerImage', () => {
  it('blocks traversal/unsafe entry filenames and normalizes fixed runtimes', () => {
    expect(resolveSafeEntry('python', '../../etc/passwd')).toEqual({
      entryFileName: 'main.py',
      javaMainClass: 'Main',
    });
    expect(resolveSafeEntry('cpp', 'evil;rm -rf /')).toEqual({
      entryFileName: 'main.cpp',
      javaMainClass: 'Main',
    });
  });

  it('infers safe Java class names cleanly, ignoring comments and mismatched filenames', () => {
    expect(
      resolveSafeEntry(
        'java',
        'App.java',
        `// public class FakeComment
         /* public class BlockFake {} */
         public class Solution {
           public static void main(String[] args) {}
         }`
      )
    ).toEqual({
      entryFileName: 'Solution.java',
      javaMainClass: 'Solution',
    });

    expect(resolveSafeEntry('java', 'class.java', '')).toEqual({
      entryFileName: 'Main.java',
      javaMainClass: 'Main',
    });

    expect(resolveSafeEntry('java', '-agentlib.java', '')).toEqual({
      entryFileName: 'Main.java',
      javaMainClass: 'Main',
    });

    expect(
      resolveSafeEntry(
        'java',
        'Main.java',
        'package demo.app;\npublic class DemoMain {}'
      )
    ).toEqual({
      entryFileName: 'DemoMain.java',
      javaMainClass: 'demo.app.DemoMain',
    });

    expect(
      resolveSafeEntry(
        'java',
        'Wrong.java',
        `public class NotPicked {}`
      )
    ).toEqual({
      entryFileName: 'NotPicked.java',
      javaMainClass: 'NotPicked',
    });

    expect(
      resolveSafeEntry(
        'java',
        'Wrong.java',
        `class Holder {
           String banner = """
             public class FakeTextBlock {}
           """;
           char quote = '"';
         }
         public class RealEntry {}`
      )
    ).toEqual({
      entryFileName: 'RealEntry.java',
      javaMainClass: 'RealEntry',
    });
  });

  it('rejects unallowlisted images and Docker CLI flag injection attempts', () => {
    expect(validateRunnerImage('codecollab-runner-node:v1')).toBe(
      'codecollab-runner-node:v1'
    );
    expect(() => validateRunnerImage('--privileged')).toThrow();
    expect(() => validateRunnerImage('evil/backdoor:latest')).toThrow();
    expect(
      validateRunnerImage('custom/runner:v2', 'custom/runner:v2')
    ).toBe('custom/runner:v2');
  });
});

describe('executeInDockerSandbox (real isolated containers)', () => {
  it('runs JavaScript as non-root UID 10001 with read-only rootfs and network=none', async () => {
    const result = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'javascript',
      sourceCode: `
        const fs = require('node:fs');
        const net = require('node:net');
        console.log('uid:' + process.getuid());
        try {
          fs.writeFileSync('/root_escape.txt', 'fail');
          console.log('rootfs:writable');
        } catch (err) {
          console.log('rootfs:' + err.code);
        }
        const sock = net.createConnection({ host: '1.1.1.1', port: 80 });
        sock.on('error', (err) => {
          console.log('net:' + err.code);
        });
      `,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('uid:10001');
    expect(result.stdout).toMatch(/rootfs:(EROFS|EACCES)/);
    expect(result.stdout).toMatch(/net:(ENETUNREACH|EACCES|EINVAL|EHOSTUNREACH)/);
  }, 20_000);

  it('compiles and runs TypeScript with Node built-in types cleanly', async () => {
    const result = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'typescript',
      initialStdin: 'typed-input\n',
      sourceCode: `
        import * as path from 'node:path';
        process.stdin.once('data', (chunk: Buffer) => {
          const line = chunk.toString('utf8').trim();
          const greet = (name: string): string => \`Hello, \${name}:\${line}:\${path.basename('/workspace/main.ts')}!\`;
          console.log(greet('CodeCollab TS'));
          process.exit(0);
        });
      `,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.stdout.trim()).toBe('Hello, CodeCollab TS:typed-input:main.ts!');
  }, 20_000);

  it('runs Python cleanly with initialStdin', async () => {
    let handle: ActiveExecutionHandle | null = null;
    const result = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'python',
      initialStdin: 'CodeCollab\n',
      sourceCode: `
name = input()
print(f"Hi {name}!")
      `,
      onSpawned: (h) => {
        handle = h;
      },
    });

    expect(handle).not.toBeNull();
    expect(result.status).toBe('COMPLETED');
    expect(result.stdout.trim()).toBe('Hi CodeCollab!');
  }, 20_000);

  it('supports Python live stdin streaming cleanly', async () => {
    const result = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'python',
      sourceCode: `
print("READY")
name = input()
print(f"PONG:{name}")
      `,
      onSpawned: (handle) => {
        setTimeout(() => {
          handle.writeStdin('Yash\n');
        }, 350);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.stdout).toContain('READY');
    expect(result.stdout).toContain('PONG:Yash');
  }, 20_000);

  it('compiles and runs C++ and Java cleanly', async () => {
    const cppResult = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'cpp',
      sourceCode: `
        #include <iostream>
        int main() {
          std::cout << "CPP_OK" << std::endl;
          return 0;
        }
      `,
    });
    expect(cppResult.status).toBe('COMPLETED');
    expect(cppResult.stdout.trim()).toBe('CPP_OK');

    const javaResult = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'java',
      entryFileName: 'WrongName.java',
      sourceCode: `
        // public class IgnoredComment
        public class HelloRunner {
          public static void main(String[] args) {
            System.out.println("JAVA_OK");
          }
        }
      `,
    });
    expect(javaResult.status).toBe('COMPLETED');
    expect(javaResult.stdout.trim()).toBe('JAVA_OK');
  }, 30_000);

  it('cleans up temporary workspace directories after compiled execution and compile errors', async () => {
    const okRunId = randomUUID();
    const okRes = await executeInDockerSandbox({
      runId: okRunId,
      language: 'cpp',
      sourceCode: `int main() { return 0; }`,
    });
    expect(okRes.status).toBe('COMPLETED');

    const failRunId = randomUUID();
    const failRes = await executeInDockerSandbox({
      runId: failRunId,
      language: 'cpp',
      sourceCode: `bad syntax`,
    });
    expect(failRes.failureKind).toBe('COMPILE_ERROR');

    const tmpEntries = await fs.readdir(os.tmpdir());
    expect(
      tmpEntries.some((entry) => entry.startsWith(`codecollab-run-${okRunId.slice(0, 8)}`))
    ).toBe(false);
    expect(
      tmpEntries.some((entry) =>
        entry.startsWith(`codecollab-run-${failRunId.slice(0, 8)}`)
      )
    ).toBe(false);
  }, 30_000);

  it('distinguishes COMPILE_ERROR from RUNTIME_ERROR', async () => {
    const compileErr = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'cpp',
      sourceCode: 'int main() { broken syntax ; }',
    });
    expect(compileErr.status).toBe('FAILED');
    expect(compileErr.failureKind).toBe('COMPILE_ERROR');

    const runtimeErr = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'javascript',
      sourceCode: 'throw new Error("boom");',
    });
    expect(runtimeErr.status).toBe('FAILED');
    expect(runtimeErr.failureKind).toBe('RUNTIME_ERROR');
    expect(runtimeErr.stderr).toContain('boom');
  }, 20_000);

  it('caps output at MAX_OUTPUT_BYTES (64 KB) and sets stdoutTruncated', async () => {
    const chunks: number[] = [];
    const result = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'javascript',
      sourceCode: `process.stdout.write('A'.repeat(120000));`,
      onStreamChunk: (ev) => {
        chunks.push(ev.seq);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(
      EXECUTION_LIMITS.MAX_OUTPUT_BYTES
    );
    expect(chunks.length).toBeGreaterThan(0);
  }, 20_000);

  it('terminates runaway loops on timeout and active runs on cancel()', async () => {
    const timeoutRes = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'python',
      timeoutMs: 1_000,
      sourceCode: 'while True:\n  pass',
    });
    expect(timeoutRes.status).toBe('TIMEOUT');
    expect(timeoutRes.failureKind).toBe('TIMEOUT');

    const cancelRes = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'python',
      sourceCode: 'import time\nprint("STARTED")\ntime.sleep(8)',
      onSpawned: (handle) => {
        setTimeout(() => handle.cancel(), 450);
      },
    });
    expect(cancelRes.status).toBe('CANCELLED');
    expect(cancelRes.failureKind).toBe('CANCELLED');
  }, 25_000);

  it('rejects invalid DOCKER_APPARMOR_PROFILE security option strings (POT-01)', async () => {
    const prev = process.env.DOCKER_APPARMOR_PROFILE;
    process.env.DOCKER_APPARMOR_PROFILE = 'bad profile;rm -rf /';
    try {
      await expect(
        executeInDockerSandbox({
          runId: randomUUID(),
          language: 'javascript',
          sourceCode: 'console.log(1)',
        })
      ).rejects.toThrow(/Invalid Docker security option/);
    } finally {
      if (prev === undefined) {
        delete process.env.DOCKER_APPARMOR_PROFILE;
      } else {
        process.env.DOCKER_APPARMOR_PROFILE = prev;
      }
    }
  });

  it('bounds C++ recursive template bombs with -ftemplate-depth and -fmax-errors (POT-02)', async () => {
    const result = await executeInDockerSandbox({
      runId: randomUUID(),
      language: 'cpp',
      sourceCode: `
        template <int N> struct Bomb { static constexpr int val = Bomb<N - 1>::val + 1; };
        int main() { return Bomb<400>::val; }
      `,
    });
    expect(result.status).toBe('FAILED');
    expect(result.failureKind).toBe('COMPILE_ERROR');
  }, 20_000);

  it('aborts compilation and cleans temp dirs when /build exceeds MAX_BUILD_DIR_FILES (VULN-03)', async () => {
    const classes = Array.from({ length: 560 }, (_, idx) => `class C${idx} {}`).join('\n');
    const sourceCode = `${classes}\npublic class QuotaMain { public static void main(String[] a) {} }`;
    const runId = randomUUID();
    const res = await executeInDockerSandbox({
      runId,
      language: 'java',
      sourceCode,
    });
    expect(res.status).toBe('FAILED');
    expect(res.failureKind).toBe('COMPILE_ERROR');
    expect(res.errorMessage).toContain('quota');

    const tmpEntries = await fs.readdir(os.tmpdir());
    expect(
      tmpEntries.some((entry) => entry.startsWith(`codecollab-run-${runId.slice(0, 8)}`))
    ).toBe(false);
  }, 30_000);

  it('cleans up stale temporary sandbox directories during orphan reconciliation (VULN-02)', async () => {
    const staleId = 'deadbeef-0000-4000-8000-000000000000';
    const staleRoot = path.join(os.tmpdir(), `codecollab-run-deadbeef-reconcile`);
    const staleBuild = path.join(staleRoot, 'build');
    await fs.mkdir(staleBuild, { recursive: true });
    await fs.writeFile(path.join(staleBuild, 'artifact.bin'), 'stale');
    await fs.chmod(staleBuild, 0o555);

    const stats = await reconcileOrphanedDockerResources([staleId]);
    expect(stats.removedTempDirs).toBeGreaterThanOrEqual(1);
    await expect(fs.access(staleRoot)).rejects.toThrow();
  });
});
