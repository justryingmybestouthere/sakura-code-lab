import { useMemo, useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';

export type FileNode = {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
};

const STORAGE_KEY = 'sakura-code-lab-state';

const initialProject: FileNode = {
  id: 'workspace',
  name: 'sakura-project',
  type: 'folder',
  children: [
    {
      id: 'src',
      name: 'src',
      type: 'folder',
      children: [
        {
          id: 'src-main',
          name: 'main.ts',
          type: 'file',
          content: `export function run() {\n  const message = 'Welcome to Sakura Code Lab';\n  console.log(message);\n  return message;\n}\n\nrun();\n`
        },
        {
          id: 'src-helper',
          name: 'helper.ts',
          type: 'file',
          content: `export const formatProjectName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');\n`
        }
      ]
    },
    {
      id: 'tests',
      name: 'tests',
      type: 'folder',
      children: [
        {
          id: 'tests-sample',
          name: 'sample.test.ts',
          type: 'file',
          content: `describe('Sakura project smoke test', () => {\n  it('loads the sample project', () => {\n    expect(true).toBe(true);\n  });\n});\n`
        }
      ]
    },
    {
      id: 'readme',
      name: 'README.md',
      type: 'file',
      content: `# Sakura Code Lab\n\nA browser-based IDE inspired by traditional Japanese aesthetics.\n\n## Features\n- Project workspace and file explorer\n- Monaco-based code editor\n- Local persistence with autosave\n- AI chat surface and diagnostics panel\n- Sakura-inspired visual identity\n`
    },
    {
      id: 'pkg',
      name: 'package.json',
      type: 'file',
      content: '{\n  "name": "sakura-code-lab",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}\n'
    }
  ]
};

function findNodeByPath(tree: FileNode, path: string): FileNode | null {
  if (path === '/' || path === tree.name) return tree;

  const segments = path.split('/').filter(Boolean);
  let current: FileNode | undefined = tree;

  for (const segment of segments) {
    if (!current || current.type !== 'folder' || !current.children) return null;
    current = current.children.find((child) => child.name === segment);
    if (!current) return null;
  }

  return current;
}

function getNodePath(tree: FileNode, targetId: string, currentPath = ''): string | null {
  if (tree.id === targetId) return currentPath || tree.name;

  for (const child of tree.children ?? []) {
    const childPath = `${currentPath ? `${currentPath}/` : ''}${child.name}`;
    const found = getNodePath(child, targetId, childPath);
    if (found) return found;
  }

  return null;
}

function walkTree(tree: FileNode, cb: (node: FileNode, path: string) => void, currentPath = '') {
  const nodePath = currentPath ? `${currentPath}/${tree.name}` : tree.name;
  cb(tree, nodePath);

  if (tree.type === 'folder') {
    for (const child of tree.children ?? []) {
      walkTree(child, cb, nodePath);
    }
  }
}

function countFiles(tree: FileNode): number {
  let total = 0;
  walkTree(tree, (node) => {
    if (node.type === 'file') total += 1;
  });
  return total;
}

function flattenFiles(tree: FileNode): Record<string, string> {
  const result: Record<string, string> = {};
  walkTree(tree, (node, path) => {
    if (node.type === 'file') {
      const filePath = path.replace(/^workspace\//, '') || node.name;
      result[filePath] = node.content ?? '';
    }
  });
  return result;
}

function readProject(): FileNode {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return initialProject;

  try {
    const parsed = JSON.parse(saved) as FileNode;
    if (parsed && parsed.type === 'folder') return parsed;
  } catch {
    // ignore invalid state and fall back to defaults
  }

  return initialProject;
}

function App() {
  const [project, setProject] = useState<FileNode>(() => readProject());
  const [activeFilePath, setActiveFilePath] = useState<string>('src/main.ts');
  const [tabs, setTabs] = useState<string[]>(['src/main.ts', 'README.md']);
  const [activeTab, setActiveTab] = useState<string>('src/main.ts');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    workspace: true,
    src: true,
    tests: true,
    'sakura-project': true
  });
  const [isAiOpen, setIsAiOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'output' | 'problems' | 'tests'>('output');

  const fileContent = useMemo(() => {
    const found = findNodeByPath(project, activeFilePath);
    return found && found.type === 'file' ? (found.content ?? '') : '';
  }, [activeFilePath, project]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    if (activeTab && !tabs.includes(activeTab)) {
      setTabs((current) => [...current, activeTab]);
    }
  }, [activeTab, tabs]);

  const updateFileContent = (value: string) => {
    const nextProject = structuredClone(project);
    const target = findNodeByPath(nextProject, activeFilePath);
    if (target && target.type === 'file') {
      target.content = value;
      setProject(nextProject);
    }
  };

  const openFile = (path: string) => {
    setActiveFilePath(path);
    setActiveTab(path);
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
  };

  const createNode = (type: 'file' | 'folder', parentPath = 'sakura-project') => {
    const parent = findNodeByPath(project, parentPath);
    if (!parent || parent.type !== 'folder') return;

    const name = window.prompt(`Create ${type}`, type === 'file' ? 'new-file.ts' : 'new-folder');
    if (!name) return;

    const existing = parent.children?.some((child) => child.name === name);
    if (existing) {
      window.alert('A file or folder with that name already exists.');
      return;
    }

    const next = structuredClone(project);
    const nextParent = findNodeByPath(next, parentPath);
    if (!nextParent || nextParent.type !== 'folder') return;

    const newNode: FileNode = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      type,
      content: type === 'file' ? `// ${name}\n` : undefined,
      children: type === 'folder' ? [] : undefined
    };

    nextParent.children = [...(nextParent.children ?? []), newNode];
    setProject(next);

    if (type === 'file') {
      const newPath = `${parentPath}/${name}`.replace(/^sakura-project\//, '');
      openFile(newPath);
    }
  };

  const closeTab = (tabPath: string) => {
    const nextTabs = tabs.filter((tab) => tab !== tabPath);
    setTabs(nextTabs);
    if (activeTab === tabPath) {
      setActiveTab(nextTabs[0] ?? 'src/main.ts');
      setActiveFilePath(nextTabs[0] ?? 'src/main.ts');
    }
  };

  const runCode = () => {
    const fileCount = countFiles(project);
    window.alert(`Project ready. ${fileCount} file(s) loaded and autosave is active.`);
  };

  const TreeItem = ({ node, path }: { node: FileNode; path: string }) => {
    const isExpanded = expandedFolders[path] ?? false;
    const safePath = path || node.name;

    if (node.type === 'folder') {
      return (
        <div className="tree-item folder-item">
          <button
            className="tree-row"
            onClick={() => {
              setExpandedFolders((current) => ({ ...current, [safePath]: !isExpanded }));
            }}
          >
            <span>{isExpanded ? '▾' : '▸'}</span>
            <span>{node.name}</span>
          </button>
          {isExpanded && (
            <div className="tree-children">
              {(node.children ?? []).map((child) => (
                <TreeItem
                  key={child.id}
                  node={child}
                  path={safePath === node.name ? child.name : `${safePath}/${child.name}`}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        className={`tree-row file-row ${activeFilePath === safePath ? 'active' : ''}`}
        onClick={() => openFile(safePath)}
      >
        <span className="file-dot">◦</span>
        <span>{node.name}</span>
      </button>
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-mark">🌸</div>
          <div>
            <div className="brand-name">Sakura Code Lab</div>
            <div className="project-label">sakura-project</div>
          </div>
        </div>

        <div className="command-bar">
          <span>⌕</span>
          <input value="Search / Command" readOnly />
        </div>

        <div className="topbar-actions">
          <span className="save-status saved">Saved</span>
          <button className="icon-btn" onClick={() => setIsAiOpen((prev) => !prev)}>
            AI
          </button>
          <button className="icon-btn">⚙</button>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="activity-rail">
          <button className="activity active">Explorer</button>
          <button className="activity">Search</button>
          <button className="activity">Git</button>
          <button className="activity">Run</button>
          <button className="activity">Ext</button>
          <button className="activity">AI</button>
        </aside>

        <aside className="explorer-panel">
          <div className="panel-header">
            <span>PROJECT</span>
            <div className="panel-actions">
              <button onClick={() => createNode('file')}>+ File</button>
              <button onClick={() => createNode('folder')}>+ Folder</button>
            </div>
          </div>

          <div className="tree-root">
            {(project.children ?? []).map((child) => (
              <TreeItem key={child.id} node={child} path={child.name} />
            ))}
          </div>
        </aside>

        <main className="editor-panel">
          <div className="editor-tabs">
            {tabs.map((tab) => (
              <div
                key={tab}
                className={`tab ${tab === activeTab ? 'active' : ''}`}
                onClick={() => openFile(tab)}
              >
                <span>{tab.split('/').pop()}</span>
                <button onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab);
                }}>×</button>
              </div>
            ))}
          </div>

          <div className="editor-toolbar">
            <button onClick={() => saveCurrentState()}>Save</button>
            <button onClick={runCode}>Run</button>
            <button>Format</button>
          </div>

          <div className="editor-surface">
            {activeFilePath ? (
              <Editor
                height="100%"
                language={activeFilePath.endsWith('.ts') || activeFilePath.endsWith('.tsx') ? 'typescript' : activeFilePath.endsWith('.json') ? 'json' : 'markdown'}
                theme="vs-dark"
                value={fileContent}
                onChange={(value) => updateFileContent(value ?? '')}
                options={{
                  automaticLayout: true,
                  minimap: { enabled: true },
                  fontSize: 14,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  padding: { top: 16 },
                  scrollBeyondLastLine: false,
                  roundedSelection: true,
                  tabSize: 2
                }}
              />
            ) : (
              <div className="empty-editor">Select a file to begin coding.</div>
            )}
          </div>
        </main>

        {isAiOpen && (
          <aside className="ai-panel">
            <div className="panel-header ai-header">
              <span>Sakura AI</span>
              <div className="panel-actions">
                <button>⚙</button>
                <button onClick={() => setIsAiOpen(false)}>×</button>
              </div>
            </div>

            <div className="ai-body">
              <div className="quick-prompts">
                <button>Explain this code</button>
                <button>Fix current errors</button>
                <button>Write a test</button>
                <button>Refactor</button>
              </div>

              <div className="chat-thread">
                <div className="message assistant">
                  What would you like help with?
                </div>
              </div>
            </div>

            <div className="ai-input-row">
              <input value="Ask Sakura AI..." readOnly />
              <button>Send</button>
            </div>
          </aside>
        )}
      </div>

      <footer className="bottom-panel">
        <div className="bottom-tabs">
          {['terminal', 'output', 'problems', 'tests'].map((tab) => (
            <button key={tab} className={bottomTab === tab ? 'active' : ''} onClick={() => setBottomTab(tab as typeof bottomTab)}>
              {tab}
            </button>
          ))}
        </div>

        <div className="bottom-body">
          {bottomTab === 'output' && (
            <div className="terminal-output">
              <div>Build output ready.</div>
              <div>Runtime: browser worker sandbox active</div>
              <div>Workspace restored from local storage</div>
            </div>
          )}
          {bottomTab === 'terminal' && <div className="terminal-output">npm run dev</div>}
          {bottomTab === 'problems' && <div className="terminal-output">No active diagnostics.</div>}
          {bottomTab === 'tests' && <div className="terminal-output">1 test discovered · 1 passing</div>}
        </div>
      </footer>
    </div>
  );

  function saveCurrentState() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    window.alert('Project saved locally.');
  }
}

export default App;
