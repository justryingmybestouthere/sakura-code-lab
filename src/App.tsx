import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';

type FileNode = {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
};

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type DiagnosticItem = {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line: number;
  column: number;
  source: string;
};

type TestResult = {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'not executed';
  duration: string;
  details: string;
};

const STORAGE_KEY = 'sakura-code-lab.v1';
const DEFAULT_AI_MODE = 'Explain';

function createDefaultProject(): FileNode {
  return {
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
            content: `export function greet(name: string) {
  const message = 'Welcome to Sakura Code Lab';
  return message + ' — ' + name;
}

console.log(greet('developer'));
`
          },
          {
            id: 'src-utils',
            name: 'utils.ts',
            type: 'file',
            content: `export const formatProjectName = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, '-');
`
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
            content: `describe('Sakura project smoke test', () => {
  it('loads the base app', () => {
    expect(true).toBe(true);
  });
});
`
          }
        ]
      },
      {
        id: 'readme',
        name: 'README.md',
        type: 'file',
        content: `# Sakura Code Lab

A browser-based IDE inspired by Japanese aesthetic philosophy and practical software workflows.

## Included
- Explorer and tabs
- Monaco editor
- Local persistence
- AI panel and command palette
- Execution and test surfaces

## Run
npm install
npm run dev
`
      },
      {
        id: 'package',
        name: 'package.json',
        type: 'file',
        content: JSON.stringify(
          {
            name: 'sakura-code-lab',
            version: '0.1.0',
            private: true,
            scripts: {
              dev: 'vite',
              build: 'vite build',
              preview: 'vite preview'
            }
          },
          null,
          2
        )
      }
    ]
  };
}

function walkTree(tree: FileNode, callback: (node: FileNode, path: string) => void, currentPath = ''): void {
  const nodePath = currentPath ? `${currentPath}/${tree.name}` : tree.name;
  callback(tree, nodePath);

  if (tree.type === 'folder') {
    for (const child of tree.children ?? []) {
      walkTree(child, callback, nodePath);
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

function findNodeByPath(tree: FileNode, relativePath: string): FileNode | null {
  if (!relativePath) return tree;
  if (relativePath === tree.name) return tree;

  const segments = relativePath.split('/').filter(Boolean);
  let current: FileNode | undefined = tree;

  for (const segment of segments) {
    if (!current || current.type !== 'folder' || !current.children) return null;
    const next = current.children.find((child) => child.name === segment);
    if (!next) return null;
    current = next;
  }

  return current ?? null;
}

function replaceNodeByPath(tree: FileNode, path: string, updater: (node: FileNode) => FileNode): FileNode {
  if (!path || path === tree.name) {
    return updater(tree);
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return tree;

  const clone: FileNode = {
    ...tree,
    children: tree.children ? tree.children.map((child) => ({ ...child, children: child.children ? [...child.children] : undefined })) : undefined
  };

  function recurse(current: FileNode, index: number): FileNode {
    if (index === segments.length) {
      return updater(current);
    }

    const nextSegment = segments[index];
    const child = current.children?.find((entry) => entry.name === nextSegment);
    if (!child || child.type !== 'folder') return current;

    const updatedChild = recurse(child, index + 1);
    const nextChildren = (current.children ?? []).map((entry) =>
      entry.name === nextSegment ? updatedChild : entry
    );

    return { ...current, children: nextChildren };
  }

  return recurse(clone, 0);
}

function deleteNodeByPath(tree: FileNode, path: string): FileNode {
  if (!path || path === tree.name) return createDefaultProject();

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return tree;

  const clone: FileNode = JSON.parse(JSON.stringify(tree));

  function recurse(current: FileNode, index: number): FileNode {
    if (index === segments.length) return current;

    if (current.type !== 'folder' || !current.children) return current;

    const nextSegment = segments[index];
    const childIndex = current.children.findIndex((entry) => entry.name === nextSegment);
    if (childIndex === -1) return current;

    if (index === segments.length - 1) {
      const nextChildren = current.children.filter((entry) => entry.name !== nextSegment);
      return { ...current, children: nextChildren };
    }

    const updatedChild = recurse(current.children[childIndex], index + 1);
    current.children[childIndex] = updatedChild;
    return current;
  }

  return recurse(clone, 0);
}

function renameNodeByPath(tree: FileNode, path: string, newName: string): FileNode {
  if (!newName.trim()) return tree;

  return replaceNodeByPath(tree, path, (node) => ({ ...node, name: newName.trim() }));
}

function duplicateNodeByPath(tree: FileNode, path: string): FileNode {
  const source = findNodeByPath(tree, path);
  if (!source) return tree;

  const parentPath = path.split('/').slice(0, -1).join('/');
  const parent = parentPath ? findNodeByPath(tree, parentPath) : tree;
  if (!parent || parent.type !== 'folder') return tree;

  const duplicate: FileNode = {
    ...source,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: `${source.name}.copy`
  };

  const updated = JSON.parse(JSON.stringify(tree));
  const parentTarget = parentPath ? findNodeByPath(updated, parentPath) : updated;
  if (!parentTarget || parentTarget.type !== 'folder') return tree;
  parentTarget.children = [...(parentTarget.children ?? []), duplicate];
  return updated;
}

function getLanguageFromPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'js' || extension === 'jsx') return 'javascript';
  if (extension === 'json') return 'json';
  if (extension === 'md') return 'markdown';
  if (extension === 'css') return 'css';
  if (extension === 'html') return 'html';
  if (extension === 'py') return 'python';
  return 'plaintext';
}

function getProjectFromLocalStorage(): FileNode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProject();
    const parsed = JSON.parse(raw) as FileNode;
    if (parsed && parsed.type === 'folder' && parsed.children) return parsed;
  } catch {
    // fall back quietly
  }
  return createDefaultProject();
}

async function persistProject(project: FileNode): Promise<void> {
  const payload = JSON.stringify(project);
  window.localStorage.setItem(STORAGE_KEY, payload);

  try {
    if ('indexedDB' in window) {
      const request = indexedDB.open('sakura-code-lab', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(payload, 'active-project');
      };
    }
  } catch {
    // no-op: local storage remains authoritative
  }
}

function App() {
  const [project, setProject] = useState<FileNode>(() => getProjectFromLocalStorage());
  const [activeFilePath, setActiveFilePath] = useState<string>('src/main.ts');
  const [tabs, setTabs] = useState<string[]>(['src/main.ts', 'README.md']);
  const [activeTab, setActiveTab] = useState<string>('src/main.ts');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    workspace: true,
    sakura_project: true,
    src: true,
    tests: true,
    'sakura-project': true
  });
  const [bottomTab, setBottomTab] = useState<'terminal' | 'output' | 'problems' | 'tests'>('output');
  const [isAiOpen, setIsAiOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiMode, setAiMode] = useState(DEFAULT_AI_MODE);
  const [query, setQuery] = useState('Explain this code and tell me why it matters.');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Sakura AI is ready. I can explain code, refactor, generate tests, and help you reason about the workspace.'
    }
  ]);
  const [executionOutput, setExecutionOutput] = useState<string[]>(['Browser runtime ready. Sandbox warm-up complete.']);
  const [problems, setProblems] = useState<DiagnosticItem[]>([
    {
      id: 'd1',
      severity: 'info',
      message: 'No active diagnostics in the current workspace.',
      file: 'src/main.ts',
      line: 1,
      column: 1,
      source: 'Sakura Diagnostics'
    }
  ]);
  const [tests, setTests] = useState<TestResult[]>([
    { id: 't1', name: 'smoke-test', status: 'pass', duration: '12ms', details: 'Base project loaded' }
  ]);
  const [statusText, setStatusText] = useState<'Saved' | 'Saving' | 'Unsaved' | 'Syncing'>('Saved');
  const [settings, setSettings] = useState({
    theme: 'sakura',
    fontSize: 14,
    autoSave: true,
    localOnly: true,
    aiConfirmation: true,
    researchMode: true,
    reducedMotion: false
  });

  const activeFile = useMemo(() => findNodeByPath(project, activeFilePath), [project, activeFilePath]);
  const activeContent = activeFile && activeFile.type === 'file' ? activeFile.content ?? '' : '';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.ctrlKey || event.metaKey;
      if (isMeta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (settings.autoSave) {
      setStatusText('Saving');
      const timeout = window.setTimeout(() => {
        void persistProject(project).then(() => setStatusText('Saved'));
      }, 250);
      return () => window.clearTimeout(timeout);
    }
  }, [project, settings.autoSave]);

  const openFile = (path: string) => {
    setActiveFilePath(path);
    setActiveTab(path);
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
  };

  const updateFileContent = (value: string) => {
    setProject((current) =>
      replaceNodeByPath(current, activeFilePath, (node) => {
        if (node.type === 'file') {
          return { ...node, content: value };
        }
        return node;
      })
    );
    setStatusText('Unsaved');
  };

  const createNode = (type: 'file' | 'folder', parentPath = 'sakura-project') => {
    const targetParent = findNodeByPath(project, parentPath);
    if (!targetParent || targetParent.type !== 'folder') return;

    const suggestion = type === 'file' ? 'new-file.ts' : 'new-folder';
    const name = window.prompt(`Create ${type}`, suggestion);
    if (!name) return;

    const trimmed = name.trim();
    if (!trimmed) return;
    if ((targetParent.children ?? []).some((child) => child.name === trimmed)) {
      window.alert('A file or folder with that name already exists.');
      return;
    }

    const newNode: FileNode = {
      id: `node-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: trimmed,
      type,
      content: type === 'file' ? `// ${trimmed}\n` : undefined,
      children: type === 'folder' ? [] : undefined
    };

    setProject((current) => {
      const parent = findNodeByPath(current, parentPath);
      if (!parent || parent.type !== 'folder') return current;
      const next = JSON.parse(JSON.stringify(current));
      const nextParent = findNodeByPath(next, parentPath);
      if (!nextParent || nextParent.type !== 'folder') return current;
      nextParent.children = [...(nextParent.children ?? []), newNode];
      return next;
    });

    if (type === 'file') {
      const nextPath = `${parentPath}/${trimmed}`.replace(/^sakura-project\//, '');
      openFile(nextPath);
    }
  };

  const handleRename = (path: string) => {
    const currentName = path.split('/').pop() ?? path;
    const nextName = window.prompt('Rename item', currentName);
    if (!nextName) return;
    setProject((current) => renameNodeByPath(current, path, nextName.trim()));
  };

  const handleDuplicate = (path: string) => {
    setProject((current) => duplicateNodeByPath(current, path));
  };

  const handleDelete = (path: string) => {
    const confirmed = window.confirm(`Delete ${path}?`);
    if (!confirmed) return;
    setProject((current) => deleteNodeByPath(current, path));
  };

  const saveCurrentProject = () => {
    setStatusText('Syncing');
    void persistProject(project).then(() => setStatusText('Saved'));
  };

  const handleRunCode = () => {
    const code = activeContent;
    const output: string[] = [];

    if (typeof Worker !== 'undefined') {
      const workerCode = `
        self.onmessage = (event) => {
          const { code } = event.data;
          try {
            const result = new Function(code + '\n; self.postMessage({ok: true, output: "Execution completed."})')();
            self.postMessage({ ok: true, output: 'Execution completed.', result: String(result ?? '') });
          } catch (error) {
            self.postMessage({ ok: false, output: String(error) });
          }
        };
      `;
      const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
      const worker = new Worker(workerUrl);
      worker.postMessage({ code });
      worker.onmessage = (event) => {
        const message = event.data;
        output.push(message.output || 'No output.');
        if (message.result) output.push(`Result: ${message.result}`);
        setExecutionOutput(output);
        setBottomTab('output');
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };
      worker.onerror = (error) => {
        output.push(`Worker error: ${error.message}`);
        setExecutionOutput(output);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };
      setExecutionOutput(['Running in browser sandbox...']);
      return;
    }

    output.push('Execution unavailable: browser worker not supported in this environment.');
    setExecutionOutput(output);
  };

  const handleAiSubmit = () => {
    const contextPayload = {
      language: getLanguageFromPath(activeFilePath),
      currentFile: activeFilePath,
      selectedCode: activeContent.slice(0, 280),
      diagnostics: problems.slice(0, 2).map((item) => `${item.message} @ ${item.file}:${item.line}:${item.column}`),
      mode: aiMode,
      question: query
    };

    const response = (() => {
      switch (aiMode) {
        case 'Explain':
          return `I analyzed ${contextPayload.currentFile} in ${contextPayload.language}. The code is structured around a small utility and a readable flow. It intends to produce a clear, maintainable result rather than relying on hidden state. The main idea is to keep the logic explicit and easy for a beginner to follow.`;
        case 'Explain Like I\'m Five':
          return 'This code is like a tiny helper that takes a name, cleans it up, and turns it into a neat label. It does not do anything scary—it just organizes the text so the app can use it reliably.';
        case 'Fix':
          return 'Likely fix: validate input before generating the project name, then normalize whitespace and lowercase. That prevents surprising output and keeps user-facing values consistent.';
        case 'Refactor':
          return 'Refactor suggestion: extract repeated string formatting into a small helper, keep function names descriptive, and avoid magic values. This improves readability without changing runtime behavior.';
        case 'Debug':
          return 'Debug note: check the active value, confirm that the file path resolves correctly, and inspect the failing branch for an unexpected null or empty value before patching.';
        case 'Generate':
          return 'Suggested code:\n\nexport function createProjectSummary(name: string) {\n  return `Project: ${name}`;\n}\n';
        case 'Test':
          return 'Suggested test: verify that the formatter trims whitespace, lowercases the value, and replaces spaces with dashes, which covers the main edge cases.';
        default:
          return 'I have the relevant file context. I can help explain, fix, refactor, or generate next steps.';
      }
    })();

    const assistantMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `${response}\n\nContext:\n- Language: ${contextPayload.language}\n- Current file: ${contextPayload.currentFile}\n- Question: ${contextPayload.question}`
    };

    setChatMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', content: query },
      assistantMessage
    ]);
    setQuery('');
  };

  const commandPaletteItems = [
    { label: 'Open File', action: () => openFile('src/main.ts') },
    { label: 'Save All', action: saveCurrentProject },
    { label: 'Run Code', action: handleRunCode },
    { label: 'Run Tests', action: () => setBottomTab('tests') },
    { label: 'Toggle AI', action: () => setIsAiOpen((value) => !value) },
    { label: 'Open Settings', action: () => setIsSettingsOpen(true) },
    { label: 'Create File', action: () => createNode('file') },
    { label: 'Create Folder', action: () => createNode('folder') },
    { label: 'Export Workspace', action: () => exportProject() },
    { label: 'Restore Snapshot', action: () => setStatusText('Syncing') }
  ];

  const exportProject = () => {
    const payload = JSON.stringify(project, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sakura-project-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as FileNode;
        if (parsed && parsed.type === 'folder') {
          setProject(parsed);
          setActiveFilePath('src/main.ts');
          setTabs(['src/main.ts']);
          setActiveTab('src/main.ts');
        }
      } catch {
        window.alert('Import failed. Please choose a valid Sakura project export.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const aiTryResearch = () => {
    const shouldResearch = /version|latest|api|docs|framework|react|node|typescript|browser/i.test(query);
    setChatMessages((current) => [
      ...current,
      {
        id: `research-${Date.now()}`,
        role: 'assistant',
        content: shouldResearch
          ? 'Research required: version-sensitive question detected. I would verify official docs, compare source reliability, and separate confirmed facts from uncertainty before answering.'
          : 'No external research required for this question; local context is sufficient.'
      }
    ]);
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
          <span className={`save-status ${statusText === 'Saved' ? 'saved' : 'pending'}`}>{statusText}</span>
          <button className="icon-btn" onClick={() => setIsAiOpen((value) => !value)}>AI</button>
          <button className="icon-btn" onClick={() => setIsSettingsOpen(true)}>⚙</button>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="activity-rail">
          <button className="activity active">Explorer</button>
          <button className="activity">Search</button>
          <button className="activity">Git</button>
          <button className="activity">Run</button>
          <button className="activity">Extensions</button>
          <button className="activity">AI</button>
        </aside>

        <aside className="explorer-panel">
          <div className="panel-header">
            <span>Project</span>
            <div className="panel-actions">
              <button onClick={() => createNode('file')}>+ File</button>
              <button onClick={() => createNode('folder')}>+ Folder</button>
            </div>
          </div>

          <div className="tree-root">
            {(project.children ?? []).map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                path={child.name}
                activeFilePath={activeFilePath}
                expandedFolders={expandedFolders}
                setExpandedFolders={setExpandedFolders}
                openFile={openFile}
                onRename={handleRename}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        </aside>

        <main className="editor-panel">
          <div className="editor-tabs">
            {tabs.map((tab) => (
              <div key={tab} className={`tab ${tab === activeTab ? 'active' : ''}`} onClick={() => openFile(tab)}>
                <span>{tab.split('/').pop()}</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setTabs((current) => current.filter((item) => item !== tab));
                    if (activeTab === tab) {
                      const nextTab = (tabs.filter((item) => item !== tab)[0] ?? 'src/main.ts');
                      setActiveTab(nextTab);
                      setActiveFilePath(nextTab);
                    }
                  }}
                >×</button>
              </div>
            ))}
          </div>

          <div className="editor-toolbar">
            <button onClick={saveCurrentProject}>Save</button>
            <button onClick={handleRunCode}>Run</button>
            <button>Format</button>
            <button onClick={exportProject}>Export</button>
            <label className="file-input-label">
              Import
              <input type="file" accept="application/json" onChange={importProject} />
            </label>
          </div>

          <div className="editor-surface">
            {activeFilePath ? (
              <Editor
                height="100%"
                language={getLanguageFromPath(activeFilePath)}
                value={activeContent}
                theme="vs-dark"
                onChange={(value) => updateFileContent(value ?? '')}
                options={{
                  automaticLayout: true,
                  minimap: { enabled: true },
                  fontSize: settings.fontSize,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  tabSize: 2,
                  scrollBeyondLastLine: false,
                  roundedSelection: true,
                  padding: { top: 14 }
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
              <div className="mode-row">
                {['Explain', 'Explain Like I\'m Five', 'Fix', 'Refactor', 'Generate', 'Test', 'Debug', 'Review'].map((mode) => (
                  <button
                    key={mode}
                    className={aiMode === mode ? 'mode-pill active' : 'mode-pill'}
                    onClick={() => setAiMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <div className="ai-context">
                <strong>Context</strong>
                <span>✓ Current file</span>
                <span>✓ Selection</span>
                <span>✓ Diagnostics</span>
              </div>

              <div className="chat-thread">
                {chatMessages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    {message.content}
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-input-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ask Sakura AI..."
              />
              <button onClick={handleAiSubmit}>Send</button>
              <button className="secondary" onClick={aiTryResearch}>Research</button>
            </div>
          </aside>
        )}
      </div>

      <footer className="bottom-panel">
        <div className="bottom-tabs">
          {['terminal', 'output', 'problems', 'tests'].map((tab) => (
            <button
              key={tab}
              className={bottomTab === tab ? 'active' : ''}
              onClick={() => setBottomTab(tab as 'terminal' | 'output' | 'problems' | 'tests')}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="bottom-body">
          {bottomTab === 'output' && (
            <div className="terminal-output">
              {executionOutput.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          )}

          {bottomTab === 'terminal' && (
            <div className="terminal-output">
              <div>$ npm run dev</div>
              <div>✔ Secure browser runtime is initialized.</div>
              <div>✔ Local persistence is active.</div>
            </div>
          )}

          {bottomTab === 'problems' && (
            <div className="problems-list">
              {problems.map((problem) => (
                <div key={problem.id} className={`problem severity-${problem.severity}`}>
                  <strong>{problem.severity.toUpperCase()}</strong>
                  <span>{problem.message}</span>
                  <small>
                    {problem.file}:{problem.line}:{problem.column} · {problem.source}
                  </small>
                </div>
              ))}
            </div>
          )}

          {bottomTab === 'tests' && (
            <div className="test-results">
              {tests.map((test) => (
                <div key={test.id} className={`test-item ${test.status}`}>
                  <span>{test.name}</span>
                  <span>{test.status}</span>
                  <span>{test.duration}</span>
                  <small>{test.details}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </footer>

      {isCommandPaletteOpen && (
        <div className="modal-overlay" onClick={() => setIsCommandPaletteOpen(false)}>
          <div className="command-palette" onClick={(event) => event.stopPropagation()}>
            <div className="command-header">Command Palette</div>
            <input value="Type a command..." readOnly />
            <div className="command-list">
              {commandPaletteItems.map((item) => (
                <button key={item.label} onClick={() => {
                  item.action();
                  setIsCommandPaletteOpen(false);
                }}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="command-header">Settings</div>

            <div className="settings-groups">
              <div className="settings-section">
                <h4>Editor</h4>
                <label>Font Size <input type="range" min={12} max={18} value={settings.fontSize} onChange={(e) => setSettings((current) => ({ ...current, fontSize: Number(e.target.value) }))} /></label>
                <label><input type="checkbox" checked={settings.autoSave} onChange={(e) => setSettings((current) => ({ ...current, autoSave: e.target.checked }))} /> Auto-save</label>
                <label><input type="checkbox" checked={settings.reducedMotion} onChange={(e) => setSettings((current) => ({ ...current, reducedMotion: e.target.checked }))} /> Reduced motion</label>
              </div>

              <div className="settings-section">
                <h4>AI</h4>
                <label><input type="checkbox" checked={settings.aiConfirmation} onChange={(e) => setSettings((current) => ({ ...current, aiConfirmation: e.target.checked }))} /> Confirm before applying changes</label>
                <label><input type="checkbox" checked={settings.researchMode} onChange={(e) => setSettings((current) => ({ ...current, researchMode: e.target.checked }))} /> Research mode</label>
              </div>

              <div className="settings-section">
                <h4>Privacy</h4>
                <label><input type="checkbox" checked={settings.localOnly} onChange={(e) => setSettings((current) => ({ ...current, localOnly: e.target.checked }))} /> Local-only mode</label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type TreeNodeProps = {
  node: FileNode;
  path: string;
  activeFilePath: string;
  expandedFolders: Record<string, boolean>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  openFile: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onDuplicate: (path: string) => void;
};

function TreeNode({ node, path, activeFilePath, expandedFolders, setExpandedFolders, openFile, onRename, onDelete, onDuplicate }: TreeNodeProps) {
  const isExpanded = expandedFolders[path] ?? true;

  if (node.type === 'folder') {
    return (
      <div className="tree-item">
        <button
          className="tree-row"
          onClick={() => setExpandedFolders((current) => ({ ...current, [path]: !isExpanded }))}
        >
          <span>{isExpanded ? '▾' : '▸'}</span>
          <span>{node.name}</span>
        </button>

        {isExpanded && (
          <div className="tree-children">
            {(node.children ?? []).map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                path={path === node.name ? child.name : `${path}/${child.name}`}
                activeFilePath={activeFilePath}
                expandedFolders={expandedFolders}
                setExpandedFolders={setExpandedFolders}
                openFile={openFile}
                onRename={onRename}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tree-item file-item">
      <button className={`tree-row file-row ${activeFilePath === path ? 'active' : ''}`} onClick={() => openFile(path)}>
        <span className="file-dot">◦</span>
        <span>{node.name}</span>
      </button>

      <div className="item-actions">
        <button onClick={() => onRename(path)}>Rename</button>
        <button onClick={() => onDuplicate(path)}>Duplicate</button>
        <button onClick={() => onDelete(path)}>Delete</button>
      </div>
    </div>
  );
}

export default App;
