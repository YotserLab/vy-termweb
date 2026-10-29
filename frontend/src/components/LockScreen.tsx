import { useState } from "react";
import { Lock, ShieldAlert, Terminal, Eye, EyeOff } from "lucide-react";
import { authLogin, authSetup } from "../lib/auth";
import { useI18n } from "../lib/i18n";

interface LockScreenProps {
  /** "setup" on first run (no password configured yet), "login" afterwards. */
  mode: "login" | "setup";
  onDone: () => void;
}

export default function LockScreen({ mode, onDone }: LockScreenProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (mode === "setup") {
      if (password.length < 4) return setError(t("auth.tooShort"));
      if (password !== confirm) return setError(t("auth.mismatch"));
    }
    setBusy(true);
    setError("");
    try {
      await (mode === "setup" ? authSetup(password) : authLogin(password));
      onDone();
    } catch (e: any) {
      setError(e?.message || t("auth.error"));
    } finally {
      setBusy(false);
    }
  };

  const field = (value: string, set: (v: string) => void, placeholder: string, autoFocus = false) => (
    <div className="relative">
      <input
        type={showPwd ? "text" : "password"}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-white border border-[#ccc] rounded px-2 h-9 text-sm outline-none focus:ring-1 focus:ring-vy-accent pr-8"
      />
      <button
        type="button"
        onClick={() => setShowPwd(!showPwd)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        tabIndex={-1}
      >
        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#2b2b2b] p-4">
      <div className="bg-white border border-[#aaa] shadow-2xl w-full max-w-sm rounded-sm overflow-hidden">
        <div className="bg-vy-nav border-b border-[#ccc] px-4 py-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-vy-accent" />
          <span className="text-sm font-bold text-gray-700">VY-TermWEB</span>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Lock className="w-4 h-4 text-vy-accent" />
            <span className="text-sm font-semibold">
              {mode === "setup" ? t("auth.setupTitle") : t("auth.loginTitle")}
            </span>
          </div>
          {mode === "setup" && (
            <div className="bg-blue-50 border border-blue-100 p-3 rounded text-[11px] text-blue-800 leading-relaxed flex gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t("auth.setupHint")}</span>
            </div>
          )}
          {field(password, setPassword, t("auth.password"), true)}
          {mode === "setup" && field(confirm, setConfirm, t("auth.confirm"))}
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <button
            onClick={submit}
            disabled={busy || !password}
            className="w-full bg-vy-accent text-white px-4 py-2 rounded-sm text-xs font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "…" : mode === "setup" ? t("auth.create") : t("auth.unlock")}
          </button>
        </div>
      </div>
    </div>
  );
}
