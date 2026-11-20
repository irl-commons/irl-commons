// A polite HTTP client for the watch: a generic user agent, a cap on parallel requests overall
// and per host, a gap between requests to one host, timeouts, robots.txt for page fetches,
// redirects followed one hop at a time (each hop is checked against robots.txt), and a disk cache
// with conditional requests. It never sends cookies and never logs in.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseRobots, robotsAllows, type Robots } from "../lib/robots.ts";

export const AGENT = "irl-commons-catalogue-watch";
export const USER_AGENT = `${AGENT}/0 (+https://github.com/irl-commons/irl-commons)`;

export type Got = {
  url: string;
  finalUrl: string;
  /** Every URL the request went through, the first one included. */
  chain: string[];
  status: number;
  headers: Record<string, string>;
  body: string;
  fetchedAt: string;
  fromCache: boolean;
  /** robots: robots.txt disallows a hop. error: network failure or timeout. */
  problem?: "robots" | "error" | "insecure-redirect" | "too-many-redirects";
  detail?: string;
};

export type GetOptions = {
  accept?: string;
  /** Check robots.txt for every hop. Off for documented public APIs. */
  robots?: boolean;
  /** Stop following redirects once a URL matches; the result is that URL with status 0. */
  stopAt?: (url: string) => boolean;
  /** Seconds a cached response is reused without a request. */
  maxAge?: number;
  headers?: Record<string, string>;
};

/** Gaps between requests to one host, in milliseconds. Search and store APIs have tight limits. */
const GAPS: Record<string, number> = {
  "api.github.com": 0,
  "api.github.com/search": 2500,
  "itunes.apple.com": 3500,
  "discord.com": 1500,
};
const PARALLEL: Record<string, number> = { "api.github.com": 4 };
const KEEP = ["etag", "last-modified", "content-type", "location", "x-ratelimit-remaining", "retry-after"];

class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private size: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>(r => this.waiting.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.waiting.shift()?.(); }
  }
}

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export class Fetcher {
  readonly stats = { requests: 0, cacheHits: 0, notModified: 0, robotsBlocked: 0, errors: 0, byHost: {} as Record<string, number> };
  private global: Gate;
  private hosts = new Map<string, { gate: Gate; next: number }>();
  private robots = new Map<string, Promise<Robots>>();
  private cacheDir: string;

  constructor(private opts: { stateDir: string; parallel?: number; timeoutMs?: number; maxAge?: number; githubToken?: string; offline?: boolean }) {
    this.global = new Gate(opts.parallel ?? 6);
    this.cacheDir = join(opts.stateDir, "cache");
    mkdirSync(this.cacheDir, { recursive: true });
  }

  private slot(url: URL) {
    const key = url.host + (url.host === "api.github.com" && url.pathname.startsWith("/search/") ? "/search" : "");
    let s = this.hosts.get(key);
    if (!s) { s = { gate: new Gate(PARALLEL[key] ?? 1), next: 0 }; this.hosts.set(key, s); }
    return { key, ...s, state: s };
  }

  private async robotsFor(url: URL): Promise<Robots> {
    const origin = url.origin;
    if (!this.robots.has(origin)) {
      this.robots.set(origin, (async () => {
        const got = await this.get(`${origin}/robots.txt`, { robots: false, accept: "text/plain,*/*", maxAge: 24 * 3600 });
        // A missing robots.txt allows everything; a server error is read as "try later", so disallow.
        if (got.problem || got.status >= 500) return { rules: [{ allow: false, pattern: "/" }], delay: null };
        if (got.status >= 400) return { rules: [], delay: null };
        return parseRobots(got.body, AGENT);
      })());
    }
    return this.robots.get(origin)!;
  }

  private cachePath(key: string) { return join(this.cacheDir, hash(key).slice(0, 32) + ".json"); }

  private readCache(key: string): Got | null {
    const p = this.cachePath(key);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  }

  /** One request, no redirects. Cached by URL and accept header. */
  private async once(url: string, opts: GetOptions): Promise<Got> {
    const key = `${opts.accept ?? ""} ${url}`;
    const cached = this.readCache(key);
    const maxAge = opts.maxAge ?? this.opts.maxAge ?? 20 * 3600;
    if (cached && (this.opts.offline || Date.now() - Date.parse(cached.fetchedAt) < maxAge * 1000)) {
      this.stats.cacheHits++;
      return { ...cached, fromCache: true };
    }
    if (this.opts.offline) return { url, finalUrl: url, chain: [url], status: 0, headers: {}, body: "", fetchedAt: new Date().toISOString(), fromCache: false, problem: "error", detail: "offline and not cached" };
    const target = new URL(url);
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8", ...opts.headers };
    if (target.host === "api.github.com" && this.opts.githubToken) headers.Authorization = `Bearer ${this.opts.githubToken}`;
    if (cached?.headers.etag) headers["If-None-Match"] = cached.headers.etag;
    else if (cached?.headers["last-modified"]) headers["If-Modified-Since"] = cached.headers["last-modified"];
    const slot = this.slot(target);
    // Wait for the host first, so requests queued for one slow host don't hold the global slots.
    return slot.gate.run(() => this.global.run(async () => {
      const wait = slot.state.next - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      slot.state.next = Date.now() + (GAPS[slot.key] ?? 1000);
      this.stats.requests++;
      this.stats.byHost[slot.key] = (this.stats.byHost[slot.key] ?? 0) + 1;
      const fetchedAt = new Date().toISOString();
      try {
        const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000) });
        if (response.status === 304 && cached) {
          await response.body?.cancel();
          this.stats.notModified++;
          const fresh = { ...cached, fetchedAt };
          writeFileSync(this.cachePath(key), JSON.stringify(fresh));
          return { ...fresh, fromCache: true };
        }
        const kept: Record<string, string> = {};
        for (const h of KEEP) { const v = response.headers.get(h); if (v !== null) kept[h] = v; }
        let body = await response.text();
        if (body.length > 3_000_000) body = body.slice(0, 3_000_000);
        const got: Got = { url, finalUrl: url, chain: [url], status: response.status, headers: kept, body, fetchedAt, fromCache: false };
        // Rate-limited and server errors are not cached, so the next run asks again.
        if (response.status < 500 && response.status !== 429 && response.status !== 403) writeFileSync(this.cachePath(key), JSON.stringify(got));
        return got;
      } catch (e: any) {
        this.stats.errors++;
        return { url, finalUrl: url, chain: [url], status: 0, headers: {}, body: "", fetchedAt, fromCache: false, problem: "error", detail: String(e?.name === "TimeoutError" ? "timeout" : e?.message ?? e).slice(0, 200) };
      }
    }));
  }

  async get(url: string, opts: GetOptions = {}): Promise<Got> {
    const chain: string[] = [];
    let current = url;
    for (let hop = 0; hop < 8; hop++) {
      chain.push(current);
      if (opts.stopAt?.(current) && hop > 0)
        return { url, finalUrl: current, chain, status: 0, headers: {}, body: "", fetchedAt: new Date().toISOString(), fromCache: false };
      const target = new URL(current);
      if (opts.robots !== false) {
        const robots = await this.robotsFor(target);
        if (!robotsAllows(robots, target.pathname + target.search)) {
          this.stats.robotsBlocked++;
          return { url, finalUrl: current, chain, status: 0, headers: {}, body: "", fetchedAt: new Date().toISOString(), fromCache: false, problem: "robots" };
        }
        const delay = Math.min(robots.delay ?? 0, 5) * 1000;
        const slot = this.slot(target);
        if (delay) slot.state.next = Math.max(slot.state.next, Date.now() + delay);
      }
      const got = await this.once(current, opts);
      const location = got.headers.location;
      if (got.status >= 300 && got.status < 400 && location) {
        const next = new URL(location, current);
        if (next.protocol !== "https:") return { ...got, url, chain: [...chain, next.href], finalUrl: next.href, problem: "insecure-redirect" };
        current = next.href;
        continue;
      }
      return { ...got, url, finalUrl: current, chain };
    }
    return { url, finalUrl: current, chain, status: 0, headers: {}, body: "", fetchedAt: new Date().toISOString(), fromCache: false, problem: "too-many-redirects" };
  }

  async json(url: string, opts: GetOptions = {}): Promise<{ got: Got; data: any }> {
    const got = await this.get(url, { robots: false, accept: "application/json", ...opts });
    let data: any = null;
    try { if (got.body) data = JSON.parse(got.body); } catch { data = null; }
    return { got, data };
  }
}
