import { Terminal as TerminalIcon, Network, Zap, Star, History, Calculator, FileText, Folder, Cpu } from "lucide-react";
import { motion } from "motion/react";
import { type Session } from "../types";
import { useI18n } from "../lib/i18n";

interface DashboardProps {
  history: Session[];
  onNewSession: () => void;
  onOpenSession: (session: Session) => void;
  onOpenTool: (tool: "calculator" | "editor" | "network-scan" | "file-manager" | "system-info") => void;
  onOpenMacros: () => void;
}

export default function Dashboard({ history, onNewSession, onOpenSession, onOpenTool, onOpenMacros }: DashboardProps) {
  const { t } = useI18n();
  const localShellName = t("dash.localShell");
  const quickActions = [
    { icon: TerminalIcon, label: t("action.newSession"), color: "text-blue-600", onClick: onNewSession },
    { icon: Network, label: t("action.networkScan"), color: "text-green-600", onClick: () => onOpenTool("network-scan") },
    { icon: Zap, label: t("tool.macros"), color: "text-purple-600", onClick: onOpenMacros },
    { icon: FileText, label: t("action.textEditor"), color: "text-orange-600", onClick: () => onOpenTool("editor") },
    { icon: Calculator, label: t("action.calculator"), color: "text-cyan-600", onClick: () => onOpenTool("calculator") },
    { icon: Folder, label: t("action.fileManager"), color: "text-yellow-600", onClick: () => onOpenTool("file-manager") },
    { icon: Cpu, label: t("action.systemInfo"), color: "text-indigo-600", onClick: () => onOpenTool("system-info") },
    {
      icon: Folder,
      label: localShellName,
      color: "text-pink-600",
      onClick: () =>
        onOpenSession({
          id: `local-${Date.now()}`,
          name: localShellName,
          host: "local",
          type: "SSH",
        }),
    },
  ];

  return (
    <div className="flex-1 bg-white p-8 overflow-y-auto selection:bg-blue-100">
      <div className="max-w-5xl mx-auto">
        <div className="mb-12 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-light text-gray-800 mb-2">VY-TermWEB Professional</h1>
            <p className="text-gray-500 italic">{t("dash.subtitle")}</p>
          </div>
          <div className="w-24 h-24 rounded-xl bg-vy-accent flex items-center justify-center shadow-sm">
            <TerminalIcon className="w-12 h-12 text-white" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {/* Quick Start Buttons */}
          <div className="md:col-span-2 grid grid-cols-3 gap-4">
            {quickActions.map((action) => (
              <motion.button
                key={action.label}
                whileHover={{ scale: 1.02, backgroundColor: "#f9fafb" }}
                whileTap={{ scale: 0.98 }}
                onClick={action.onClick}
                className="flex flex-col items-center justify-center p-6 border border-gray-200 rounded-lg transition-colors group"
              >
                <action.icon className={`w-8 h-8 ${action.color} mb-3 group-hover:scale-110 transition-transform`} />
                <span className="text-sm font-medium text-gray-700">{action.label}</span>
              </motion.button>
            ))}
          </div>

          {/* Tips Section */}
          <div className="p-6 bg-blue-50 border border-blue-100 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-4 flex items-center gap-2">
              <Star className="w-4 h-4 fill-blue-400 stroke-blue-400" />
              {t("dash.proTips")}
            </h3>
            <ul className="space-y-3 text-sm text-blue-800">
              <li className="flex gap-2">
                <span className="text-blue-400 font-bold">•</span>
                {t("dash.tip1")}
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 font-bold">•</span>
                {t("dash.tip2")}
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 font-bold">•</span>
                {t("dash.tip3")}
              </li>
            </ul>
          </div>
        </div>

        {/* Recent Sessions */}
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-gray-400" />
            {t("dash.recentSessions")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {history.length > 0 ? (
              history.map((session) => (
                <div
                  key={session.id}
                  onClick={() => onOpenSession(session)}
                  className="flex items-center gap-3 p-4 border border-gray-100 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                    <TerminalIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-800">{session.name}</div>
                    <div className="text-xs text-gray-400">
                      {session.type} - {session.host}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-8 text-center border border-dashed border-gray-200 rounded-lg text-gray-400 italic">
                {t("dash.noRecent")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
