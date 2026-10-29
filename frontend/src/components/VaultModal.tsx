import { useState } from "react";
import { X, Lock, ShieldAlert, KeyRound, Eye, EyeOff } from "lucide-react";
import { setupVault, unlockVault, changePassword, lockVault, resetVault, vaultHint, hasVault, isUnlocked } from "../lib/vault";
import { isEncryptedField } from "../lib/vault";
import { type Session, type SSHKey } from "../types";

export type VaultModalMode = "unlock" | "setup" | "manage";

interface VaultModalProps {
  mode: VaultModalMode;
  onClose: () => void;
  onUnlocked: () => void;
  /** Called after reset: App strips enc: fields from sessions/keys. */
  onReset: () => void;
  onVaultStateChange: () => void;
}

export default function VaultModal({ mode, onClose, onUnlocked, onReset, onVaultStateChange }: VaultModalProps) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const run = async (fn: () => Promise<boolean | void>, okMsg?: () => void) => {
    setBusy(true);
    setError("");
    try {
      const res = await fn();
      if (res === false) {
        setError("Incorrect master password.");
      } else {
        okMsg?.();
        onVaultStateChange();
      }
    } catch (e: any) {
      setError(e?.message || "Operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = () =>
    run(() => unlockVault(password), () => {
      onUnlocked();
      onClose();
    });

  const handleSetup = () => {
    if (password.length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    run(() => setupVault(password, hint.trim()), () => {
      onUnlocked();
      onClose();
    });
  };

  const handleChange = () => {
    if (password.length < 4 || password !== password2) {
      setError(password.length < 4 ? "Use at least 4 characters." : "Passwords do not match.");
      return;
    }
    run(() => changePassword(password, hint.trim() || vaultHint()), onClose);
  };

  const title = mode === "unlock" ? "Unlock Vault" : mode === "setup" ? "Enable Master Password" : "Vault Settings";

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white border border-[#aaa] shadow-2xl w-full max-w-sm rounded-sm overflow-hidden animate-in zoom-in duration-200">
        <div className="bg-vy-nav border-b border-[#ccc] px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-gray-700">{title}</span>
          </div>
          <button onClick={onClose}>
            <X className="w-4 h-4 text-gray-400 hover:text-red-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {mode === "unlock" && (
            <>
              {vaultHint() && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Hint: {vaultHint()}
                </p>
              )}
              <PasswordField value={password} onChange={setPassword} onEnter={handleUnlock} show={showPwd} onToggleShow={() => setShowPwd(!showPwd)} placeholder="Master password" autoFocus />
              <p className="text-[10px] text-gray-400">
                Passwords and keys saved in the vault cannot be recovered without the master password.
              </p>
              <button
                onClick={handleUnlock}
                disabled={busy || !password}
                className="w-full bg-vy-accent text-white px-4 py-2 rounded-sm text-xs font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Unlocking…" : "Unlock"}
              </button>
              <button
                onClick={() => {
                  if (confirm("Reset the vault? Saved passwords and private keys will be permanently erased — sessions are kept.")) {
                    resetVault();
                    onReset();
                    onClose();
                  }
                }}
                className="w-full text-[10px] text-red-500 hover:underline"
              >
                Forgot password? Reset vault (erases saved credentials)
              </button>
            </>
          )}

          {mode === "setup" && (
            <>
              <div className="bg-blue-50 border border-blue-100 p-3 rounded text-[11px] text-blue-800 leading-relaxed flex gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Passwords and private keys will be encrypted with AES-GCM using a key derived from your master
                  password. <b>There is no recovery</b> — if you lose it, saved credentials must be reset.
                </span>
              </div>
              <PasswordField value={password} onChange={setPassword} show={showPwd} onToggleShow={() => setShowPwd(!showPwd)} placeholder="Master password" autoFocus />
              <PasswordField value={password2} onChange={setPassword2} onEnter={handleSetup} show={showPwd} onToggleShow={() => setShowPwd(!showPwd)} placeholder="Confirm password" />
              <div>
                <input
                  type="text"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="Password hint (optional — visible to anyone)"
                  className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
                />
                <p className="text-[9px] text-gray-400 mt-0.5">Do not write the password itself — it is shown in plain text on the unlock screen.</p>
              </div>
              <button
                onClick={handleSetup}
                disabled={busy || !password}
                className="w-full bg-vy-accent text-white px-4 py-2 rounded-sm text-xs font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Encrypting…" : "Enable Vault"}
              </button>
            </>
          )}

          {mode === "manage" && (
            <>
              <div className="bg-green-50 border border-green-200 p-3 rounded text-[11px] text-green-800 flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Vault is active{isUnlocked() ? " and unlocked" : ""}.
              </div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Change master password</p>
              <PasswordField value={password} onChange={setPassword} show={showPwd} onToggleShow={() => setShowPwd(!showPwd)} placeholder="New master password" />
              <PasswordField value={password2} onChange={setPassword2} onEnter={handleChange} show={showPwd} onToggleShow={() => setShowPwd(!showPwd)} placeholder="Confirm new password" />
              <input
                type="text"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder={`Hint: ${vaultHint() || "none"}`}
                className="w-full bg-white border border-[#ccc] rounded px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-vy-accent"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleChange}
                  disabled={busy || !password}
                  className="flex-1 bg-vy-accent text-white px-4 py-2 rounded-sm text-xs font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
                >
                  Change password
                </button>
                <button
                  onClick={() => {
                    lockVault();
                    onVaultStateChange();
                    onClose();
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-sm text-xs font-bold hover:bg-gray-300"
                >
                  Lock now
                </button>
              </div>
            </>
          )}

          {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, onEnter, show, onToggleShow, placeholder, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex items-center border border-[#ccc] bg-white rounded px-2 focus-within:ring-1 focus-within:ring-vy-accent h-9">
      <Lock className="w-3.5 h-3.5 text-gray-400 mr-2" />
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="bg-transparent border-none outline-none text-xs w-full"
      />
      <button type="button" onClick={onToggleShow} className="text-gray-400 hover:text-gray-600 ml-1">
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

/** Strip enc: secrets from sessions/keys after a vault reset. */
export function stripEncryptedSecrets(sessions: Session[], keys: SSHKey[]): { sessions: Session[]; sshKeys: SSHKey[] } {
  return {
    sessions: sessions.map((s) => (isEncryptedField(s.password) ? { ...s, password: "" } : s)),
    sshKeys: keys.map((k) => (isEncryptedField(k.content) ? { ...k, content: "" } : k)),
  };
}

export { hasVault };
