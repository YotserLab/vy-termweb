import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Folder, 
  FileText, 
  ArrowUp, 
  RefreshCw, 
  Upload, 
  Download, 
  Trash2, 
  Search, 
  MoreVertical, 
  LayoutGrid, 
  List as ListIcon, 
  FolderPlus, 
  Edit3,
  FileImage,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  FileJson,
  File as FileIcon,
  FileDigit,
  FileSpreadsheet,
  FilePen
} from "lucide-react";
import { connectSocket } from "../lib/auth";
import { trackBoot } from "../lib/boot";
import { cn } from "../lib/utils";
import { type Session, type SessionGroup, type SSHKey } from "../types";
import { buildConnectPayload } from "../lib/session";
import { bytesToB64 } from "../lib/remoteFs";

interface SFTPViewProps {
  key?: string;
  session: Session;
  sessions?: Session[];
  groups?: SessionGroup[];
  sshKeys?: SSHKey[];
}

const getFileIcon = (fileName: string, isDir: boolean) => {
  if (isDir) {
    return {
      Icon: Folder,
      color: "text-yellow-500 fill-yellow-500"
    };
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return { Icon: FileImage, color: "text-purple-500" };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) {
    return { Icon: FileArchive, color: "text-orange-600" };
  }
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'c', 'cpp', 'java', 'go', 'rs', 'sh', 'php'].includes(ext)) {
    return { Icon: FileCode, color: "text-blue-600" };
  }
  if (ext === 'json') {
    return { Icon: FileJson, color: "text-yellow-600" };
  }
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
    return { Icon: FileAudio, color: "text-pink-500" };
  }
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return { Icon: FileVideo, color: "text-red-500" };
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return { Icon: FileSpreadsheet, color: "text-green-600" };
  }
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) {
    return { Icon: FileText, color: "text-blue-400" };
  }

  return { Icon: FileIcon, color: "text-gray-400" };
};

export default function SFTPView({ session, sessions, groups, sshKeys }: SFTPViewProps) {
  const [currentPath, setCurrentPath] = useState(".");
  const [files, setFiles] = useState<{name: string, type: string, size?: number, mtime?: number}[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [sftpReady, setSftpReady] = useState(false);
  const socketRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  // Connect once per session — NOT on every path change
  useEffect(() => {
    if (!session.host || session.host === "local") return;

    const socket = connectSocket();
    socketRef.current = socket;
    trackBoot(socket);

    // Re-emit on every (re)connect: the server parks the session and resumes
    // it via resumeId instead of re-authenticating SSH.
    socket.on("connect", () => {
      buildConnectPayload(session, sessions || [session], sshKeys || [], groups || [])
        .then((payload) =>
          socket.emit("ssh-connect", {
            ...payload,
            resumeId: `sftp-${session.id}`,
            seen: -1,
          })
        )
        .catch(() => setSftpReady(false));
    });

    socket.on("sftp-ready", () => {
      setSftpReady(true);
      socket.emit("sftp-ls", currentPathRef.current);
    });

    socket.on("sftp-list", ({ path, files }: any) => {
      setFiles(files);
      setCurrentPath(path);
      setLoading(false);
    });

    socket.on("sftp-error", (err: string) => {
      alert(err);
      setLoading(false);
    });

    socket.on("sftp-file-content", ({ name, content }: any) => {
      const blob = new Blob([content]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    });

    socket.on("sftp-upload-success", () => {
      socket.emit("sftp-ls", currentPathRef.current);
    });

    socket.on("sftp-action-success", () => {
      socket.emit("sftp-ls", currentPathRef.current);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSftpReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const loadFiles = (path: string) => {
    setLoading(true);
    socketRef.current?.emit("sftp-ls", path);
  };

  // Navigate when path changes (socket already connected)
  useEffect(() => {
    if (sftpReady) loadFiles(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, sftpReady]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socketRef.current) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const buf = event.target?.result;
      socketRef.current?.emit("sftp-upload", {
        remotePath: currentPath,
        name: file.name,
        // binary payloads inside a map don't reach the server — send base64
        content: buf instanceof ArrayBuffer ? bytesToB64(new Uint8Array(buf)) : ""
      });
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleDelete = (name: string, type: string) => {
    if (!confirm(`Are you sure you want to delete this ${type === 'dir' ? 'folder' : 'file'}?`)) return;
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    socketRef.current?.emit("sftp-rm", { path: fullPath, type });
  };

  const handleMkdir = () => {
    const name = prompt("Enter folder name:");
    if (!name) return;
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    socketRef.current?.emit("sftp-mkdir", { path: fullPath });
  };

  const handleRename = (oldName: string) => {
    const newName = prompt("Enter new name:", oldName);
    if (!newName || newName === oldName) return;
    const oldPath = currentPath === '/' ? `/${oldName}` : `${currentPath}/${oldName}`;
    const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
    socketRef.current?.emit("sftp-rename", { oldPath, newPath });
  };

  const handleDirClick = (name: string) => {
    const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    setCurrentPath(newPath);
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath('/' + parts.join('/'));
  };

  const handleDownload = (name: string) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    socketRef.current?.emit("sftp-download", fullPath);
  };

  // Hand the remote file to the internal editor — content round-trips via
  // sftp-read/sftp-write on a dedicated socket (src/lib/remoteFs.ts).
  const openInEditor = (name: string) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    sessionStorage.setItem(
      "vy-termweb:pending-remote",
      JSON.stringify({ sessionId: session.id, path: fullPath })
    );
    window.dispatchEvent(new Event("vy-termweb:open-editor"));
  };

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col bg-[#f0f0f0]">
      {/* SFTP Toolbar */}
      <div className="bg-vy-toolbar border-b border-vy-border px-2 py-1.5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-1">
          <button 
            onClick={handleGoUp}
            className="p-1.5 hover:bg-white/50 rounded flex items-center gap-1.5 text-xs text-gray-700 font-medium"
          >
            <ArrowUp className="w-3.5 h-3.5" /> Up
          </button>
          <div className="h-4 w-px bg-gray-300 mx-1"></div>
          <button 
            onClick={() => loadFiles(currentPath)}
            className="p-1.5 hover:bg-white/50 rounded flex items-center gap-1.5 text-xs text-gray-700 font-medium"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
          </button>
          <div className="h-4 w-px bg-gray-300 mx-1"></div>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 hover:bg-white/50 rounded flex items-center gap-1.5 text-xs text-gray-700 font-medium"
          >
            <Upload className="w-3.5 h-3.5 text-blue-600" /> Upload
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
          />
          <button 
            onClick={handleMkdir}
            className="p-1.5 hover:bg-white/50 rounded flex items-center gap-1.5 text-xs text-gray-700 font-medium"
          >
            <FolderPlus className="w-3.5 h-3.5 text-yellow-600" /> New Dir
          </button>
        </div>

        <div className="flex items-center gap-2">
           <div className="relative group/search">
              <Search className="absolute left-2.5 top-2 w-3 h-3 text-gray-400 group-focus-within/search:text-vy-accent transition-colors" />
              <input 
                type="text" 
                placeholder="Find in directory..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-2 py-1 border border-gray-300 rounded-sm text-xs w-48 outline-none focus:border-vy-accent focus:ring-1 focus:ring-vy-accent/20 transition-all bg-white/50 focus:bg-white"
              />
           </div>
           <div className="flex border border-gray-300 rounded-sm overflow-hidden bg-gray-100/50">
              <button 
                onClick={() => setViewMode("list")}
                className={cn("p-1", viewMode === "list" ? "bg-white" : "bg-gray-100 hover:bg-gray-50")}
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => setViewMode("grid")}
                className={cn("p-1 border-l border-gray-300", viewMode === "grid" ? "bg-white" : "bg-gray-100 hover:bg-gray-50")}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
           </div>
        </div>
      </div>

      {/* Path Breadcrumbs Area */}
      <div className="bg-white border-b border-vy-border px-3 py-1 flex items-center text-[11px] text-gray-500 font-mono">
        <span className="opacity-50 mr-1">Remote Path:</span>
        <span className="text-gray-800 font-bold">{currentPath}</span>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto bg-white">
        {viewMode === "list" ? (
          <table className="w-full text-left text-xs border-separate border-spacing-0">
            <thead className="bg-[#f8f9fa] border-b border-vy-border sticky top-0 z-10 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
              <tr>
                <th className="px-4 py-2 w-1/2 font-serif italic text-[11px] uppercase tracking-wider text-gray-500 border-b border-vy-border">Name</th>
                <th className="px-4 py-2 font-serif italic text-[11px] uppercase tracking-wider text-gray-500 border-b border-vy-border">Size</th>
                <th className="px-4 py-2 font-serif italic text-[11px] uppercase tracking-wider text-gray-500 border-b border-vy-border">Type</th>
                <th className="px-4 py-2 text-right font-serif italic text-[11px] uppercase tracking-wider text-gray-500 border-b border-vy-border">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredFiles.map(file => (
                <tr 
                  key={file.name} 
                  onDoubleClick={() => file.type === 'dir' && handleDirClick(file.name)}
                  className="hover:bg-blue-50/40 group cursor-default transition-colors"
                >
                  <td className="px-4 py-1 flex items-center gap-2 border-r border-gray-50">
                    {(() => {
                      const { Icon, color } = getFileIcon(file.name, file.type === 'dir');
                      return <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />;
                    })()}
                    <span className={cn("truncate font-mono text-[11px]", file.type === 'dir' ? "font-bold text-gray-900" : "text-gray-700")}>{file.name}</span>
                  </td>
                  <td className="px-4 py-1 text-gray-500 font-mono text-[10px] border-r border-gray-50">
                    {file.size ? `${(file.size / 1024).toFixed(1)} KB` : '-'}
                  </td>
                  <td className="px-4 py-1 text-gray-400 font-mono text-[10px] border-r border-gray-50">
                    {file.type === 'dir' ? 'Folder' : 'File'}
                  </td>
                  <td className="px-4 py-1 text-right opacity-0 group-hover:opacity-100 transition-all">
                    <div className="flex items-center justify-end gap-2">
                       {file.type === 'file' && (
                         <button
                           onClick={() => openInEditor(file.name)}
                           className="p-1 hover:bg-gray-200 rounded text-sky-600"
                           title="Edit in editor"
                         >
                           <FilePen className="w-3.5 h-3.5" />
                         </button>
                       )}
                       <button 
                         onClick={() => handleRename(file.name)}
                         className="p-1 hover:bg-gray-200 rounded text-gray-600"
                         title="Rename"
                       >
                         <Edit3 className="w-3.5 h-3.5" />
                       </button>
                       {file.type === 'file' && (
                         <button 
                           onClick={() => handleDownload(file.name)}
                           className="p-1 hover:bg-gray-200 rounded text-blue-600"
                           title="Download"
                         >
                           <Download className="w-3.5 h-3.5" />
                         </button>
                       )}
                       <button 
                         onClick={() => handleDelete(file.name, file.type)}
                         className="p-1 hover:bg-red-100 rounded text-red-500" 
                         title="Delete"
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                       </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4 p-4">
            {filteredFiles.map(file => (
              <div 
                key={file.name} 
                onDoubleClick={() => file.type === 'dir' && handleDirClick(file.name)}
                className="flex flex-col items-center p-2 rounded hover:bg-blue-50 group cursor-default text-center relative"
              >
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 flex flex-col gap-1">
                   {file.type === 'file' && (
                     <button onClick={() => openInEditor(file.name)} className="p-1 bg-white/80 hover:bg-gray-100 text-sky-600 rounded shadow-sm" title="Edit in editor">
                        <FilePen className="w-3 h-3" />
                     </button>
                   )}
                   <button onClick={() => handleDelete(file.name, file.type)} className="p-1 bg-white/80 hover:bg-red-100 text-red-500 rounded shadow-sm">
                      <Trash2 className="w-3 h-3" />
                   </button>
                   <button onClick={() => handleRename(file.name)} className="p-1 bg-white/80 hover:bg-gray-100 text-gray-600 rounded shadow-sm">
                      <Edit3 className="w-3 h-3" />
                   </button>
                </div>
                <div className="relative mb-1">
                   {(() => {
                      const { Icon, color } = getFileIcon(file.name, file.type === 'dir');
                      return <Icon className={cn("w-10 h-10", color)} />;
                   })()}
                </div>
                <span className="text-[11px] font-medium break-all line-clamp-2 max-w-full">{file.name}</span>
                <span className="text-[9px] text-gray-400 mt-0.5">{file.size ? `${(file.size / 1024).toFixed(1)} KB` : '-'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SFTP Status Footer */}
      <div className="bg-vy-nav border-t border-vy-border px-3 py-1 flex items-center justify-between text-[11px] text-gray-500 font-medium">
        <div className="flex items-center gap-4">
           <span>Total: {filteredFiles.length} items</span>
           <span className="opacity-30">|</span>
           <span>Selected: 0</span>
        </div>
        <div className="flex items-center gap-2">
           <span className="bg-blue-600 text-white px-2 rounded-sm text-[9px] font-bold">READY</span>
           <span className="opacity-70">{session.host}</span>
        </div>
      </div>
    </div>
  );
}
