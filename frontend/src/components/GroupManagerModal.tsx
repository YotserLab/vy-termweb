import { useState } from "react";
import { X, Folder, Plus, Trash2 } from "lucide-react";
import { type SessionGroup } from "../types";

interface GroupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  groups: SessionGroup[];
  onSaveGroups: (groups: SessionGroup[]) => void;
}

const COLORS = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#06b6d4", "#64748b"];

export default function GroupManagerModal({ isOpen, onClose, groups, onSaveGroups }: GroupManagerModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);

  if (!isOpen) return null;

  const addGroup = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveGroups([
      ...groups,
      { id: `grp-${Date.now()}`, name: trimmed, color, defaults: {} },
    ]);
    setName("");
  };

  const updateDefaults = (id: string, patch: Partial<NonNullable<SessionGroup["defaults"]>>) =>
    onSaveGroups(
      groups.map((g) => (g.id === id ? { ...g, defaults: { ...g.defaults, ...patch } } : g))
    );

  const removeGroup = (id: string) => onSaveGroups(groups.filter((g) => g.id !== id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-vy-bg border border-vy-border shadow-2xl w-full max-w-md flex flex-col rounded-sm overflow-hidden select-none animate-in fade-in zoom-in duration-200">
        <div className="bg-vy-nav border-b border-vy-border px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-gray-700">Session Groups</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 bg-white/30 max-h-[420px] overflow-y-auto">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
              placeholder="New group name…"
              className="flex-1 bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
            />
            <div className="flex items-center gap-0.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-4 h-4 rounded-sm border border-black/10"
                  style={{ backgroundColor: c, outline: color === c ? "2px solid #333" : "none" }}
                />
              ))}
            </div>
            <button
              onClick={addGroup}
              className="flex items-center gap-1 bg-green-600 text-white rounded px-2 h-8 text-[10px] font-bold shadow-sm hover:brightness-110"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>

          {groups.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic text-center py-6">
              No groups yet. Groups organize the session list and can set default
              user/port/auth for their sessions.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="bg-white border border-[#ccc] rounded-sm p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: g.color || "#64748b" }} />
                  <span className="text-xs font-bold text-gray-700 flex-1">{g.name}</span>
                  <button onClick={() => removeGroup(g.id)} className="text-gray-400 hover:text-red-500" title="Delete group">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={g.defaults?.user || ""}
                    onChange={(e) => updateDefaults(g.id, { user: e.target.value })}
                    placeholder="default user"
                    className="bg-gray-50 border border-[#ddd] rounded px-1.5 h-6 text-[10px] outline-none"
                  />
                  <input
                    type="number"
                    value={g.defaults?.port || ""}
                    onChange={(e) => updateDefaults(g.id, { port: parseInt(e.target.value) || undefined })}
                    placeholder="port"
                    className="bg-gray-50 border border-[#ddd] rounded px-1.5 h-6 text-[10px] outline-none"
                  />
                  <select
                    value={g.defaults?.authType || ""}
                    onChange={(e) => updateDefaults(g.id, { authType: (e.target.value || undefined) as "password" | "key" | undefined })}
                    className="bg-gray-50 border border-[#ddd] rounded px-1 h-6 text-[10px] outline-none"
                  >
                    <option value="">auth —</option>
                    <option value="password">password</option>
                    <option value="key">key</option>
                  </select>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="bg-gray-100 border-t border-[#ccc] p-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-1.5 bg-vy-accent text-white rounded-sm text-xs font-bold shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
