import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import Editor from '@monaco-editor/react';

type FileNode = {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
};

type AppSettings = {
  theme: 'sakura' | 'ink';
  fontSize: number;
  tabSize: number;
  lineNumbers: boolean;
  minimap: boolean;
  wordWrap: boolean;
  autosave: boolean;
  reducedMotion: boolean;
};

type SearchResult = {
  path: string;
  line: number;
  column: number;
  snippet: string;
};

const STORAGE_KEY = 'sakura-code-lab.phase2';
const DB_NAME = 'sakura-code-lab';
const STORE_NAME = 'projects';

const defaultSettings: AppSettings = {
  theme: 'sakura',
  fontSize: 14,
  tabSize: 2,
  lineNumbers: true,
  minimap: true,
  wordWrap: true,
  autosave: true,
  reducedMotion: false
};

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
  return `${message} — ${name}`;
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

export const buildGreeting = (name: string) => {
  return 'Hello ' + formatProjectName(name);
};
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
        content: '# Sakura Code Lab\n\nPhase 2 editor improvements.\n\n- searchable workspace\n- refactored tabs\n- better editor configuration\n- command palette\n'
      },
      {
        id: 'package',
        name: 'package.json',
        type: 'file',
        content: JSON.stringify({
          name: 'sakura-code-lab',
          version: '0.1.0',
          private: true,
          scripts: {
            dev: 'vite',
            build: 'vite build'
          }
        }, null, 2)
      }
    ]
  };
}

function findNodeByPath(root: FileNode, path: string): FileNode | null {
  if (!path || path === root.name) return root;
  const segments = path.split('/').filter(Boolean);
  let current: FileNode | undefined = root;

  for (const segment of segments) {
    if (!current || current.type !== 'folder' || !current.children) return null;
    const next = current.children.find((entry) => entry.name === segment);
    if (!next) return null;
    current = next;
  }

  return current ?? null;
}

function updateNodeByPath(root: FileNode, path: string, updater: (node: FileNode) => FileNode): FileNode {
  if (!path || path === root.name) return updater(root);

  const segments = path.split('/').filter(Boolean);

  function walk(node: FileNode, index: number): FileNode {
    if (index === segments.length) return updater(node);
    if (node.type !== 'folder' || !node.children) return node;

    const nextName = segments[index];
    const child = node.children.find((entry) => entry.name === nextName);
    if (!child) return node;

    const updatedChild = walk(child, index + 1);
    return {
      ...node,
      children: node.children.map((entry) => (entry.name === nextName ? updatedChild : entry))
    };
  }

  return walk(root, 0);
}

function deleteNodeByPath(root: FileNode, path: string): FileNode {
  if (!path || path === root.name) return createDefaultProject();

  const segments = path.split('/').filter(Boolean);

  function walk(node: FileNode, index: number): FileNode {
    if (node.type !== 'folder' || !node.children) return node;

    if (index === segments.length - 1) {
      const nextChildren = node.children.filter((entry) => entry.name !== segments[index]);
      return { ...node, children: nextChildren };
    }

    const nextName = segments[index];
    const child = node.children.find((entry) => entry.name === nextName);
    if (!child) return node;

    return {
      ...node,
      children: node.children.map((entry) =>
        entry.name === nextName ? walk(entry, index + 1) : entry
      )
    };
  }

  return walk(root, 0);
}

function renameNodeByPath(root: FileNode, path: string, newName: string): FileNode {
  const trimmed = newName.trim();
  if (!trimmed) return root;
  return updateNodeByPath(root, path, (node) => ({ ...node, name: trimmed }));
}

function duplicateNodeByPath(root: FileNode, path: string): FileNode {
  const source = findNodeByPath(root, path);
  if (!source) return root;

  const parentPath = path.split('/').slice(0, -1).join('/');
  const parent = parentPath ? findNodeByPath(root, parentPath) : root;
  if (!parent || parent.type !== 'folder') return root;

  const duplicate: FileNode = {
    ...source,
    id: `node-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: `${source.name}.copy`
  };

  return updateNodeByPath(root, parentPath || root.name, (node) => {
    if (node.type !== 'folder') return node;
    return { ...node, children: [...(node.children ?? []), duplicate] };
  });
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  if (ext === 'css') return 'css';
  if (ext === 'html') return 'html';
  if (ext === 'py') return 'python';
  return 'plaintext';
}

function findSearchMatches(root: FileNode, query: string): SearchResult[] {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  function walk(node: FileNode, parentPath: string) {
    if (node.type === 'file') {
      const content = node.content ?? '';
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        const normalized = line.toLowerCase();
        const position = normalized.indexOf(lowerQuery);
        if (position >= 0) {
          const resultPath = parentPath ? `${parentPath}/${node.name}` : node.name;
          results.push({
            path: resultPath,
            line: index + 1,
            column: position + 1,
            snippet: line.trim() || '(blank line)'
          });
        }
      });
    }

    if (node.type === 'folder') {
      for (const child of node.children ?? []) {
        const nextPath = parentPath ? `${parentPath}/${child.name}` : child.name;
        walk(child, nextPath);
      }
    }
  }

  walk(root, '');
  return results.slice(0, 20);
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function saveProjectToStorage(project: FileNode): Promise<void> {
  const payload = JSON.stringify(project);
  window.localStorage.setItem(STORAGE_KEY, payload);

  try {
    const db = await openIndexedDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(payload, 'active-project');
  } catch {
    // localStorage remains the primary persistence mechanism.
  }
}

async function loadProjectFromStorage(): Promise<FileNode> {
  try {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as FileNode;
      if (parsed && parsed.type === 'folder') return parsed;
    }

    const db = await openIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get('active-project');
      request.onsuccess = () => {
        const value = request.result as string | undefined;
        if (value) {
          try {
            const parsed = JSON.parse(value) as FileNode;
            if (parsed && parsed.type === 'folder') {
              resolve(parsed);
              return;
            }
          } catch {
            // ignore malformed payload and fall back.
          }
        }
        resolve(createDefaultProject());
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to load project'));
    });
  } catch {
    return createDefaultProject();
  }
}

function App() {
  const [project, setProject] = useState<FileNode>(createDefaultProject());
  const [activeFilePath, setActiveFilePath] = useState<string>('src/main.ts');
  const [tabs, setTabs] = useState<string[]>(['src/main.ts', 'README.md']);
  const [activeTab, setActiveTab] = useState<string>('src/main.ts');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [saveState, setSaveState] = useState<'Saved' | 'Saving' | 'Unsaved'>('Saved');
  const [searchTerm, setSearchTerm] = useState('formatProjectName');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'sakura-project': true,
    src: true,
    tests: true
  });

  useEffect(() => {
    void loadProjectFromStorage().then((loadedProject) => {
      setProject(loadedProject);
      setActiveFilePath('src/main.ts');
      setTabs(['src/main.ts']);
      setActiveTab('src/main.ts');
    });
  }, []);

  useEffect(() => {
    const results = findSearchMatches(project, searchTerm);
    setSearchResults(results);
  }, [searchTerm, project]);

  useEffect(() => {
    if (!settings.autosave) return;
    setSaveState('Saving');
    const timeout = window.setTimeout(() => {
      void saveProjectToStorage(project).then(() => setSaveState('Saved'));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [project, settings.autosave]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.ctrlKey || event.metaKey;
      if (isMeta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setCommandPaletteOpen(false);
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeFile = useMemo(() => findNodeByPath(project, activeFilePath), [project, activeFilePath]);
  const activeContent = activeFile && activeFile.type === 'file' ? (activeFile.content ?? '') : '';

  const openFile = (path: string) => {
    setActiveFilePath(path);
    setActiveTab(path);
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
  };

  const updateFileContent = (value: string) => {
    setProject((current) =>
      updateNodeByPath(current, activeFilePath, (node) => {
        if (node.type !== 'file') return node;
        return { ...node, content: value };
      })
    );
    setSaveState('Unsaved');
  };

  const createFile = (parentPath = 'sakura-project') => {
    const targetParent = findNodeByPath(project, parentPath);
    if (!targetParent || targetParent.type !== 'folder') return;

    const fileName = window.prompt('New file name', 'new-file.ts');
    if (!fileName) return;

    const cleaned = fileName.trim();
    if (!cleaned) return;
    if ((targetParent.children ?? []).some((entry) => entry.name === cleaned)) {
      window.alert('A file with that name already exists.');
      return;
    }

    const newNode: FileNode = {
      id: `file-${Date.now()}`,
      name: cleaned,
      type: 'file',
      content: `// ${cleaned}\n`
    };

    setProject((current) => {
      const nextParent = findNodeByPath(current, parentPath);
      if (!nextParent || nextParent.type !== 'folder') return current;
      return updateNodeByPath(current, parentPath, (node) => {
        if (node.type !== 'folder') return node;
        return { ...node, children: [...(node.children ?? []), newNode] };
      });
    });

    const fullPath = `${parentPath}/${cleaned}`.replace(/^sakura-project\//, '');
    openFile(fullPath);
  };

  const createFolder = (parentPath = 'sakura-project') => {
    const targetParent = findNodeByPath(project, parentPath);
    if (!targetParent || targetParent.type !== 'folder') return;

    const folderName = window.prompt('New folder name', 'new-folder');
    if (!folderName) return;

    const cleaned = folderName.trim();
    if (!cleaned) return;
    if ((targetParent.children ?? []).some((entry) => entry.name === cleaned)) {
      window.alert('A folder with that name already exists.');
      return;
    }

    const newNode: FileNode = {
      id: `folder-${Date.now()}`,
      name: cleaned,
      type: 'folder',
      children: []
    };

    setProject((current) => {
      const nextParent = findNodeByPath(current, parentPath);
      if (!nextParent || nextParent.type !== 'folder') return current;
      return updateNodeByPath(current, parentPath, (node) => {
        if (node.type !== 'folder') return node;
        return { ...node, children: [...(node.children ?? []), newNode] };
      });
    });
  };

  const saveNow = async () => {
    setSaveState('Saving');
    await saveProjectToStorage(project);
    setSaveState('Saved');
  };

  const handleRename = (path: string) => {
    const currentName = path.split('/').pop() ?? path;
    const value = window.prompt('Rename item', currentName);
    if (!value) return;
    setProject((current) => renameNodeByPath(current, path, value));
  };

  const handleDuplicate = (path: string) => {
    setProject((current) => duplicateNodeByPath(current, path));
  };

  const handleDelete = (path: string) => {
    const confirmed = window.confirm(`Delete ${path}?`);
    if (!confirmed) return;
    setProject((current) => deleteNodeByPath(current, path));
  };

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

  const importProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as FileNode;
        if (parsed && parsed.type === 'folder') {
          setProject(parsed);
          setActiveFilePath('src/main.ts');
          setActiveTab('src/main.ts');
          setTabs(['src/main.ts']);
        }
      } catch {
        window.alert('Import failed. Please choose a valid Sakura project export.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const commandPaletteItems = [
    { label: 'Open File', action: () => openFile('src/main.ts') },
    { label: 'Save All', action: saveNow },
    { label: 'Create File', action: () => createFile() },
    { label: 'Create Folder', action: () => createFolder() },
    { label: 'Format Document', action: () => setSearchTerm('formatProjectName') },
    { label: 'Toggle Search', action: () => setSearchTerm('greet') },
    { label: 'Toggle Settings', action: () => setSettingsOpen(true) }
  ];

  return (
    <div className={`app-shell ${settings.theme}`}>
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
          <input value="Search / Command" readOnly aria-label="Search and commands" />
        </div>

        <div className="topbar-actions">
          <span className={`save-status ${saveState === 'Saved' ? 'saved' : 'unsaved'}`}>{saveState}</span>
          <button className="icon-btn" onClick={() => setCommandPaletteOpen(true)}>Command</button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>
      </header>

      <div className="workbench">
        <aside className="sidebar">
          <div className="activity-rail">
            <button className="activity active">Explorer</button>
            <button className="activity">Search</button>
            <button className="activity">Git</button>
            <button className="activity">Run</button>
          </div>

          <div className="explorer-panel">
            <div className="panel-header">
              <span>Project</span>
              <div className="panel-actions">
                <button onClick={() => createFile()}>＋</button>
                <button onClick={() => createFolder()}>▣</button>
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
                  onOpen={openFile}
                  onRename={handleRename}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
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
                <button
                  className="close-tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextTabs = tabs.filter((item) => item !== tab);
                    setTabs(nextTabs);
                    if (activeTab === tab) {
                      const fallback = nextTabs[0] ?? 'src/main.ts';
                      setActiveTab(fallback);
                      setActiveFilePath(fallback);
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="editor-toolbar">
            <button onClick={saveNow}>Save</button>
            <button onClick={() => setSearchTerm('greet')}>Find</button>
            <button onClick={() => openFile('src/main.ts')}>Open</button>
            <button onClick={exportProject}>Export</button>
            <label className="import-label">
              Import
              <input type="file" accept="application/json" onChange={importProject} />
            </label>
          </div>

          <div className="editor-surface">
            <Editor
              height="100%"
              theme={settings.theme === 'sakura' ? 'vs-dark' : 'vs-dark'}
              language={getLanguageFromPath(activeFilePath)}
              value={activeContent}
              onChange={(value) => updateFileContent(value ?? '')}
              options={{
                automaticLayout: true,
                minimap: { enabled: settings.minimap },
                fontSize: settings.fontSize,
                tabSize: settings.tabSize,
                lineNumbers: settings.lineNumbers ? 'on' : 'off',
                wordWrap: settings.wordWrap ? 'on' : 'off',
                roundedSelection: true,
                padding: { top: 14 },
                scrollBeyondLastLine: false,
                find: {
                  addExtraSpaceOnTop: false,
                  autoFindInSelection: 'never',
                  seedSearchStringFromSelection: 'never'
                }
              }}
            />
          </div>
        </main>

        <aside className="search-panel">
          <div className="search-header">Workspace Search</div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search in project"
            aria-label="Search in project"
          />

          <div className="search-results">
            {searchResults.length === 0 && (
              <div className="search-empty">No matching results.</div>
            )}

            {searchResults.map((result) => (
              <button
                key={`${result.path}-${result.line}-${result.column}`}
                className="search-result"
                onClick={() => {
                  openFile(result.path);
                }}
              >
                <strong>{result.path}</strong>
                <span>
                  Ln {result.line}, Col {result.column}
                </span>
                <small>{result.snippet}</small>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {commandPaletteOpen && (
        <div className="modal-overlay" onClick={() => setCommandPaletteOpen(false)}>
          <div className="command-palette" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header settings-header">
              <span>Command Palette</span>
              <button onClick={() => setCommandPaletteOpen(false)}>×</button>
            </div>

            <div className="command-items">
              {commandPaletteItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    item.action();
                    setCommandPaletteOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header settings-header">
              <span>Settings</span>
              <button onClick={() => setSettingsOpen(false)}>×</button>
            </div>

            <div className="settings-section">
              <h4>Appearance</h4>
              <label>
                Theme
                <select
                  value={settings.theme}
                  onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as AppSettings['theme'] }))}
                >
                  <option value="sakura">Sakura</option>
                  <option value="ink">Ink</option>
                </select>
              </label>

              <label>
                Font size
                <input
                  type="range"
                  min={12}
                  max={20}
                  value={settings.fontSize}
                  onChange={(event) => setSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))}
                />
              </label>
            </div>

            <div className="settings-section">
              <h4>Editor</h4>
              <label>
                Tab size
                <select
                  value={settings.tabSize}
                  onChange={(event) => setSettings((current) => ({ ...current, tabSize: Number(event.target.value) }))}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={settings.lineNumbers}
                  onChange={(event) => setSettings((current) => ({ ...current, lineNumbers: event.target.checked }))}
                />
                Line numbers
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={settings.minimap}
                  onChange={(event) => setSettings((current) => ({ ...current, minimap: event.target.checked }))}
                />
                Minimap
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={settings.wordWrap}
                  onChange={(event) => setSettings((current) => ({ ...current, wordWrap: event.target.checked }))}
                />
                Word wrap
              </label>
            </div>

            <div className="settings-section">
              <h4>Behavior</h4>
              <label>
                <input
                  type="checkbox"
                  checked={settings.autosave}
                  onChange={(event) => setSettings((current) => ({ ...current, autosave: event.target.checked }))}
                />
                Auto-save
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(event) => setSettings((current) => ({ ...current, reducedMotion: event.target.checked }))}
                />
                Reduced motion
              </label>
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
  onOpen: (path: string) => void;
  onRename: (path: string) => void;
  onDuplicate: (path: string) => void;
  onDelete: (path: string) => void;
};

function TreeNode({
  node,
  path,
  activeFilePath,
  expandedFolders,
  setExpandedFolders,
  onOpen,
  onRename,
  onDuplicate,
  onDelete
}: TreeNodeProps) {
  const isExpanded = expandedFolders[path] ?? true;

  if (node.type === 'folder') {
    return (
      <div className="tree-item folder-item">
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
                onOpen={onOpen}
                onRename={onRename}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tree-item file-item">
      <button className={`tree-row file-row ${activeFilePath === path ? 'active' : ''}`} onClick={() => onOpen(path)}>
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
