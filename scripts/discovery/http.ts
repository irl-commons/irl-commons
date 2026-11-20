// Polite fetching for the discovery reports: one generic user agent, a pause per host,
// robots.txt honoured for every host, retries on rate limits, and a small file cache.
// The cache holds only what the callers keep (titles, dates, states), never raw pages.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseRobots as parseFor, robotsAllows, type Robots } from "../lib/robots.ts";

export const USER_AGENT = "irl-commons-discovery";

// ---------- robots.txt ----------

export { robotsAllows, type Robots };

/** The rules that apply to `agent`: the most specific named group, else the * group. */
export const parseRobots = (text: string, agent = USER_AGENT): Robots => parseFor(text, agent);

// ---------- cache ----------

export class Cache {
  constructor(readonly dir: string, readonly offline = false) { mkdirSync(dir, { recursive: true }); }
  private file(key: string) { return join(this.dir, new Bun.CryptoHasher("sha1").update(key).digest("hex") + ".json"); }
  get<T>(key: string, maxAgeHours: number): T | undefined {
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    const { saved, value } = JSON.parse(readFileSync(f, "utf8"));
    if (!this.offline && Date.now() - saved > maxAgeHours * 3600_000) return undefined;
    return value as T;
  }
  set<T>(key: string, value: T): T { writeFileSync(this.file(key), JSON.stringify({ saved: Date.now(), value })); return value; }
  /** Read a fresh cached value, or compute and store it. Offline runs never compute. */
  async remember<T>(key: string, maxAgeHours: number, make: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key, maxAgeHours);
    if (hit !== undefined) return hit;
    if (this.offline) throw new OfflineMiss(key);
    return this.set(key, await make());
  }
}
export class OfflineMiss extends Error { constructor(key: string) { super(`not in cache (offline): ${key}`); } }
export class RobotsBlocked extends Error { constructor(readonly url: string) { super(`robots.txt disallows ${url}`); } }

// ---------- fetcher ----------

export type FetchLog = { requests: number; blocked: string[]; failures: string[] };

export class Fetcher {
  private robots = new Map<string, Promise<Robots>>();
  private nextAt = new Map<string, number>();
  readonly log: FetchLog = { requests: 0, blocked: [], failures: [] };
  /** Minimum pause between requests to one host, in ms. */
  constructor(private pauses: Record<string, number> = {}, private defaultPause = 1500) {}

  private robotsFor(origin: string): Promise<Robots> {
    if (!this.robots.has(origin)) this.robots.set(origin, (async () => {
      try {
        const r = await this.raw(`${origin}/robots.txt`, {});
        // 4xx: no rules. 5xx or no answer: stay away (the usual crawler convention).
        if (r.status >= 500) return { rules: [{ allow: false, pattern: "/" }], delay: null };
        return r.ok ? parseRobots(await r.text()) : { rules: [], delay: null };
      } catch { return { rules: [{ allow: false, pattern: "/" }], delay: null }; }
    })());
    return this.robots.get(origin)!;
  }

  private async wait(host: string, robotsDelay: number | null) {
    const pause = Math.max(this.pauses[host] ?? this.defaultPause, (robotsDelay ?? 0) * 1000);
    const now = Date.now(), at = Math.max(now, this.nextAt.get(host) ?? 0);
    this.nextAt.set(host, at + pause);
    if (at > now) await Bun.sleep(at - now);
  }

  private async raw(url: string, init: RequestInit): Promise<Response> {
    const host = new URL(url).host;
    await this.wait(host, null);
    this.log.requests++;
    return fetch(url, { ...init, signal: AbortSignal.timeout(30000), headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string>) } });
  }

  /** Fetch after a robots.txt check, retrying 429 and 5xx with the server's Retry-After. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robotsAllows(robots, u.pathname + u.search)) { this.log.blocked.push(url); throw new RobotsBlocked(url); }
    for (let attempt = 0; ; attempt++) {
      await this.wait(u.host, robots.delay);
      this.log.requests++;
      let r: Response;
      try {
        r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000), headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string>) } });
      } catch (e) {
        if (attempt < 2) { await Bun.sleep(2000 * (attempt + 1)); continue; }
        this.log.failures.push(`${url}: ${(e as Error).message}`);
        throw e;
      }
      const limited = r.status === 429 || r.status >= 500 || (r.status === 403 && r.headers.get("retry-after"));
      if (limited && attempt < 3) {
        const after = Number(r.headers.get("retry-after")) || 5 * 2 ** attempt;
        await r.body?.cancel();
        await Bun.sleep(Math.min(after, 90) * 1000);
        continue;
      }
      return r;
    }
  }

  async text(url: string, init: RequestInit = {}): Promise<string> {
    const r = await this.request(url, init);
    if (!r.ok) { await r.body?.cancel(); this.log.failures.push(`${r.status}: ${url}`); throw new Error(`${r.status} for ${url}`); }
    return r.text();
  }

  async json<T = any>(url: string, init: RequestInit = {}): Promise<T> {
    return JSON.parse(await this.text(url, init));
  }
}
