import { useEffect, useState } from "react";
import { Cpu, CircuitBoard, MemoryStick, MonitorPlay, AppWindow, RefreshCw, HardDrive } from "lucide-react";
import { cn } from "../../lib/utils";
import { apiFetch } from "../../lib/auth";

type Info = {
  cpu: {
    name: string; vendor: string; arch: string; cores: number; threads: number;
    maxMhz?: string; curMhz?: string; cacheL1?: string; cacheL2?: string; cacheL3?: string;
    socket?: string; stepping?: string; family?: string; model?: string;
    virt?: string; numa?: string; flags?: string;
  };
  memory: {
    totalBytes: number; availBytes?: number; swapTotal?: number; swapFree?: number;
    type?: string; channels?: string;
    slots?: { locator: string; sizeBytes: number; type?: string; speedMts?: string; manufacturer?: string; partNumber?: string }[];
  };
  board: { vendor?: string; product?: string; biosVersion?: string; biosDate?: string };
  gpus: { name: string; vramMB?: number; driver?: string; pciAddr?: string; tempC?: string; clockMhz?: string }[] | null;
  storage?: { device: string; mount: string; fs?: string; sizeBytes: number; usedBytes: number }[];
  os: { name: string; version?: string; kernel?: string; arch: string; uptime?: string; hostname: string };
};

const fmtBytes = (n: number) =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : `${(n / (1 << 20)).toFixed(0)} MB`;

const Row = ({ k, v }: { k: string; v?: string | number }) => (
  <div className="flex border-b border-gray-100 last:border-0">
    <div className="w-44 shrink-0 px-3 py-1.5 text-gray-500 bg-gray-50">{k}</div>
    <div className="flex-1 px-3 py-1.5 text-gray-800 font-mono text-[11px] break-all">{v || "—"}</div>
  </div>
);

const UsageBar = ({ used, total }: { used: number; total: number }) => {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={cn("h-full rounded-full", pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-blue-500")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

export default function SystemInfo() {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"cpu" | "board" | "mem" | "gpu" | "storage" | "os">("cpu");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch("/api/system/info")
      .then((r) => r.json())
      .then((d) => { setInfo(d); setErr(""); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const tabs = [
    { id: "cpu" as const, label: "CPU", icon: Cpu },
    { id: "board" as const, label: "Mainboard", icon: CircuitBoard },
    { id: "mem" as const, label: "Memory", icon: MemoryStick },
    { id: "gpu" as const, label: "Graphics", icon: MonitorPlay },
    { id: "storage" as const, label: "Storage", icon: HardDrive },
    { id: "os" as const, label: "OS", icon: AppWindow },
  ];

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden text-xs">
      {/* header */}
      <div className="bg-[#f5f6f7] border-b border-[#d9d9d9] px-3 py-2 flex items-center gap-3 shrink-0">
        <Cpu className="w-5 h-5 text-blue-600" />
        <div className="font-semibold text-gray-800">System Information</div>
        <div className="text-gray-400">|</div>
        <div className="text-gray-500 truncate">{info?.cpu.name || "…"}</div>
        <button onClick={load} className="ml-auto p-1 hover:bg-gray-200 rounded" title="Refresh">
          <RefreshCw className={cn("w-4 h-4 text-gray-600", loading && "animate-spin")} />
        </button>
      </div>

      {/* tabs */}
      <div className="flex border-b border-[#d9d9d9] bg-[#ececec] shrink-0 px-1 pt-1 gap-0.5">
        {tabs.map(({ id, label, icon: I }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-t border-x border-t text-[11px]",
              tab === id
                ? "bg-white border-[#d9d9d9] border-b-white -mb-px font-semibold text-gray-800"
                : "bg-transparent border-transparent text-gray-500 hover:bg-gray-200"
            )}
          >
            <I className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {err && <div className="text-red-600 p-3">{err}</div>}
        {!info && !err && <div className="text-gray-400 italic p-3">Loading system information…</div>}

        {info && tab === "cpu" && (
          <div className="max-w-2xl border border-gray-200 rounded">
            <Row k="Name" v={info.cpu.name} />
            <Row k="Vendor" v={info.cpu.vendor} />
            <Row k="Architecture" v={info.cpu.arch} />
            <Row k="Cores" v={info.cpu.cores} />
            <Row k="Threads" v={info.cpu.threads} />
            <Row k="Max clock" v={info.cpu.maxMhz ? `${info.cpu.maxMhz} MHz` : undefined} />
            <Row k="Current clock" v={info.cpu.curMhz ? `${info.cpu.curMhz} MHz` : undefined} />
            <Row k="Socket" v={info.cpu.socket} />
            <Row k="Stepping" v={info.cpu.stepping} />
            <Row k="Family / Model" v={[info.cpu.family, info.cpu.model].filter(Boolean).join(" / ")} />
            <Row k="Virtualization" v={info.cpu.virt} />
            <Row k="NUMA nodes" v={info.cpu.numa} />
            <Row k="L1 cache" v={info.cpu.cacheL1} />
            <Row k="L2 cache" v={info.cpu.cacheL2} />
            <Row k="L3 cache" v={info.cpu.cacheL3} />
            <Row k="Instructions" v={info.cpu.flags} />
          </div>
        )}

        {info && tab === "board" && (
          <div className="max-w-2xl border border-gray-200 rounded">
            <Row k="Manufacturer" v={info.board.vendor} />
            <Row k="Model" v={info.board.product} />
            <Row k="BIOS version" v={info.board.biosVersion} />
            <Row k="BIOS date" v={info.board.biosDate} />
          </div>
        )}

        {info && tab === "mem" && (
          <div className="space-y-3 max-w-2xl">
            <div className="border border-gray-200 rounded">
              <Row k="Total" v={fmtBytes(info.memory.totalBytes)} />
              {info.memory.availBytes !== undefined && (
                <div className="px-3 py-1.5">
                  <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>In use: {fmtBytes(info.memory.totalBytes - info.memory.availBytes)}</span>
                    <span>Available: {fmtBytes(info.memory.availBytes)}</span>
                  </div>
                  <UsageBar used={info.memory.totalBytes - info.memory.availBytes} total={info.memory.totalBytes} />
                </div>
              )}
              <Row k="Type" v={info.memory.type} />
              <Row k="Channels" v={info.memory.channels} />
              {!!info.memory.swapTotal && (
                <Row k="Swap" v={`${fmtBytes((info.memory.swapTotal ?? 0) - (info.memory.swapFree ?? 0))} used / ${fmtBytes(info.memory.swapTotal ?? 0)}`} />
              )}
            </div>
            {info.memory.slots && info.memory.slots.length > 0 && (
              <div className="border border-gray-200 rounded">
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 font-semibold text-gray-700">Modules (SPD)</div>
                {info.memory.slots.map((s, i) => (
                  <div key={i} className="px-3 py-2 border-b border-gray-100 last:border-0">
                    <div className="font-mono text-[11px] text-gray-800 font-semibold">{s.locator} — {fmtBytes(s.sizeBytes)} {s.type}</div>
                    <div className="text-gray-500 mt-0.5">{[s.speedMts, s.manufacturer, s.partNumber].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {info && tab === "gpu" && (
          <div className="max-w-2xl border border-gray-200 rounded">
            {(!info.gpus || info.gpus.length === 0) && <div className="px-3 py-2 text-gray-400 italic">No GPU detected</div>}
            {info.gpus?.map((g, i) => (
              <div key={i} className="px-3 py-2 border-b border-gray-100 last:border-0">
                <div className="font-mono text-[11px] text-gray-800 font-semibold">{g.name}</div>
                <div className="text-gray-500 mt-0.5">
                  {[g.pciAddr, g.vramMB ? `${g.vramMB} MB VRAM` : "", g.driver && `driver ${g.driver}`, g.clockMhz, g.tempC]
                    .filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}

        {info && tab === "storage" && (
          <div className="max-w-2xl border border-gray-200 rounded">
            {(!info.storage || info.storage.length === 0) && (
              <div className="px-3 py-2 text-gray-400 italic">No mounted filesystems found</div>
            )}
            {info.storage?.map((s, i) => (
              <div key={i} className="px-3 py-2 border-b border-gray-100 last:border-0">
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-[11px] text-gray-800 font-semibold">{s.mount}</span>
                  <span className="text-gray-400 text-[10px]">{s.device}{s.fs ? ` · ${s.fs}` : ""}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <UsageBar used={s.usedBytes} total={s.sizeBytes} />
                  <span className="text-gray-500 whitespace-nowrap">
                    {fmtBytes(s.usedBytes)} / {fmtBytes(s.sizeBytes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {info && tab === "os" && (
          <div className="max-w-2xl border border-gray-200 rounded">
            <Row k="Hostname" v={info.os.hostname} />
            <Row k="Name" v={info.os.name} />
            <Row k="Version" v={info.os.version} />
            <Row k="Kernel" v={info.os.kernel} />
            <Row k="Architecture" v={info.os.arch} />
            <Row k="Uptime" v={info.os.uptime} />
          </div>
        )}
      </div>
    </div>
  );
}
