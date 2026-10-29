import React from "react";
import { X, Palette, Check } from "lucide-react";

export interface TerminalTheme {
  name: string;
  description: string;
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  accent: string;
}

export const TERMINAL_THEMES: Record<string, TerminalTheme> = {
  "Classic Black": {
    name: "Classic Black",
    description: "Standard high-contrast pitch black terminal theme",
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    selectionBackground: "#3e4451",
    accent: "#3b82f6"
  },
  "Dracula": {
    name: "Dracula",
    description: "Dark theme with vibrant purples, pinks, and greens",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    selectionBackground: "#44475a",
    accent: "#bd93f9"
  },
  "Solarized Dark": {
    name: "Solarized Dark",
    description: "Precision colors designed for eye comfort and reduced strain",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    selectionBackground: "#073642",
    accent: "#268bd2"
  },
  "Monokai": {
    name: "Monokai",
    description: "Warm dark theme inspired by the legendary text editor",
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    selectionBackground: "#49483e",
    accent: "#66d9ef"
  },
  "Nord": {
    name: "Nord",
    description: "An arctic, north-bluish clean and elegant color palette",
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    selectionBackground: "#434c5e",
    accent: "#81a1c1"
  },
  "Gruvbox": {
    name: "Gruvbox",
    description: "Retro groove color scheme with warm earthy tones",
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    selectionBackground: "#504945",
    accent: "#458588"
  }
};

interface TerminalThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: string;
  onSelectTheme: (themeName: string) => void;
}

export default function TerminalThemeModal({ isOpen, onClose, currentTheme, onSelectTheme }: TerminalThemeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Terminal Color Themes</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Choose a color palette for your active terminal sessions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Theme Grid */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[65vh] overflow-y-auto">
          {Object.entries(TERMINAL_THEMES).map(([key, theme]) => {
            const isSelected = currentTheme === key;
            return (
              <div
                key={key}
                onClick={() => onSelectTheme(key)}
                className={`relative group cursor-pointer rounded-lg border-2 p-4 transition-all flex flex-col justify-between ${
                  isSelected
                    ? "border-blue-600 bg-blue-50/30 dark:bg-blue-950/20 shadow-md"
                    : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-900"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center shadow">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
                
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm text-gray-900 dark:text-white">{theme.name}</h3>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{theme.description}</p>
                </div>

                {/* Mini Preview Box */}
                <div 
                  className="rounded-md p-3 font-mono text-[11px] shadow-inner border border-gray-700/20"
                  style={{ backgroundColor: theme.background, color: theme.foreground }}
                >
                  <div className="flex items-center gap-1.5 mb-1 opacity-75">
                    <span style={{ color: theme.accent }}>➜</span>
                    <span>user@vy-termweb:~$</span>
                  </div>
                  <div className="text-[10px] opacity-90">
                    <span style={{ color: theme.accent }}>uptime</span>: load average 0.08
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md shadow transition-colors"
          >
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  );
}
