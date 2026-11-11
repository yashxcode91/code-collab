import { SupportedLanguage } from '@codecollab/shared';

/**
 * Blueprint node returned before DB insertion; symbolic `key` / `parentKey`
 * strings are mapped to freshly generated UUIDs inside `createProject`.
 */
export interface StarterFileSpec {
  key: string;
  parentKey?: string;
  name: string;
  nodeType: 'FILE' | 'FOLDER';
  content: string;
}

const ENTRY_FILES: Record<SupportedLanguage, { name: string; content: string }> = {
  typescript: {
    name: 'index.ts',
    content: `function greet(team: string): string {\n  return \`Hello from \${team} in CodeCollab Studio!\`;\n}\n\nconsole.log(greet('Engineering'));\n`,
  },
  javascript: {
    name: 'index.js',
    content: `function greet(team) {\n  return \`Hello from \${team} in CodeCollab Studio!\`;\n}\n\nconsole.log(greet('Engineering'));\n`,
  },
  python: {
    name: 'main.py',
    content: `def greet(team: str) -> str:\n    return f"Hello from {team} in CodeCollab Studio!"\n\n\nif __name__ == "__main__":\n    print(greet("Engineering"))\n`,
  },
  cpp: {
    name: 'main.cpp',
    content: `#include <iostream>\n#include <string>\n\nint main() {\n    std::string team = "Engineering";\n    std::cout << "Hello from " << team << " in CodeCollab Studio!\\n";\n    return 0;\n}\n`,
  },
  java: {
    name: 'Main.java',
    content: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from CodeCollab Studio!");\n    }\n}\n`,
  },
};

/** Generates the starter workspace tree (`README.md`, `src/`, and a runnable entry file). */
export const buildStarterWorkspaceNodes = (
  projectName: string,
  language: SupportedLanguage
): StarterFileSpec[] => {
  const entry = ENTRY_FILES[language];
  return [
    {
      key: 'readme',
      name: 'README.md',
      nodeType: 'FILE',
      content: `# ${projectName}\n\nCollaborative **${language}** workspace in CodeCollab Studio.\n\n- Entry file: \`src/${entry.name}\`\n- Default branch: \`main\`\n`,
    },
    {
      key: 'src',
      name: 'src',
      nodeType: 'FOLDER',
      content: '',
    },
    {
      key: 'entry',
      parentKey: 'src',
      name: entry.name,
      nodeType: 'FILE',
      content: entry.content,
    },
  ];
};
