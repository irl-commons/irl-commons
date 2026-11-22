// GitHub wikis expose a separate public Git repository. Fetch the default tree with
// smart HTTP through the discovery fetcher, then use local Git to read only its paths.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetcher } from "./http.ts";

const SERVICE = "git-upload-pack";
const REF_LIMIT = 1024 ** 2;
const PACK_LIMIT = 8 * 1024 ** 2;
const PAGE_EXT = /\.(md|markdown|mdown|mdwn|mdx|litcoffee|mkdn|mkd|textile|rdoc|org|creole|mediawiki|wiki|re?st(?:\.txt)?|asciidoc|adoc|asc|pod6?)$/i;

function readPacket(bytes: Buffer, offset: number): { text: string; next: number } {
  const header = bytes.toString("ascii", offset, offset + 4);
  const size = Number.parseInt(header, 16);
  if (!/^[0-9a-f]{4}$/i.test(header) || (size !== 0 && size < 4) || offset + (size || 4) > bytes.length) {
    throw new Error("Invalid wiki Git packet");
  }
  const next = offset + (size || 4);
  return { text: bytes.toString("utf8", offset + 4, next), next };
}

function packet(text: string): string {
  return (Buffer.byteLength(text) + 4).toString(16).padStart(4, "0") + text;
}

/** Run Git only against the explicitly selected temporary bare repository. */
export function wikiGit(dir: string, args: string[], stdin?: Buffer): Buffer {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const result = Bun.spawnSync(["git", "--git-dir=" + dir, ...args], {
    cwd: dir, env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error("Local Git failed reading wiki: git " + args[0]);
  return result.stdout;
}

export async function listWikiPages(fetcher: Fetcher, repo: string): Promise<{ url: string; lastmod: null; title: string }[]> {
  const base = "https://github.com/" + repo;
  const remote = base + ".wiki.git";
  const allowedOrigins = [new URL(base).origin];
  const refs = Buffer.from(await fetcher.bytes(remote + "/info/refs?service=" + SERVICE, { allowedOrigins }, REF_LIMIT));
  const banner = readPacket(refs, 0);
  const flush = readPacket(refs, banner.next);
  if (banner.text.trimEnd() !== "# service=" + SERVICE || flush.text !== "") throw new Error("Invalid wiki Git advertisement");

  let head: string | undefined;
  let capabilities: string[] = [];
  for (let offset = flush.next; offset < refs.length;) {
    const entry = readPacket(refs, offset);
    if (!entry.text) break;
    const [ref, caps] = entry.text.trimEnd().split("\0");
    if (caps) capabilities = caps.split(" ");
    head ??= ref.match(/^([a-f0-9]{40}) HEAD$/)?.[1];
    offset = entry.next;
  }
  if (!head || !capabilities.includes("shallow")) throw new Error("Wiki Git endpoint did not advertise a shallow default branch");

  const filter = capabilities.includes("filter");
  const request = packet("want " + head + " shallow" + (filter ? " filter" : "") + "\n")
    + packet("deepen 1\n") + (filter ? packet("filter blob:none\n") : "") + "0000" + packet("done\n");
  const response = Buffer.from(await fetcher.bytes(remote + "/" + SERVICE, {
    method: "POST", body: request, allowedOrigins,
    headers: { "Content-Type": "application/x-git-upload-pack-request", Accept: "application/x-git-upload-pack-result" },
  }, PACK_LIMIT));
  let start = 0;
  while (start < response.length && response.toString("ascii", start, start + 4) !== "PACK") {
    const entry = readPacket(response, start);
    if (entry.text.startsWith("ERR ")) throw new Error("Wiki Git endpoint refused the default tree");
    start = entry.next;
  }
  if (start === response.length) throw new Error("Wiki Git response did not include a pack");

  const dir = mkdtempSync(join(tmpdir(), "discovery-wiki-"));
  try {
    wikiGit(dir, ["init", "--bare", "--quiet", "--template=", "--object-format=sha1"]);
    wikiGit(dir, ["index-pack", "--stdin"], response.subarray(start));
    return wikiGit(dir, ["ls-tree", "-r", "-z", "--name-only", head]).toString().split("\0").flatMap((path) => {
      const filename = path.split("/").at(-1)!;
      if (!PAGE_EXT.test(filename) || filename.startsWith("_")) return [];
      const name = filename.replace(PAGE_EXT, "");
      const slug = name.replace(/ /g, "-");
      return [{ url: base + "/wiki/" + encodeURIComponent(slug), lastmod: null, title: name.replace(/-/g, " ").trim() }];
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
