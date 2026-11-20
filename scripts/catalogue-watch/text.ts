// Turning pages into comparable text: the main text of an HTML page or a README as lines,
// with scripts, navigation, footers and copyright lines left out, and a line diff between two runs.
import { createHash } from "node:crypto";

export const textHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", copy: "©", reg: "®", trade: "™", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', middot: "·", bull: "·" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

const DROP = ["script", "style", "noscript", "svg", "template", "iframe", "nav", "footer", "form", "select", "button"];
const BLOCK = /<\/?(?:p|div|li|ul|ol|h[1-6]|br|hr|tr|td|th|table|section|article|header|main|aside|dt|dd|dl|blockquote|pre|figure|figcaption|summary|details)\b[^>]*>/gi;
/** Lines that change without the product changing. */
const VOLATILE = /^(?:©|\(c\)|copyright\b)|all rights reserved|^skip to (?:main )?content$|cookie/i;

export function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<head\b[\s\S]*?<\/head>/i, " ");
  for (const tag of DROP) s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  const main = s.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  if (main && main[1].replace(/<[^>]+>/g, "").trim().length > 200) s = main[1];
  else { const body = s.match(/<body\b[^>]*>([\s\S]*)<\/body>/i); if (body) s = body[1]; }
  s = s.replace(BLOCK, "\n").replace(/<[^>]+>/g, " ");
  return cleanLines(decodeEntities(s));
}

function cleanLines(s: string): string {
  const out: string[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.replace(/[\s​]+/g, " ").trim();
    if (!line || VOLATILE.test(line)) continue;
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out.join("\n");
}

/** README markdown as lines, without badges, images, HTML comments and link targets. */
export function markdownToText(md: string): string {
  let s = md.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/<img\b[^>]*>/gi, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/<\/?[a-z][^>]*>/gi, " ");
  return cleanLines(decodeEntities(s));
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
}

/** The latest modification date a page declares about itself, as YYYY-MM-DD. */
export function declaredModified(html: string): string | null {
  const dates: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (/(?:property|name|itemprop)=["'](?:article:modified_time|og:updated_time|dateModified|last-modified)["']/i.test(tag)) {
      const c = tag.match(/content=["']([^"']+)["']/i);
      if (c) dates.push(c[1]);
    }
  }
  for (const m of html.matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)) dates.push(m[1]);
  const days = dates.map(d => d.slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return days.at(-1) ?? null;
}

/** True when the page is mostly a script shell, so its text says little about the product. */
export function looksLikeScriptShell(html: string, text: string): boolean {
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return text.length < 400 && (scripts >= 3 || /id=["'](?:root|app|__next|__nuxt|svelte)["']/i.test(html));
}

export type PageLink = { url: string; text: string };
export function pageLinks(html: string, base: string): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(decodeEntities(m[1]), base).href; } catch { continue; }
    if (!url.startsWith("https://") || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  // Bare links in markdown or text.
  for (const m of html.matchAll(/https:\/\/[^\s<>"'()\[\]`]+/g)) {
    const url = decodeEntities(m[0]).replace(/[.,;:!?]+$/, "");
    if (!seen.has(url)) { seen.add(url); out.push({ url, text: "" }); }
  }
  return out;
}

export type Diff = { added: string[]; removed: string[] };
/** Lines added and removed between two texts, in order (LCS; falls back to set difference on huge inputs). */
export function lineDiff(before: string, after: string): Diff {
  const a = before ? before.split("\n") : [], b = after ? after.split("\n") : [];
  if (a.length * b.length > 4_000_000) {
    const sa = new Set(a), sb = new Set(b);
    return { added: b.filter(x => !sa.has(x)), removed: a.filter(x => !sb.has(x)) };
  }
  const n = a.length, m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const added: string[] = [], removed: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { added, removed };
}

/** Untrusted text for a markdown report: one line, no backticks, short, inside a code span so it can't mention or link. */
export function quote(s: string | null | undefined, max = 160): string {
  const one = String(s ?? "").replace(/[`\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!one) return "";
  return "`" + (one.length > max ? one.slice(0, max - 1) + "…" : one) + "`";
}
