// Separator-aware path helpers — the backend may be Windows (C:\...) or
// unix (/...). Detection is per-path: a path containing "\" uses "\".

export const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");

export const joinPath = (dir: string, name: string): string => {
  const s = sepOf(dir);
  const base = dir.replace(/[\\/]+$/, "");
  if (!base) return s + name;
  return `${base}${s}${name}`;
};

export const splitPath = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean);

export const parentPath = (p: string): string => {
  const s = sepOf(p);
  const trimmed = p.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]+/);
  parts.pop();
  let parent = parts.join(s);
  if (/^[A-Za-z]:$/.test(parent)) parent += s; // C: -> C:\
  return parent || s;
};

/** Rebuild an absolute path from the first `i+1` breadcrumb segments. */
export const crumbPath = (segments: string[], i: number): string => {
  const segs = segments.slice(0, i + 1);
  if (/^[A-Za-z]:$/.test(segs[0])) return segs[0] + "\\" + segs.slice(1).join("\\");
  return "/" + segs.join("/");
};
