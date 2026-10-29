import { useState, useCallback, useEffect } from "react";

type Angle = "DEG" | "RAD";
type Fmt = { mode: "STD" | "FIX" | "SCI"; digits: number };

interface KeyDef {
  label: string;
  shiftLabel?: string;
  act: () => void;
  shiftAct?: () => void;
  wide?: boolean;
  tall?: boolean;
}

const factorial = (n: number): number => {
  if (n < 0 || n !== Math.floor(n)) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

export default function Calculator() {
  const [stack, setStack] = useState<number[]>([]); // index 0 = level 1 (X)
  const [entry, setEntry] = useState("");
  const [lastX, setLastX] = useState<number | null>(null);
  const [angle, setAngle] = useState<Angle>("DEG");
  const [shift, setShift] = useState(false);
  const [menu, setMenu] = useState(0);
  const [fmt, setFmt] = useState<Fmt>({ mode: "STD", digits: 4 });

  const format = useCallback(
    (n: number): string => {
      if (Number.isNaN(n)) return "Error";
      if (!isFinite(n)) return n > 0 ? "∞" : "-∞";
      if (fmt.mode === "FIX") return n.toFixed(fmt.digits);
      if (fmt.mode === "SCI") return n.toExponential(fmt.digits);
      const s = n.toPrecision(12);
      if (/e/i.test(s)) {
        return n.toExponential(6).replace(/(\.\d*?)0+e/, "$1e").replace(/\.e/, "e");
      }
      return String(parseFloat(s));
    },
    [fmt]
  );

  const push = useCallback(
    (n: number) => {
      setStack((s) => [n, ...s]);
      setLastX(null);
    },
    []
  );

  const commitEntry = useCallback((): number | null => {
    if (entry === "") return null;
    const v = parseFloat(entry);
    setEntry("");
    return Number.isNaN(v) ? 0 : v;
  }, [entry]);

  // Unary: applies to typed entry if present, else replaces X (level 1)
  const unary = useCallback(
    (f: (x: number) => number) => {
      setShift(false);
      const v = commitEntry();
      if (v !== null) {
        push(f(v));
        setLastX(v);
        return;
      }
      setStack(([x, ...rest]) => {
        if (x === undefined) return rest;
        setLastX(x);
        return [f(x), ...rest];
      });
    },
    [commitEntry, push]
  );

  // Binary: consumes Y and X (auto-enters a typed number first)
  const binary = useCallback(
    (f: (y: number, x: number) => number) => {
      setShift(false);
      const v = commitEntry();
      setStack((s) => {
        const arr = v !== null ? [v, ...s] : s;
        if (arr.length < 2) return arr;
        const [x, y, ...rest] = arr;
        setLastX(x);
        return [f(y, x), ...rest];
      });
    },
    [commitEntry]
  );

  const enter = useCallback(() => {
    setShift(false);
    const v = commitEntry();
    if (v !== null) {
      setStack((s) => [v, ...s]);
    } else {
      setStack((s) => (s.length ? [s[0], ...s] : s));
    }
  }, [commitEntry]);

  const drop = useCallback(() => {
    setShift(false);
    if (entry) {
      setEntry((e) => e.slice(0, -1));
      return;
    }
    setStack(([x, ...rest]) => {
      if (x !== undefined) setLastX(x);
      return rest;
    });
  }, [entry]);

  const digit = useCallback((d: string) => {
    setShift(false);
    setEntry((e) => {
      if (d === "." && e.includes(".")) return e;
      if (d === "." && (e === "" || e === "-")) return e + "0.";
      return e + d;
    });
  }, []);

  const chs = useCallback(() => {
    setShift(false);
    if (entry) {
      setEntry((e) => (e.startsWith("-") ? e.slice(1) : "-" + e));
    } else {
      unary((x) => -x);
    }
  }, [entry, unary]);

  const eex = useCallback(() => {
    setShift(false);
    setEntry((e) => (e === "" || e === "-" ? e + "1e" : e.includes("e") ? e : e + "e"));
  }, []);

  const swap = useCallback(() => {
    setShift(false);
    setStack(([x, y, ...rest]) => (x === undefined || y === undefined ? [x, ...rest].filter((v): v is number => v !== undefined) : [y, x, ...rest]));
  }, []);

  const rollDown = useCallback(() => {
    setShift(false);
    setStack((s) => (s.length > 1 ? [...s.slice(1), s[0]] : s));
  }, []);

  const dup = useCallback(() => {
    setShift(false);
    setStack((s) => (s.length ? [s[0], ...s] : s));
  }, []);

  const clearAll = useCallback(() => {
    setShift(false);
    setStack([]);
    setEntry("");
    setLastX(null);
  }, []);

  const recallLastX = useCallback(() => {
    setShift(false);
    if (lastX !== null) push(lastX);
  }, [lastX, push]);

  const toAngle = (x: number) => (angle === "DEG" ? (x * Math.PI) / 180 : x);
  const fromAngle = (x: number) => (angle === "DEG" ? (x * 180) / Math.PI : x);

  const keys: KeyDef[][] = [
    [
      { label: "SIN", shiftLabel: "ASIN", act: () => unary((x) => Math.sin(toAngle(x))), shiftAct: () => unary((x) => fromAngle(Math.asin(x))) },
      { label: "COS", shiftLabel: "ACOS", act: () => unary((x) => Math.cos(toAngle(x))), shiftAct: () => unary((x) => fromAngle(Math.acos(x))) },
      { label: "TAN", shiftLabel: "ATAN", act: () => unary((x) => Math.tan(toAngle(x))), shiftAct: () => unary((x) => fromAngle(Math.atan(x))) },
      { label: "√x", shiftLabel: "x²", act: () => unary(Math.sqrt), shiftAct: () => unary((x) => x * x) },
      { label: "1/x", shiftLabel: "x!", act: () => unary((x) => 1 / x), shiftAct: () => unary(factorial) },
    ],
    [
      { label: "yˣ", shiftLabel: "ˣ√y", act: () => binary((y, x) => Math.pow(y, x)), shiftAct: () => binary((y, x) => Math.pow(y, 1 / x)) },
      { label: "LN", act: () => unary(Math.log) },
      { label: "eˣ", act: () => unary(Math.exp) },
      { label: "LOG", act: () => unary(Math.log10) },
      { label: "10ˣ", act: () => unary((x) => Math.pow(10, x)) },
    ],
    [
      { label: "SHIFT", act: () => setShift((s) => !s) },
      { label: "±", shiftLabel: "ABS", act: chs, shiftAct: () => unary(Math.abs) },
      { label: "EEX", shiftLabel: "π", act: eex, shiftAct: () => push(Math.PI) },
      { label: "x⇄y", shiftLabel: "DUP", act: swap, shiftAct: dup },
      { label: "◄", shiftLabel: "CLR", act: drop, shiftAct: clearAll },
    ],
    [
      { label: "7", act: () => digit("7") },
      { label: "8", act: () => digit("8") },
      { label: "9", act: () => digit("9") },
      { label: "÷", shiftLabel: "%", act: () => binary((y, x) => y / x), shiftAct: () => binary((y, x) => (y * x) / 100) },
    ],
    [
      { label: "4", act: () => digit("4") },
      { label: "5", act: () => digit("5") },
      { label: "6", act: () => digit("6") },
      { label: "×", act: () => binary((y, x) => y * x) },
    ],
    [
      { label: "1", act: () => digit("1") },
      { label: "2", act: () => digit("2") },
      { label: "3", act: () => digit("3") },
      { label: "−", act: () => binary((y, x) => y - x) },
    ],
    [
      { label: "0", act: () => digit("0") },
      { label: ".", act: () => digit(".") },
      { label: "R↓", shiftLabel: "LASTx", act: rollDown, shiftAct: recallLastX },
      { label: "+", act: () => binary((y, x) => y + x) },
    ],
  ];

  const softMenus: { label: string; act: () => void }[][] = [
    [
      { label: angle === "DEG" ? "RAD" : "DEG", act: () => setAngle((a) => (a === "DEG" ? "RAD" : "DEG")) },
      { label: "π", act: () => push(Math.PI) },
      { label: "e", act: () => push(Math.E) },
      { label: "LASTx", act: recallLastX },
      { label: "R↓", act: rollDown },
      { label: "NXT", act: () => setMenu(1) },
    ],
    [
      { label: "STD", act: () => setFmt({ mode: "STD", digits: 4 }) },
      { label: "FIX 2", act: () => setFmt({ mode: "FIX", digits: 2 }) },
      { label: "FIX 4", act: () => setFmt({ mode: "FIX", digits: 4 }) },
      { label: "SCI 4", act: () => setFmt({ mode: "SCI", digits: 4 }) },
      { label: "RND", act: () => unary((x) => parseFloat(x.toFixed(fmt.digits))) },
      { label: "NXT", act: () => setMenu(0) },
    ],
  ];

  // Physical keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) digit(e.key);
      else if (e.key === ".") digit(".");
      else if (e.key === "+") binary((y, x) => y + x);
      else if (e.key === "-") binary((y, x) => y - x);
      else if (e.key === "*") binary((y, x) => y * x);
      else if (e.key === "/") { e.preventDefault(); binary((y, x) => y / x); }
      else if (e.key === "Enter") enter();
      else if (e.key === "Backspace") drop();
      else if (e.key === "Escape") clearAll();
      else if (e.key === "e" || e.key === "E") eex();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [digit, binary, enter, drop, clearAll, eex]);

  const levels = [3, 2, 1, 0]; // display order: 4,3,2,1

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-200 font-mono p-4 overflow-auto">
      {/* HP48G body */}
      <div className="bg-gradient-to-b from-[#4a4a52] to-[#32323a] rounded-2xl shadow-2xl p-3 w-[340px] select-none border border-black/40">
        <div className="text-center text-[10px] font-bold tracking-[0.3em] text-gray-300 mb-2">
          HEWLETT · PACKARD <span className="text-[#b8a0e8]">48G</span>
        </div>

        {/* LCD */}
        <div className="bg-[#9fb3bc] rounded-md border-4 border-[#2a2a30] shadow-inner overflow-hidden">
          {/* Annunciators */}
          <div className="flex justify-between items-center px-2 pt-1 text-[9px] font-bold text-[#1d2b3a] tracking-wider">
            <span className={shift ? "opacity-100" : "opacity-0"}>◄ SHIFT</span>
            <span>{angle === "RAD" ? "RAD" : ""}</span>
            <span>{fmt.mode === "STD" ? "" : `${fmt.mode} ${fmt.digits}`}</span>
          </div>

          {/* Stack levels */}
          <div className="px-2 pb-1 min-h-[92px]">
            {levels.map((lvl) => (
              <div key={lvl} className="flex justify-between items-baseline leading-5">
                <span className="text-[10px] text-[#1d2b3a]/70 font-bold">{lvl + 1}:</span>
                <span className="text-[15px] text-[#101c28] font-bold tracking-tight">
                  {stack[lvl] !== undefined ? format(stack[lvl]) : ""}
                </span>
              </div>
            ))}
            {/* Command line */}
            <div className="flex justify-between items-baseline border-t border-[#1d2b3a]/20 mt-0.5 pt-0.5">
              <span className="text-[10px] text-[#1d2b3a]/70 font-bold">«</span>
              <span className="text-[15px] text-[#101c28] font-bold tracking-tight">
                {entry}
                <span className="animate-pulse">▮</span>
              </span>
              <span className="text-[10px] text-[#1d2b3a]/70 font-bold">»</span>
            </div>
          </div>

          {/* Soft menu bar */}
          <div className="grid grid-cols-6 border-t-2 border-[#1d2b3a]/40">
            {softMenus[menu].map((m, i) => (
              <button
                key={i}
                onClick={m.act}
                className="bg-[#1d2b3a] text-[#c8d8e0] text-[9px] font-bold py-1 border-r border-[#9fb3bc]/30 last:border-r-0 hover:bg-[#2d3f52] transition-colors"
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Keys */}
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {keys.flat().map((k, i) => (
            <button
              key={i}
              onClick={() => (shift && k.shiftAct ? k.shiftAct() : k.act())}
              className={`relative h-10 rounded-md text-[13px] font-bold transition-all active:translate-y-px active:shadow-none shadow-[0_2px_0_rgba(0,0,0,.5)] ${
                k.label === "SHIFT"
                  ? shift
                    ? "bg-[#b8a0e8] text-black"
                    : "bg-[#6b5a9e] text-white"
                  : /^[0-9.]$/.test(k.label)
                  ? "bg-[#55555e] text-white hover:bg-[#666670]"
                  : "bg-[#43434b] text-[#e8e0d0] hover:bg-[#55555e]"
              }`}
            >
              <span>{shift && k.shiftLabel ? k.shiftLabel : k.label}</span>
              {k.shiftLabel && (
                <span className="absolute -top-0.5 left-1 text-[7px] text-[#b8a0e8] font-normal">
                  {k.shiftLabel}
                </span>
              )}
            </button>
          ))}
          {/* ENTER — tall key spanning the bottom-right like the real 48G */}
          <button
            onClick={enter}
            className="col-start-5 row-start-4 row-span-4 rounded-md bg-[#43434b] text-[#e8e0d0] font-bold text-sm shadow-[0_2px_0_rgba(0,0,0,.5)] hover:bg-[#55555e] active:translate-y-px active:shadow-none transition-all border border-white/10"
          >
            <span className="[writing-mode:vertical-lr] rotate-180 tracking-widest">ENTER</span>
          </button>
        </div>
      </div>

      <div className="mt-3 text-[10px] text-gray-500 text-center leading-4">
        RPN — digite um número, ENTER empilha, operadores consomem X e Y.
        <br />
        Teclado: dígitos, + − * /, Enter = ENTER, Backspace = DROP, Esc = CLR, E = EEX
      </div>
    </div>
  );
}
