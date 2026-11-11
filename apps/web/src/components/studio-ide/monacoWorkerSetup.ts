import { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

export const STUDIO_LIGHT_THEME = 'codecollab-light';
export const STUDIO_DARK_THEME = 'codecollab-dark';

let initialized = false;

/**
 * Configures `@monaco-editor/react` to run strictly against the locally installed
 * `monaco-editor` package and Vite's bundled web workers (zero CDN scripts).
 *
 * IMPORTANT: Only import this module inside the lazy-loaded Studio route subtree so
 * Login, Register, and Dashboard initial bundles never pay Monaco's weight.
 */
export function ensureMonacoConfigured() {
  if (initialized) return;
  initialized = true;

  // Bind Vite module web workers per language mode
  (self as typeof self & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  // Point `@monaco-editor/react`'s loader directly to the local Vite-bundled Monaco instance
  loader.config({ monaco: monaco as unknown as Monaco });

  // Tune TypeScript/JavaScript diagnostics cleanly for multi-language studio starter snippets
  const sharedCompilerOptions = {
    target: monaco.typescript.ScriptTarget.ES2020,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  };

  monaco.typescript.typescriptDefaults.setCompilerOptions(sharedCompilerOptions);
  monaco.typescript.javascriptDefaults.setCompilerOptions({
    ...sharedCompilerOptions,
    checkJs: false,
  });

  // Define aligned Light Alabaster & Dark Obsidian editor themes matching `index.css`
  monaco.editor.defineTheme(STUDIO_LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C2410C', fontStyle: 'bold' },
      { token: 'string', foreground: '0F766E' },
      { token: 'number', foreground: 'B45309' },
      { token: 'type', foreground: '1D4ED8' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#131722',
      'editorLineNumber.foreground': '#94A3B8',
      'editorLineNumber.activeForeground': '#EA580C',
      'editor.lineHighlightBackground': '#F8FAFC',
      'editorCursor.foreground': '#EA580C',
      'editor.selectionBackground': '#FDBA7455',
      'editor.inactiveSelectionBackground': '#E2E8F088',
      'editorIndentGuide.background1': '#E2E8F0',
      'editorIndentGuide.activeBackground1': '#CBD5E1',
      'editorGutter.background': '#FFFFFF',
    },
  });

  monaco.editor.defineTheme(STUDIO_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'FB923C', fontStyle: 'bold' },
      { token: 'string', foreground: '5EEAD4' },
      { token: 'number', foreground: 'FCD34D' },
      { token: 'type', foreground: '93C5FD' },
    ],
    colors: {
      'editor.background': '#0F1117',
      'editor.foreground': '#F1F5F9',
      'editorLineNumber.foreground': '#475569',
      'editorLineNumber.activeForeground': '#FB923C',
      'editor.lineHighlightBackground': '#171A23',
      'editorCursor.foreground': '#FB923C',
      'editor.selectionBackground': '#EA580C44',
      'editor.inactiveSelectionBackground': '#1E293B88',
      'editorIndentGuide.background1': '#1E2430',
      'editorIndentGuide.activeBackground1': '#334155',
      'editorGutter.background': '#0F1117',
    },
  });
}

/**
 * Disposes Monaco text models matching an `inmemory://studio/...` URI prefix
 * when switching branches, deleting/renaming files, or closing tabs / leaving Studio.
 */
export function disposeStudioModels(uriPrefix = 'inmemory://studio/') {
  for (const model of monaco.editor.getModels()) {
    const uriStr = model.uri.toString();
    if (uriStr.startsWith(uriPrefix)) {
      model.dispose();
    }
  }
}
