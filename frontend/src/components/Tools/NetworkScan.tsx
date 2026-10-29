import { useState, useEffect, useRef } from "react";
import {
  Network, Search, RefreshCw, Router, Monitor, Smartphone, Printer, Tv, Server,
  HardDrive, Cpu, Gamepad2, Camera, HelpCircle, ChevronDown, ChevronUp, Wifi,
  Activity, Globe, MapPin, X, ExternalLink, Terminal, FolderOpen, Copy,
} from "lucide-react";
import { type Socket } from "socket.io-client";
import { connectSocket } from "../../lib/auth";
import { trackBoot } from "../../lib/boot";
import { serviceName, webProto } from "../../lib/ports";
import { cn } from "../../lib/utils";

interface ScanHost {
  ip: string;
  hostname: string;
  mac: string;
  vendor: string;
  deviceType: string;
  isGateway: boolean;
  isSelf: boolean;
  latency: number;
  openPorts: number[];
}

const TYPE_META: Record<string, { icon: any; label: string; color: string }> = {
  router: { icon: Router, label: "Router / Gateway", color: "text-blue-600" },
  self: { icon: Monitor, label: "This device", color: "text-green-600" },
  computer: { icon: Monitor, label: "Computer", color: "text-gray-700" },
  server: { icon: Server, label: "Server", color: "text-indigo-600" },
  vm: { icon: HardDrive, label: "VM / Container", color: "text-purple-600" },
  nas: { icon: HardDrive, label: "NAS / Storage", color: "text-amber-600" },
  phone: { icon: Smartphone, label: "Phone / Tablet", color: "text-pink-600" },
  printer: { icon: Printer, label: "Printer", color: "text-cyan-600" },
  tv: { icon: Tv, label: "TV / Media", color: "text-orange-600" },
  console: { icon: Gamepad2, label: "Game console", color: "text-emerald-600" },
  camera: { icon: Camera, label: "Camera", color: "text-red-600" },
  iot: { icon: Cpu, label: "IoT / Smart device", color: "text-teal-600" },
  device: { icon: HelpCircle, label: "Device", color: "text-gray-500" },
};

const toolBtn =
  "px-2.5 py-1 rounded text-[11px] font-bold border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40 transition-colors";

type ToolResult = { tool: string; output: string[]; done: boolean };

export default function NetworkScan({
  onAppConnect,
}: {
  /** Open an in-app session to ip:port — saved session if one matches, else prefill the modal. */
  onAppConnect?: (ip: string, port: number, type: "SSH" | "SFTP") => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanHost[]>([]);
  const [subnets, setSubnets] = useState<string[]>([]);
  const [gateway, setGateway] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ScanHost | null>(null);
  const [toolBusy, setToolBusy] = useState("");
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [portMenu, setPortMenu] = useState<{ port: number; x: number; y: number } | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const openPortMenu = (e: React.MouseEvent, port: number) => {
    e.preventDefault();
    setPortMenu({ port, x: e.clientX, y: e.clientY });
  };

  /** Smart click: web ports open the browser, 22 opens SSH in-app, others show the menu. */
  const primaryPortAction = (e: React.MouseEvent, port: number) => {
    if (!selected) return;
    const proto = webProto(port);
    if (proto) {
      window.open(`${proto}://${selected.ip}:${port}`, "_blank", "noopener");
    } else if (port === 22) {
      onAppConnect?.(selected.ip, port, "SSH");
    } else {
      openPortMenu(e, port);
    }
  };

  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    trackBoot(socket);

    socket.on("scan-start", ({ subnets, gateway }: { subnets: string[]; gateway: string }) => {
      setSubnets(subnets);
      setGateway(gateway || "");
      setScanning(true);
      setResults([]);
      setError(null);
      setSelected(null);
      setToolResult(null);
    });

    socket.on("scan-result", (host: ScanHost) => {
      setResults((prev) => {
        const next = prev.some((h) => h.ip === host.ip) ? prev : [...prev, host];
        return next.sort((a, b) => {
          const ga = a.isGateway ? 0 : a.isSelf ? 1 : 2;
          const gb = b.isGateway ? 0 : b.isSelf ? 1 : 2;
          if (ga !== gb) return ga - gb;
          const pa = a.ip.split(".").map(Number);
          const pb = b.ip.split(".").map(Number);
          for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
          return 0;
        });
      });
    });

    socket.on("scan-done", () => setScanning(false));
    socket.on("scan-error", (msg: string) => {
      setError(msg);
      setScanning(false);
    });

    socket.on("net-ping-result", ({ seq, ms }: { seq: number; ms: number | null }) => {
      setToolResult((t) => ({
        tool: "ping",
        done: false,
        output: [...(t?.output || []), ms === null ? `seq ${seq}: timeout` : `seq ${seq}: time=${ms} ms`],
      }));
    });
    socket.on("net-ping-done", (r: any) => {
      setToolBusy("");
      setToolResult((t) => ({
        tool: "ping",
        done: true,
        output: [
          ...(t?.output || []),
          r.received === 0
            ? `— 100% packet loss`
            : `— ${r.received}/${r.sent} received, min/avg/max = ${r.min}/${r.avg}/${r.max} ms`,
        ],
      }));
    });
    socket.on("net-portscan-result", (r: any) => {
      setToolBusy("");
      setToolResult({
        tool: "portscan",
        done: true,
        output: [
          `Scanned ${r.scanned} ports on ${r.ip}`,
          r.open.length ? `Open: ${r.open.join(", ")}` : "No open ports found",
        ],
      });
      // Merge newly discovered ports into the host so they render as
      // actionable chips (same click/context-menu behavior as the
      // quick-scan ports).
      const merge = (h: ScanHost) =>
        h.ip !== r.ip
          ? h
          : { ...h, openPorts: [...new Set([...h.openPorts, ...r.open])].sort((a, b) => a - b) };
      setResults((prev) => prev.map(merge));
      setSelected((prev) => (prev ? merge(prev) : prev));
    });
    socket.on("net-traceroute-result", (r: any) => {
      setToolBusy("");
      setToolResult({
        tool: "traceroute",
        done: true,
        output: r.hops.length
          ? r.hops.map((h: any) => `${String(h.hop).padStart(2)}  ${h.host}  ${h.rtt.length ? h.rtt.map((x: number) => x + " ms").join("  ") : "*"} `)
          : ["No hops returned"],
      });
    });
    socket.on("net-dns-result", (r: any) => {
      setToolBusy("");
      setToolResult({
        tool: "dns",
        done: true,
        output: [
          `${r.type} lookup ${r.query}`,
          ...(r.answers.length ? r.answers : []),
          ...(r.error ? [`Error: ${r.error}`] : []),
        ],
      });
    });
    socket.on("net-tool-error", ({ tool, error }: { tool: string; error: string }) => {
      setToolBusy("");
      setToolResult({ tool, done: true, output: [`Error: ${error}`] });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Escape closes the port context menu
  useEffect(() => {
    if (!portMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPortMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [portMenu]);

  const startScan = () => socketRef.current?.emit("net-scan");

  const runTool = (tool: string, host: ScanHost) => {
    setToolBusy(tool);
    setToolResult({ tool, done: false, output: [] });
    const s = socketRef.current;
    if (!s) return;
    if (tool === "ping") s.emit("net-ping", { ip: host.ip });
    if (tool === "portscan") s.emit("net-portscan", { ip: host.ip });
    if (tool === "traceroute") s.emit("net-traceroute", { ip: host.ip });
    if (tool === "dns") s.emit("net-dns", { query: host.hostname || host.ip });
  };

  const q = filter.trim().toLowerCase();
  const shown = q
    ? results.filter((h) =>
        [h.ip, h.hostname, h.mac, h.vendor, TYPE_META[h.deviceType]?.label || ""]
          .join(" ").toLowerCase().includes(q)
      )
    : results;

  return (
    <div className="flex-1 flex flex-col bg-white font-sans overflow-hidden">
      {/* Header — Fing-style summary */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-600 text-white px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-white/15 p-2 rounded-lg">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">Network Scan</h2>
            <p className="text-[11px] text-blue-100">
              {subnets.length > 0
                ? `${subnets.map((s) => s + "0/24").join(", ")}${gateway ? ` · Gateway ${gateway}` : ""}`
                : "Discover every device on your network — Fing style"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {results.length > 0 && (
            <div className="text-right">
              <div className="text-lg font-bold leading-none">{results.length}</div>
              <div className="text-[10px] text-blue-100 uppercase tracking-wide">devices</div>
            </div>
          )}
          <button
            onClick={startScan}
            disabled={scanning}
            className="bg-white text-blue-700 px-5 py-2 rounded-lg text-xs font-bold hover:bg-blue-50 disabled:opacity-60 flex items-center gap-2 shadow transition-all"
          >
            {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {scanning ? "SCANNING…" : "SCAN"}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 flex items-center gap-3 shrink-0">
        <Search className="w-3.5 h-3.5 text-gray-400" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by IP, name, MAC, vendor or type…"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400"
        />
        {scanning && (
          <span className="flex items-center gap-2 text-[11px] text-blue-600 italic">
            <span className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            probing hosts…
          </span>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Device list */}
        <div className={cn("flex-1 overflow-y-auto bg-gray-50 p-3", selected && "hidden sm:block sm:max-w-[55%]")}>
          {error && (
            <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded">
              Scan error: {error}
            </div>
          )}
          {shown.length === 0 && !scanning && (
            <div className="text-center text-gray-400 italic text-sm py-16">
              Press <b>SCAN</b> to discover devices on your network.
            </div>
          )}
          <div className="space-y-1.5">
            {shown.map((h) => {
              const meta = TYPE_META[h.deviceType] || TYPE_META.device;
              const Icon = meta.icon;
              const name = h.hostname || h.vendor || h.ip;
              return (
                <button
                  key={h.ip}
                  onClick={() => { setSelected(h); setToolResult(null); }}
                  className={cn(
                    "w-full text-left bg-white border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-blue-300 hover:shadow-sm transition-all",
                    selected?.ip === h.ip ? "border-blue-500 shadow-sm ring-1 ring-blue-200" : "border-gray-200"
                  )}
                >
                  <div className={cn("p-2 rounded-lg bg-gray-50 shrink-0", meta.color)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-gray-800 truncate">{name}</span>
                      {h.isGateway && (
                        <span className="text-[9px] font-bold uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Gateway</span>
                      )}
                      {h.isSelf && (
                        <span className="text-[9px] font-bold uppercase bg-green-100 text-green-700 px-1.5 py-0.5 rounded">This device</span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {h.ip}
                      {h.mac ? ` · ${h.mac}` : ""}
                      {h.vendor ? ` · ${h.vendor}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold text-green-600">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> Online
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">{h.latency} ms</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Device detail — Fing-style side panel */}
        {selected && (
          <div className="flex-1 sm:max-w-[45%] border-l border-gray-200 bg-white overflow-y-auto">
            <div className="p-4 border-b border-gray-100 flex items-start justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                {(() => {
                  const meta = TYPE_META[selected.deviceType] || TYPE_META.device;
                  const Icon = meta.icon;
                  return <div className={cn("p-2.5 rounded-xl bg-gray-50", meta.color)}><Icon className="w-6 h-6" /></div>;
                })()}
                <div>
                  <div className="text-sm font-bold text-gray-800">{selected.hostname || selected.vendor || selected.ip}</div>
                  <div className="text-[11px] text-gray-500">{(TYPE_META[selected.deviceType] || TYPE_META.device).label}</div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Detail label="IP address" value={selected.ip} mono />
                <Detail label="Status" value={`Online · ${selected.latency} ms`} />
                <Detail label="MAC address" value={selected.mac || "—"} mono />
                <Detail label="Vendor" value={selected.vendor || "Unknown"} />
                <Detail label="Hostname" value={selected.hostname || "—"} mono />
                <Detail
                  label="Role"
                  value={selected.isGateway ? "Gateway" : selected.isSelf ? "This device" : "Host"}
                />
              </div>

              <div>
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  Open ports ({selected.openPorts.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {selected.openPorts.length ? (
                    selected.openPorts.map((p) => {
                      const svc = serviceName(p);
                      const proto = webProto(p);
                      return (
                        <button
                          key={p}
                          onClick={(e) => primaryPortAction(e, p)}
                          onContextMenu={(e) => openPortMenu(e, p)}
                          title={
                            (svc ? `${svc} — ` : "") +
                            (proto
                              ? `open ${proto}://${selected.ip}:${p}`
                              : p === 22
                                ? "open SSH session in app"
                                : "click for actions")
                          }
                          className={cn(
                            "border px-1.5 py-0.5 rounded font-mono text-[10px] inline-flex items-center gap-1 transition-colors",
                            proto || p === 22
                              ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 cursor-pointer"
                              : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer"
                          )}
                        >
                          {proto && <ExternalLink className="w-2.5 h-2.5" />}
                          {p === 22 && <Terminal className="w-2.5 h-2.5" />}
                          {p}{svc ? <span className="text-[9px] opacity-70">{svc}</span> : null}
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-gray-400 italic">none detected (ping only)</span>
                  )}
                </div>
              </div>

              {/* Fing-style tools */}
              <div>
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Tools</div>
                <div className="flex flex-wrap gap-1.5">
                  <button className={toolBtn} disabled={!!toolBusy} onClick={() => runTool("ping", selected)}>
                    <Activity className="w-3 h-3 inline mr-1" />Ping
                  </button>
                  <button className={toolBtn} disabled={!!toolBusy} onClick={() => runTool("portscan", selected)}>
                    <Search className="w-3 h-3 inline mr-1" />Deep port scan
                  </button>
                  <button className={toolBtn} disabled={!!toolBusy} onClick={() => runTool("traceroute", selected)}>
                    <MapPin className="w-3 h-3 inline mr-1" />Traceroute
                  </button>
                  <button className={toolBtn} disabled={!!toolBusy} onClick={() => runTool("dns", selected)}>
                    <Globe className="w-3 h-3 inline mr-1" />DNS lookup
                  </button>
                </div>

                {(toolBusy || toolResult) && (
                  <div className="mt-2 bg-[#1e1e1e] text-gray-200 rounded-md p-2.5 font-mono text-[11px] space-y-0.5 max-h-48 overflow-y-auto">
                    {toolBusy && (
                      <div className="flex items-center gap-2 text-blue-300">
                        <span className="w-3 h-3 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                        running {toolBusy}…
                      </div>
                    )}
                    {toolResult?.output.map((l, i) => (
                      <div key={i} className={cn(l.startsWith("Error") ? "text-red-400" : l.startsWith("—") ? "text-green-400" : "")}>
                        {l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Port context menu */}
      {portMenu && selected && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPortMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setPortMenu(null); }}
          />
          <div
            className="fixed z-50 bg-white border border-gray-300 shadow-lg rounded py-1 min-w-[210px] text-[11px]"
            style={{
              left: Math.min(portMenu.x, window.innerWidth - 220),
              top: Math.min(portMenu.y, window.innerHeight - 220),
            }}
          >
            <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase border-b border-gray-100 mb-1">
              {selected.ip}:{portMenu.port}{serviceName(portMenu.port) ? ` · ${serviceName(portMenu.port)}` : ""}
            </div>
            <MenuItem icon={Globe} label={`Open http://${selected.ip}:${portMenu.port}`}
              onClick={() => { window.open(`http://${selected.ip}:${portMenu.port}`, "_blank", "noopener"); setPortMenu(null); }} />
            <MenuItem icon={ExternalLink} label={`Open https://${selected.ip}:${portMenu.port}`}
              onClick={() => { window.open(`https://${selected.ip}:${portMenu.port}`, "_blank", "noopener"); setPortMenu(null); }} />
            <MenuItem icon={Terminal} label={`SSH session — port ${portMenu.port}`}
              onClick={() => { onAppConnect?.(selected.ip, portMenu.port, "SSH"); setPortMenu(null); }} />
            <MenuItem icon={FolderOpen} label={`SFTP session — port ${portMenu.port}`}
              onClick={() => { onAppConnect?.(selected.ip, portMenu.port, "SFTP"); setPortMenu(null); }} />
            <MenuItem icon={Copy} label={`Copy ${selected.ip}:${portMenu.port}`}
              onClick={() => { navigator.clipboard?.writeText(`${selected.ip}:${portMenu.port}`); setPortMenu(null); }} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon: I, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center gap-2 text-gray-700 transition-colors"
    >
      <I className="w-3.5 h-3.5 shrink-0" /> {label}
    </button>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={cn("text-gray-800 truncate", mono && "font-mono")}>{value}</div>
    </div>
  );
}
