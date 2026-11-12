import { spawn } from 'node:child_process';
import type { SupportedLanguage } from '@codecollab/shared';

export interface ResolvedExecutionEntry {
  entryFileName: string;
  javaMainClass: string;
}

export interface LanguageRuntimeConfig {
  language: SupportedLanguage;
  image: string;
  defaultEntryFileName: string;
  compileArgv: ((entry: ResolvedExecutionEntry) => string[]) | null;
  runArgv: (entry: ResolvedExecutionEntry) => string[];
}

const JAVA_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;
const JAVA_PACKAGE_RE =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,15}$/;
const DOCKER_IMAGE_REF_RE =
  /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})?$/;

const JAVA_RESERVED_KEYWORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'try',
  'void',
  'volatile',
  'while',
  'record',
  'sealed',
  'permits',
  'var',
]);

export const DEFAULT_RUNNER_IMAGES = [
  'codecollab-runner-node:v1',
  'codecollab-runner-ts:v1',
  'codecollab-runner-python:v1',
  'codecollab-runner-cpp:v1',
  'codecollab-runner-java:v1',
] as const;

const isValidJavaIdentifier = (value: string): boolean =>
  JAVA_IDENTIFIER_RE.test(value) && !JAVA_RESERVED_KEYWORDS.has(value);

const stripJavaCommentsAndStrings = (source: string): string =>
  source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (token) => {
      if (token.startsWith('"""') || token.startsWith('"')) return '""';
      if (token.startsWith("'")) return "''";
      return ' ';
    }
  );

const assertSafeWorkspaceEntry = (fileName: string): string => {
  if (
    !fileName ||
    fileName.startsWith('-') ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('..')
  ) {
    throw new Error(`Unsafe workspace entrypoint: ${fileName}`);
  }
  return fileName;
};

/**
 * Validates that a configured Docker runner image matches strict image reference syntax
 * (blocking CLI flag injection via `--...`) and belongs to our server allowlist.
 */
export const validateRunnerImage = (
  image: string,
  extraAllowedEnv = process.env.RUNNER_ALLOWED_IMAGES
): string => {
  const trimmed = image.trim();
  if (!trimmed || trimmed.startsWith('-') || !DOCKER_IMAGE_REF_RE.test(trimmed)) {
    throw new Error(`Invalid runner image reference: "${image}"`);
  }

  const allowed = new Set<string>(DEFAULT_RUNNER_IMAGES);
  if (extraAllowedEnv) {
    for (const item of extraAllowedEnv.split(',')) {
      const clean = item.trim();
      if (clean && DOCKER_IMAGE_REF_RE.test(clean)) {
        allowed.add(clean);
      }
    }
  }

  if (!allowed.has(trimmed)) {
    throw new Error(`Runner image "${trimmed}" is not in the allowlist`);
  }

  return trimmed;
};

/**
 * Resolves a safe single-segment entrypoint filename inside `/workspace` without ever
 * allowing path traversal, shell metacharacters, leading dashes, or mismatched Java public classes.
 */
export const resolveSafeEntry = (
  language: SupportedLanguage,
  requestedFileName?: string | null,
  sourceCode?: string
): ResolvedExecutionEntry => {
  if (language === 'java') {
    const cleanedSource = sourceCode ? stripJavaCommentsAndStrings(sourceCode) : '';

    let packagePrefix = '';
    if (cleanedSource) {
      const pkgMatch = /^\s*package\s+([A-Za-z0-9_.]+)\s*;/m.exec(cleanedSource);
      if (pkgMatch && JAVA_PACKAGE_RE.test(pkgMatch[1])) {
        const segments = pkgMatch[1].split('.');
        if (segments.every((seg) => isValidJavaIdentifier(seg))) {
          packagePrefix = `${pkgMatch[1]}.`;
        }
      }
    }

    // 1. Prioritize an explicit `public class <Name>` declaration so javac never rejects filename mismatches
    if (cleanedSource) {
      const publicMatch =
        /\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
          cleanedSource
        );
      if (publicMatch && isValidJavaIdentifier(publicMatch[1])) {
        return {
          entryFileName: assertSafeWorkspaceEntry(`${publicMatch[1]}.java`),
          javaMainClass: `${packagePrefix}${publicMatch[1]}`,
        };
      }
    }

    // 2. Otherwise honor a safe requested `.java` filename stem if valid
    if (requestedFileName) {
      const trimmed = requestedFileName.trim();
      if (trimmed.endsWith('.java')) {
        const stem = trimmed.slice(0, -5);
        if (isValidJavaIdentifier(stem)) {
          return {
            entryFileName: assertSafeWorkspaceEntry(`${stem}.java`),
            javaMainClass: `${packagePrefix}${stem}`,
          };
        }
      }
    }

    // 3. Fallback to first non-public class when source code omits `public class`
    if (cleanedSource) {
      const classMatch = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
        cleanedSource
      );
      if (classMatch && isValidJavaIdentifier(classMatch[1])) {
        return {
          entryFileName: assertSafeWorkspaceEntry(`${classMatch[1]}.java`),
          javaMainClass: `${packagePrefix}${classMatch[1]}`,
        };
      }
    }

    return {
      entryFileName: 'Main.java',
      javaMainClass: `${packagePrefix}Main`,
    };
  }

  const fixedNames: Record<Exclude<SupportedLanguage, 'java'>, string> = {
    javascript: 'main.js',
    typescript: 'main.ts',
    python: 'main.py',
    cpp: 'main.cpp',
  };

  return {
    entryFileName: assertSafeWorkspaceEntry(fixedNames[language]),
    javaMainClass: 'Main',
  };
};

/**
 * Trusted server-side language runtime definitions.
 * Compilers and interpreters are prebuilt into non-root Docker images and invoked
 * via strict argv arrays—never user-supplied shell strings.
 */
export const LANGUAGE_RUNTIMES: Record<
  SupportedLanguage,
  LanguageRuntimeConfig
> = {
  javascript: {
    language: 'javascript',
    image: validateRunnerImage(
      process.env.RUNNER_IMAGE_NODE || 'codecollab-runner-node:v1'
    ),
    defaultEntryFileName: 'main.js',
    compileArgv: null,
    runArgv: ({ entryFileName }) => ['node', `/workspace/${entryFileName}`],
  },
  typescript: {
    language: 'typescript',
    image: validateRunnerImage(
      process.env.RUNNER_IMAGE_TYPESCRIPT || 'codecollab-runner-ts:v1'
    ),
    defaultEntryFileName: 'main.ts',
    compileArgv: ({ entryFileName }) => [
      'tsc',
      '--target',
      'ES2022',
      '--lib',
      'ES2022',
      '--module',
      'CommonJS',
      '--moduleResolution',
      'node',
      '--rootDir',
      '/workspace',
      '--typeRoots',
      '/usr/local/lib/node_modules/@types',
      '--strict',
      '--esModuleInterop',
      '--skipLibCheck',
      '--outDir',
      '/build',
      `/workspace/${entryFileName}`,
    ],
    runArgv: ({ entryFileName }) => [
      'node',
      `/build/${entryFileName.replace(/\.ts$/, '.js')}`,
    ],
  },
  python: {
    language: 'python',
    image: validateRunnerImage(
      process.env.RUNNER_IMAGE_PYTHON || 'codecollab-runner-python:v1'
    ),
    defaultEntryFileName: 'main.py',
    compileArgv: null,
    runArgv: ({ entryFileName }) => [
      'python3',
      '-u',
      `/workspace/${entryFileName}`,
    ],
  },
  cpp: {
    language: 'cpp',
    image: validateRunnerImage(
      process.env.RUNNER_IMAGE_CPP || 'codecollab-runner-cpp:v1'
    ),
    defaultEntryFileName: 'main.cpp',
    compileArgv: ({ entryFileName }) => [
      'g++',
      '-std=c++20',
      '-O2',
      '-pipe',
      '-fmax-errors=5',
      '-ftemplate-depth=128',
      `/workspace/${entryFileName}`,
      '-o',
      '/build/main',
    ],
    runArgv: () => ['/build/main'],
  },
  java: {
    language: 'java',
    image: validateRunnerImage(
      process.env.RUNNER_IMAGE_JAVA || 'codecollab-runner-java:v1'
    ),
    defaultEntryFileName: 'Main.java',
    compileArgv: ({ entryFileName }) => [
      'javac',
      '-J-Xmx192m',
      '-J-XX:ActiveProcessorCount=2',
      '-d',
      '/build',
      `/workspace/${entryFileName}`,
    ],
    runArgv: ({ javaMainClass }) => [
      'java',
      '-Xmx192m',
      '-XX:ActiveProcessorCount=2',
      '-cp',
      '/build',
      javaMainClass,
    ],
  },
};

const inspectImageExists = async (image: string): Promise<boolean> =>
  new Promise((resolve) => {
    const proc = spawn('docker', ['image', 'inspect', image], {
      stdio: 'ignore',
    });
    proc.once('close', (code) => resolve(code === 0));
    proc.once('error', () => resolve(false));
  });

/**
 * Preflight check run during worker boot to surface missing runner images immediately.
 */
export const verifyRunnerImagesAvailable = async (): Promise<{
  missing: string[];
}> => {
  const uniqueImages = Array.from(
    new Set(Object.values(LANGUAGE_RUNTIMES).map((cfg) => cfg.image))
  );
  const results = await Promise.all(
    uniqueImages.map(async (image) => ({
      image,
      exists: await inspectImageExists(image),
    }))
  );
  const missing = results.filter((r) => !r.exists).map((r) => r.image);
  return { missing };
};
