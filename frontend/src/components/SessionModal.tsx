import { X, Shield, Key, Lock, Terminal, Globe, Server, User, Hash, Plus, Trash2, ArrowRight, FileKey, History, Search, Zap, Folder } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { type Session, type SSHTunnel, type SSHKey, type Macro, type SessionGroup } from "../types";
import { isEncryptedField } from "../lib/vault";
import { cn } from "../lib/utils";

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (session: Session) => void;
  session?: Session | null;
  sshKeys: SSHKey[];
  onSaveKeys: (keys: SSHKey[]) => void;
  macros: Macro[];
  sessions: Session[];
  groups: SessionGroup[];
}

const envToText = (env?: Record<string, string>) =>
  env ? Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") : "";

const textToEnv = (text: string): Record<string, string> | undefined => {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(env).length ? env : undefined;
};

export default function SessionModal({ isOpen, onClose, onSave, session, sshKeys, onSaveKeys, macros, sessions, groups }: SessionModalProps) {
  const [formData, setFormData] = useState<Partial<Session>>({
    name: "",
    host: "",
    port: 22,
    user: "root",
    password: "",
    authType: "password",
    privateKeyPath: "",
    privateKeyId: "",
    tunnels: [],
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [envText, setEnvText] = useState("");

  const [newTunnel, setNewTunnel] = useState<Partial<SSHTunnel>>({
    localPort: 8080,
    remoteHost: "localhost",
    remotePort: 80,
    type: "local"
  });

  const [activeTab, setActiveInternalTab] = useState<"basic" | "tunnels" | "keys">("basic");

  useEffect(() => {
    if (session) {
      setFormData(session);
      setEnvText(envToText(session.env));
    } else {
      setFormData({
        name: "",
        host: "",
        port: 22,
        user: "root",
        password: "",
        authType: "password",
        privateKeyPath: "",
        privateKeyId: "",
        type: "SSH",
        tunnels: [],
      });
      setEnvText("");
    }
  }, [session, isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      env: textToEnv(envText),
      id: session?.id || `session-${Date.now()}`,
      type: formData.type || "SSH",
    } as Session);
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newKey: SSHKey = {
        id: `key-${Date.now()}`,
        name: file.name,
        content: content,
        type: "RSA", // Default to RSA, simplified
        createdAt: Date.now(),
      };
      onSaveKeys([...sshKeys, newKey]);
    };
    reader.readAsText(file);
    e.target.value = ""; // Clear for next selection
  };

  const removeKey = (id: string) => {
    onSaveKeys(sshKeys.filter(k => k.id !== id));
    if (formData.privateKeyId === id) {
      setFormData({ ...formData, privateKeyId: "" });
    }
  };

  const addTunnel = () => {
    const isDynamic = newTunnel.type === "dynamic";
    if (!newTunnel.localPort || (!isDynamic && (!newTunnel.remoteHost || !newTunnel.remotePort))) return;

    const tunnel: SSHTunnel = {
      id: `tunnel-${Date.now()}`,
      localPort: newTunnel.localPort,
      remoteHost: isDynamic ? "" : newTunnel.remoteHost || "",
      remotePort: isDynamic ? 0 : newTunnel.remotePort || 0,
      type: newTunnel.type as any || "local"
    };

    setFormData(prev => ({
      ...prev,
      tunnels: [...(prev.tunnels || []), tunnel]
    }));

    setNewTunnel({
      localPort: 8080,
      remoteHost: "localhost",
      remotePort: 80,
      type: "local"
    });
  };

  const removeTunnel = (id: string) => {
    setFormData(prev => ({
      ...prev,
      tunnels: prev.tunnels?.filter(t => t.id !== id) || []
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-vy-bg border border-vy-border shadow-2xl w-full max-w-xl flex flex-col rounded-sm overflow-hidden select-none animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-vy-nav border-b border-vy-border px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1 rounded-sm">
               <Terminal className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-700">SSH Session Settings</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs style navigation */}
        <div className="bg-vy-toolbar border-b border-vy-border flex text-[11px] font-medium text-gray-600">
           <div 
             onClick={() => setActiveInternalTab("basic")}
             className={cn(
               "px-4 py-1.5 border-r border-vy-border cursor-pointer transition-colors",
               activeTab === "basic" ? "bg-white border-b border-b-white -mb-px relative z-10" : "hover:bg-white/50"
             )}
           >
             Basic SSH settings
           </div>
           <div 
             onClick={() => setActiveInternalTab("keys")}
             className={cn(
               "px-4 py-1.5 border-r border-vy-border cursor-pointer transition-colors",
               activeTab === "keys" ? "bg-white border-b border-b-white -mb-px relative z-10" : "hover:bg-white/50"
             )}
           >
             <div className="flex items-center gap-1.5">
               <FileKey className="w-3 h-3 text-blue-500" />
               SSH Keys Management
             </div>
           </div>
           <div 
             onClick={() => setActiveInternalTab("tunnels")}
             className={cn(
               "px-4 py-1.5 border-r border-vy-border cursor-pointer transition-colors",
               activeTab === "tunnels" ? "bg-white border-b border-b-white -mb-px relative z-10" : "hover:bg-white/50"
             )}
           >
             SSH Tunnels
           </div>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-4 bg-white/30 min-h-[400px]">
          {activeTab === "basic" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-tight">Session Type</label>
                  <select 
                    value={formData.type || "SSH"}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                  >
                    <option value="SSH">SSH Session</option>
                    <option value="SFTP">SFTP Session</option>
                    <option value="Shell">Local Shell</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-tight">Session Name</label>
                  <div className="flex items-center border border-[#ccc] bg-white rounded px-2 focus-within:ring-1 focus-within:ring-vy-accent transition-all h-8">
                    <Globe className="w-3.5 h-3.5 text-gray-400 mr-2" />
                    <input 
                      type="text" 
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Production Main" 
                      className="bg-transparent border-none outline-none text-xs w-full"
                      required
                    />
                  </div>
                </div>

                {formData.type !== "Shell" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-600 uppercase tracking-tight">Remote Host</label>
                      <div className="flex items-center border border-[#ccc] bg-white rounded px-2 focus-within:ring-1 focus-within:ring-vy-accent h-8">
                        <Server className="w-3.5 h-3.5 text-gray-400 mr-2" />
                        <input
                          type="text"
                          value={formData.host}
                          onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                          placeholder="192.168.1.100"
                          className="bg-transparent border-none outline-none text-xs w-full"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-600 uppercase tracking-tight">Port</label>
                      <div className="flex items-center border border-[#ccc] bg-white rounded px-2 focus-within:ring-1 focus-within:ring-vy-accent h-8">
                        <Hash className="w-3.5 h-3.5 text-gray-400 mr-2" />
                        <input
                          type="number"
                          value={formData.port}
                          onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                          className="bg-transparent border-none outline-none text-xs w-full"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 col-span-2">
                      <label className="text-[11px] font-bold text-gray-600 uppercase tracking-tight">Username</label>
                      <div className="flex items-center border border-[#ccc] bg-white rounded px-2 focus-within:ring-1 focus-within:ring-vy-accent h-8">
                        <User className="w-3.5 h-3.5 text-gray-400 mr-2" />
                        <input
                          type="text"
                          value={formData.user}
                          onChange={(e) => setFormData({ ...formData, user: e.target.value })}
                          placeholder="root"
                          className="bg-transparent border-none outline-none text-xs w-full"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {formData.type === "Shell" && (
                <div className="bg-blue-50 border border-blue-100 p-3 rounded text-[11px] text-blue-800">
                  A Local Shell session opens a real PTY on the machine running VY-TermWEB (bash). No credentials needed.
                </div>
              )}

              {formData.type !== "Shell" && (
              <div className="bg-[#f5f5f5] border border-[#ccc] p-3 space-y-3 rounded-sm">
                <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-[11px] font-bold text-gray-700 uppercase tracking-tight">Security & Authentication</span>
                </div>

                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                          type="radio" 
                          name="authType" 
                          checked={formData.authType === "password"}
                          onChange={() => setFormData({ ...formData, authType: "password" })}
                          className="accent-vy-accent"
                      />
                      <span className="text-[11px] text-gray-700 flex items-center gap-1"><Lock className="w-3 h-3" /> Password</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                          type="radio" 
                          name="authType" 
                          checked={formData.authType === "key"}
                          onChange={() => setFormData({ ...formData, authType: "key" })}
                          className="accent-vy-accent"
                      />
                      <span className="text-[11px] text-gray-700 flex items-center gap-1"><Key className="w-3 h-3" /> Private Key</span>
                    </label>
                </div>

                {formData.authType === "password" && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-1 fade-in duration-200">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Password</label>
                        <div className="flex items-center border border-[#ccc] bg-white rounded px-2 focus-within:ring-1 focus-within:ring-vy-accent h-8">
                          <Lock className="w-3.5 h-3.5 text-gray-400 mr-2" />
                          <input
                            type="password"
                            value={isEncryptedField(formData.password) ? "" : formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            placeholder={isEncryptedField(formData.password) ? "••• encrypted in vault — type to replace" : "Optional if using key"}
                            className="bg-transparent border-none outline-none text-xs w-full"
                          />
                        </div>
                    </div>
                )}

                {formData.authType === "key" && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-1 fade-in duration-200">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Select Private Key</label>
                        <div className="flex items-center gap-2">
                          <select 
                            value={formData.privateKeyId || ""}
                            onChange={(e) => setFormData({ ...formData, privateKeyId: e.target.value })}
                            className="flex-1 bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                            required={formData.authType === "key"}
                          >
                            <option value="">-- Choose integrated key --</option>
                            {sshKeys.map(key => (
                              <option key={key.id} value={key.id}>{key.name}</option>
                            ))}
                          </select>
                          <button 
                            type="button" 
                            onClick={() => setActiveInternalTab("keys")}
                            className="text-[10px] bg-white border border-[#ccc] px-2 h-8 rounded hover:bg-gray-100 font-bold transition-colors shadow-sm flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" /> Manage Keys
                          </button>
                        </div>
                        <div className="mt-2">
                           <div className="flex items-center text-[10px] text-gray-400 mb-1">
                              <span>OR Enter path manually:</span>
                           </div>
                           <input 
                              type="text" 
                              value={formData.privateKeyPath}
                              onChange={(e) => setFormData({ ...formData, privateKeyPath: e.target.value })}
                              placeholder="/home/user/.ssh/id_rsa"
                              className="w-full bg-white border border-[#ccc] rounded px-2 h-7 text-[10px] outline-none italic"
                           />
                        </div>
                    </div>
                )}
              </div>
              )}

              {/* Organization: group + jump host */}
              <div className="bg-[#f5f5f5] border border-[#ccc] p-3 space-y-3 rounded-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Folder className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-[11px] font-bold text-gray-700 uppercase tracking-tight">Organization & Network</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Group</label>
                    <select
                      value={formData.groupId || ""}
                      onChange={(e) => setFormData({ ...formData, groupId: e.target.value || undefined })}
                      className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                    >
                      <option value="">-- Ungrouped --</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                  {formData.type !== "Shell" && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Jump host (bastion)</label>
                      <select
                        value={formData.jumpChain?.[0] || ""}
                        onChange={(e) =>
                          setFormData({ ...formData, jumpChain: e.target.value ? [e.target.value] : undefined })
                        }
                        className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                      >
                        <option value="">-- Direct connection --</option>
                        {sessions
                          .filter((s) => s.id !== session?.id && s.type !== "Shell" && s.host)
                          .map((s) => (
                            <option key={s.id} value={s.id}>via {s.name} ({s.host})</option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Automation: env vars + startup macro + logging */}
              <div className="bg-[#f5f5f5] border border-[#ccc] p-3 space-y-3 rounded-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-[11px] font-bold text-gray-700 uppercase tracking-tight">Automation</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Startup snippet (macro)</label>
                    <select
                      value={formData.startupMacroId || ""}
                      onChange={(e) => setFormData({ ...formData, startupMacroId: e.target.value || undefined })}
                      className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                    >
                      <option value="">-- None --</option>
                      {macros.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Startup delay (ms)</label>
                    <input
                      type="number"
                      min={0}
                      value={formData.startupDelayMs ?? 500}
                      onChange={(e) => setFormData({ ...formData, startupDelayMs: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Environment variables (KEY=VALUE per line)</label>
                  <textarea
                    value={envText}
                    onChange={(e) => setEnvText(e.target.value)}
                    placeholder={"LANG=en_US.UTF-8\nEDITOR=vim"}
                    rows={2}
                    className="w-full bg-white border border-[#ccc] rounded px-2 py-1 text-[11px] font-mono outline-none focus:ring-1 focus:ring-vy-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Session log</label>
                  <select
                    value={formData.logging || "off"}
                    onChange={(e) => setFormData({ ...formData, logging: e.target.value as Session["logging"] })}
                    className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                  >
                    <option value="off">Off</option>
                    <option value="clean">Record (clean — no escape codes)</option>
                    <option value="raw">Record (raw — full byte stream)</option>
                  </select>
                  <p className="text-[9px] text-gray-400 italic">Saved under ~/.vy-termweb/logs/ on the server.</p>
                </div>
              </div>
            </>
          )}

          {activeTab === "keys" && (
            <div className="space-y-4 animate-in fade-in duration-200 flex flex-col h-full">
               <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-tight">SSH Key Library</h3>
                    <p className="text-[10px] text-gray-500">Manage your private keys here to associate them with sessions.</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 bg-blue-600 text-white rounded-sm px-3 h-8 text-xs font-bold shadow-sm hover:brightness-110 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add New Key
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
               </div>

               <div className="flex-1 bg-gray-50 border border-[#ccc] rounded-sm overflow-y-auto max-h-[250px]">
                  {sshKeys.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-gray-400 italic">
                       <Key className="w-8 h-8 mb-2 opacity-20" />
                       <span className="text-[11px]">No private keys in library yet.</span>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                       <thead className="bg-[#f0f0f0] border-b border-[#ccc] sticky top-0 font-serif italic text-gray-500 text-[10px]">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-200 bg-white">
                          {sshKeys.map(key => (
                            <tr key={key.id} className="hover:bg-blue-50/50 group">
                               <td className="px-3 py-2 font-medium flex items-center gap-2">
                                  <FileKey className="w-3.5 h-3.5 text-blue-500" />
                                  {key.name}
                               </td>
                               <td className="px-3 py-2 text-gray-500 text-[10px] uppercase font-mono">{key.type}</td>
                               <td className="px-3 py-2 text-right">
                                  <button 
                                    type="button"
                                    onClick={() => removeKey(key.id)}
                                    className="p-1 hover:bg-red-50 text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                               </td>
                            </tr>
                          ))}
                       </tbody>
                    </table>
                  )}
               </div>

               <div className="bg-orange-50 border border-orange-100 p-3 rounded-sm flex gap-3">
                  <Shield className="w-8 h-8 text-orange-400 shrink-0" />
                  <div>
                    <span className="text-[11px] font-bold text-orange-800 block">Security Note</span>
                    <p className="text-[10px] text-orange-700 leading-relaxed">
                      Keys are stored locally in your browser's session. They are encrypted before being sent to the remote server during connection establishment.
                    </p>
                  </div>
               </div>
            </div>
          )}

          {activeTab === "tunnels" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-blue-50 border border-blue-200 p-2 text-[11px] text-blue-800 rounded-sm">
                Map a port from your machine to a remote port through this SSH session.
              </div>
              
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2 items-end bg-gray-100 p-2 border border-gray-300 rounded-sm">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase">Forward Type</label>
                    <select
                      value={newTunnel.type}
                      onChange={(e) => setNewTunnel({ ...newTunnel, type: e.target.value as any })}
                      className="w-full bg-white border border-[#ccc] p-1 text-[10px] outline-none"
                    >
                      <option value="local">Local Port Forwarding</option>
                      <option value="remote">Remote Port Forwarding</option>
                      <option value="dynamic">Dynamic (SOCKS5 proxy)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase">Local Port</label>
                    <input 
                      type="number" 
                      value={newTunnel.localPort}
                      onChange={(e) => setNewTunnel({ ...newTunnel, localPort: parseInt(e.target.value) })}
                      className="w-full border border-[#ccc] p-1 text-[10px] outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase">
                      {newTunnel.type === "dynamic" ? "Remote (via SOCKS5)" : "Remote Host/Port"}
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newTunnel.remoteHost}
                        onChange={(e) => setNewTunnel({ ...newTunnel, remoteHost: e.target.value })}
                        className="w-full border border-[#ccc] p-1 text-[10px] outline-none disabled:bg-gray-50 disabled:text-gray-400"
                        placeholder="localhost"
                        disabled={newTunnel.type === "dynamic"}
                      />
                      <span className="text-gray-400 italic">:</span>
                      <input
                        type="number"
                        value={newTunnel.remotePort}
                        onChange={(e) => setNewTunnel({ ...newTunnel, remotePort: parseInt(e.target.value) })}
                        className="w-16 border border-[#ccc] p-1 text-[10px] outline-none disabled:bg-gray-50 disabled:text-gray-400"
                        disabled={newTunnel.type === "dynamic"}
                      />
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={addTunnel}
                    className="flex items-center justify-center gap-1 bg-green-600 text-white rounded p-1.5 h-8 text-[10px] font-bold shadow-sm hover:brightness-110"
                  >
                    <Plus className="w-3.5 h-3.5" /> ADD
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-tight">Active Tunnels</label>
                <div className="border border-[#ccc] rounded-sm bg-gray-50 min-h-[100px] max-h-[150px] overflow-y-auto">
                   {(formData.tunnels || []).length === 0 ? (
                      <div className="p-4 text-center text-[11px] text-gray-400 italic">No port forwardings configured.</div>
                   ) : (
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-[#e4e4e4] border-b border-[#ccc] sticky top-0">
                          <tr>
                            <th className="px-2 py-1 font-bold text-gray-600 w-1/4">Source</th>
                            <th className="px-2 py-1"></th>
                            <th className="px-2 py-1 font-bold text-gray-600">Destination</th>
                            <th className="px-2 py-1 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(formData.tunnels || []).map(tunnel => (
                            <tr key={tunnel.id} className="border-b border-gray-200 bg-white hover:bg-blue-50/30">
                              <td className="px-2 py-1 font-mono text-blue-600">
                                {tunnel.type === "local" || tunnel.type === "dynamic" ? tunnel.localPort : `${tunnel.remoteHost}:${tunnel.remotePort}`}
                              </td>
                              <td className="px-1 py-1">
                                <ArrowRight className="w-3 h-3 text-gray-400" />
                              </td>
                              <td className="px-2 py-1 font-mono text-gray-700">
                                {tunnel.type === "local"
                                  ? `${tunnel.remoteHost}:${tunnel.remotePort}`
                                  : tunnel.type === "dynamic"
                                    ? "SOCKS5"
                                    : tunnel.localPort}
                              </td>
                              <td className="px-2 py-1">
                                <button 
                                  type="button"
                                  onClick={() => removeTunnel(tunnel.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                   )}
                </div>
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="bg-vy-nav border-t border-vy-border p-3 flex justify-end gap-2">
           <button 
             onClick={onClose}
             className="px-4 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded border border-[#ccc] transition-colors font-medium cursor-default"
           >
             Cancel
           </button>
           <button 
             onClick={handleSave}
             className="px-4 py-1 text-xs bg-vy-accent text-white rounded shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:brightness-110 transition-all font-bold cursor-default"
           >
             OK
           </button>
        </div>
      </div>
    </div>
  );
}
