import { useState, useCallback, useEffect, useRef, lazy, Suspense, type Dispatch, type SetStateAction, type ChangeEvent } from "react";
import { X, Terminal as TerminalIcon, Home, Menu, Settings, Radio, Send } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import Dashboard from "./components/Dashboard";
import TerminalView from "./components/TerminalView";
import SFTPView from "./components/SFTPView";
import SessionModal from "./components/SessionModal";
import Calculator from "./components/Tools/Calculator";
const TextEditor = lazy(() => import("./components/Tools/TextEditor"));
const FileManager = lazy(() => import("./components/Tools/FileManager"));

const TOOL_ROUTES: Record<string, string> = {
  "file-manager": "/files",
  "system-info": "/sysinfo",
  editor: "/editor",
  calculator: "/calc",
  "network-scan": "/netscan",
};
const ROUTE_TOOLS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_ROUTES).map(([k, v]) => [v, k])
);
const pathForTab = (t: Tab): string =>
  t.id === "home" ? "/" :
  t.type === "terminal" && t.sessionId ? `/session/${t.sessionId}` :
  t.type === "sftp" && t.sessionId ? `/sftp/${t.sessionId}` :
  TOOL_ROUTES[t.type] ?? "/";
import NetworkScan from "./components/Tools/NetworkScan";
import SystemInfo from "./components/Tools/SystemInfo";
import MacroManagerModal from "./components/MacroManagerModal";
import TerminalThemeModal from "./components/TerminalThemeModal";
import { applyBootId } from "./lib/boot";
import { type Tab, type Session, type SessionGroup, type SSHKey, type Macro } from "./types";
import { cn } from "./lib/utils";
import GroupManagerModal from "./components/GroupManagerModal";
import VaultModal, { stripEncryptedSecrets, type VaultModalMode } from "./components/VaultModal";
import {
  hasVault, isUnlocked, lockVault, setUnlockRequestHandler,
  isEncryptedField, encryptField, ensureUnlocked,
} from "./lib/vault";
import { authStatus, AUTH_EXPIRED, apiFetch } from "./lib/auth";
import LockScreen from "./components/LockScreen";
import { useI18n } from "./lib/i18n";

// Tool/dashboard tabs render their title via t() so a language switch
// retitles open tabs live (stored tab.title remains for session tabs).
const TOOL_TITLE_KEY: Record<string, string> = {
  calculator: "tab.calculator",
  editor: "tab.editor",
  "network-scan": "tab.networkScan",
  "file-manager": "tab.fileManager",
  "system-info": "tab.systemInfo",
};

function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

interface ServerStatus {
  process: string;
  version: string;
  node: string;
  uptime: number;
  platform: string;
  hostname: string;
}

export default function App() {
  const { t } = useI18n();
  const tabTitle = (tab: Tab) =>
    tab.type === "dashboard" ? t("tab.home") : TOOL_TITLE_KEY[tab.type] ? t(TOOL_TITLE_KEY[tab.type]) : tab.title;
  const [tabs, setTabs] = useState<Tab[]>([{ id: "home", title: "Home", type: "dashboard" }]);
  const [sshKeys, setSshKeys] = usePersistentState<SSHKey[]>("vy-termweb:ssh-keys", []);
  const [macros, setMacros] = usePersistentState<Macro[]>("vy-termweb:macros", []);
  const [sessions, setSessions] = usePersistentState<Session[]>("vy-termweb:sessions", []);
  const [history, setHistory] = usePersistentState<Session[]>("vy-termweb:history", []);
  const [terminalTheme, setTerminalTheme] = usePersistentState<string>("vy-termweb:theme", "Dracula");
  const [fontSize, setFontSize] = usePersistentState<number>("vy-termweb:font-size", 14);

  const [activeTabId, setActiveTabId] = useState("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMacroManagerOpen, setIsMacroManagerOpen] = useState(false);
  const [isTerminalThemeOpen, setIsTerminalThemeOpen] = useState(false);
  const [isMultiExecOpen, setIsMultiExecOpen] = useState(false);
  const [broadcastInput, setBroadcastInput] = useState("");
  const [lastBroadcast, setLastBroadcast] = useState<{ command: string; timestamp: number } | null>(null);
  const [splitMode, setSplitMode] = useState<"none" | "vertical" | "horizontal">("none");
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [tabStatus, setTabStatus] = useState<Record<string, string>>({});
  const importInputRef = useRef<HTMLInputElement>(null);

  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const openingSessionRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = usePersistentState<SessionGroup[]>("vy-termweb:groups", []);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [vaultMode, setVaultMode] = useState<VaultModalMode | null>(null);
  const [, setVaultTick] = useState(0); // forces re-render on lock/unlock
  // Panel gate: "loading" until /api/auth/status answers, "none" when the
  // server has no password configured, "ready" when authenticated.
  const [authState, setAuthState] = useState<"loading" | "none" | "setup" | "login" | "ready">("loading");

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    authStatus()
      .then((s) =>
        setAuthState(s.disabled ? "none" : s.needsSetup ? "setup" : s.authenticated ? "ready" : "login")
      )
      .catch(() => setAuthState("none"));
    const expired = () => setAuthState("login");
    window.addEventListener(AUTH_EXPIRED, expired);
    return () => window.removeEventListener(AUTH_EXPIRED, expired);
  }, []);

  // Locked vault operations (connect with encrypted creds, saving secrets)
  // request the unlock modal through this handler registered in lib/vault.
  useEffect(() => {
    setUnlockRequestHandler(() => setVaultMode("unlock"));
  }, []);

  // Real server status for the footer / about (starts once authenticated)
  useEffect(() => {
    if (authState === "loading" || authState === "setup" || authState === "login") return;
    const load = () =>
      apiFetch("/api/system/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (!s) return;
          applyBootId(s.bootId);
          setServerStatus(s);
        })
        .catch(() => setServerStatus(null));
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [authState]);

  const setTabConnStatus = useCallback((tabId: string, status: string) => {
    setTabStatus((prev) => ({ ...prev, [tabId]: status }));
  }, []);

  const handleOpenTool = useCallback(
    (tool: "calculator" | "editor" | "network-scan" | "file-manager" | "system-info", forceNew = false) => {
      const titles = {
        calculator: t("tab.calculator"),
        editor: t("tab.editor"),
        "network-scan": t("tab.networkScan"),
        "file-manager": t("tab.fileManager"),
        "system-info": t("tab.systemInfo"),
      };

      const id = forceNew ? `tool-${tool}-${Date.now()}` : `tool-${tool}`;
      setTabs((prev) =>
        prev.some((t) => t.id === id) ? prev : [...prev, { id, title: titles[tool], type: tool }]
      );
      setActiveTabId(id);
    },
    [t]
  );

  // Activate the oldest tab of a type if one exists, otherwise create the
  // canonical `tool-<type>` tab — used for handoff events and deep links so
  // they don't spawn duplicates.
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;
  const openOrActivateTool = useCallback(
    (tool: "calculator" | "editor" | "network-scan" | "file-manager" | "system-info") => {
      const existing = tabsRef.current.find((t) => t.type === tool);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      handleOpenTool(tool);
    },
    [handleOpenTool]
  );

  const handleNewSession = useCallback(() => {
    setEditingSession(null);
    setIsSessionModalOpen(true);
  }, []);

  const handleExportSessions = useCallback(() => {
    const data = JSON.stringify({ sessions, sshKeys: sshKeys.map(({ content, ...k }) => k), exportedAt: Date.now() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vy-termweb-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessions, sshKeys]);

  const handleImportSessions = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(String(ev.target?.result));
          const imported: Session[] = Array.isArray(data) ? data : data.sessions;
          if (!Array.isArray(imported)) throw new Error("Invalid file");
          setSessions((prev) => {
            const ids = new Set(prev.map((s) => s.id));
            return [...prev, ...imported.filter((s) => s && s.id && s.name && !ids.has(s.id))];
          });
        } catch {
          alert("Failed to import sessions: invalid JSON file.");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [setSessions]
  );

  const handleMenuAction = useCallback(
    (action: string) => {
      switch (action) {
        case "New Session":
        case "Open Session":
          handleNewSession();
          break;
        case "Exit":
          window.close();
          break;
        case "Toggle Sidebar":
          setIsSidebarOpen((prev) => !prev);
          break;
        case "Calculator":
          handleOpenTool("calculator");
          break;
        case "Text Editor":
          handleOpenTool("editor");
          break;
        case "Network Scan":
          handleOpenTool("network-scan");
          break;
        case "Local Shell":
          openSessionRef.current?.({ id: `local-${Date.now()}`, name: t("dash.localShell"), host: "local", type: "SSH" });
          break;
        case "File Manager":
          handleOpenTool("file-manager", true);
          break;
        case "System Info":
          handleOpenTool("system-info");
          break;
        case "Macro Manager":
          setIsMacroManagerOpen(true);
          break;
        case "About VY-TermWEB":
          setIsAboutOpen(true);
          break;
        case "Global Settings":
          setIsSettingsOpen(true);
          break;
        case "Session Groups":
          setIsGroupManagerOpen(true);
          break;
        case "Master Password":
          setVaultMode(hasVault() ? (isUnlocked() ? "manage" : "unlock") : "setup");
          break;
        case "Lock Vault":
          lockVault();
          setVaultTick((t) => t + 1);
          break;
        case "Terminal Style":
          setIsTerminalThemeOpen(true);
          break;
        case "Fullscreen":
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen().catch(() => {});
          break;
        case "Import":
          importInputRef.current?.click();
          break;
        case "Export":
          handleExportSessions();
          break;
        case "Split Vertically":
          setSplitMode("vertical");
          break;
        case "Split Horizontally":
          setSplitMode("horizontal");
          break;
        case "Close Split":
          setSplitMode("none");
          setSplitTabId(null);
          break;
        case "MultiExec":
        case "Multi-Execution Mode":
          setIsMultiExecOpen((prev) => !prev);
          break;
        case "Copy":
          window.dispatchEvent(new Event("vy-termweb:copy"));
          break;
        case "Cut":
          window.dispatchEvent(new Event("vy-termweb:cut"));
          break;
        case "Paste":
          window.dispatchEvent(new Event("vy-termweb:paste"));
          break;
        case "Reconnect":
          window.dispatchEvent(new Event("vy-termweb:reconnect"));
          break;
        default:
          break;
      }
    },
    [handleNewSession, handleOpenTool, handleExportSessions]
  );

  useEffect(() => {
    const openInEditor = () => handleOpenTool("editor");
    window.addEventListener("vy-termweb:open-editor", openInEditor);
    return () => window.removeEventListener("vy-termweb:open-editor", openInEditor);
  }, [handleOpenTool]);

  useEffect(() => {
    const openFiles = () => openOrActivateTool("file-manager");
    window.addEventListener("vy-termweb:open-files", openFiles);
    return () => window.removeEventListener("vy-termweb:open-files", openFiles);
  }, [openOrActivateTool]);

  // ---- URL routes: tab <-> path sync ----
  const applyRoute = useCallback(() => {
    const p = window.location.pathname;
    if (p === "/") { setActiveTabId("home"); return; }
    const tool = ROUTE_TOOLS[p];
    if (tool) { openOrActivateTool(tool as "calculator" | "editor" | "network-scan" | "file-manager" | "system-info"); return; }
    const m = p.match(/^\/(session|sftp)\/([^/]+)/);
    if (m) {
      const sid = m[2];
      const wantType = (m[1] === "sftp" ? "sftp" : "terminal") as Tab["type"];
      const s = sessions.find((x) => x.id === sid) ?? history.find((x) => x.id === sid);
      if (!s) return;
      const id = `tab-${wantType}-${sid}`;
      setTabs((prev) =>
        prev.some((t) => t.id === id)
          ? prev
          : [...prev, { id, title: `${s.type || "SSH"}: ${s.name}`, type: wantType, sessionId: sid, status: "connecting" }]
      );
      setActiveTabId(id);
    }
  }, [handleOpenTool, openOrActivateTool, sessions, history]);

  const applyRouteRef = useRef(applyRoute);
  applyRouteRef.current = applyRoute;

  useEffect(() => {
    applyRouteRef.current();
    const onPop = () => applyRouteRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const routeSynced = useRef(false);
  useEffect(() => {
    // skip the mount run: let applyRoute (declared above) resolve the URL first,
    // otherwise this effect would stomp a deep link like /files back to "/"
    if (!routeSynced.current) { routeSynced.current = true; return; }
    const t = tabs.find((x) => x.id === activeTabId);
    if (!t) return;
    const desired = pathForTab(t);
    if (window.location.pathname !== desired) window.history.pushState(null, "", desired);
  }, [activeTabId, tabs]);

  const handleSaveMacro = (macro: Macro) => {
    setMacros((prev) => {
      const idx = prev.findIndex((m) => m.id === macro.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = macro;
        return next;
      }
      return [macro, ...prev];
    });
  };

  const handleDeleteMacro = (id: string) => {
    setMacros((prev) => prev.filter((m) => m.id !== id));
  };

  const handleOpenSession = useCallback(
    (session: Session) => {
      if (openingSessionRef.current.has(session.id)) return;
      openingSessionRef.current.add(session.id);

      setHistory((prev) => {
        const filtered = prev.filter((s) => s.id !== session.id);
        return [session, ...filtered].slice(0, 10);
      });

      const type = session.type === "SFTP" ? "sftp" : "terminal";
      setTabs((prev) => {
        const existingTab = prev.find((t) => t.sessionId === session.id && t.type === type);
        if (existingTab) {
          setActiveTabId(existingTab.id);
          openingSessionRef.current.delete(session.id);
          return prev;
        }
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: `${session.type || "SSH"}: ${session.name}`,
          type,
          sessionId: session.id,
          status: "connecting",
        };
        setActiveTabId(newTab.id);
        // Remove lock shortly after the tab renders; state batching handles the id before a new click
        setTimeout(() => openingSessionRef.current.delete(session.id), 100);
        return [...prev, newTab];
      });
    },
    [setHistory]
  );

  // Late-bound ref so earlier callbacks (menu actions) can open sessions.
  const openSessionRef = useRef(handleOpenSession);
  openSessionRef.current = handleOpenSession;

  // Session list mutations used by the sidebar context menu
  const handleDeleteSession = useCallback(
    (s: Session) => setSessions((prev) => prev.filter((x) => x.id !== s.id)),
    [setSessions]
  );
  const handleDuplicateSession = useCallback(
    (s: Session) =>
      setSessions((prev) => [
        ...prev,
        { ...s, id: `session-${Date.now()}`, name: `${s.name} copy`, groupId: s.groupId },
      ]),
    [setSessions]
  );
  const handleUpdateSession = useCallback(
    (s: Session) => setSessions((prev) => prev.map((x) => (x.id === s.id ? s : x))),
    [setSessions]
  );

  const handleQuickConnect = useCallback(
    (host: string) => {
      // Prefill the session modal so the user can supply credentials
      setEditingSession({
        id: "",
        name: host,
        host,
        port: 22,
        user: "root",
        type: "SSH",
        authType: "password",
      });
      setIsSessionModalOpen(true);
    },
    []
  );

  // From NetworkScan port chips: reuse a saved session for host:port when one
  // exists, otherwise prefill the session modal with the discovered target.
  const handleAppConnect = useCallback(
    (ip: string, port: number, type: "SSH" | "SFTP") => {
      const saved = sessions.find(
        (s) => s.host === ip && (s.port || 22) === port && (s.type || "SSH") === type
      );
      if (saved) {
        handleOpenSession(saved);
        return;
      }
      setEditingSession({
        id: "",
        name: ip,
        host: ip,
        port,
        user: "root",
        type,
        authType: "password",
      });
      setIsSessionModalOpen(true);
    },
    [sessions, handleOpenSession]
  );

  // Encrypts a plaintext secret when the vault is enabled (prompts unlock if
  // needed). enc: values pass through untouched.
  const maybeEncrypt = async (v: string | undefined): Promise<string | undefined> => {
    if (!v || isEncryptedField(v) || !hasVault()) return v;
    if (!isUnlocked() && !(await ensureUnlocked())) {
      throw new Error("Vault is locked — credential was not saved.");
    }
    return encryptField(v);
  };

  // Re-encrypts any plaintext secrets still in storage (runs after unlock /
  // vault setup so migration happens once, transparently).
  const migrateSecrets = async () => {
    if (!isUnlocked()) return;
    const migratedSessions = await Promise.all(
      sessions.map(async (s) =>
        s.password && !isEncryptedField(s.password) ? { ...s, password: await encryptField(s.password) } : s
      )
    );
    if (migratedSessions.some((s, i) => s !== sessions[i])) setSessions(migratedSessions);
    const migratedKeys = await Promise.all(
      sshKeys.map(async (k) =>
        k.content && !isEncryptedField(k.content) ? { ...k, content: await encryptField(k.content) } : k
      )
    );
    if (migratedKeys.some((k, i) => k !== sshKeys[i])) setSshKeys(migratedKeys);
  };

  const handleSaveSession = async (session: Session) => {
    try {
      session = { ...session, password: await maybeEncrypt(session.password) };
    } catch (e: any) {
      alert(e?.message || "Could not save credentials.");
      return;
    }
    const isNew = !sessions.some((s) => s.id === session.id);
    const saved = isNew ? { ...session, id: session.id || `session-${Date.now()}` } : session;
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    handleOpenSession(saved);
  };

  const handleSaveKeys = async (keys: SSHKey[]) => {
    try {
      keys = await Promise.all(keys.map(async (k) => ({ ...k, content: (await maybeEncrypt(k.content)) || "" })));
    } catch (e: any) {
      alert(e?.message || "Could not save credentials.");
      return;
    }
    setSshKeys(keys);
  };

  const closeTab = (id: string, e: any) => {
    e.stopPropagation();
    if (id === "home") return;
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (id === activeTabId) {
        setActiveTabId(filtered[filtered.length - 1]?.id || "home");
      }
      if (id === splitTabId) {
        setSplitTabId(null);
        setSplitMode("none");
      }
      return filtered;
    });
  };

  const renderTabContent = (tab: Tab) => {
    switch (tab.type) {
      case "dashboard":
        return (
          <Dashboard
            history={history}
            onNewSession={handleNewSession}
            onOpenSession={handleOpenSession}
            onOpenTool={(tool) => handleOpenTool(tool, tool === "file-manager")}
            onOpenMacros={() => setIsMacroManagerOpen(true)}
          />
        );
      case "terminal":
        return (
          <TerminalView
            id={tab.id}
            title={tab.title}
            session={sessions.find((s) => s.id === tab.sessionId) ?? (history.find((s) => s.id === tab.sessionId) || undefined)}
            sessions={sessions}
            groups={groups}
            sshKeys={sshKeys}
            macros={macros}
            onOpenMacroManager={() => setIsMacroManagerOpen(true)}
            lastBroadcast={lastBroadcast}
            terminalTheme={terminalTheme}
            fontSize={fontSize}
            isActive={tab.id === activeTabId}
            onStatusChange={(s) => setTabConnStatus(tab.id, s)}
          />
        );
      case "sftp": {
        const s = sessions.find((x) => x.id === tab.sessionId) ?? history.find((x) => x.id === tab.sessionId);
        return s ? <SFTPView session={s} sessions={sessions} groups={groups} sshKeys={sshKeys} /> : <div className="flex-1 flex items-center justify-center text-gray-400 text-sm italic">Session not found</div>;
      }
      case "calculator":
        return <Calculator />;
      case "editor":
        return (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-[#1e1e1e] text-gray-400 text-sm italic">Loading editor…</div>}>
            <TextEditor />
          </Suspense>
        );
      case "network-scan":
        return <NetworkScan onAppConnect={handleAppConnect} />;
      case "system-info":
        return <SystemInfo />;
      case "file-manager":
        return (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400 text-sm italic">Loading file manager…</div>}>
            <FileManager />
          </Suspense>
        );
      default:
        return null;
    }
  };

  const connectedCount = Object.values(tabStatus).filter((s) => s === "connected").length;

  if (authState === "loading") {
    return <div className="h-screen w-screen flex items-center justify-center bg-[#2b2b2b]" />;
  }
  if (authState === "setup" || authState === "login") {
    return <LockScreen mode={authState} onDone={() => setAuthState("ready")} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-vy-bg select-none font-sans">
      <input type="file" ref={importInputRef} onChange={handleImportSessions} accept=".json" className="hidden" />

      {/* Workspace Area: Sidebar + Tabs Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Toggle Column */}
        <div className="flex flex-col bg-vy-nav border-r border-vy-border w-6 items-center pt-1 shrink-0">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-1 hover:bg-white rounded transition-colors">
            <Menu className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {isSidebarOpen && (
          <Sidebar
            sessions={sessions}
            history={history}
            activeSession={sessions.find((s) => s.id === activeTab?.sessionId) ?? history.find((s) => s.id === activeTab?.sessionId)}
            sshKeys={sshKeys}
            groups={groups}
            onNewSession={handleNewSession}
            onOpenSession={handleOpenSession}
            onEditSession={(s) => {
              setEditingSession(s);
              setIsSessionModalOpen(true);
            }}
            onDeleteSession={handleDeleteSession}
            onDuplicateSession={handleDuplicateSession}
            onUpdateSession={handleUpdateSession}
          />
        )}

        {/* Content Area with Top Tab List */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <SessionModal
            isOpen={isSessionModalOpen}
            onClose={() => setIsSessionModalOpen(false)}
            onSave={(s) => void handleSaveSession(s)}
            session={editingSession}
            sshKeys={sshKeys}
            onSaveKeys={(k) => void handleSaveKeys(k)}
            macros={macros}
            sessions={sessions}
            groups={groups}
          />

          <Toolbar onNewSession={handleNewSession} onQuickConnect={handleQuickConnect} onAction={handleMenuAction} />

          {/* Tab Rail */}
          <div className="bg-vy-nav border-b border-vy-border flex items-center overflow-x-auto scrollbar-hide select-none h-8">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "px-4 py-1.5 text-xs flex items-center transition-all cursor-default border-r border-[#bbb] relative group min-w-[120px]",
                  activeTabId === tab.id
                    ? "bg-black text-white border-t-2 border-t-vy-accent h-full"
                    : "bg-[#ccc] text-gray-700 hover:bg-[#bbb] h-full"
                )}
              >
                {tab.type === "terminal" && (
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full mr-1.5 shrink-0 shadow-xs",
                      tabStatus[tab.id] === "connected"
                        ? "bg-emerald-500 animate-pulse"
                        : tabStatus[tab.id] === "disconnected"
                          ? "bg-rose-500"
                          : "bg-amber-500 animate-pulse"
                    )}
                    title={`Status: ${tabStatus[tab.id] || "connecting"}`}
                  />
                )}
                {tab.type === "dashboard" ? (
                  <Home className="w-3.5 h-3.5 mr-2 opacity-60" />
                ) : (
                  <TerminalIcon className="w-3.5 h-3.5 mr-2 opacity-60" />
                )}
                <span className="truncate flex-1">{tabTitle(tab)}</span>
                {tab.id !== "home" && (
                  <button onClick={(e) => closeTab(tab.id, e)} className="ml-2 hover:text-red-400 p-0.5 rounded transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={handleNewSession}
              className="px-3 text-gray-600 font-bold hover:text-black cursor-pointer text-lg h-full hover:bg-white/20 transition-colors"
            >
              +
            </button>
          </div>

          {/* Active Content */}
          <main
            className={cn(
              "flex-1 relative overflow-hidden flex flex-col",
              activeTab?.type === "terminal" ? "bg-black" : "bg-white"
            )}
          >
            {/* Multi-Exec Broadcast Bar */}
            {isMultiExecOpen && (
              <div className="bg-[#1f2937] border-b border-red-500/40 px-4 py-2 flex items-center gap-3 text-white shadow-lg animate-in slide-in-from-top duration-200 z-30 shrink-0">
                <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-500/50 px-2.5 py-1 rounded text-xs font-bold text-red-300">
                  <Radio className="w-3.5 h-3.5 animate-pulse text-red-400" />
                  <span>MULTI-EXEC BROADCAST</span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!broadcastInput.trim()) return;
                    setLastBroadcast({ command: broadcastInput, timestamp: Date.now() });
                    setBroadcastInput("");
                  }}
                  className="flex-1 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={broadcastInput}
                    onChange={(e) => setBroadcastInput(e.target.value)}
                    placeholder="Type command to send simultaneously to all active terminal sessions..."
                    className="flex-1 bg-black/60 border border-red-500/40 rounded px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-red-400 placeholder:text-gray-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 shadow transition-all cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Broadcast to All</span>
                  </button>
                </form>
                <button
                  onClick={() => setIsMultiExecOpen(false)}
                  className="text-gray-400 hover:text-white p-1 rounded transition-colors"
                  title="Close Multi-Exec"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* All tabs stay mounted so SSH/SFTP connections survive tab switches.
                A tab selected for the split pane is rendered there instead of the main pane. */}
            <div className={cn("flex-1 flex min-h-0", splitMode === "vertical" ? "flex-row" : "flex-col")}>
              <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
                {tabs
                  .filter((tab) => !(splitMode !== "none" && tab.id === splitTabId))
                  .map((tab) => (
                    <div
                      key={tab.id}
                      className={cn("flex-1 flex-col min-h-0", tab.id === activeTabId ? "flex" : "hidden")}
                    >
                      {renderTabContent(tab)}
                    </div>
                  ))}
              </div>

              {/* Split pane */}
              {splitMode !== "none" && (
                <div
                  className={cn(
                    "flex-1 flex flex-col min-w-0 min-h-0 relative",
                    splitMode === "vertical" ? "border-l border-[#555]" : "border-t border-[#555]"
                  )}
                >
                  <div className="bg-vy-nav border-b border-vy-border px-2 py-0.5 flex items-center gap-2 text-[11px] text-gray-600 shrink-0">
                    <span className="font-bold">Split pane:</span>
                    <select
                      value={splitTabId || ""}
                      onChange={(e) => setSplitTabId(e.target.value || null)}
                      className="bg-white border border-[#ccc] rounded px-1 py-0.5 text-[11px] outline-none"
                    >
                      <option value="">-- choose a tab --</option>
                      {tabs
                        .filter((t) => t.id !== activeTabId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => {
                        setSplitMode("none");
                        setSplitTabId(null);
                      }}
                      className="ml-auto hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col">
                    {splitTabId ? (
                      (() => {
                        const splitTab = tabs.find((t) => t.id === splitTabId);
                        return splitTab ? (
                          <div className="flex-1 flex flex-col min-h-0">{renderTabContent(splitTab)}</div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-gray-400 text-xs italic bg-[#111]">
                            Tab was closed.
                          </div>
                        );
                      })()
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-gray-400 text-xs italic bg-[#111]">
                        Select a tab to display in this pane.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Footer — real data */}
          <footer className="bg-vy-bg border-t border-vy-border h-6 flex items-center px-2 text-[10px] space-x-4 shrink-0 text-gray-600">
            <div className="flex items-center">
              <span
                className={cn(
                  "w-2.5 h-2.5 rounded-full mr-1.5",
                  serverStatus ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.4)]" : "bg-rose-500"
                )}
              />
              <span>{serverStatus ? `Server online — ${serverStatus.hostname}` : "Server unreachable"}</span>
            </div>
            <div className="flex items-center border-l border-[#ccc] pl-4">
              <span>
                {connectedCount} session{connectedCount === 1 ? "" : "s"} connected
              </span>
            </div>
            {serverStatus && (
              <div className="flex items-center border-l border-[#ccc] pl-4">
                <span>Uptime: {Math.floor(serverStatus.uptime / 60)}m</span>
              </div>
            )}
            <div className="flex-grow" />
            <div className="text-gray-400 font-medium">VY-TermWEB v{serverStatus?.version || "?"}</div>
          </footer>

          {/* About Modal */}
          {isAboutOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-white border border-[#aaa] shadow-2xl w-full max-w-md rounded-sm overflow-hidden animate-in zoom-in duration-200">
                <div className="bg-vy-nav border-b border-[#ccc] px-3 py-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-700">About VY-TermWEB</span>
                  <button onClick={() => setIsAboutOpen(false)}>
                    <X className="w-4 h-4 text-gray-400 hover:text-red-500" />
                  </button>
                </div>
                <div className="p-8 flex flex-col items-center text-center">
                  <div className="bg-vy-accent p-4 rounded-xl shadow-lg mb-4">
                    <TerminalIcon className="w-12 h-12 text-white" />
                  </div>
                  <h1 className="text-2xl font-black text-gray-800 tracking-tighter">
                    VY-TermWEB <span className="text-vy-accent italic">Professional</span>
                  </h1>
                  <p className="text-xs text-gray-500 mb-6 font-medium">
                    Web-based SSH/SFTP terminal — v{serverStatus?.version || "?"}
                  </p>

                  <div className="space-y-1.5 w-full text-[11px] text-gray-600 bg-gray-50 p-4 rounded border border-gray-200 mb-6 text-left font-mono">
                    {serverStatus ? (
                      <>
                        <p>Server: {serverStatus.hostname} ({serverStatus.platform})</p>
                        <p>Runtime: {serverStatus.node}</p>
                        <p>Uptime: {Math.floor(serverStatus.uptime / 60)} minutes</p>
                      </>
                    ) : (
                      <p className="italic text-gray-400">Server status unavailable.</p>
                    )}
                  </div>

                  <button
                    onClick={() => setIsAboutOpen(false)}
                    className="bg-vy-accent text-white px-8 py-2 rounded-sm text-xs font-bold shadow-md hover:brightness-110"
                  >
                    CLOSE
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Settings Modal — real, functional settings */}
          {isSettingsOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-vy-bg border border-[#aaa] shadow-2xl w-full max-w-lg rounded-sm overflow-hidden animate-in fade-in duration-200">
                <div className="bg-vy-nav border-b border-[#ccc] px-3 py-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-tight">Global Settings</span>
                  </div>
                  <button onClick={() => setIsSettingsOpen(false)}>
                    <X className="w-4 h-4 text-gray-400 hover:text-red-500" />
                  </button>
                </div>
                <div className="p-6 space-y-6 bg-white/50 min-h-[200px]">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-bold text-gray-700">Terminal font size</span>
                      <select
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value))}
                        className="bg-white border border-[#ccc] rounded px-2 py-0.5 text-xs"
                      >
                        {[11, 12, 13, 14, 15, 16, 18, 20].map((s) => (
                          <option key={s} value={s}>
                            {s}px
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-bold text-gray-700">Session groups</span>
                      <button
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setIsGroupManagerOpen(true);
                        }}
                        className="bg-white border border-[#ccc] rounded px-2 py-0.5 text-xs hover:bg-gray-50"
                      >
                        {groups.length} group{groups.length === 1 ? "" : "s"} — manage…
                      </button>
                    </div>
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-bold text-gray-700">Master password (vault)</span>
                      <button
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setVaultMode(hasVault() ? (isUnlocked() ? "manage" : "unlock") : "setup");
                        }}
                        className="bg-white border border-[#ccc] rounded px-2 py-0.5 text-xs hover:bg-gray-50"
                      >
                        {!hasVault()
                          ? "Off — enable…"
                          : isUnlocked()
                            ? "On — unlocked"
                            : "On — locked"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-bold text-gray-700">Terminal theme</span>
                      <button
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setIsTerminalThemeOpen(true);
                        }}
                        className="bg-white border border-[#ccc] rounded px-2 py-0.5 text-xs hover:bg-gray-50"
                      >
                        {terminalTheme} — change…
                      </button>
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 p-3 rounded text-[11px] text-blue-800 leading-relaxed">
                    Font size applies to new terminal tabs. SSH keepalive (30s) is always enabled on the server.
                  </div>
                </div>
                <div className="bg-gray-100 border-t border-[#ccc] p-3 flex justify-end gap-2">
                  <button
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-6 py-1.5 bg-vy-accent text-white rounded-sm text-xs font-bold shadow-sm"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}

          <GroupManagerModal
            isOpen={isGroupManagerOpen}
            onClose={() => setIsGroupManagerOpen(false)}
            groups={groups}
            onSaveGroups={setGroups}
          />

          {vaultMode && (
            <VaultModal
              mode={vaultMode}
              onClose={() => setVaultMode(null)}
              onUnlocked={() => void migrateSecrets()}
              onReset={() => {
                const stripped = stripEncryptedSecrets(sessions, sshKeys);
                setSessions(stripped.sessions);
                setSshKeys(stripped.sshKeys);
              }}
              onVaultStateChange={() => setVaultTick((t) => t + 1)}
            />
          )}

          <MacroManagerModal
            isOpen={isMacroManagerOpen}
            onClose={() => setIsMacroManagerOpen(false)}
            macros={macros}
            onSaveMacro={handleSaveMacro}
            onDeleteMacro={handleDeleteMacro}
            onRunMacro={(macro) => {
              window.dispatchEvent(new CustomEvent("vy-termweb:run-macro", { detail: { macro } }));
              setIsMacroManagerOpen(false);
            }}
          />

          <TerminalThemeModal
            isOpen={isTerminalThemeOpen}
            onClose={() => setIsTerminalThemeOpen(false)}
            currentTheme={terminalTheme}
            onSelectTheme={(themeName) => {
              setTerminalTheme(themeName);
              setIsTerminalThemeOpen(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}
