// Polite fetching for the discovery reports: one generic user agent, a pause per host,
// robots.txt honoured for every host, retries on rate limits, and a small file cache.
// The cache holds only what the callers keep (titles, dates, states), never raw pages.
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate, createZstdDecompress } from "node:zlib";
import { join } from "node:path";
import { parseRobots as parseFor, robotsAllows, type Robots } from "../lib/robots.ts";

export const USER_AGENT = "irl-commons-discovery";

// ---------- robots.txt ----------

export { robotsAllows, type Robots };

/** The rules that apply to `agent`: the most specific named group, else the * group. */
export const parseRobots = (text: string, agent = USER_AGENT): Robots => parseFor(text, agent);

// ---------- cache ----------

export { writeLocalFile } from "./output.ts";
import { writeLocalFile } from "./output.ts";

export class Cache {
  constructor(readonly dir: string, readonly offline = false) { mkdirSync(dir, { recursive: true }); }
  private file(key: string) { return join(this.dir, new Bun.CryptoHasher("sha1").update(key).digest("hex") + ".json"); }
  entry<T>(key: string): { saved: number; value: T } | undefined {
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    return JSON.parse(readFileSync(f, "utf8"));
  }
  get<T>(key: string, maxAgeHours: number): T | undefined {
    const entry = this.entry<T>(key);
    if (!entry || (!this.offline && Date.now() - entry.saved > maxAgeHours * 3600_000)) return undefined;
    return entry.value;
  }
  set<T>(key: string, value: T): T { writeLocalFile(this.file(key), JSON.stringify({ saved: Date.now(), value })); return value; }
  /** Read a fresh cached value, or compute and store it. Offline runs never compute. */
  async remember<T>(key: string, maxAgeHours: number, make: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key, maxAgeHours);
    if (hit !== undefined) return hit;
    if (this.offline) throw new OfflineMiss(key);
    return this.set(key, await make());
  }
}
class RequestDeferred extends Error {}
export class SourceOriginMismatch extends Error {}
export class OfflineMiss extends Error { constructor(key: string) { super(`not in cache (offline): ${key}`); } }
export class RobotsBlocked extends Error { constructor(readonly url: string) { super(`robots.txt disallows ${url}`); } }

// ---------- fetcher ----------

export class BodyLimitExceeded extends Error {
  constructor(readonly layer: "wire" | "decoded" | "expansion", limit: number, readonly measured: number) {
    super((layer === "wire" ? "response" : "decoded response") + " exceeds " + limit + " bytes");
  }
}

export async function boundedBytes(stream: ReadableStream<Uint8Array> | null, limit: number, charge?: (size: number) => void, layer: "wire" | "decoded" = "wire"): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  let byteReader: ReadableStreamBYOBReader | undefined;
  try { byteReader = stream.getReader({ mode: "byob" }); } catch { /* Some transports provide regular streams. */ }
  const reader = byteReader ?? stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = byteReader
        ? await byteReader.read(new Uint8Array(Math.min(16 * 1024, limit - size + 1)))
        : await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
      if (done) break;
      charge?.(value.byteLength);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new BodyLimitExceeded(layer, limit, size);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function decodeBody(bytes: Uint8Array, encoding: string, limit: number, charge?: (size: number) => void, layer: "decoded" | "expansion" = "decoded"): Promise<Uint8Array> {
  const options = { chunkSize: 16 * 1024 };
  const decoder = encoding === "gzip" || encoding === "x-gzip" ? createGunzip(options)
    : encoding === "deflate" ? createInflate(options)
    : encoding === "br" ? createBrotliDecompress(options)
    : encoding === "zstd" ? createZstdDecompress(options)
    : null;
  if (!decoder) throw new Error("unsupported content encoding: " + encoding);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.from([bytes]).pipe(decoder) as AsyncIterable<Buffer>) {
    charge?.(chunk.length);
    size += chunk.length;
    if (size > limit) throw new BodyLimitExceeded(layer, limit, size);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

type BodyLimits = {
  decoded?: number; ratio?: number;
  chargeWire?: (size: number) => void; chargeDecoded?: (size: number) => void;
};

export type FetchLog = { requests: number; blocked: string[]; failures: string[] };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export type FetchOptions = RequestInit & { allowedOrigins?: readonly string[]; decompress?: boolean };
type Transport = (url: string, init: FetchOptions) => Promise<Response>;

const HTTP_DATE = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4})$/;

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isSafeInteger(ms) ? ms : undefined;
  }
  if (!HTTP_DATE.test(value)) return undefined;
  const at = Date.parse(value.endsWith(" GMT") ? value : value + " GMT");
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function resetDelay(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const at = Number(value) * 1000;
  return Number.isSafeInteger(at) && at <= 8.64e15 ? Math.max(0, at - Date.now()) : undefined;
}

export class Fetcher {
  private robots = new Map<string, Promise<Robots>>();
  private lastAt = new Map<string, number>();
  private waitRemaining = 300_000;
  private cooldowns = new Map<string, number>();
  private reportedDeferrals = new Map<string, number>();
  private responseUrls = new WeakMap<Response, string>();
  readonly log: FetchLog = { requests: 0, blocked: [], failures: [] };
  /** Minimum pause between requests to one host, in ms. */
  constructor(
    private pauses: Record<string, number> = {},
    private defaultPause = 1500,
    private transport: Transport = fetch,
    private sleep: (ms: number) => Promise<unknown> = Bun.sleep,
    private cache?: Cache,
  ) {}

  private robotsFor(origin: string): Promise<Robots> {
    if (!this.robots.has(origin)) this.robots.set(origin, (async () => {
      const key = "robots-rules:" + origin;
      const cached = this.cache?.get<Robots>(key, 24);
      if (cached) return cached;
      try {
        const r = await this.follow(`${origin}/robots.txt`, {}, (url, init) => this.raw(url, init, null));
        // Ordinary 4xx responses mean no rules. Rate limits and unreachable rules block this run.
        if (r.ok) {
          const rules = parseRobots(new TextDecoder().decode(await boundedBytes(r.body, 512 * 1024)));
          const host = new URL(origin).host;
          if (this.cache && rules.delay && rules.delay > 0) {
            this.cache.set("crawl-sent:" + host, this.lastAt.get(host) ?? Date.now());
          }
          this.cache?.set(key, rules);
          return rules;
        }
        await r.body?.cancel();
        const limited = r.status === 429 || r.status === 403 && (r.headers.has("retry-after") || r.headers.get("x-ratelimit-remaining") === "0");
        if (limited) {
          const delay = retryAfterMs(r.headers.get("retry-after")) ?? resetDelay(r.headers.get("x-ratelimit-reset")) ?? 5000;
          const host = new URL(this.responseUrls.get(r) ?? origin).host;
          const until = this.cooldown(host, delay);
          this.recordDeferral(host, until, "robots.txt HTTP " + r.status);
        }
        return limited || r.status < 400 || r.status >= 500
          ? { rules: [{ allow: false, pattern: "/" }], delay: null }
          : { rules: [], delay: null };
      } catch (error) {
        if (error instanceof RequestDeferred) throw error;
        return { rules: [{ allow: false, pattern: "/" }], delay: null };
      }
    })());
    return this.robots.get(origin)!;
  }

  private async wait(url: string, robotsDelay: number | null) {
    const host = new URL(url).host;
    const base = this.pauses[host] ?? this.defaultPause;
    const crawl = Math.max(0, (robotsDelay ?? 0) * 1000);
    const last = Math.max(this.lastAt.get(host) ?? -Infinity,
      crawl > 0 ? this.cache?.get<number>("crawl-sent:" + host, Infinity) ?? -Infinity : -Infinity);
    const now = Date.now(), at = Math.max(now, last + Math.max(base, crawl));
    if (at > now) {
      if (crawl > base) await this.serverWait(at - now, url, at, "robots crawl delay");
      else await this.sleep(at - now);
    }
    const sent = Math.max(at, Date.now());
    this.lastAt.set(host, sent);
    if (crawl > 0) this.cache?.set("crawl-sent:" + host, sent);
  }

  private recordDeferral(scope: string, until: number, cause: string): string {
    const message = "retry deferred until " + new Date(Math.min(8.64e15, until)).toISOString() + " for " + scope + " (" + cause + ")";
    if (this.reportedDeferrals.get(scope) !== until) {
      this.log.failures.push(message);
      this.reportedDeferrals.set(scope, until);
    }
    return message;
  }

  private async serverWait(ms: number, url: string, until = Date.now() + ms, cause = "redirect response"): Promise<void> {
    if (ms > this.waitRemaining) throw new RequestDeferred(this.recordDeferral(new URL(url).host, until, cause));
    this.waitRemaining -= ms;
    await this.sleep(ms);
  }

  private deadline(scope: string): number {
    const until = this.cooldowns.get(scope) ?? this.cache?.get<number>("cooldown:" + scope, Infinity) ?? 0;
    return Number.isFinite(until) ? until : 0;
  }

  private cooldown(scope: string, ms: number): number {
    const until = Math.max(this.deadline(scope), Date.now() + ms);
    this.cooldowns.set(scope, until);
    this.cache?.set("cooldown:" + scope, until);
    return until;
  }

  deferPath(url: string, seconds: number): void {
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return;
    const u = new URL(url);
    const scope = u.origin + u.pathname;
    const until = this.cooldown(scope, seconds * 1000);
    if (until - Date.now() > this.waitRemaining) this.recordDeferral(scope, until, "API method backoff");
  }

  private async waitCooldown(url: string): Promise<void> {
    const u = new URL(url);
    const scopes = [u.host, u.origin + u.pathname];
    const deadlines = scopes.map((scope) => this.deadline(scope));
    const until = Math.max(...deadlines);
    if (!until) return;
    await this.serverWait(Math.max(0, until - Date.now()), url, until, "server cooldown");
    for (const [index, scope] of scopes.entries()) {
      if (this.deadline(scope) === deadlines[index]) this.cooldowns.set(scope, 0);
    }
  }

  private async raw(url: string, init: RequestInit, delay: number | null): Promise<Response> {
    await this.waitCooldown(url);
    await this.wait(url, delay);
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    this.log.requests++;
    return this.transport(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(30000), headers });
  }

  private async follow(url: string, init: FetchOptions, send: Transport): Promise<Response> {
    let u = new URL(url);
    let method = (init.method ?? "GET").toUpperCase();
    let body = init.body;
    const headers = new Headers(init.headers);
    for (let redirects = 0; ; redirects++) {
      if (init.allowedOrigins && !init.allowedOrigins.includes(u.origin)) throw new SourceOriginMismatch("URL outside configured source: " + u.origin);
      const response = await send(u.href, { ...init, method, body, headers });
      const location = response.headers.get("location");
      if (!REDIRECTS.has(response.status) || location === null || init.redirect === "manual") {
        this.responseUrls.set(response, u.href);
        return response;
      }
      await response.body?.cancel();
      if (init.redirect === "error" || redirects >= 5) throw new Error("Redirect refused for " + u.href);
      const next = new URL(location, u);
      if (!["http:", "https:"].includes(next.protocol) || next.username || next.password) {
        throw new Error("Unsupported redirect target for " + u.href);
      }
      if (init.allowedOrigins && !init.allowedOrigins.includes(next.origin)) throw new SourceOriginMismatch("URL outside configured source: " + next.origin);
      if (u.origin !== next.origin) {
        for (const name of ["authorization", "proxy-authorization", "cookie"]) headers.delete(name);
      }
      if (((response.status === 301 || response.status === 302) && method === "POST")
        || (response.status === 303 && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        body = undefined;
        for (const name of ["content-encoding", "content-language", "content-length", "content-location", "content-type"]) headers.delete(name);
      }
      const after = retryAfterMs(response.headers.get("retry-after"));
      if (after !== undefined) await this.serverWait(after, u.href);
      u = next;
    }
  }

  /** Fetch each hop after its own robots.txt check and rate limit handling. */
  request(url: string, init: FetchOptions = {}): Promise<Response> {
    return this.follow(url, init, (target, options) => this.checked(target, options));
  }

  private async checked(url: string, init: RequestInit): Promise<Response> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robotsAllows(robots, u.pathname + u.search)) { this.log.blocked.push(url); throw new RobotsBlocked(url); }
    for (let attempt = 0; ; attempt++) {
      await this.waitCooldown(url);
      let r: Response;
      try {
        r = await this.raw(url, init, robots.delay);
      } catch (e) {
        if (e instanceof RequestDeferred) throw e;
        if (attempt < 2) { await this.sleep(2000 * (attempt + 1)); continue; }
        this.log.failures.push(`${url}: ${(e as Error).message}`);
        throw e;
      }
      const exhausted = u.hostname === "api.github.com" && r.headers.get("x-ratelimit-remaining") === "0";
      const primaryLimit = exhausted && (r.status === 403 || r.status === 429 || (
        r.ok && u.pathname === "/graphql" && await r.clone().json().then(
          (body: any) => Array.isArray(body?.errors) && body.errors.some((error: any) => error.type === "RATE_LIMITED"),
          () => false,
        )
      ));
      const limited = primaryLimit || r.status === 429 || r.status >= 500 || (r.status === 403 && r.headers.has("retry-after"));
      if (limited) {
        const reset = primaryLimit ? r.headers.get("x-ratelimit-reset") : null;
        const untilReset = resetDelay(reset);
        const after = Math.max(untilReset ?? 0, retryAfterMs(r.headers.get("retry-after")) ?? (untilReset === undefined ? 5000 * 2 ** attempt : 0));
        this.cooldown(u.host, after);
        if (attempt < 3) {
          await r.body?.cancel();
          await this.waitCooldown(url);
          continue;
        }
      }
      return r;
    }
  }

  private async ok(url: string, init: FetchOptions): Promise<Response> {
    const r = await this.request(url, init);
    if (!r.ok) { await r.body?.cancel(); this.log.failures.push(`${r.status}: ${url}`); throw new Error(`${r.status} for ${url}`); }
    return r;
  }

  async text(url: string, init: FetchOptions = {}): Promise<string> {
    return (await this.ok(url, init)).text();
  }

  async document(url: string, init: FetchOptions = {}): Promise<{ text: string; url: string }> {
    const body = await this.binaryDocument(url, init, 2 * 1024 ** 2, { decoded: 2 * 1024 ** 2, ratio: 150 });
    return { text: new TextDecoder().decode(body.bytes), url: body.url };
  }

  async bytes(url: string, init: FetchOptions = {}, limit = Infinity): Promise<Uint8Array> {
    return (await this.binaryDocument(url, init, limit)).bytes;
  }

  async binaryDocument(url: string, init: FetchOptions = {}, limit = Infinity, limits: BodyLimits = {}): Promise<{ bytes: Uint8Array; url: string; wireBytes: number }> {
    const response = await this.ok(url, { ...init, decompress: false });
    const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    const coded = !!encoding && encoding !== "identity";
    const decodedLimit = limits.decoded ?? limit;
    const contentLength = Number(response.headers.get("content-length"));
    const readLimit = Math.min(limit, coded ? Infinity : decodedLimit);
    const layer = readLimit < limit ? "decoded" : "wire";
    if (contentLength > readLimit) {
      await response.body?.cancel().catch(() => undefined);
      throw new BodyLimitExceeded(contentLength > limit ? "wire" : layer, readLimit, contentLength);
    }
    let bytes = await boundedBytes(response.body, readLimit, (size) => {
      limits.chargeWire?.(size);
      if (!coded) limits.chargeDecoded?.(size);
    }, layer);
    const wireBytes = bytes.length;
    if (coded) {
      const expansion = wireBytes * (limits.ratio ?? 150);
      bytes = await decodeBody(bytes, encoding!, Math.min(decodedLimit, expansion), limits.chargeDecoded,
        expansion < decodedLimit ? "expansion" : "decoded");
    }
    return { bytes, wireBytes, url: this.responseUrls.get(response) ?? url };
  }

  async json<T = any>(url: string, init: RequestInit = {}): Promise<T> {
    return JSON.parse(await this.text(url, init));
  }
}
