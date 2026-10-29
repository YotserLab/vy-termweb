import React, { useState, useEffect } from 'react';
import { X, Play, Plus, Trash2, Edit2, Zap, Clock, Terminal, Check, Square, Circle, Sparkles, HelpCircle, BookOpen } from 'lucide-react';
import { type Macro, type MacroCommand } from '../types';

/** Starter templates — picking one opens the editor pre-filled (nothing is
 * saved until the user clicks Save Macro). */
const EXAMPLE_MACROS: Omit<Macro, 'id' | 'createdAt'>[] = [
  {
    name: 'System Overview',
    description: 'Quick health check: kernel, uptime, disk and RAM',
    shortcut: 'F5',
    commands: [
      { id: 'c1', type: 'command', value: 'uname -a\n' },
      { id: 'c2', type: 'command', value: 'uptime\n' },
      { id: 'c3', type: 'command', value: 'df -h /\n' },
      { id: 'c4', type: 'command', value: 'free -h\n' },
    ],
  },
  {
    name: 'Tail Syslog',
    description: 'Follow the system log (Ctrl+C to stop)',
    shortcut: 'F6',
    commands: [{ id: 'c1', type: 'command', value: 'tail -f /var/log/syslog\n' }],
  },
  {
    name: 'Docker Status',
    description: 'List containers, pause, then show live resource usage',
    shortcut: 'F7',
    commands: [
      { id: 'c1', type: 'command', value: 'docker ps\n' },
      { id: 'c2', type: 'delay', value: '800' },
      { id: 'c3', type: 'command', value: 'docker stats --no-stream\n' },
    ],
  },
  {
    name: 'Git Pull',
    description: 'Show status and fast-forward pull in the current repo',
    commands: [
      { id: 'c1', type: 'command', value: 'git status -sb\n' },
      { id: 'c2', type: 'command', value: 'git pull --ff-only\n' },
    ],
  },
  {
    name: 'Network Check',
    description: 'Ping a public DNS and show the route it takes',
    commands: [
      { id: 'c1', type: 'command', value: 'ping -c 3 8.8.8.8\n' },
      { id: 'c2', type: 'command', value: 'ip route get 1.1.1.1\n' },
    ],
  },
  {
    name: 'Disk Hogs',
    description: 'Find the biggest directories under your home',
    commands: [
      { id: 'c1', type: 'command', value: 'du -sh ~/* 2>/dev/null | sort -h | tail -15\n' },
    ],
  },
];

interface MacroManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  macros: Macro[];
  onSaveMacro: (macro: Macro) => void;
  onDeleteMacro: (id: string) => void;
  onRunMacro: (macro: Macro) => void;
}

export default function MacroManagerModal({
  isOpen,
  onClose,
  macros,
  onSaveMacro,
  onDeleteMacro,
  onRunMacro,
}: MacroManagerModalProps) {
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Live recorder: captures real commands typed in the active terminal
  useEffect(() => {
    if (!isRecording) return;
    const handler = (e: Event) => {
      const { command } = (e as CustomEvent).detail || {};
      if (!command) return;
      setEditingMacro((prev) =>
        prev
          ? {
              ...prev,
              commands: [
                ...prev.commands,
                { id: `cmd-${Date.now()}-${prev.commands.length}`, type: 'command', value: command + '\n' },
              ],
            }
          : prev
      );
    };
    window.addEventListener('vy-termweb:record-command', handler);
    return () => window.removeEventListener('vy-termweb:record-command', handler);
  }, [isRecording]);

  // While recording, show a floating badge even when the manager is closed —
  // commands typed in the active terminal are captured into the editing macro.
  if (!isOpen) {
    if (!isRecording) return null;
    return (
      <div className="fixed bottom-4 right-4 z-[60] bg-red-600 text-white px-3 py-2 rounded shadow-lg flex items-center gap-2 text-xs font-bold animate-pulse select-none">
        <Circle className="w-3 h-3 fill-white" />
        Recording macro… type in the terminal
        <button
          onClick={() => setIsRecording(false)}
          className="ml-1 bg-white/20 hover:bg-white/40 px-2 py-0.5 rounded text-[10px]"
        >
          STOP
        </button>
      </div>
    );
  }

  const handleStartCreate = () => {
    setEditingMacro({
      id: `macro-${Date.now()}`,
      name: 'New Automation Macro',
      description: '',
      shortcut: 'F2',
      commands: [
        { id: `cmd-${Date.now()}-1`, type: 'command', value: 'echo "Running macro..."\n' }
      ],
      createdAt: Date.now()
    });
    setIsCreating(true);
    setIsRecording(false);
  };

  const handleStartEdit = (macro: Macro) => {
    setEditingMacro(JSON.parse(JSON.stringify(macro)));
    setIsCreating(false);
    setIsRecording(false);
  };

  const handlePickExample = (ex: Omit<Macro, 'id' | 'createdAt'>) => {
    const ts = Date.now();
    setEditingMacro({
      ...ex,
      id: `macro-${ts}`,
      createdAt: ts,
      commands: ex.commands.map((c, i) => ({ ...c, id: `cmd-${ts}-${i}` })),
    });
    setIsCreating(true);
    setIsRecording(false);
    setShowHelp(false);
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    onClose(); // close so the user can type in the terminal; badge stays visible
    if (!editingMacro) {
      setEditingMacro({
        id: `macro-${Date.now()}`,
        name: 'Recorded Macro ' + new Date().toLocaleTimeString(),
        description: 'Captured via live macro recorder',
        shortcut: 'F3',
        commands: [],
        createdAt: Date.now()
      });
    }
  };

  const handleAddCommandStep = () => {
    if (!editingMacro) return;
    setEditingMacro({
      ...editingMacro,
      commands: [
        ...editingMacro.commands,
        { id: `cmd-${Date.now()}`, type: 'command', value: 'ls -la\n' }
      ]
    });
  };

  const handleAddDelayStep = () => {
    if (!editingMacro) return;
    setEditingMacro({
      ...editingMacro,
      commands: [
        ...editingMacro.commands,
        { id: `cmd-${Date.now()}`, type: 'delay', value: '1000' }
      ]
    });
  };

  const handleUpdateStep = (id: string, field: 'type' | 'value', val: string) => {
    if (!editingMacro) return;
    setEditingMacro({
      ...editingMacro,
      commands: editingMacro.commands.map(cmd => 
        cmd.id === id ? { ...cmd, [field]: val } : cmd
      )
    });
  };

  const handleDeleteStep = (id: string) => {
    if (!editingMacro) return;
    setEditingMacro({
      ...editingMacro,
      commands: editingMacro.commands.filter(cmd => cmd.id !== id)
    });
  };

  const handleSave = () => {
    if (!editingMacro || !editingMacro.name.trim()) return;
    onSaveMacro(editingMacro);
    setEditingMacro(null);
    setIsCreating(false);
    setIsRecording(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-white border border-gray-300 shadow-2xl w-full max-w-3xl rounded-md overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 font-sans">
        
        {/* Header */}
        <div className="bg-vy-nav border-b border-gray-300 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded text-white shadow-xs">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-800">Terminal Macro Manager</h2>
              <p className="text-[10px] text-gray-500">Automate repetitive keystrokes, commands, and workflow sequences</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHelp((v) => !v)}
              className={`p-1 rounded transition-colors ${showHelp ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-gray-500'}`}
              title="Examples & help"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-red-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left: Macro List */}
          <div className="w-1/3 border-r border-gray-200 bg-gray-50 flex flex-col">
            <div className="p-3 border-b border-gray-200 flex items-center justify-between bg-white">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Saved Macros ({macros.length})</span>
              <button 
                onClick={handleStartCreate}
                className="bg-blue-600 text-white px-2.5 py-1 rounded-sm text-xs font-bold hover:bg-blue-700 flex items-center gap-1 shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-200">
              {macros.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs italic">
                  No macros created yet. Click "New", record one, or pick an example on the right.
                </div>
              ) : (
                macros.map(macro => (
                  <div 
                    key={macro.id}
                    onClick={() => handleStartEdit(macro)}
                    className={`p-3 cursor-pointer transition-colors flex items-start justify-between group ${editingMacro?.id === macro.id ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-gray-100'}`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-800 truncate">{macro.name}</span>
                        {macro.shortcut && (
                          <span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold">
                            {macro.shortcut}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">{macro.description || `${macro.commands.length} steps`}</p>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button 
                        onClick={(e) => { e.stopPropagation(); onRunMacro(macro); }}
                        className="p-1 hover:bg-green-100 text-green-600 rounded"
                        title="Run Macro"
                      >
                        <Play className="w-3.5 h-3.5 fill-green-600" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteMacro(macro.id); }}
                        className="p-1 hover:bg-red-100 text-red-600 rounded"
                        title="Delete Macro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Macro Editor / Recorder / Help */}
          <div className="flex-1 flex flex-col bg-white overflow-y-auto p-4">
            {editingMacro && !showHelp ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    {isCreating ? 'Create New Macro' : 'Edit Macro'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleStartRecording}
                      className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1.5 transition-colors ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                    >
                      <Circle className={`w-3 h-3 ${isRecording ? 'fill-white' : 'fill-red-500 text-red-500'}`} />
                      {isRecording ? 'Recording Keystrokes...' : 'Live Recorder'}
                    </button>
                    <button 
                      onClick={() => onRunMacro(editingMacro)}
                      className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-xs"
                    >
                      <Play className="w-3 h-3 fill-white" /> Test Run
                    </button>
                  </div>
                </div>

                {isRecording && (
                  <div className="bg-red-50 border border-red-200 p-3 rounded text-xs text-red-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping"></span>
                      <span>Recording mode active. Type commands in any active terminal session to capture commands automatically, or add steps manually below.</span>
                    </div>
                    <button 
                      onClick={() => setIsRecording(false)} 
                      className="bg-red-600 text-white px-2 py-0.5 rounded text-[10px] font-bold"
                    >
                      Stop Recording
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">Macro Name</label>
                    <input 
                      type="text"
                      value={editingMacro.name}
                      onChange={(e) => setEditingMacro({ ...editingMacro, name: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs outline-none focus:border-blue-600"
                      placeholder="e.g. Docker Status & Logs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">Trigger Shortcut</label>
                    <select
                      value={editingMacro.shortcut || 'F2'}
                      onChange={(e) => setEditingMacro({ ...editingMacro, shortcut: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs outline-none focus:border-blue-600 bg-white font-mono"
                    >
                      <option value="F2">F2</option>
                      <option value="F3">F3</option>
                      <option value="F4">F4</option>
                      <option value="F5">F5</option>
                      <option value="F6">F6</option>
                      <option value="F7">F7</option>
                      <option value="F8">F8</option>
                      <option value="F9">F9</option>
                      <option value="F10">F10</option>
                      <option value="Ctrl+M">Ctrl + M</option>
                      <option value="Ctrl+Shift+M">Ctrl + Shift + M</option>
                      <option value="Ctrl+Alt+1">Ctrl + Alt + 1</option>
                      <option value="Ctrl+Alt+2">Ctrl + Alt + 2</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Description</label>
                  <input 
                    type="text"
                    value={editingMacro.description || ''}
                    onChange={(e) => setEditingMacro({ ...editingMacro, description: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs outline-none focus:border-blue-600"
                    placeholder="Brief description of what this automation does..."
                  />
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wide">Execution Steps / Commands</label>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={handleAddCommandStep}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 border border-gray-300"
                      >
                        <Plus className="w-3 h-3 text-blue-600" /> Add Command
                      </button>
                      <button 
                        onClick={handleAddDelayStep}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 border border-gray-300"
                      >
                        <Clock className="w-3 h-3 text-orange-500" /> Add Delay
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {editingMacro.commands.length === 0 ? (
                      <div className="p-8 text-center text-gray-400 text-xs border border-dashed border-gray-300 rounded bg-gray-50">
                        No commands added yet. Use "Add Command" or "Add Delay".
                      </div>
                    ) : (
                      editingMacro.commands.map((cmd, idx) => (
                        <div key={cmd.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 p-2 rounded">
                          <span className="w-6 text-center text-xs font-mono font-bold text-gray-400">#{idx + 1}</span>
                          <select
                            value={cmd.type}
                            onChange={(e) => handleUpdateStep(cmd.id, 'type', e.target.value as any)}
                            className="w-28 border border-gray-300 rounded px-2 py-1 text-xs bg-white font-mono font-bold"
                          >
                            <option value="command">Command</option>
                            <option value="delay">Delay (ms)</option>
                          </select>
                          <input 
                            type={cmd.type === 'delay' ? 'number' : 'text'}
                            value={cmd.value}
                            onChange={(e) => handleUpdateStep(cmd.id, 'value', e.target.value)}
                            className="flex-1 border border-gray-300 rounded px-2.5 py-1 text-xs font-mono bg-white outline-none focus:border-blue-600"
                            placeholder={cmd.type === 'delay' ? '1000' : 'command (e.g. npm start\n)'}
                          />
                          <button 
                            onClick={() => handleDeleteStep(cmd.id)}
                            className="p-1.5 hover:bg-red-100 text-red-500 rounded"
                            title="Remove Step"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t">
                  <button 
                    onClick={() => setEditingMacro(null)}
                    className="px-4 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSave}
                    className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-sm"
                  >
                    Save Macro
                  </button>
                </div>

              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-700">
                    <BookOpen className="w-4 h-4 text-blue-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wide">Getting started</h3>
                  </div>
                  <button
                    onClick={handleStartCreate}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> New Macro
                  </button>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Start from an example</div>
                  <div className="grid grid-cols-2 gap-2">
                    {EXAMPLE_MACROS.map((ex) => (
                      <button
                        key={ex.name}
                        onClick={() => handlePickExample(ex)}
                        className="text-left border border-gray-200 rounded p-2.5 hover:border-blue-400 hover:shadow-sm transition-all group bg-gray-50 hover:bg-blue-50/40"
                      >
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3 h-3 text-blue-600 shrink-0" />
                          <span className="text-xs font-bold text-gray-800 truncate">{ex.name}</span>
                          {ex.shortcut && (
                            <span className="ml-auto bg-gray-200 text-gray-600 px-1 py-0.5 rounded text-[9px] font-mono font-bold shrink-0">
                              {ex.shortcut}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-snug">{ex.description}</p>
                        <p className="text-[9px] text-gray-400 mt-1 font-mono truncate">
                          {ex.commands.filter((c) => c.type === 'command').map((c) => c.value.trim()).join(' ; ')}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 rounded divide-y divide-gray-100 text-[11px] text-gray-600">
                  <div className="px-3 py-2 bg-gray-50 font-bold text-gray-700 uppercase tracking-wide text-[10px]">
                    How macros work
                  </div>
                  <div className="px-3 py-2"><b className="text-gray-800">Command</b> steps send raw keystrokes to the active terminal — end with <code className="bg-gray-100 px-1 rounded">\n</code> to press Enter. Special keys work too: <code className="bg-gray-100 px-1 rounded">\t</code> = Tab, <code className="bg-gray-100 px-1 rounded">\u0003</code> = Ctrl+C.</div>
                  <div className="px-3 py-2"><b className="text-gray-800">Delay</b> steps wait N milliseconds — useful to give a prompt (sudo password, pager) time to appear.</div>
                  <div className="px-3 py-2"><b className="text-gray-800">Trigger keys</b> run the macro in whichever terminal tab is active. Pick one per macro.</div>
                  <div className="px-3 py-2"><b className="text-gray-800">Live Recorder</b> captures commands as you type them in a real terminal — record once, replay forever.</div>
                  <div className="px-3 py-2"><b className="text-gray-800">Startup snippet</b>: assign a macro to a session (Session settings → Startup) and it runs automatically right after connect — e.g. <code className="bg-gray-100 px-1 rounded">cd /var/log &amp;&amp; tail -f app.log</code>.</div>
                  <div className="px-3 py-2"><b className="text-gray-800">Multi-Execution</b>: with Multi-Exec on, replayed macros hit every terminal at once.</div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="bg-gray-100 border-t border-gray-300 px-4 py-2.5 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-700">Tip:</span> Press assigned trigger keys (e.g. <span className="font-mono bg-white px-1.5 py-0.5 border rounded">F2</span>) in any active terminal to execute macros instantly.
          </div>
          <button 
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-1 rounded text-xs font-bold"
          >
            Close Manager
          </button>
        </div>

      </div>
    </div>
  );
}
