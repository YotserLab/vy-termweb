import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { type Session, type SessionGroup, type SSHKey, type Macro } from "../types";
import { TERMINAL_THEMES } from "./TerminalThemeModal";
import { Search, X, ChevronUp, ChevronDown, Zap, Play, Disc } from "lucide-react";
import { type Socket } from "socket.io-client";
import { connectSocket } from "../lib/auth";
import { trackBoot } from "../lib/boot";
import { buildConnectPayload, effectiveSession, envExports } from "../lib/session";
import "xterm/css/xterm.css";

interface TerminalViewProps {
  id: string;
  title: string;
  session?: Session;
  sessions?: Session[];
  groups?: SessionGroup[];
  sshKeys?: SSHKey[];
  macros?: Macro[];
  onOpenMacroManager?: () => void;
  lastBroadcast?: { command: string; timestamp: number } | null;
  terminalTheme?: string;
  isActive?: boolean;
  fontSize?: number;
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void;
}

export default function TerminalView({
  id,
  title,
  session,
  sessions,
  groups,
  sshKeys,
  macros,
  onOpenMacroManager,
  lastBroadcast,
  terminalTheme = "Classic Black",
  isActive = true,
  fontSize = 14,
  onStatusChange,
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [sshInfo, setSshInfo] = useState<{ cipher?: string; banner?: string } | null>(null);
  const [connStatus, setConnStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [logPath, setLogPath] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const macrosRef = useRef(macros);
  macrosRef.current = macros;
  const sshKeysRef = useRef(sshKeys);
  sshKeysRef.current = sshKeys;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: "connecting" | "connected" | "disconnected") => {
    setConnStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  // Update xterm theme when terminalTheme prop changes
  useEffect(() => {
    if (xtermRef.current) {
      const selectedTheme = TERMINAL_THEMES[terminalTheme] || TERMINAL_THEMES["Classic Black"];
      xtermRef.current.options.theme = {
        background: selectedTheme.background,
        foreground: selectedTheme.foreground,
        cursor: selectedTheme.cursor,
        selectionBackground: selectedTheme.selectionBackground,
      };
    }
  }, [terminalTheme]);

  const isRemoteSession = useCallback(() => {
    const s = sessionRef.current;
    return !!(s?.host && s.host !== "local" && s.host !== "localhost");
  }, []);

  const sendInput = useCallback((data: string) => {
    socketRef.current?.emit("ssh-input", data);
  }, []);

  // Macros store raw bytes (real \n works as-is); typed text like \n, \t or
  // \u0003 in the editor is unescaped so it produces the real keystroke.
  const unescapeMacroValue = (s: string) =>
    s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[nrtbe0\\])/g, (_m, g: string) => {
      if (g[0] === "x" || g[0] === "u") return String.fromCharCode(parseInt(g.slice(1), 16));
      return { n: "\n", r: "\r", t: "\t", b: "\b", e: "\x1b", "0": "\x00", "\\": "\\" }[g] ?? g;
    });

  const executeMacro = useCallback(async (macro: Macro) => {
    for (const cmd of macro.commands) {
      if (cmd.type === "delay") {
        const ms = parseInt(cmd.value) || 1000;
        await new Promise((res) => setTimeout(res, ms));
      } else if (cmd.type === "command") {
        sendInput(unescapeMacroValue(cmd.value));
      }
    }
  }, [sendInput]);

  // Run macro triggered from the Macro Manager
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { macro: Macro };
      if (detail?.macro) executeMacro(detail.macro);
    };
    if (isActive) window.addEventListener("vy-termweb:run-macro", handler);
    return () => window.removeEventListener("vy-termweb:run-macro", handler);
  }, [isActive, executeMacro]);

  // Multi-exec broadcast
  useEffect(() => {
    if (!lastBroadcast) return;
    const cmdVal = lastBroadcast.command.endsWith("\n")
      ? lastBroadcast.command
      : lastBroadcast.command + "\r";
    socketRef.current?.emit("ssh-input", cmdVal);
  }, [lastBroadcast]);

  // Macro shortcut keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!macros || macros.length === 0 || !isActive) return;

      const matched = macros.find((m) => {
        if (!m.shortcut) return false;
        if (m.shortcut === e.key) return true;
        if (m.shortcut === `Ctrl+${e.key.toUpperCase()}` && e.ctrlKey && !e.shiftKey && !e.altKey) return true;
        if (m.shortcut === `Ctrl+Shift+${e.key.toUpperCase()}` && e.ctrlKey && e.shiftKey) return true;
        if (m.shortcut === `Ctrl+Alt+${e.key}` && e.ctrlKey && e.altKey) return true;
        return false;
      });

      if (matched) {
        e.preventDefault();
        executeMacro(matched);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [macros, isActive, executeMacro]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const initialTheme = TERMINAL_THEMES[terminalTheme] || TERMINAL_THEMES["Classic Black"];
    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: initialTheme.background,
        foreground: initialTheme.foreground,
        cursor: initialTheme.cursor,
        selectionBackground: initialTheme.selectionBackground,
      },
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    term.onCursorMove(() => {
      const buf = term.buffer.active;
      setCursorPos({ line: buf.cursorY + 1, col: buf.cursorX + 1 });
    });

    let resizeTimeout: any;
    const pushResize = () => {
      if (socketRef.current) {
        socketRef.current.emit("ssh-resize", { cols: term.cols, rows: term.rows });
      }
    };
    const safeFit = () => {
      try {
        if (
          terminalRef.current &&
          terminalRef.current.clientWidth > 0 &&
          terminalRef.current.clientHeight > 0 &&
          xtermRef.current
        ) {
          const prevCols = term.cols;
          const prevRows = term.rows;
          fitAddon.fit();
          if (term.cols !== prevCols || term.rows !== prevRows) pushResize();
        }
      } catch (e) {
        console.warn("Terminal fit failed", e);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(safeFit, 50);
    });
    resizeObserver.observe(terminalRef.current);
    setTimeout(safeFit, 100);

    // Stable per-tab identity lets the server park & resume the SSH/PTY
    // session across socket.io transport reconnects (no re-auth loop).
    const resumeId = `term-${id}-${Math.random().toString(36).slice(2, 10)}`;
    // How many chars of server scrollback this xterm has already rendered.
    let seenChars = 0;

    // Startup snippet: env exports + startup macro, once per fresh connect
    // (ssh-ready/shell-ready only fire on new sessions — resumes get ssh-resumed)
    const runStartup = () => {
      const s = sessionRef.current;
      if (!s) return;
      const eff = effectiveSession(s, groupsRef.current || []);
      const exportsLine = envExports(eff.env);
      const macro = eff.startupMacroId
        ? macrosRef.current?.find((m) => m.id === eff.startupMacroId)
        : undefined;
      if (!exportsLine && !macro) return;
      setTimeout(() => {
        if (exportsLine) sendInput(exportsLine + "\r");
        if (macro) void executeMacro(macro);
      }, eff.startupDelayMs ?? 500);
    };

    const connect = () => {
      setStatus("connecting");
      setSshInfo(null);
      const socket = connectSocket();
      socketRef.current = socket;
      trackBoot(socket);

      let sessionRequested = false;

      socket.on("connect", () => {
        const s = sessionRef.current;
        const remote = !!(s?.host && s.host !== "local" && s.host !== "localhost");

        // The server parks the session on transport drops, so re-issue the
        // request with the same resumeId — it resumes instead of re-authing.
        if (sessionRequested) {
          setStatus("connecting");
          term.writeln("\r\n\u001b[33mTransport lost — re-establishing session...\u001b[0m");
        } else if (remote) {
          term.writeln(`\u001b[1;34mVY-TermWEB [SSH]\u001b[0m connecting to \u001b[1;32m${s!.host}:${s!.port || 22}\u001b[0m ...`);
        } else {
          term.writeln(`\u001b[1;34mVY-TermWEB [LOCAL SHELL]\u001b[0m — spawning PTY...`);
        }
        sessionRequested = true;

        if (remote) {
          const sNow = sessionRef.current!;
          const eff = effectiveSession(sNow, groupsRef.current || []);
          void buildConnectPayload(sNow, sessionsRef.current || [], sshKeysRef.current || [], groupsRef.current || [])
            .then((payload) => {
              socket.emit("ssh-connect", {
                ...payload,
                logging: eff.logging,
                cols: term.cols,
                rows: term.rows,
                resumeId,
                seen: seenChars,
              });
            })
            .catch((e) => {
              setStatus("disconnected");
              term.writeln(`\r\n\u001b[31m${e?.message || e}\u001b[0m`);
            });
        } else {
          const effLocal = sessionRef.current
            ? effectiveSession(sessionRef.current, groupsRef.current || [])
            : undefined;
          socket.emit("local-shell", {
            cols: term.cols,
            rows: term.rows,
            logging: effLocal?.logging,
            resumeId,
            seen: seenChars,
          });
        }
      });

      socket.on("ssh-resumed", ({ scrollback, ready }: { scrollback?: string; ready?: boolean }) => {
        if (ready) setStatus("connected");
        if (scrollback) {
          seenChars += scrollback.length;
          term.write(scrollback);
        }
        term.writeln("\r\n\u001b[32mSession restored.\u001b[0m");
      });

      socket.on("disconnect", (reason) => {
        if (reason === "io client disconnect") return;
        setStatus("disconnected");
        term.writeln(`\r\n\u001b[33mLost connection to server (${reason}).\u001b[0m`);
        // socket.io does not auto-reconnect on server-initiated disconnects
        if (reason === "io server disconnect") socket.connect();
      });

      socket.on("ssh-ready", (msg) => {
        setStatus("connected");
        term.writeln(`\u001b[1;32m${msg}\u001b[0m`);
        runStartup();
      });

      socket.on("shell-ready", () => {
        setStatus("connected");
        runStartup();
      });

      socket.on("ssh-log-started", (info: { path?: string; format?: string }) => {
        setLogPath(info.path || "");
        term.writeln(`\r\n\u001b[36mSession log: ${info.path} (${info.format})\u001b[0m`);
      });

      socket.on("ssh-log-stopped", () => {
        setLogPath(null);
        term.writeln(`\r\n\u001b[36mSession log stopped.\u001b[0m`);
      });

      socket.on("ssh-log-error", (msg: string) => {
        term.writeln(`\r\n\u001b[31m${msg}\u001b[0m`);
      });

      socket.on("ssh-info", (info) => {
        setSshInfo(info);
      });

      socket.on("ssh-data", (data) => {
        seenChars += data.length;
        term.write(data);
      });

      socket.on("ssh-error", (err) => {
        setStatus("disconnected");
        term.writeln(`\r\n\u001b[31m${err}\u001b[0m`);
      });

      socket.on("ssh-close", () => {
        setStatus("disconnected");
        term.writeln("\r\n\u001b[1;31mConnection closed.\u001b[0m");
      });

      socket.on("tunnel-ready", (t: any) => {
        term.writeln(
          `\r\n\u001b[36mTunnel active: 127.0.0.1:${t.localPort} -> ${t.remoteHost}:${t.remotePort}\u001b[0m`
        );
      });

      socket.on("tunnel-error", (msg: string) => {
        term.writeln(`\r\n\u001b[31m${msg}\u001b[0m`);
      });
    };

    connect();

    // Track the typed line so the live macro recorder can capture real commands
    let lineBuf = "";
    term.onData((data) => {
      socketRef.current?.emit("ssh-input", data);
      if (data === "\r") {
        if (isActiveRef.current && lineBuf.trim()) {
          window.dispatchEvent(
            new CustomEvent("vy-termweb:record-command", {
              detail: { command: lineBuf, terminalId: id },
            })
          );
        }
        lineBuf = "";
      } else if (data === "\x7f") {
        lineBuf = lineBuf.slice(0, -1);
      } else if (data.length === 1 && data >= " ") {
        lineBuf += data;
      } else if (data.startsWith("\x1b")) {
        lineBuf = "";
      }
    });

    // Window-level actions dispatched from the toolbar
    const onCopy = () => {
      if (!isActiveRef.current) return;
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    };
    const onCut = () => {
      if (!isActiveRef.current) return;
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    };
    const onPaste = async () => {
      if (!isActiveRef.current) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) socketRef.current?.emit("ssh-input", text);
      } catch {}
    };
    const onReconnect = () => {
      if (!isActiveRef.current) return;
      term.writeln("\r\n\u001b[33mReconnecting...\u001b[0m");
      socketRef.current?.disconnect();
      connect();
    };

    window.addEventListener("vy-termweb:copy", onCopy);
    window.addEventListener("vy-termweb:cut", onCut);
    window.addEventListener("vy-termweb:paste", onPaste);
    window.addEventListener("vy-termweb:reconnect", onReconnect);

    return () => {
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      window.removeEventListener("vy-termweb:copy", onCopy);
      window.removeEventListener("vy-termweb:cut", onCut);
      window.removeEventListener("vy-termweb:paste", onPaste);
      window.removeEventListener("vy-termweb:reconnect", onReconnect);
      socketRef.current?.disconnect();
      term.dispose();
    };
  }, []);

  const handleSearch = (next = true) => {
    if (!searchQuery) return;
    if (next) searchAddonRef.current?.findNext(searchQuery);
    else searchAddonRef.current?.findPrevious(searchQuery);
  };

  return (
    <div className="flex-1 bg-black relative overflow-hidden h-full flex flex-col">
      {macros && macros.length > 0 && (
        <div className="bg-[#1a1a1a] border-b border-[#333] px-2 py-1 flex items-center gap-2 overflow-x-auto shrink-0 select-none">
          <div className="flex items-center gap-1 text-[11px] font-bold text-purple-400 mr-1">
            <Zap className="w-3 h-3" /> Macros:
          </div>
          {macros.map((m) => (
            <button
              key={m.id}
              onClick={() => executeMacro(m)}
              className="bg-[#2a2a2a] hover:bg-purple-900/60 hover:border-purple-500 border border-[#444] text-gray-200 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shadow-xs"
              title={`${m.description || m.name} (Shortcut: ${m.shortcut || "None"})`}
            >
              <Play className="w-2.5 h-2.5 fill-purple-400 text-purple-400" />
              <span>{m.name}</span>
              {m.shortcut && (
                <span className="bg-black/50 text-purple-300 px-1 rounded text-[9px]">{m.shortcut}</span>
              )}
            </button>
          ))}
          {onOpenMacroManager && (
            <button
              onClick={onOpenMacroManager}
              className="text-gray-400 hover:text-white px-2 py-0.5 rounded text-[10px] underline ml-auto whitespace-nowrap"
            >
              Manage Macros...
            </button>
          )}
        </div>
      )}

      {showSearch && (
        <div className="absolute top-2 right-4 z-20 flex items-center bg-white border border-[#ccc] rounded shadow-lg p-1 animate-in slide-in-from-top-2 duration-150">
          <Search className="w-3 h-3 text-gray-400 mx-2" />
          <input
            autoFocus
            type="text"
            placeholder="Search terminal..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
              if (e.key === "Escape") setShowSearch(false);
            }}
            className="text-[11px] outline-none w-48 py-0.5 text-black"
          />
          <div className="flex items-center ml-2 border-l border-gray-200 pl-1 gap-1">
            <button onClick={() => handleSearch(false)} className="hover:bg-gray-100 p-0.5 rounded">
              <ChevronUp className="w-3 h-3 text-gray-500" />
            </button>
            <button onClick={() => handleSearch(true)} className="hover:bg-gray-100 p-0.5 rounded">
              <ChevronDown className="w-3 h-3 text-gray-500" />
            </button>
            <button onClick={() => setShowSearch(false)} className="hover:bg-red-50 p-0.5 rounded ml-1">
              <X className="w-3 h-3 text-red-500" />
            </button>
          </div>
        </div>
      )}

      <div ref={terminalRef} className="flex-1 p-2 overflow-hidden" style={{ width: "100%", height: "100%" }} />

      {/* Terminal Internal Status Bar — real data */}
      <div className="bg-[#1a1a1a] border-t border-[#333] px-2 py-0.5 flex items-center justify-between text-[10px] text-gray-400 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 font-bold">
            <div
              className={
                connStatus === "connected"
                  ? "w-2 h-2 rounded-sm bg-green-600"
                  : connStatus === "connecting"
                    ? "w-2 h-2 rounded-sm bg-amber-500 animate-pulse"
                    : "w-2 h-2 rounded-sm bg-rose-600"
              }
            />
            <span className="text-gray-300 capitalize">
              {isRemoteSession() ? session?.type || "SSH" : "Local Shell"} — {connStatus}
            </span>
          </div>
          <span className="opacity-30">|</span>
          <span className="opacity-70">{isRemoteSession() ? session?.host : "localhost"}</span>
          {sshInfo?.cipher && (
            <>
              <span className="opacity-30">|</span>
              <span className="opacity-70 font-mono">{sshInfo.cipher}</span>
            </>
          )}
          <span className="opacity-30">|</span>
          <span className="bg-[#333] px-1.5 rounded text-[9px] select-none">UTF-8</span>
          <button
            onClick={() =>
              socketRef.current?.emit(logPath ? "ssh-log-stop" : "ssh-log-start", { format: "clean" })
            }
            className={
              logPath
                ? "flex items-center gap-1 bg-rose-900/60 border border-rose-500/50 px-1.5 rounded text-[9px] text-rose-300 animate-pulse"
                : "flex items-center gap-1 bg-[#333] px-1.5 rounded text-[9px] text-gray-500 hover:text-gray-300"
            }
            title={logPath ? `Recording session log: ${logPath}` : "Record session log"}
          >
            <Disc className="w-2.5 h-2.5" />
            {logPath ? "REC" : "Log"}
          </button>
        </div>
        <div className="flex items-center gap-3 font-mono opacity-80">
          <span>{title}</span>
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
        </div>
      </div>
    </div>
  );
}
