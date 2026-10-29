import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Save, FileText, Download, Copy, Check, FolderOpen, Server, Laptop, X, AlertCircle, Globe, Zap, Braces } from 'lucide-react';
import { remoteReadFile, remoteWriteFile, findSessionById } from '../../lib/remoteFs';
import { apiFetch } from '../../lib/auth';

// The VS Code (Monaco) surface is a separate lazy chunk (~4MB) — it only
// downloads when the user picks "vscode" mode. "plain" mode is instant.
const MonacoPane = lazy(() => import('./MonacoPane'));

type EditorMode = 'vscode' | 'plain';
const MODE_KEY = 'vy-termweb:editor-mode';
const getMode = (): EditorMode =>
  localStorage.getItem(MODE_KEY) === 'vscode' ? 'vscode' : 'plain';

const LANGUAGES = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'shell', label: 'Shell' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'ini', label: 'INI / Config' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'xml', label: 'XML' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'sql', label: 'SQL' },
];

const EXT_TO_LANG: Record<string, string> = {
  sh: 'shell', bash: 'shell', zsh: 'shell',
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json',
  yml: 'yaml', yaml: 'yaml', md: 'markdown', markdown: 'markdown',
  ini: 'ini', conf: 'ini', cfg: 'ini', env: 'ini', properties: 'ini',
  dockerfile: 'dockerfile', xml: 'xml', html: 'html', htm: 'html',
  css: 'css', sql: 'sql', txt: 'plaintext', log: 'plaintext',
};

const detectLanguage = (filename: string): string => {
  const base = filename.toLowerCase();
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile';
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return EXT_TO_LANG[ext] || 'plaintext';
};

export default function TextEditor() {
  const [content, setContent] = useState('');
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState('plaintext');
  const [filename, setFilename] = useState('notes.txt');
  const [serverPath, setServerPath] = useState<string | null>(null);
  const [remote, setRemote] = useState<{ sessionId: string; path: string; host: string } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [pathMode, setPathMode] = useState<'open' | 'save' | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [mode, setMode] = useState<EditorMode>(getMode);
  const openInputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  const pickMode = (m: EditorMode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };

  useEffect(() => {
    const checkPending = () => {
      const remotePending = sessionStorage.getItem('vy-termweb:pending-remote');
      if (remotePending) {
        sessionStorage.removeItem('vy-termweb:pending-remote');
        try {
          const { sessionId, path } = JSON.parse(remotePending);
          void openRemoteFile(sessionId, path);
          return;
        } catch { /* fall through to local pending */ }
      }
      const pending = sessionStorage.getItem('vy-termweb:pending-open');
      if (pending) {
        sessionStorage.removeItem('vy-termweb:pending-open');
        openServerFile(pending);
      }
    };
    checkPending();
    // Re-check when another handoff arrives while this tab stays mounted.
    window.addEventListener('vy-termweb:open-editor', checkPending);
    return () => window.removeEventListener('vy-termweb:open-editor', checkPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? '');
      setContent(text);
      setFilename(file.name);
      setServerPath(null);
      setRemote(null);
      setLanguage(detectLanguage(file.name));
    };
    reader.readAsText(file);
  };

  const basename = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'file';

  const openServerFile = async (p: string) => {
    setErrorMsg('');
    try {
      const r = await apiFetch(`/api/local-file?path=${encodeURIComponent(p)}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const text = await r.text();
      if (text.includes('\0')) throw new Error('Binary file — cannot edit as text');
      setContent(text);
      setServerPath(p);
      setRemote(null);
      setFilename(basename(p));
      setLanguage(detectLanguage(p));
      setPathMode(null);
      setSavedAt(0);
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  // Remote (SFTP) file: content travels over the per-session socket in
  // remoteFs.ts; saves write back through sftp-write on the same connection.
  const openRemoteFile = async (sessionId: string, p: string) => {
    setErrorMsg('');
    setRemoteBusy(true);
    try {
      const s = findSessionById(sessionId);
      const text = await remoteReadFile(sessionId, p);
      setContent(text);
      setRemote({ sessionId, path: p, host: s?.host || sessionId });
      setServerPath(null);
      setFilename(basename(p));
      setLanguage(detectLanguage(p));
      setPathMode(null);
      setSavedAt(0);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setRemoteBusy(false);
    }
  };

  const saveRemoteFile = async () => {
    if (!remote) return;
    setErrorMsg('');
    setRemoteBusy(true);
    try {
      await remoteWriteFile(remote.sessionId, remote.path, content);
      setSavedAt(Date.now());
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setRemoteBusy(false);
    }
  };

  const saveServerFile = async (p: string) => {
    setErrorMsg('');
    try {
      const r = await apiFetch('/api/local-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p, content }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      setServerPath(d.path);
      setFilename(basename(d.path));
      setPathMode(null);
      setSavedAt(Date.now());
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const submitPath = () => {
    const p = pathInput.trim();
    if (!p) return;
    if (pathMode === 'open') openServerFile(p);
    else if (pathMode === 'save') saveServerFile(p);
  };

  useEffect(() => {
    if (pathMode) {
      setPathInput(pathMode === 'save' ? (serverPath ?? `/${filename}`) : (serverPath ?? ''));
      setTimeout(() => pathInputRef.current?.focus(), 0);
    }
  }, [pathMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadFile = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'notes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col bg-[#1e1e1e] text-white font-mono min-h-0">
      {/* Editor Toolbar */}
      <div className="bg-[#2d2d2d] border-b border-[#3f3f3f] p-2 flex items-center gap-3 text-xs shrink-0">
        <button
          onClick={() => setPathMode(pathMode === 'open' ? null : 'open')}
          className={`flex items-center gap-1.5 hover:bg-white/10 px-2 py-1 rounded transition-colors ${pathMode === 'open' ? 'bg-white/10' : ''} text-yellow-400`}
          title="Open file from server filesystem"
        >
          <FolderOpen className="w-3.5 h-3.5" /> Open
        </button>
        <input
          type="file"
          ref={openInputRef}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
            e.target.value = '';
          }}
        />
        <button
          onClick={() =>
            remote ? void saveRemoteFile() : serverPath ? saveServerFile(serverPath) : setPathMode('save')
          }
          disabled={remoteBusy}
          className="flex items-center gap-1.5 hover:bg-white/10 px-2 py-1 rounded transition-colors text-blue-400 disabled:opacity-50"
          title={
            remote
              ? `Save to ${remote.host}:${remote.path}`
              : serverPath
                ? `Save to ${serverPath}`
                : 'Save to server filesystem'
          }
        >
          {remoteBusy ? (
            <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
          ) : savedAt ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {remoteBusy ? 'Working…' : savedAt ? 'Saved' : 'Save'}
        </button>
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 hover:bg-white/10 px-2 py-1 rounded transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          onClick={downloadFile}
          className="flex items-center gap-1.5 hover:bg-white/10 px-2 py-1 rounded transition-colors text-green-400"
        >
          <Download className="w-3.5 h-3.5" /> Download
        </button>
        <button
          onClick={() => pickMode(mode === 'vscode' ? 'plain' : 'vscode')}
          className="flex items-center gap-1.5 hover:bg-white/10 px-2 py-1 rounded transition-colors text-purple-300"
          title={mode === 'vscode' ? 'VS Code engine (Monaco) — click for instant plain editor' : 'Plain editor — click for VS Code engine (Monaco)'}
        >
          {mode === 'vscode' ? <Braces className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          {mode === 'vscode' ? 'VS Code' : 'Plain'}
        </button>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-[#1e1e1e] border border-[#3f3f3f] rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="bg-[#1e1e1e] border border-[#3f3f3f] rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none w-36"
          title="Filename used for Save/Download"
        />
        <div className="flex-1" />
        {remote && (
          <span className="text-[10px] text-sky-400 truncate max-w-64" title={`${remote.host}:${remote.path}`}>
            <Globe className="w-3 h-3 inline mr-1" />{remote.host}:{remote.path}
          </span>
        )}
        {!remote && serverPath && (
          <span className="text-[10px] text-gray-500 truncate max-w-64" title={serverPath}>
            <Server className="w-3 h-3 inline mr-1" />{serverPath}
          </span>
        )}
        <div className="flex items-center gap-2 text-[10px] text-gray-500 italic">
          <FileText className="w-3 h-3" /> UTF-8 | Ln {cursor.line}, Col {cursor.col}
        </div>
      </div>

      {/* Server path bar */}
      {pathMode && (
        <div className="bg-[#252526] border-b border-[#3f3f3f] px-2 py-1.5 flex items-center gap-2 text-xs shrink-0">
          <Server className="w-3.5 h-3.5 text-gray-400" />
          <input
            ref={pathInputRef}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitPath();
              if (e.key === 'Escape') setPathMode(null);
            }}
            placeholder={pathMode === 'open' ? '/path/to/file.txt — Enter to open' : '/path/to/save.txt — Enter to save'}
            className="flex-1 bg-[#1e1e1e] border border-[#3f3f3f] rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500 font-mono"
          />
          <button onClick={submitPath} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-[11px]">
            {pathMode === 'open' ? 'Open' : 'Save'}
          </button>
          {pathMode === 'open' && (
            <button
              onClick={() => { setPathMode(null); openInputRef.current?.click(); }}
              className="flex items-center gap-1 px-2 py-1 hover:bg-white/10 rounded text-[11px] text-gray-400"
              title="Pick a file from this PC instead"
            >
              <Laptop className="w-3.5 h-3.5" /> From this PC…
            </button>
          )}
          <button onClick={() => setPathMode(null)} className="p-1 hover:bg-white/10 rounded text-gray-400"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-900/40 border-b border-red-700 px-3 py-1 text-[11px] text-red-300 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-3.5 h-3.5" /> {errorMsg}
          <button onClick={() => setErrorMsg('')} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {mode === 'vscode' ? (
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm italic">
            Loading VS Code engine…
          </div>
        }>
          <MonacoPane
            value={content}
            language={language}
            onChange={setContent}
            onCursor={(line, col) => setCursor({ line, col })}
          />
        </Suspense>
      ) : (
        <PlainEditor
          value={content}
          onChange={setContent}
          onCursor={(line, col) => setCursor({ line, col })}
        />
      )}
    </div>
  );
}

/** Lightweight VS Code-styled surface — no Monaco download, opens instantly.
 * Same dark palette and font stack as the Monaco pane. */
function PlainEditor({
  value, onChange, onCursor,
}: {
  value: string;
  onChange: (v: string) => void;
  onCursor: (line: number, col: number) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = value === '' ? 1 : value.split('\n').length;

  const syncScroll = () => {
    if (taRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  const reportCursor = () => {
    const ta = taRef.current;
    if (!ta) return;
    const upto = value.slice(0, ta.selectionStart);
    const line = upto.split('\n').length;
    const col = ta.selectionStart - upto.lastIndexOf('\n');
    onCursor(line, col);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = taRef.current!;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const v = value.slice(0, start) + '    ' + value.slice(end);
    onChange(v);
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
  };

  return (
    <div className="flex-1 flex min-h-0 bg-[#1e1e1e]">
      <div
        ref={gutterRef}
        className="w-12 shrink-0 overflow-hidden text-right pr-3 pt-2 select-none text-[#858585] text-[13px] leading-[19px] font-mono"
        aria-hidden
      >
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); reportCursor(); }}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        onKeyUp={reportCursor}
        onClick={reportCursor}
        spellCheck={false}
        placeholder="Text Editor — start typing..."
        className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] text-[13px] leading-[19px] font-mono p-2 pl-3 outline-none resize-none whitespace-pre overflow-auto placeholder:text-[#6a6a6a] selection:bg-[#264f78]"
        style={{ tabSize: 4, fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace" }}
      />
    </div>
  );
}
