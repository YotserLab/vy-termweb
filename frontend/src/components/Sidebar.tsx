import { Folder, Terminal, FileText, Search, ChevronRight, ChevronDown, Monitor, Clock, Edit3, PlusCircle, RefreshCw, ArrowUp, Upload, Download, MoreVertical, FolderOpen, ExternalLink, Copy, Trash2, Pencil, Files, FolderInput } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent } from "react";
import { cn } from "../lib/utils";
import { joinPath, parentPath } from "../lib/pathx";
import { type Session, type SessionGroup, type SSHKey } from "../types";
import { type Socket } from "socket.io-client";
import { connectSocket, apiFetch } from "../lib/auth";
import { trackBoot, bust } from "../lib/boot";
import { buildConnectPayload } from "../lib/session";
import { bytesToB64 } from "../lib/remoteFs";
import { useI18n } from "../lib/i18n";

interface SidebarProps {
  sessions: Session[];
  history: Session[];
  activeSession?: Session;
  sshKeys?: SSHKey[];
  groups?: SessionGroup[];
  onNewSession: () => void;
  onEditSession: (session: Session) => void;
  onOpenSession: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  onDuplicateSession?: (session: Session) => void;
  onUpdateSession?: (session: Session) => void;
}

interface FsEntry {
  name: string;
  type: string;
  size?: number;
}

export default function Sidebar({ sessions, history, activeSession, sshKeys, groups, onNewSession, onEditSession, onOpenSession, onDeleteSession, onDuplicateSession, onUpdateSession }: SidebarProps) {
  const { t } = useI18n();
  const [expandedFolders, setExpandedFolders] = useState<string[]>(["user-sessions"]);
  const [files, setFiles] = useState<FsEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [filter, setFilter] = useState("");
  const [sftpReady, setSftpReady] = useState(false);
  const [sftpError, setSftpError] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: FsEntry } | null>(null);
  const [sessCtx, setSessCtx] = useState<{ x: number; y: number; session: Session; saved: boolean } | null>(null);
  const [sessGroupsOpen, setSessGroupsOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const isRemote = !!(activeSession?.host && activeSession.host !== "local" && activeSession.host !== "localhost");

  // Local filesystem browsing (no SSH session active)
  const loadLocal = useCallback((dir: string) => {
    apiFetch(`/api/local-fs?path=${encodeURIComponent(dir)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.files) {
          setFiles(data.files);
          setCurrentPath(data.path);
        }
      })
      .catch(() => {});
  }, []);

  // Remote SFTP: connect once per active session
  useEffect(() => {
    if (!isRemote || !activeSession) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSftpReady(false);
      loadLocal(currentPathRef.current || "");
      return;
    }

    // Clear the stale local listing so it is not mistaken for remote files
    // while the SFTP connection is being established.
    setFiles([]);
    setCurrentPath("");
    setSftpError("");

    const socket = connectSocket();
    socketRef.current = socket;
    trackBoot(socket);

    // Re-emit on every (re)connect: the server parks the session and resumes
    // it via resumeId instead of re-authenticating SSH.
    socket.on("connect", () => {
      buildConnectPayload(activeSession, sessions, sshKeys || [], groups || [])
        .then((payload) =>
          socket.emit("ssh-connect", {
            ...payload,
            resumeId: `sidebar-${activeSession.id}`,
            seen: -1,
          })
        )
        .catch((e) => setSftpError(e?.message || String(e)));
    });

    socket.on("sftp-ready", () => {
      setSftpReady(true);
      setSftpError("");
      // "." resolves to the remote home dir via realpath — avoids reusing
      // a stale LOCAL path (e.g. /home/can) on the remote server.
      socket.emit("sftp-ls", ".");
    });

    socket.on("sftp-list", ({ path, files: list }: any) => {
      setFiles(list);
      setCurrentPath(path);
    });

    socket.on("sftp-error", (err: string) => {
      setSftpError(err);
    });

    socket.on("ssh-error", (err: string) => {
      setSftpError("SSH: " + err);
    });

    socket.on("ssh-close", () => {
      setSftpReady(false);
      setSftpError("SSH connection closed");
    });

    socket.on("disconnect", () => {
      setSftpReady(false);
    });

    socket.on("connect_error", () => {
      setSftpError("Transport unreachable");
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
  }, [activeSession?.id, isRemote]);

  // Navigate without reconnecting
  const navigate = useCallback(
    (dir: string) => {
      if (isRemote && socketRef.current && sftpReady) {
        socketRef.current.emit("sftp-ls", dir);
      } else if (!isRemote) {
        loadLocal(dir);
      }
    },
    [isRemote, sftpReady, loadLocal]
  );

  const handleRefresh = () => navigate(currentPath || "/");

  const handleFileDblClick = (file: FsEntry) => {
    if (file.type !== "dir") return;
    const newPath = joinPath(currentPath || "/", file.name);
    navigate(newPath);
  };

  const handleGoUp = () => {
    navigate(parentPath(currentPath || "/"));
  };

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socketRef.current) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buf = ev.target?.result;
      socketRef.current?.emit("sftp-upload", {
        remotePath: currentPath || "/",
        name: file.name,
        // binary payloads inside a map don't reach the server — send base64
        content: buf instanceof ArrayBuffer ? bytesToB64(new Uint8Array(buf)) : "",
      });
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleDownload = (name: string) => {
    if (!isRemote || !socketRef.current) return;
    const fullPath = joinPath(currentPath || "/", name);
    socketRef.current.emit("sftp-download", fullPath);
    const onContent = ({ content, name: n }: any) => {
      const blob = new Blob([content]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = n;
      a.click();
      URL.revokeObjectURL(url);
      socketRef.current?.off("sftp-file-content", onContent);
    };
    socketRef.current.on("sftp-file-content", onContent);
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  // Escape closes the context menus
  useEffect(() => {
    if (!ctxMenu && !sessCtx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCtxMenu(null);
        setSessCtx(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu, sessCtx]);

  // ---- file context menu (works for local fs and remote SFTP) ----

  const filePath = (f: FsEntry) => joinPath(currentPath || "/", f.name);

  const openInEditor = (path: string) => {
    sessionStorage.setItem("vy-termweb:pending-open", path);
    window.dispatchEvent(new Event("vy-termweb:open-editor"));
  };

  const openRemoteInEditor = (path: string) => {
    if (!activeSession) return;
    sessionStorage.setItem(
      "vy-termweb:pending-remote",
      JSON.stringify({ sessionId: activeSession.id, path })
    );
    window.dispatchEvent(new Event("vy-termweb:open-editor"));
  };

  const openInFileManager = (f: FsEntry) => {
    sessionStorage.setItem(
      "vy-termweb:pending-fm-path",
      f.type === "dir" ? filePath(f) : parentPath(filePath(f))
    );
    window.dispatchEvent(new Event("vy-termweb:open-files"));
  };

  const ctxAction = (action: string, f: FsEntry) => {
    const p = filePath(f);
    setCtxMenu(null);
    switch (action) {
      case "open":
        if (f.type === "dir") navigate(p);
        else if (isRemote) handleDownload(f.name);
        else openInEditor(p);
        break;
      case "editor":
        if (isRemote) openRemoteInEditor(p);
        else openInEditor(p);
        break;
      case "filemanager":
        openInFileManager(f);
        break;
      case "download":
        if (isRemote) handleDownload(f.name);
        else {
          const a = document.createElement("a");
          a.href = `/api/local-file?path=${encodeURIComponent(p)}&download=1&${bust()}`;
          a.download = f.name;
          a.click();
        }
        break;
      case "copy-path":
        navigator.clipboard?.writeText(p);
        break;
      case "rename": {
        const nn = window.prompt(t("ctx.renamePrompt"), f.name);
        if (!nn || nn === f.name || nn.includes("/")) break;
        if (isRemote) {
          socketRef.current?.emit("sftp-rename", {
            oldPath: p,
            newPath: joinPath(currentPath || "/", nn),
          });
        } else {
          apiFetch("/api/local-rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dir: currentPath, oldName: f.name, newName: nn }),
          }).then(() => loadLocal(currentPath));
        }
        break;
      }
      case "delete": {
        if (!window.confirm(t("ctx.deleteFileConfirm", { path: p }))) break;
        if (isRemote) {
          socketRef.current?.emit("sftp-rm", { path: p, type: f.type });
        } else {
          apiFetch(`/api/local-entry?path=${encodeURIComponent(p)}`, { method: "DELETE" })
            .then(() => loadLocal(currentPath));
        }
        break;
      }
    }
  };

  // ---- session context menu ----

  const sessionAddr = (s: Session) =>
    s.host && s.host !== "local" && s.host !== "localhost"
      ? `${s.user ? `${s.user}@` : ""}${s.host}${s.port ? `:${s.port}` : ""}`
      : s.name;

  const openSessMenu = (e: { preventDefault: () => void; clientX: number; clientY: number }, session: Session, saved: boolean) => {
    e.preventDefault();
    setSessGroupsOpen(false);
    setSessCtx({ x: e.clientX, y: e.clientY, session, saved });
  };

  const sessAction = (action: string, s: Session) => {
    setSessCtx(null);
    switch (action) {
      case "open":
        onOpenSession(s);
        break;
      case "sftp":
        onOpenSession({ ...s, type: "SFTP" });
        break;
      case "edit":
        onEditSession(s);
        break;
      case "duplicate":
        onDuplicateSession?.(s);
        break;
      case "copy":
        navigator.clipboard?.writeText(sessionAddr(s));
        break;
      case "delete":
        if (window.confirm(t("ctx.deleteSessionConfirm", { name: s.name }))) onDeleteSession?.(s);
        break;
      default:
        if (action.startsWith("group:")) onUpdateSession?.({ ...s, groupId: action.slice(6) || undefined });
    }
  };

  const q = filter.trim().toLowerCase();
  const filteredSessions = q ? sessions.filter((s) => s.name.toLowerCase().includes(q) || s.host?.toLowerCase().includes(q)) : sessions;
  const filteredHistory = q ? history.filter((s) => s.name.toLowerCase().includes(q) || s.host?.toLowerCase().includes(q)) : history;

  // Group sessions: undefined bucket = ungrouped ("User sessions"); sessions
  // pointing at a deleted group fall back to ungrouped.
  const groupedSessions = useMemo(() => {
    const map = new Map<string | undefined, Session[]>();
    for (const s of filteredSessions) {
      const key = s.groupId && groups?.some((g) => g.id === s.groupId) ? s.groupId : undefined;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [filteredSessions, groups]);

  const orderedGroupKeys = useMemo(() => {
    const keys: (string | undefined)[] = [undefined];
    for (const g of groups || []) if (groupedSessions.has(g.id)) keys.push(g.id);
    for (const k of groupedSessions.keys()) if (k !== undefined && !keys.includes(k)) keys.push(k);
    return keys;
  }, [groupedSessions, groups]);

  return (
    <div className="w-64 bg-vy-sidebar border-r border-vy-border flex flex-col h-full overflow-hidden select-none">
      {/* Sidebar Section Header */}
      <div className="bg-vy-nav px-2 py-1 border-b border-vy-border font-bold text-[11px] flex justify-between items-center text-gray-700">
        <span className="uppercase tracking-tight">{t("sidebar.sessions")}</span>
        <button onClick={onNewSession} className="text-blue-600 hover:text-blue-800 transition-colors" title={t("sidebar.newSession")}>
          <PlusCircle className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 space-y-1">
        <div className="relative mb-2 px-1">
          <Search className="absolute left-3 top-2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            placeholder={t("sidebar.filterSessions")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-white border border-[#ccc] rounded py-1 pl-8 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-vy-accent h-7"
          />
        </div>

        {/* Sessions — ungrouped bucket first, then one section per group */}
        {orderedGroupKeys.map((groupId, gi) => {
          const list = groupedSessions.get(groupId) ?? [];
          const group = groupId ? groups?.find((g) => g.id === groupId) : undefined;
          const label = group?.name || t("sidebar.userSessions");
          const folderId = groupId ? `grp-${groupId}` : "user-sessions";
          const expanded = expandedFolders.includes(folderId);
          return (
            <div key={folderId} className={cn("space-y-0.5", gi > 0 && "mt-2")}>
              <div
                className="flex items-center gap-1 p-1 bg-blue-100/50 border border-blue-200 rounded text-blue-900 cursor-default"
                onClick={() => toggleFolder(folderId)}
              >
                {expanded ? (
                  <ChevronDown className="w-3 h-3 text-blue-400" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-blue-400" />
                )}
                {group?.color ? (
                  <span className="w-4 h-4 rounded-sm shrink-0" style={{ backgroundColor: group.color }} />
                ) : (
                  <Folder className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                )}
                <span className="text-[11px] font-bold truncate">{label}</span>
              </div>

              {expanded && (
                <div className="ml-4 space-y-0.5 mt-1 border-l border-gray-200 pl-1">
                  {list.length > 0 ? (
                    list.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center gap-1.5 p-1 hover:bg-[#eee] rounded cursor-default group text-gray-700 active:bg-blue-200 transition-colors"
                        onClick={() => onOpenSession(session)}
                        onContextMenu={(e) => openSessMenu(e, session, true)}
                      >
                        <Terminal className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="text-[11px] truncate whitespace-nowrap flex-1">{session.name}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditSession(session);
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-vy-accent p-0.5 transition-opacity"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            setSessGroupsOpen(false);
                            setSessCtx({ x: r.left, y: r.bottom, session, saved: true });
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-vy-accent p-0.5 transition-opacity"
                          title={t("sidebar.actions")}
                        >
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <span className="text-[10px] text-gray-400 italic px-2">
                      {sessions.length === 0 ? t("sidebar.noSaved") : t("sidebar.noMatches")}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* History Folder */}
        <div className="mt-2 space-y-0.5">
          <div className="flex items-center gap-1 p-1 hover:bg-gray-200 rounded cursor-default" onClick={() => toggleFolder("history")}>
            {expandedFolders.includes("history") ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )}
            <Clock className="w-4 h-4 text-blue-500" />
            <span className="text-[11px] font-bold italic text-gray-500">{t("sidebar.recentSessions")}</span>
          </div>

          {expandedFolders.includes("history") && (
            <div className="ml-4 space-y-0.5 mt-1 border-l border-gray-200 pl-1">
              {filteredHistory.length > 0 ? (
                filteredHistory.map((session, idx) => (
                  <div
                    key={`${session.id}-${idx}`}
                    className="flex items-center gap-1.5 p-1 hover:bg-[#eee] rounded cursor-default opacity-80"
                    onClick={() => onOpenSession(session)}
                    onContextMenu={(e) => openSessMenu(e, session, false)}
                  >
                    <Clock className="w-3 h-3 text-gray-400 shrink-0" />
                    <span className="text-[11px] truncate">{session.name}</span>
                  </div>
                ))
              ) : (
                <span className="text-[10px] text-gray-400 italic px-2">{t("sidebar.noHistory")}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* File Explorer (SFTP remote or local filesystem) */}
      <div className="h-1/3 border-t border-vy-border flex flex-col bg-white">
        <div className="bg-vy-nav px-2 py-1 text-[11px] font-bold border-b border-vy-border text-gray-700 uppercase tracking-tight flex justify-between items-center">
          <span>{isRemote ? t("sidebar.sftpHost", { host: activeSession?.host || "" }) : t("sidebar.localFiles")}</span>
          <div className="flex gap-1">
            {isRemote && (
              <>
                <button className="p-0.5 hover:bg-gray-200 rounded" title={t("sidebar.upload")} onClick={() => uploadInputRef.current?.click()}>
                  <Upload className="w-3 h-3 text-blue-600" />
                </button>
                <input type="file" ref={uploadInputRef} onChange={handleUpload} className="hidden" />
              </>
            )}
            <button onClick={handleGoUp} className="p-0.5 hover:bg-gray-200 rounded" title={t("sidebar.up")}>
              <ArrowUp className="w-3 h-3 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="bg-gray-50 flex items-center p-0.5 border-b border-vy-border gap-1 px-2">
          <button onClick={handleRefresh} className="p-0.5 hover:bg-gray-200 rounded transition-colors">
            <RefreshCw className="w-3 h-3 text-gray-500" />
          </button>
          <div className="flex-1 text-[10px] text-gray-500 truncate italic">{currentPath || "—"}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 text-[10px] text-gray-600 space-y-1">
          {isRemote && sftpError ? (
            <div className="text-red-500 italic px-1">
              {sftpError}
              <button
                className="block mt-1 text-blue-600 underline not-italic"
                onClick={() => {
                  setSftpError("");
                  socketRef.current?.disconnect();
                  socketRef.current?.connect();
                }}
              >
                {t("sidebar.retry")}
              </button>
            </div>
          ) : isRemote && !sftpReady ? (
            <div className="text-gray-400 italic px-1">{t("sidebar.connecting", { host: activeSession?.host || "" })}</div>
          ) : files.length === 0 ? (
            <div className="text-gray-400 italic px-1">{t("sidebar.emptyDir")}</div>
          ) : null}
          {files.map((file) => (
            <div
              key={file.name}
              onDoubleClick={() => handleFileDblClick(file)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, file });
              }}
              className="flex justify-between items-center group cursor-default hover:bg-vy-bg rounded px-1 -mx-1"
            >
              <div className="flex items-center gap-1.5 overflow-hidden">
                {file.type === "dir" ? (
                  <Folder className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                )}
                <span className={cn("truncate", file.type === "dir" ? "font-bold" : "font-medium")}>{file.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] text-gray-400 opacity-60">
                  {file.type === "dir" ? "-" : `${((file.size || 0) / 1024).toFixed(1)} KB`}
                </span>
                {isRemote && file.type === "file" && (
                  <button
                    onClick={() => handleDownload(file.name)}
                    className="opacity-0 group-hover:opacity-100 hover:text-blue-600 transition-opacity"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setCtxMenu({ x: r.left - 150, y: r.bottom, file });
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-blue-600 transition-opacity"
                  title={t("sidebar.actions")}
                >
                  <MoreVertical className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Info footer */}
      <div className="p-1 px-2 border-t border-vy-border bg-vy-nav flex items-center justify-between text-[10px] text-gray-500 font-medium">
        <span className="flex items-center gap-1.5">
          <Monitor className={cn("w-3 h-3", sftpReady ? "text-green-600" : "text-gray-400")} />
          {sftpReady ? t("sidebar.sftpConnected") : isRemote && sftpError ? t("sidebar.sftpError") : isRemote ? t("sidebar.connectingStatus") : t("sidebar.local")}
        </span>
        <span className="text-[9px] opacity-60">{activeSession?.host || ""}</span>
      </div>

      {/* File context menu — local fs + remote SFTP */}
      {ctxMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu(null);
          }}
        >
          <div
            className="absolute bg-white border border-vy-border rounded shadow-xl py-1 min-w-44 text-[11px] text-gray-700"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 190),
              top: Math.min(ctxMenu.y, window.innerHeight - 230),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-[9px] uppercase tracking-wide text-gray-400 truncate max-w-44 border-b border-gray-100 mb-1">
              {ctxMenu.file.name}
            </div>
            {[
              {
                id: "open",
                label: ctxMenu.file.type === "dir" ? t("ctx.open") : isRemote ? t("ctx.download") : t("ctx.open"),
                icon: ctxMenu.file.type === "dir" ? FolderOpen : ExternalLink,
              },
              ...(!isRemote ? [{ id: "filemanager", label: t("ctx.openInFileManager"), icon: FolderOpen }] : []),
              ...(ctxMenu.file.type !== "dir" ? [{ id: "editor", label: t("ctx.editInEditor"), icon: Edit3 }] : []),
              ...(ctxMenu.file.type !== "dir" ? [{ id: "download", label: t("ctx.download"), icon: Download }] : []),
              { id: "copy-path", label: t("ctx.copyPath"), icon: Copy },
              { id: "rename", label: t("ctx.rename"), icon: Pencil },
              { id: "delete", label: t("ctx.delete"), icon: Trash2 },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => ctxAction(item.id, ctxMenu.file)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-vy-bg",
                  item.id === "delete" && "text-red-600"
                )}
              >
                <item.icon className="w-3.5 h-3.5 shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Session context menu — saved sessions + recent history */}
      {sessCtx && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setSessCtx(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setSessCtx(null);
          }}
        >
          <div
            className="absolute bg-white border border-vy-border rounded shadow-xl py-1 min-w-44 text-[11px] text-gray-700"
            style={{
              left: Math.min(sessCtx.x, window.innerWidth - 190),
              top: Math.min(sessCtx.y, window.innerHeight - (sessCtx.saved ? 320 : 120)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-[9px] uppercase tracking-wide text-gray-400 truncate max-w-44 border-b border-gray-100 mb-1">
              {sessCtx.session.name}
            </div>
            {[
              { id: "open", label: sessCtx.session.type === "SFTP" ? t("ctx.openSftp") : t("ctx.open"), icon: Terminal },
              ...(sessCtx.session.type !== "SFTP" && sessCtx.session.host && sessCtx.session.host !== "local" && sessCtx.session.host !== "localhost"
                ? [{ id: "sftp", label: t("ctx.openSftp"), icon: FolderOpen }]
                : []),
              ...(sessCtx.saved ? [{ id: "edit", label: t("ctx.edit"), icon: Edit3 }] : []),
              { id: "copy", label: t("ctx.copyAddress", { addr: sessionAddr(sessCtx.session) }), icon: Copy },
              ...(sessCtx.saved && onDuplicateSession ? [{ id: "duplicate", label: t("ctx.duplicate"), icon: Files }] : []),
              ...(sessCtx.saved && onDeleteSession ? [{ id: "delete", label: t("ctx.delete"), icon: Trash2 }] : []),
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => sessAction(item.id, sessCtx.session)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-vy-bg",
                  item.id === "delete" && "text-red-600"
                )}
              >
                <item.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
            {sessCtx.saved && onUpdateSession && (groups?.length || 0) > 0 && (
              <>
                <button
                  onClick={() => setSessGroupsOpen((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-vy-bg"
                >
                  <FolderInput className="w-3.5 h-3.5 shrink-0" />
                  {t("ctx.moveToGroup")}
                  <ChevronRight className={cn("w-3 h-3 ml-auto transition-transform", sessGroupsOpen && "rotate-90")} />
                </button>
                {sessGroupsOpen && (
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    {[{ id: "", name: t("ctx.ungrouped"), color: "" }, ...(groups || [])].map((g) => (
                      <button
                        key={g.id || "ungrouped"}
                        onClick={() => sessAction(`group:${g.id}`, sessCtx.session)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 pl-7 py-1 text-left hover:bg-vy-bg",
                          (sessCtx.session.groupId || "") === g.id && "font-bold text-blue-700"
                        )}
                      >
                        {g.color && <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: g.color }} />}
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
