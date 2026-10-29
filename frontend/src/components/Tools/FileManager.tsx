import { useState, useEffect, useRef, useCallback, type ChangeEvent, type DragEvent, type MouseEvent as RMouseEvent } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Search, Folder, Image as ImageIcon,
  Film, Music, FileText, FileCode, Archive, File, FolderPlus, Upload, Download,
  Pencil, Trash2, Copy, LayoutGrid, List, Home, HardDrive, X, ChevronRight,
  ChevronLeft, ChevronDown, Eye, TerminalSquare, Monitor, Scissors, ClipboardPaste, Info,
} from "lucide-react";
import { bust, BOOT_EVENT } from "../../lib/boot";
import { apiFetch, withAuthToken } from "../../lib/auth";
import { joinPath, parentPath, splitPath, crumbPath, sepOf } from "../../lib/pathx";
import { cn } from "../../lib/utils";

interface Entry {
  name: string;
  type: "dir" | "file";
  size: number;
  mtime: number;
  owner: string;
  permissions: string;
}

type Cat = "image" | "video" | "audio" | "pdf" | "text" | "archive" | "exec" | "dir" | "file";

const EXT_CAT: Record<string, Cat> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
  bmp: "image", ico: "image", avif: "image", heic: "image", heif: "image",
  mp4: "video", webm: "video", mov: "video", mkv: "video", m4v: "video",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio", opus: "audio", aac: "audio",
  pdf: "pdf",
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive", bz2: "archive", xz: "archive",
  "7z": "archive", rar: "archive", jar: "archive", war: "archive", deb: "archive", rpm: "archive",
  sh: "exec", bash: "exec", appimage: "exec", exe: "exec", msi: "exec", run: "exec", bin: "exec",
  txt: "text", md: "text", json: "text", js: "text", ts: "text", tsx: "text", jsx: "text",
  mjs: "text", cjs: "text", py: "text", css: "text", html: "text", htm: "text", xml: "text",
  yml: "text", yaml: "text", toml: "text", ini: "text", conf: "text", cfg: "text", log: "text",
  csv: "text", env: "text", gitignore: "text", editorconfig: "text", c: "text", cpp: "text",
  h: "text", hpp: "text", rs: "text", go: "text", java: "text", kt: "text", rb: "text",
  php: "text", sql: "text", vue: "text", svelte: "text", lock: "text", dockerfile: "text",
};

const CAT_META: Record<Cat, { icon: any; color: string; label: string }> = {
  dir: { icon: Folder, color: "text-amber-500 fill-amber-400", label: "File folder" },
  image: { icon: ImageIcon, color: "text-purple-500", label: "Image" },
  video: { icon: Film, color: "text-red-500", label: "Video" },
  audio: { icon: Music, color: "text-pink-500", label: "Audio" },
  pdf: { icon: FileText, color: "text-red-600", label: "PDF Document" },
  text: { icon: FileCode, color: "text-sky-600", label: "Text / Code" },
  archive: { icon: Archive, color: "text-orange-600", label: "Archive" },
  exec: { icon: TerminalSquare, color: "text-emerald-600", label: "Executable" },
  file: { icon: File, color: "text-gray-400", label: "File" },
};

const catOf = (e: Entry): Cat => {
  if (e.type === "dir") return "dir";
  const ext = e.name.includes(".") ? e.name.split(".").pop()!.toLowerCase() : e.name.toLowerCase();
  return EXT_CAT[ext] || "file";
};

const typeLabel = (e: Entry): string => {
  const c = catOf(e);
  if (c === "dir") return "File folder";
  const ext = e.name.includes(".") ? e.name.split(".").pop()!.toUpperCase() : "";
  return ext ? `${ext} ${CAT_META[c].label}` : "File";
};

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

const fmtDate = (ts: number): string =>
  ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";

const fileUrl = (p: string) => withAuthToken(`/api/local-file?path=${encodeURIComponent(p)}&${bust()}`);
const join = joinPath;

export default function FileManager() {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"details" | "icons">("details");
  const [iconSize, setIconSize] = useState(96);
  const [sort, setSort] = useState<{ col: "name" | "mtime" | "type" | "size" | "owner" | "permissions"; dir: 1 | -1 }>({ col: "name", dir: 1 });
  const [filter, setFilter] = useState("");
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: Entry | null; treeDir?: string } | null>(null);
  const [propsTarget, setPropsTarget] = useState<{ path: string; entry: Entry | null } | null>(null);
  const [viewer, setViewer] = useState<Entry | null>(null);
  const [viewerText, setViewerText] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: "copy" | "cut" } | null>(null);
  const [homePath, setHomePath] = useState("");
  const [serverRoots, setServerRoots] = useState<{ label: string; path: string }[]>([]);
  const [treeDirs, setTreeDirs] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lastClickRef = useRef<string>("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (dir: string) => {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch(`/api/local-fs?path=${encodeURIComponent(dir)}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setEntries(data.files);
      setCurrentPath(data.path);
      if (Array.isArray(data.roots)) setServerRoots(data.roots);
      setSelected(new Set());
      setRenaming(null);
      if (!dir) setHomePath(data.path);
      setTreeDirs((t) => ({
        ...t,
        [data.path]: data.files.filter((f: Entry) => f.type === "dir").map((f: Entry) => f.name),
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const pending = sessionStorage.getItem("vy-termweb:pending-fm-path");
    sessionStorage.removeItem("vy-termweb:pending-fm-path");
    load(pending || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar "Open in File Manager": pending path is set before the event;
  // if this tab is already mounted we navigate, otherwise the mount effect
  // above picks it up.
  useEffect(() => {
    const open = () => {
      const p = sessionStorage.getItem("vy-termweb:pending-fm-path");
      if (!p) return;
      sessionStorage.removeItem("vy-termweb:pending-fm-path");
      load(p);
    };
    window.addEventListener("vy-termweb:open-files", open);
    return () => window.removeEventListener("vy-termweb:open-files", open);
  }, [load]);

  // New server instance (restart or different machine) — cached entries,
  // thumbs and open viewers point at the old filesystem. Reset everything.
  useEffect(() => {
    const reset = () => {
      setViewer(null);
      setSelected(new Set());
      setCtxMenu(null);
      setTreeDirs({});
      setBack([]);
      setFwd([]);
      load(currentPath || "");
    };
    window.addEventListener(BOOT_EVENT, reset);
    return () => window.removeEventListener(BOOT_EVENT, reset);
  }, [load, currentPath]);

  const navigate = useCallback(
    (dir: string) => {
      if (dir === currentPath) return;
      setBack((b) => [...b, currentPath].filter(Boolean));
      setFwd([]);
      load(dir);
    },
    [currentPath, load]
  );

  const goBack = () => {
    setBack((b) => {
      if (!b.length) return b;
      const prev = b[b.length - 1];
      setFwd((f) => [currentPath, ...f]);
      load(prev);
      return b.slice(0, -1);
    });
  };
  const goFwd = () => {
    setFwd((f) => {
      if (!f.length) return f;
      const next = f[0];
      setBack((b) => [...b, currentPath]);
      load(next);
      return f.slice(1);
    });
  };
  const goUp = () => {
    navigate(parentPath(currentPath));
  };

  // ---- navigation tree (lazy) ----
  const loadTreeDirs = useCallback(async (dir: string) => {
    try {
      const r = await apiFetch(`/api/local-fs?path=${encodeURIComponent(dir)}`);
      const d = await r.json();
      if (d.error) return;
      setTreeDirs((t) => ({
        ...t,
        [d.path]: d.files.filter((f: Entry) => f.type === "dir").map((f: Entry) => f.name),
      }));
    } catch {}
  }, []);

  const toggleExpand = (dir: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(dir) ? n.delete(dir) : n.add(dir);
      return n;
    });
    if (!treeDirs[dir]) loadTreeDirs(dir);
  };

  // reveal current path in the tree (Explorer-style auto-expand ancestors)
  useEffect(() => {
    if (!currentPath) return;
    const segs = splitPath(currentPath);
    (async () => {
      for (let i = 0; i < segs.length; i++) {
        const acc = crumbPath(segs, i);
        if (acc === currentPath) break;
        if (!treeDirs[acc]) await loadTreeDirs(acc);
        setExpanded((e) => new Set(e).add(acc));
      }
      if (homePath && currentPath !== homePath && currentPath.startsWith(homePath + sepOf(currentPath))) {
        const h = homePath;
        setExpanded((e) => new Set(e).add(h));
      }
    })();
  }, [currentPath, homePath, loadTreeDirs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection (Explorer-like: click, ctrl, shift) ----
  const ordered = entries;
  const clickEntry = (e: RMouseEvent, entry: Entry) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(entry.name) ? n.delete(entry.name) : n.add(entry.name);
        return n;
      });
    } else if (e.shiftKey && lastClickRef.current) {
      const a = ordered.findIndex((x) => x.name === lastClickRef.current);
      const b = ordered.findIndex((x) => x.name === entry.name);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        setSelected(new Set(ordered.slice(lo, hi + 1).map((x) => x.name)));
      }
    } else {
      setSelected(new Set([entry.name]));
    }
    lastClickRef.current = entry.name;
  };

  const openEntry = (entry: Entry) => {
    if (entry.type === "dir") navigate(join(currentPath, entry.name));
    else setViewer(entry);
  };

  // ---- file ops ----
  const api = async (url: string, opts?: RequestInit) => {
    const r = await apiFetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  };

  const doMkdir = async (dir = currentPath) => {
    const name = window.prompt("New folder name:", "New folder");
    if (!name) return;
    try {
      await api("/api/local-mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, name }),
      });
      loadTreeDirs(dir);
      if (dir === currentPath) load(currentPath);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doRenamePath = async (dirPath: string) => {
    const parent = parentPath(dirPath);
    const oldName = splitPath(dirPath).pop() ?? dirPath;
    const newName = window.prompt("Rename to:", oldName);
    if (!newName || newName === oldName) return;
    try {
      await api("/api/local-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: parent, oldName, newName }),
      });
      loadTreeDirs(parent);
      const renamed = join(parent, newName);
      if (currentPath === dirPath || currentPath.startsWith(dirPath + "/")) load(renamed);
      else load(currentPath);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doRename = async (oldName: string, newName: string) => {
    setRenaming(null);
    if (!newName || newName === oldName) return;
    try {
      await api("/api/local-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: currentPath, oldName, newName }),
      });
      load(currentPath);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deletePaths = async (paths: string[]) => {
    if (!paths.length) return;
    if (!window.confirm(`Delete ${paths.length} item(s)?\n${paths.slice(0, 5).join("\n")}${paths.length > 5 ? "\n…" : ""}`)) return;
    setBusy(true);
    try {
      for (const p of paths) {
        await api(`/api/local-entry?path=${encodeURIComponent(p)}`, { method: "DELETE" });
      }
      for (const p of paths) loadTreeDirs(parentPath(p));
      load(currentPath);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = (names: string[]) => deletePaths(names.map((n) => join(currentPath, n)));

  const doDownload = (name: string) => {
    const a = document.createElement("a");
    a.href = `${fileUrl(join(currentPath, name))}&download=1`;
    a.download = name;
    a.click();
  };

  const putOnClipboard = (mode: "copy" | "cut") => {
    const names = selected.size ? [...selected] : ctxMenu?.entry ? [ctxMenu.entry.name] : [];
    if (!names.length) return;
    setClipboard({ paths: names.map((name) => join(currentPath, name)), mode });
    setCtxMenu(null);
  };

  const pasteClipboard = async () => {
    if (!clipboard?.paths.length) return;
    setBusy(true);
    try {
      await api(`/api/local-${clipboard.mode === "copy" ? "copy" : "move"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: clipboard.paths, destination: currentPath }),
      });
      if (clipboard.mode === "cut") setClipboard(null);
      await load(currentPath);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      setCtxMenu(null);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        await api("/api/local-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir: currentPath, name: file.name, content: btoa(bin) }),
        });
      }
      load(currentPath);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  };

  // ---- context menu ----
  const onContext = (e: RMouseEvent, entry: Entry | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (entry && !selected.has(entry.name)) setSelected(new Set([entry.name]));
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const onTreeContext = (e: RMouseEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry: null, treeDir: dirPath });
  };
  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // ---- viewer ----
  const viewableFiles = entries.filter((e) => e.type === "file");
  const openViewer = (entry: Entry) => {
    setViewer(entry);
    setViewerText(null);
    if (catOf(entry) === "text" && entry.size < 512 * 1024) {
      apiFetch(fileUrl(join(currentPath, entry.name)))
        .then((r) => r.text())
        .then(setViewerText)
        .catch(() => setViewerText("(failed to load)"));
    }
  };
  const stepViewer = (dir: 1 | -1) => {
    if (!viewer) return;
    const idx = viewableFiles.findIndex((f) => f.name === viewer.name);
    const next = viewableFiles[(idx + dir + viewableFiles.length) % viewableFiles.length];
    if (next) openViewer(next);
  };

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowLeft") stepViewer(-1);
      else if (e.key === "ArrowRight") stepViewer(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sorting / filtering ----
  const q = filter.trim().toLowerCase();
  const shown = ordered
    .filter((e) => !q || e.name.toLowerCase().includes(q) || typeLabel(e).toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      const d =
        sort.col === "name" ? a.name.localeCompare(b.name) :
        sort.col === "size" ? a.size - b.size :
        sort.col === "mtime" ? a.mtime - b.mtime :
        sort.col === "owner" ? a.owner.localeCompare(b.owner) :
        sort.col === "permissions" ? a.permissions.localeCompare(b.permissions) :
        typeLabel(a).localeCompare(typeLabel(b));
      return d * sort.dir;
    });

  const crumbs = splitPath(currentPath);
  const selEntries = entries.filter((e) => selected.has(e.name));

  const rootIcon = (label: string) =>
    label === "Home" ? Home : /^[A-Za-z]:/.test(label) ? HardDrive : label === "Root" ? Monitor : Folder;
  const treeRoots = serverRoots.length
    ? serverRoots.map((r) => ({ icon: rootIcon(r.label), label: r.label, path: r.path }))
    : [{ icon: Home, label: "Home", path: homePath }];

  return (
    <div className="flex-1 flex flex-col bg-white font-sans overflow-hidden text-xs" onClick={() => setCtxMenu(null)}>
      {/* Command bar */}
      <div className="bg-[#f5f6f7] border-b border-[#d9d9d9] px-2 py-1.5 flex items-center gap-1 shrink-0">
        <NavBtn onClick={goBack} disabled={!back.length} title="Back"><ArrowLeft className="w-4 h-4" /></NavBtn>
        <NavBtn onClick={goFwd} disabled={!fwd.length} title="Forward"><ArrowRight className="w-4 h-4" /></NavBtn>
        <NavBtn onClick={goUp} disabled={!currentPath || parentPath(currentPath) === currentPath} title="Up"><ArrowUp className="w-4 h-4" /></NavBtn>
        <NavBtn onClick={() => load(currentPath)} title="Refresh"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></NavBtn>

        {/* Breadcrumb address bar */}
        <div className="flex-1 flex items-center bg-white border border-[#b8b8b8] rounded-sm h-7 px-1 mx-2 overflow-x-auto whitespace-nowrap">
          <button onClick={() => navigate("/")} className="px-1.5 py-0.5 hover:bg-blue-50 rounded-sm flex items-center gap-1 text-gray-700">
            <Monitor className="w-3.5 h-3.5 text-gray-500" /> <span className="font-semibold">/</span>
          </button>
          {crumbs.map((seg, i) => (
            <span key={i} className="flex items-center">
              <ChevronRight className="w-3 h-3 text-gray-400" />
              <button
                onClick={() => navigate(crumbPath(crumbs, i))}
                className={cn(
                  "px-1.5 py-0.5 rounded-sm hover:bg-blue-50",
                  i === crumbs.length - 1 ? "font-bold text-gray-800" : "text-gray-600"
                )}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center bg-white border border-[#b8b8b8] rounded-sm h-7 px-2 w-48">
          <Search className="w-3.5 h-3.5 text-gray-400 mr-1.5" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${crumbs[crumbs.length - 1] || "/"}`}
            className="flex-1 bg-transparent outline-none text-[11px]"
          />
        </div>
      </div>

      {/* Action ribbon */}
      <div className="bg-[#f5f6f7] border-b border-[#e0e0e0] px-2 py-1 flex items-center gap-1 shrink-0">
        <RibbonBtn onClick={doMkdir}><FolderPlus className="w-3.5 h-3.5 text-amber-500" /> New folder</RibbonBtn>
        <RibbonBtn onClick={() => uploadRef.current?.click()}><Upload className="w-3.5 h-3.5 text-blue-500" /> Upload</RibbonBtn>
        <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ""; }} />
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <RibbonBtn disabled={!selEntries.length} onClick={() => putOnClipboard("cut")}><Scissors className="w-3.5 h-3.5 text-gray-600" /> Cut</RibbonBtn>
        <RibbonBtn disabled={!selEntries.length} onClick={() => putOnClipboard("copy")}><Copy className="w-3.5 h-3.5 text-gray-600" /> Copy</RibbonBtn>
        <RibbonBtn disabled={!clipboard} onClick={pasteClipboard}><ClipboardPaste className="w-3.5 h-3.5 text-gray-600" /> Paste</RibbonBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <RibbonBtn disabled={!selEntries.length || selEntries[0].type !== "file"} onClick={() => doDownload(selEntries[0].name)}><Download className="w-3.5 h-3.5 text-green-600" /> Download</RibbonBtn>
        <RibbonBtn disabled={!selEntries.length} onClick={() => setRenaming(selEntries[0].name)}><Pencil className="w-3.5 h-3.5 text-gray-600" /> Rename</RibbonBtn>
        <RibbonBtn disabled={!selEntries.length} onClick={() => doDelete(selEntries.map((e) => e.name))}><Trash2 className="w-3.5 h-3.5 text-red-500" /> Delete</RibbonBtn>
        <div className="flex-1" />
        {view === "icons" && (
          <select
            value={iconSize}
            onChange={(e) => setIconSize(Number(e.target.value))}
            className="bg-white border border-[#b8b8b8] rounded-sm px-1.5 py-0.5 text-[11px] text-gray-700 outline-none mr-1"
            title="Thumbnail size"
          >
            <option value={64}>Small icons</option>
            <option value={96}>Medium icons</option>
            <option value={128}>Large icons</option>
            <option value={192}>Extra large icons</option>
          </select>
        )}
        <button
          onClick={() => setView("details")}
          className={cn("p-1.5 rounded-sm", view === "details" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-200")}
          title="Details"
        ><List className="w-4 h-4" /></button>
        <button
          onClick={() => setView("icons")}
          className={cn("p-1.5 rounded-sm", view === "icons" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-200")}
          title="Large icons"
        ><LayoutGrid className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Navigation pane — dynamic folder tree */}
        <div className="w-52 border-r border-[#e5e5e5] bg-[#fbfbfb] overflow-y-auto py-2 shrink-0 select-none">
          <div className="px-3 pb-1 text-[10px] font-bold text-gray-500 uppercase tracking-wide">Folders</div>
          {treeRoots.map((r) => (
            <TreeNode
              key={r.label}
              name={r.label}
              dirPath={r.path}
              depth={0}
              icon={r.icon}
              treeDirs={treeDirs}
              expanded={expanded}
              currentPath={currentPath}
              onToggle={toggleExpand}
              onNavigate={navigate}
              onContext={onTreeContext}
            />
          ))}
        </div>

        {/* File list */}
        <div
          ref={listRef}
          className={cn("flex-1 overflow-auto relative", dragOver && "outline-dashed outline-2 outline-blue-400 outline-offset-[-4px] bg-blue-50/40")}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onContextMenu={(e) => onContext(e, null)}
          onClick={(e) => { if (e.target === listRef.current || (e.target as HTMLElement).dataset.empty) setSelected(new Set()); }}
        >
          {error && (
            <div className="m-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError("")}><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {view === "details" ? (
            <table className="w-full text-left select-none">
              <thead className="sticky top-0 bg-[#f9f9f9] border-b border-[#e0e0e0] text-gray-600 z-10">
                <tr>
                  {([["name", "Name"], ["mtime", "Date modified"], ["type", "Type"], ["size", "Size"], ["owner", "Owner"], ["permissions", "Permissions"]] as const).map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => setSort((s) => ({ col, dir: s.col === col ? (s.dir === 1 ? -1 : 1) : 1 }))}
                      className="px-3 py-1.5 font-medium hover:bg-gray-100 cursor-pointer text-[11px] border-r border-[#ececec] last:border-r-0"
                    >
                      {label} {sort.col === col && <span className="text-blue-600">{sort.dir === 1 ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const cat = catOf(e);
                  const meta = CAT_META[cat];
                  const Icon = meta.icon;
                  const isSel = selected.has(e.name);
                  return (
                    <tr
                      key={e.name}
                      onClick={(ev) => clickEntry(ev, e)}
                      onDoubleClick={() => openEntry(e)}
                      onContextMenu={(ev) => onContext(ev, e)}
                      className={cn("cursor-default border-b border-transparent", isSel ? "bg-blue-100" : "hover:bg-blue-50")}
                    >
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-2">
                          <Icon className={cn("w-4 h-4 shrink-0", meta.color)} />
                          {renaming === e.name ? (
                            <input
                              autoFocus
                              defaultValue={e.name}
                              className="border border-blue-400 rounded-sm px-1 text-[11px] w-48"
                              onClick={(ev) => ev.stopPropagation()}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") doRename(e.name, (ev.target as HTMLInputElement).value);
                                if (ev.key === "Escape") setRenaming(null);
                              }}
                              onBlur={(ev) => doRename(e.name, ev.target.value)}
                            />
                          ) : (
                            <span className="text-gray-800 truncate">{e.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1 text-gray-500 whitespace-nowrap">{fmtDate(e.mtime)}</td>
                      <td className="px-3 py-1 text-gray-500">{typeLabel(e)}</td>
                      <td className="px-3 py-1 text-gray-500 text-right pr-4">{e.type === "file" ? fmtSize(e.size) : ""}</td>
                      <td className="px-3 py-1 text-gray-500 whitespace-nowrap">{e.owner}</td>
                      <td className="px-3 py-1 text-gray-500 font-mono whitespace-nowrap">{e.permissions}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div
              className="grid gap-1 p-3 select-none"
              style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${iconSize + 30}px,1fr))` }}
            >
              {shown.map((e) => {
                const cat = catOf(e);
                const meta = CAT_META[cat];
                const Icon = meta.icon;
                const isSel = selected.has(e.name);
                return (
                  <div
                    key={e.name}
                    onClick={(ev) => clickEntry(ev, e)}
                    onDoubleClick={() => openEntry(e)}
                    onContextMenu={(ev) => onContext(ev, e)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 p-3 rounded-md cursor-default border border-transparent",
                      isSel ? "bg-blue-100 border-blue-300" : "hover:bg-blue-50"
                    )}
                  >
                    <FileThumb entry={e} dir={currentPath} icon={Icon} iconColor={meta.color} size={iconSize} />
                    <span className="text-[11px] text-gray-800 text-center break-all leading-tight max-h-8 overflow-hidden">{e.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !shown.length && !error && (
            <div data-empty className="text-center text-gray-400 italic py-16">This folder is empty — drop files here to upload.</div>
          )}
          {busy && (
            <div className="absolute bottom-3 right-3 bg-gray-800 text-white px-3 py-1.5 rounded shadow-lg">Working…</div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-[#f0f0f0] border-t border-[#d9d9d9] px-3 py-1 flex items-center justify-between text-gray-600 shrink-0">
        <span>{shown.length} item{shown.length !== 1 ? "s" : ""}{selected.size ? ` · ${selected.size} selected` : ""}</span>
        <span className="font-mono text-[10px] truncate max-w-[50%]">{currentPath}</span>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed bg-white border border-gray-300 shadow-xl rounded-sm py-1 z-50 min-w-44 text-[12px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.entry ? (
            <>
              <CtxItem onClick={() => { openEntry(ctxMenu.entry!); setCtxMenu(null); }}><Eye className="w-3.5 h-3.5" /> Open</CtxItem>
              {ctxMenu.entry.type === "file" && (
                <CtxItem onClick={() => { doDownload(ctxMenu.entry!.name); setCtxMenu(null); }}><Download className="w-3.5 h-3.5" /> Download</CtxItem>
              )}
              {ctxMenu.entry.type === "file" && (
                <CtxItem onClick={() => {
                  sessionStorage.setItem("vy-termweb:pending-open", join(currentPath, ctxMenu.entry!.name));
                  window.dispatchEvent(new Event("vy-termweb:open-editor"));
                  setCtxMenu(null);
                }}><FileText className="w-3.5 h-3.5" /> Edit in editor</CtxItem>
              )}
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => putOnClipboard("cut")}><Scissors className="w-3.5 h-3.5" /> Cut</CtxItem>
              <CtxItem onClick={() => putOnClipboard("copy")}><Copy className="w-3.5 h-3.5" /> Copy</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { setRenaming(ctxMenu.entry!.name); setCtxMenu(null); }}><Pencil className="w-3.5 h-3.5" /> Rename</CtxItem>
              <CtxItem onClick={() => { doDelete([...selected]); setCtxMenu(null); }}><Trash2 className="w-3.5 h-3.5 text-red-500" /> Delete</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { navigator.clipboard.writeText(join(currentPath, ctxMenu.entry!.name)).catch(() => {}); setCtxMenu(null); }}><Copy className="w-3.5 h-3.5" /> Copy path</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { setPropsTarget({ path: join(currentPath, ctxMenu.entry!.name), entry: ctxMenu.entry }); setCtxMenu(null); }}><Info className="w-3.5 h-3.5" /> Properties</CtxItem>
            </>
          ) : ctxMenu.treeDir ? (
            <>
              <CtxItem onClick={() => { navigate(ctxMenu.treeDir!); setCtxMenu(null); }}><Folder className="w-3.5 h-3.5" /> Open</CtxItem>
              <CtxItem onClick={() => { loadTreeDirs(ctxMenu.treeDir!); setCtxMenu(null); }}><RefreshCw className="w-3.5 h-3.5" /> Refresh</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { doMkdir(ctxMenu.treeDir!); setCtxMenu(null); }}><FolderPlus className="w-3.5 h-3.5" /> New folder</CtxItem>
              <CtxItem onClick={() => { doRenamePath(ctxMenu.treeDir!); setCtxMenu(null); }}><Pencil className="w-3.5 h-3.5" /> Rename</CtxItem>
              <CtxItem onClick={() => { deletePaths([ctxMenu.treeDir!]); setCtxMenu(null); }}><Trash2 className="w-3.5 h-3.5 text-red-500" /> Delete</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { navigator.clipboard.writeText(ctxMenu.treeDir!).catch(() => {}); setCtxMenu(null); }}><Copy className="w-3.5 h-3.5" /> Copy path</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { setPropsTarget({ path: ctxMenu.treeDir!, entry: null }); setCtxMenu(null); }}><Info className="w-3.5 h-3.5" /> Properties</CtxItem>
            </>
          ) : (
            <>
              <CtxItem onClick={() => { doMkdir(); setCtxMenu(null); }}><FolderPlus className="w-3.5 h-3.5" /> New folder</CtxItem>
              <CtxItem onClick={() => { uploadRef.current?.click(); setCtxMenu(null); }}><Upload className="w-3.5 h-3.5" /> Upload files</CtxItem>
              {clipboard && <CtxItem onClick={pasteClipboard}><ClipboardPaste className="w-3.5 h-3.5" /> Paste</CtxItem>}
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { load(currentPath); setCtxMenu(null); }}><RefreshCw className="w-3.5 h-3.5" /> Refresh</CtxItem>
              <div className="my-1 border-t border-gray-200" />
              <CtxItem onClick={() => { setPropsTarget({ path: currentPath, entry: null }); setCtxMenu(null); }}><Info className="w-3.5 h-3.5" /> Properties</CtxItem>
            </>
          )}
        </div>
      )}

      {/* Properties dialog */}
      {propsTarget && (
        <PropertiesDialog path={propsTarget.path} entry={propsTarget.entry} onClose={() => setPropsTarget(null)} />
      )}

      {/* Media viewer overlay */}
      {viewer && (
        <div className="fixed inset-0 bg-black/85 z-50 flex flex-col" onClick={() => setViewer(null)}>
          <div className="flex items-center justify-between px-4 py-2 bg-black/60 text-white text-xs shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-bold truncate">{viewer.name}</span>
              <span className="text-gray-400">{typeLabel(viewer)} · {fmtSize(viewer.size)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); doDownload(viewer.name); }} className="p-1.5 hover:bg-white/20 rounded" title="Download"><Download className="w-4 h-4" /></button>
              <button onClick={() => setViewer(null)} className="p-1.5 hover:bg-white/20 rounded" title="Close"><X className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0 relative" onClick={(e) => e.stopPropagation()}>
            {viewableFiles.length > 1 && (
              <>
                <button onClick={() => stepViewer(-1)} className="absolute left-3 p-2 bg-black/50 hover:bg-black/80 rounded-full text-white z-10"><ChevronLeft className="w-6 h-6" /></button>
                <button onClick={() => stepViewer(1)} className="absolute right-3 p-2 bg-black/50 hover:bg-black/80 rounded-full text-white z-10"><ChevronRight className="w-6 h-6" /></button>
              </>
            )}
            <ViewerContent entry={viewer} dir={currentPath} text={viewerText} />
          </div>
        </div>
      )}
    </div>
  );
}

function TreeNode({
  name, dirPath, depth, icon, treeDirs, expanded, currentPath, onToggle, onNavigate, onContext,
}: {
  name: string;
  dirPath: string;
  depth: number;
  icon: any;
  treeDirs: Record<string, string[]>;
  expanded: Set<string>;
  currentPath: string;
  onToggle: (dir: string) => void;
  onNavigate: (dir: string) => void;
  onContext: (e: RMouseEvent, dir: string) => void;
}) {
  const open = expanded.has(dirPath);
  const kids = treeDirs[dirPath];
  const isLeaf = kids !== undefined && kids.length === 0;
  const active = currentPath === dirPath;
  const Icon = icon;
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 pr-2 py-1 cursor-default text-gray-700 hover:bg-blue-50",
          active && "bg-blue-100 text-blue-800 font-semibold"
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => dirPath && onNavigate(dirPath)}
        onContextMenu={(e) => dirPath && onContext(e, dirPath)}
      >
        {isLeaf ? (
          <span className="w-3.5 shrink-0" />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(dirPath); }}
            className="w-3.5 h-3.5 flex items-center justify-center text-gray-400 hover:text-gray-700 shrink-0"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
        <Icon className={cn("w-3.5 h-3.5 shrink-0", depth > 0 ? "text-amber-500 fill-amber-200" : "text-gray-500")} />
        <span className="truncate text-[11px]">{name}</span>
      </div>
      {open && kids === undefined && (
        <div className="text-gray-400 italic text-[10px] py-0.5" style={{ paddingLeft: 24 + depth * 12 }}>Loading…</div>
      )}
      {open &&
        kids?.map((k) => (
          <TreeNode
            key={k}
            name={k}
            dirPath={join(dirPath, k)}
            depth={depth + 1}
            icon={Folder}
            treeDirs={treeDirs}
            expanded={expanded}
            currentPath={currentPath}
            onToggle={onToggle}
            onNavigate={onNavigate}
            onContext={onContext}
          />
        ))}
    </div>
  );
}

function PropertiesDialog({ path, entry, onClose }: { path: string; entry: Entry | null; onClose: () => void }) {
  const [meta, setMeta] = useState<Entry | null>(entry);
  const [contents, setContents] = useState<string | null>(null);
  const name = splitPath(path).pop() ?? path;
  const parent = parentPath(path);
  const isDir = (meta?.type ?? "dir") === "dir";

  useEffect(() => {
    let dead = false;
    // Resolve owner/perms/mtime via the parent listing (tree nodes and the
    // background menu carry no Entry metadata).
    if (!entry) {
      apiFetch(`/api/local-fs?path=${encodeURIComponent(parent)}`)
        .then((r) => r.json())
        .then((d) => {
          const e = (d.files as Entry[] | undefined)?.find((f) => f.name === name);
          if (!dead && e) setMeta(e);
        })
        .catch(() => {});
    }
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDir) return;
    apiFetch(`/api/local-fs?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => {
        const files = (d.files as Entry[] | undefined) ?? [];
        setContents(
          `${files.filter((f) => f.type === "dir").length} folder(s), ${files.filter((f) => f.type === "file").length} file(s)`
        );
      })
      .catch(() => setContents(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const row = (label: string, value: string) => (
    <div className="flex border-b border-[#eee] last:border-0">
      <span className="w-28 shrink-0 px-3 py-1.5 text-gray-500">{label}</span>
      <span className="px-3 py-1.5 text-gray-800 break-all select-text">{value || "—"}</span>
    </div>
  );

  const metaEntry: Entry = meta ?? { name, type: "dir", size: 0, mtime: 0, owner: "", permissions: "" };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white border border-[#aaa] shadow-2xl w-full max-w-sm rounded-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-vy-nav border-b border-[#ccc] px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Info className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-sm font-bold text-gray-700 truncate">{name} — Properties</span>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400 hover:text-red-500" /></button>
        </div>
        <div className="p-3 text-[12px]">
          {row("Type", typeLabel(metaEntry))}
          {row("Location", parent)}
          {isDir ? row("Contents", contents ?? "…") : row("Size", fmtSize(metaEntry.size))}
          {row("Modified", fmtDate(metaEntry.mtime))}
          {row("Owner", metaEntry.owner)}
          {row("Permissions", metaEntry.permissions)}
        </div>
      </div>
    </div>
  );
}

function FileThumb({ entry, dir, icon: Icon, iconColor, size }: { entry: Entry; dir: string; icon: any; iconColor: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const cat = catOf(entry);
  const thumbless = entry.type === "dir" || (cat !== "image" && cat !== "video") || entry.name.toLowerCase().endsWith(".svg");
  if (failed || thumbless)
    return <Icon className={iconColor} style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }} />;
  return (
    <img
      src={withAuthToken(`/api/local-thumb?path=${encodeURIComponent(join(dir, entry.name))}&s=${Math.min(512, size * 2)}&${bust()}`)}
      loading="lazy"
      onError={() => setFailed(true)}
      alt=""
      style={{ width: size, height: size }}
      className="object-cover rounded-sm border border-gray-200 bg-gray-50"
    />
  );
}

function ViewerContent({ entry, dir, text }: { entry: Entry; dir: string; text: string | null }) {
  const url = fileUrl(join(dir, entry.name));
  const cat = catOf(entry);
  // Browsers can't decode HEIC natively — show the server-side JPEG conversion
  const isHeic = /\.hei[cf]$/i.test(entry.name);
  switch (cat) {
    case "image":
      return (
        <img
          src={isHeic ? withAuthToken(`/api/local-thumb?path=${encodeURIComponent(join(dir, entry.name))}&s=1024&${bust()}`) : url}
          alt={entry.name}
          className="max-w-full max-h-full object-contain"
        />
      );
    case "video":
      return <video src={url} controls autoPlay className="max-w-full max-h-full" />;
    case "audio":
      return (
        <div className="bg-white/10 rounded-xl p-8 flex flex-col items-center gap-4">
          <Music className="w-16 h-16 text-pink-400" />
          <audio src={url} controls autoPlay className="w-96" />
        </div>
      );
    case "pdf":
      return <iframe src={url} title={entry.name} className="w-full h-full bg-white" />;
    case "text":
      return (
        <div className="w-full h-full overflow-auto bg-[#1e1e1e] p-4">
          <pre className="text-gray-200 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">
            {text ?? "Loading…"}
          </pre>
        </div>
      );
    default:
      return (
        <div className="text-center text-gray-300">
          <File className="w-16 h-16 mx-auto mb-3 text-gray-500" />
          <p className="text-sm">No preview available for this file type.</p>
          <p className="text-[11px] text-gray-500 mt-1">Use the Download button to open it locally.</p>
        </div>
      );
  }
}

function NavBtn({ children, onClick, disabled, title }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="p-1.5 rounded-sm text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors">
      {children}
    </button>
  );
}

function RibbonBtn({ children, onClick, disabled }: any) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 px-2 py-1 rounded-sm text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition-colors text-[11px]">
      {children}
    </button>
  );
}

function CtxItem({ children, onClick }: any) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-600 hover:text-white text-left text-gray-700 transition-colors">
      {children}
    </button>
  );
}
