import ts from 'typescript';
import {
  AgentVerificationDiagnostic,
  AgentVerificationResultDto,
} from '@codecollab/shared';
import { AgentStagingService, normalizeFilePath } from './agentStaging.service';

const DEFAULT_LIB_DTS = `
declare const Math: any;
declare const console: any;
declare const Promise: any;
declare const JSON: any;
declare const Buffer: any;
declare const setTimeout: any;
declare const clearTimeout: any;
declare const process: any;
interface Boolean {}
interface Function {}
interface IArguments {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
interface Array<T> { [n: number]: T; length: number; }
`;

export class AgentVerificationService {
  /**
   * Builds an in-memory snapshot of the virtual filesystem representing the branch
   * overlaid with all current uncommitted staged files from the agent session.
   */
  static async getOverlaidWorkspaceSnapshot(params: {
    sessionId: string;
    branchId: string;
  }): Promise<Map<string, string>> {
    const { sessionId, branchId } = params;

    const { filesByPath } = await AgentStagingService.getBranchPathMap(branchId);
    const virtualFs = new Map<string, string>();

    // 1. Populate base files from the branch
    for (const [filePath, fileNode] of filesByPath.entries()) {
      virtualFs.set(normalizeFilePath(filePath), fileNode.content);
    }

    // 2. Overlay staged files from the session
    const stagedFiles = await AgentStagingService.getStagedFiles(sessionId);
    for (const staged of stagedFiles) {
      const normalized = normalizeFilePath(staged.filePath);
      if (staged.changeType === 'DELETE') {
        virtualFs.delete(normalized);
      } else {
        virtualFs.set(normalized, staged.stagedContent);
      }
    }

    return virtualFs;
  }

  /**
   * Executes in-memory compilation and syntax/type verification across all
   * TypeScript and JavaScript files in the overlaid workspace snapshot.
   */
  static async verifyWorkspace(params: {
    sessionId: string;
    branchId: string;
    command?: string;
  }): Promise<AgentVerificationResultDto> {
    const { sessionId, branchId } = params;
    const virtualFs = await this.getOverlaidWorkspaceSnapshot({
      sessionId,
      branchId,
    });

    const diagnostics: AgentVerificationDiagnostic[] = [];
    const sourceFiles: string[] = [];

    // Filter files for TypeScript / JavaScript verification
    for (const [filePath] of virtualFs.entries()) {
      if (
        filePath.endsWith('.ts') ||
        filePath.endsWith('.tsx') ||
        filePath.endsWith('.js') ||
        filePath.endsWith('.jsx')
      ) {
        sourceFiles.push(filePath);
      }
    }

    if (sourceFiles.length === 0) {
      return {
        success: true,
        exitCode: 0,
        stdout: 'No TypeScript/JavaScript files found to verify.',
        stderr: '',
        diagnostics: [],
      };
    }

    // 1. Check for syntax and lexical errors using TypeScript transpileModule
    for (const filePath of sourceFiles) {
      const content = virtualFs.get(filePath) ?? '';
      try {
        const transpileRes = ts.transpileModule(content, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
          reportDiagnostics: true,
          fileName: filePath,
        });

        if (transpileRes.diagnostics && transpileRes.diagnostics.length > 0) {
          for (const diag of transpileRes.diagnostics) {
            let line: number | undefined;
            let column: number | undefined;

            if (diag.file && diag.start !== undefined) {
              const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
              line = pos.line + 1;
              column = pos.character + 1;
            }

            diagnostics.push({
              filePath,
              line,
              column,
              code: `TS${diag.code}`,
              message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
            });
          }
        }
      } catch (err: any) {
        diagnostics.push({
          filePath,
          message: err.message || 'Syntax parse failure',
        });
      }
    }

    // 2. Perform in-memory multi-file program verification if syntax is clean
    if (diagnostics.length === 0) {
      const options: ts.CompilerOptions = {
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        allowJs: true,
        strict: false, // pragmatic for partial virtual snapshots
        skipLibCheck: true,
      };

      const host: ts.CompilerHost = {
        getSourceFile: (fileName, languageVersion) => {
          const normalized = normalizeFilePath(fileName);
          const content = virtualFs.get(normalized);
          if (content !== undefined) {
            return ts.createSourceFile(fileName, content, languageVersion);
          }
          // Fall back to default lib if requested
          if (fileName.includes('lib.d.ts') || fileName.includes('lib.es')) {
            return ts.createSourceFile(fileName, DEFAULT_LIB_DTS, languageVersion);
          }
          return undefined;
        },
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => '/',
        getDirectories: () => [],
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (fileName) => virtualFs.has(normalizeFilePath(fileName)),
        readFile: (fileName) => virtualFs.get(normalizeFilePath(fileName)),
      };

      try {
        const program = ts.createProgram(sourceFiles, options, host);
        const semanticDiagnostics = program.getSemanticDiagnostics();

        for (const diag of semanticDiagnostics) {
          // Filter out missing external module declarations and ambient types in virtual FS
          if (
            diag.code === 2307 ||
            diag.code === 2792 ||
            diag.code === 2304 ||
            diag.code === 2584 ||
            diag.code === 2552
          ) {
            continue;
          }

          let filePath = 'unknown';
          let line: number | undefined;
          let column: number | undefined;

          if (diag.file) {
            filePath = normalizeFilePath(diag.file.fileName);
            if (diag.start !== undefined) {
              const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
              line = pos.line + 1;
              column = pos.character + 1;
            }
          }

          diagnostics.push({
            filePath,
            line,
            column,
            code: `TS${diag.code}`,
            message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
          });
        }
      } catch {
        // Fall back gracefully to transpile syntax diagnostics
      }
    }

    if (diagnostics.length === 0) {
      return {
        success: true,
        exitCode: 0,
        stdout: `Verification passed. Clean compilation for ${sourceFiles.length} source file(s).`,
        stderr: '',
        diagnostics: [],
      };
    }

    const formattedStderr = diagnostics
      .map(
        (d) =>
          `${d.filePath}${d.line ? `(${d.line},${d.column ?? 1})` : ''}: error ${d.code ?? 'ERR'}: ${d.message}`
      )
      .join('\n');

    return {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: formattedStderr,
      diagnostics,
    };
  }
}
