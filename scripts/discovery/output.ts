import { randomUUID } from "node:crypto";
import { closeSync, constants, mkdirSync, openSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

const guards = new Map<string, () => void>();

export function verifyOutputDirectory(path: string): void { guards.get(path)?.(); }

/** Create and replace a file through the same pinned parent. Never follow a file link. */
export function writeLocalFile(path: string, value: string): void {
  const parent = dirname(path);
  verifyOutputDirectory(parent);
  const temporary = join(parent, ".discovery-" + randomUUID());
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, value);
    verifyOutputDirectory(parent);
    renameSync(temporary, path);
  } finally {
    closeSync(fd);
    try { unlinkSync(temporary); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function withOutputDirectories<T>(root: string, checkout: string, run: (root: string, cache: string, state: string) => Promise<T>): Promise<T> {
  // Linux exposes directory descriptors as path anchors for ordinary filesystem calls.
  // Fail closed on platforms that cannot perform descriptor-relative path resolution.
  if (process.platform !== "linux") throw new Error("discovery writes require Linux directory descriptors");
  const repo = realpathSync(checkout);
  const handles: { fd: number; path: string }[] = [];
  const pin = (path: string, requireExternal = true) => {
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const handle = "/proc/self/fd/" + fd;
    handles.push({ fd, path: handle });
    const verify = () => {
      const rel = relative(repo, realpathSync(handle));
      if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep)) {
        throw new Error("discovery output directory moved inside the checkout");
      }
    };
    if (requireExternal) {
      verify();
      guards.set(handle, verify);
    }
    return handle;
  };
  try {
    // Walk the canonical root path one component at a time so a symlink
    // inserted before the final open cannot redirect even directory creation.
    const parts = root.split(sep).filter(Boolean);
    if (!isAbsolute(root) || parts.some((part) => part === "." || part === "..")) throw new Error("expected an absolute discovery output root");
    const openChild = (parent: string, name: string, requireExternal: boolean) => {
      const path = join(parent, name);
      try { return pin(path, requireExternal); } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        const rel = relative(repo, realpathSync(parent));
        if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep)) {
          throw new Error("discovery output directory moved inside the checkout");
        }
        try { mkdirSync(path); } catch (mkdirError: any) { if (mkdirError.code !== "EEXIST") throw mkdirError; }
        return pin(path, requireExternal);
      }
    };
    let out = pin(sep, !parts.length);
    for (const [index, part] of parts.entries()) out = openChild(out, part, index === parts.length - 1);
    const subdirectory = (name: string) => openChild(out, name, true);
    return await run(out, subdirectory("cache"), subdirectory("state"));
  } finally {
    for (const { fd, path } of handles.reverse()) {
      guards.delete(path);
      closeSync(fd);
    }
  }
}
