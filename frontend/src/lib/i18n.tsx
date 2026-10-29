import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type Dict } from "../i18n/en";
import { ptBR } from "../i18n/pt-BR";
import { es } from "../i18n/es";

export type Lang = "en" | "pt-BR" | "es";
export const LANGS: Lang[] = ["en", "pt-BR", "es"];
const DICTS: Record<Lang, Dict> = { en, "pt-BR": ptBR, es };
const LANG_KEY = "vy-termweb:lang";

const detect = (): Lang => {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "en" || saved === "pt-BR" || saved === "es") return saved;
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("es")) return "es";
  return "en";
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a key; {var} placeholders are interpolated from vars. Falls back to English, then the key itself. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>({ lang: "en", setLang: () => {}, t: (k) => k });
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = DICTS[lang][key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang]
  );

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}
