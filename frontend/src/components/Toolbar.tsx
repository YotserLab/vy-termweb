import { Terminal, SquareTerminal, Monitor, FileText, Save, Scissors, Copy, Clipboard, Search, List, Cpu, Network, RefreshCw, Zap, Folder, Check, Globe } from "lucide-react";
import React, { useState } from "react";
import { cn } from "../lib/utils";
import { LANGS, useI18n, type Lang } from "../lib/i18n";

interface ToolbarProps {
  onNewSession: () => void;
  onQuickConnect: (host: string) => void;
  onAction: (item: string) => void;
}

export default function Toolbar({ onNewSession, onQuickConnect, onAction }: ToolbarProps) {
  const [quickConnectHost, setQuickConnectHost] = useState("");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const { t, lang, setLang } = useI18n();

  // Action ids stay English — they're the contract with handleMenuAction.
  const a = (id: string, key: string) => ({ id, label: t(key) });
  const menuItems = [
    { label: t("menu.file"), items: [a("New Session", "action.newSession"), a("Import", "action.import"), a("Export", "action.export"), a("Exit", "action.exit")] },
    {
      label: t("menu.view"),
      items: [
        a("Split Vertically", "action.splitVertically"),
        a("Split Horizontally", "action.splitHorizontally"),
        a("Close Split", "action.closeSplit"),
        a("Multi-Execution Mode", "action.multiExec"),
        a("Fullscreen", "action.fullscreen"),
        a("Toggle Sidebar", "action.toggleSidebar"),
      ],
    },
    {
      label: t("menu.tools"),
      items: [
        a("Network Scan", "action.networkScan"),
        a("Text Editor", "action.textEditor"),
        a("File Manager", "action.fileManager"),
        a("Calculator", "action.calculator"),
        a("System Info", "action.systemInfo"),
        a("Macro Manager", "action.macroManager"),
      ],
    },
    { label: t("menu.edit"), items: [a("Copy", "action.copy"), a("Cut", "action.cut"), a("Paste", "action.paste"), a("Reconnect", "action.reconnect")] },
    {
      label: t("menu.settings"),
      items: [
        a("Terminal Style", "action.terminalStyle"),
        a("Session Groups", "action.sessionGroups"),
        a("Global Settings", "action.globalSettings"),
        a("Master Password", "action.masterPassword"),
        a("Lock Vault", "action.lockVault"),
      ],
    },
    { label: t("menu.language"), items: LANGS.map((l) => ({ id: `lang:${l}`, label: t(`lang.${l}`) })) },
    { label: t("menu.help"), items: [a("About VY-TermWEB", "action.about")] },
  ];

  const toolButtons = [
    { icon: Terminal, label: t("tool.session"), color: "bg-blue-600", onClick: onNewSession },
    { icon: SquareTerminal, label: t("dash.localShell"), color: "bg-teal-600", onClick: () => onAction("Local Shell") },
    { icon: Network, label: t("tool.netScan"), color: "bg-green-600", onClick: () => onAction("Network Scan") },
    { icon: FileText, label: t("tool.editor"), color: "bg-orange-500", onClick: () => onAction("Text Editor") },
    { icon: Folder, label: t("tool.files"), color: "bg-yellow-500", onClick: () => onAction("File Manager") },
    { icon: Zap, label: t("tool.macros"), color: "bg-purple-600", onClick: () => onAction("Macro Manager") },
    { icon: Monitor, label: t("tool.split"), color: "bg-gray-500", spacer: true, onClick: () => onAction("Split Vertically") },
    { icon: List, label: t("tool.multiExec"), color: "bg-red-500", onClick: () => onAction("MultiExec") },
  ];

  const handleQuickConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickConnectHost.trim()) {
      onQuickConnect(quickConnectHost.trim());
      setQuickConnectHost("");
    }
  };

  return (
    <div className="flex flex-col select-none shrink-0 relative">
      {/* Top Menu Nav */}
      <nav className="bg-vy-nav border-b border-vy-border flex items-center px-2 py-0.5 space-x-4 text-[11px] relative">
        <div className="flex space-x-3">
          {menuItems.map((menu) => (
            <div key={menu.label} className="relative group">
              <button
                onClick={() => setActiveMenu(activeMenu === menu.label ? null : menu.label)}
                className={cn(
                  "px-1.5 py-0.5 hover:bg-[#bbb] transition-colors rounded-sm outline-none",
                  activeMenu === menu.label && "bg-[#bbb]"
                )}
              >
                {menu.label === t("menu.language") && <Globe className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                {menu.label}
              </button>

              {activeMenu === menu.label && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                  <div className="absolute top-full left-0 w-48 bg-white border border-gray-300 shadow-lg py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                    {menu.items.map((item) => {
                      const isLang = item.id.startsWith("lang:");
                      const active = isLang && item.id === `lang:${lang}`;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (isLang) setLang(item.id.slice(5) as Lang);
                            else onAction(item.id);
                            setActiveMenu(null);
                          }}
                          className="w-full text-left px-4 py-1 hover:bg-vy-accent hover:text-white transition-colors text-[11px] flex items-center gap-1.5"
                        >
                          {isLang && <Check className={cn("w-3 h-3", !active && "invisible")} />}
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* Main Toolbar with Buttons */}
      <div className="bg-vy-toolbar border-b border-vy-border flex items-center p-1 space-x-1">
        {toolButtons.map((tool) => (
          <div key={tool.label} className="flex items-center">
            <button
              onClick={tool.onClick}
              className="flex flex-col items-center justify-center w-14 h-14 hover:bg-[#e0e0e0] border border-transparent hover:border-[#aaa] rounded transition-all cursor-default group"
            >
              <div className={cn("inline-flex items-center justify-center w-6 h-6 rounded-sm mb-1 text-white shadow-sm", tool.color)}>
                <tool.icon className="w-3.5 h-3.5" />
              </div>
              <span className="text-[10px] text-gray-700 font-medium">{tool.label}</span>
            </button>
            {tool.spacer && <div className="w-[1px] h-10 bg-[#ccc] mx-2" />}
          </div>
        ))}

        <div className="flex-grow" />

        <form
          onSubmit={handleQuickConnect}
          className="flex items-center bg-white border border-[#ccc] px-2 py-1 rounded w-64 shadow-inner mr-2 h-7 focus-within:ring-1 focus-within:ring-vy-accent"
        >
          <Search className="w-3 h-3 text-gray-400 mr-2" />
          <input
            type="text"
            placeholder={t("toolbar.quickConnect")}
            value={quickConnectHost}
            onChange={(e) => setQuickConnectHost(e.target.value)}
            className="bg-transparent outline-none text-[11px] w-full placeholder:italic"
          />
        </form>
      </div>

      {/* Action Bar (clipboard / session actions) */}
      <div className="flex items-center px-2 py-0.5 bg-[#f9f9f9] border-b border-vy-border gap-1 h-6">
        <button onClick={() => onAction("Export")} className="p-1 hover:bg-white rounded transition-colors" title={t("toolbar.exportSessions")}>
          <Save className="w-3 h-3 text-gray-600" />
        </button>
        <div className="w-px h-3 bg-gray-300 mx-1" />
        <button onClick={() => onAction("Cut")} className="p-1 hover:bg-white rounded transition-colors" title={t("toolbar.cutSelection")}>
          <Scissors className="w-3 h-3 text-gray-600" />
        </button>
        <button onClick={() => onAction("Copy")} className="p-1 hover:bg-white rounded transition-colors" title={t("toolbar.copySelection")}>
          <Copy className="w-3 h-3 text-gray-600" />
        </button>
        <button onClick={() => onAction("Paste")} className="p-1 hover:bg-white rounded transition-colors" title={t("toolbar.pasteTerminal")}>
          <Clipboard className="w-3 h-3 text-gray-600" />
        </button>
        <div className="w-px h-3 bg-gray-300 mx-1" />
        <button
          onClick={() => onAction("Reconnect")}
          className="flex items-center gap-1.5 hover:bg-white hover:text-vy-accent cursor-pointer transition-colors px-2 py-0.5 rounded text-[10px] text-gray-500 font-medium"
          title={t("toolbar.reconnectTitle")}
        >
          <RefreshCw className="w-3 h-3 text-blue-500" />
          <span>{t("action.reconnect")}</span>
        </button>
      </div>
    </div>
  );
}
