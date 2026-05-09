import { posix, win32 } from 'node:path';

export function pathToSlug(absolutePath: string): string {
  return absolutePath.replace(/[:\\/]/g, '-');
}

/**
 * Decode a Claude Code project slug back to an absolute path.
 *
 * ADVISORY — LOSSY DECODE: a folder name containing `-` is indistinguishable
 * from the path separator in the slug. `/home/my-project` and `/home/my/project`
 * both encode to `-home-my-project`. Callers with access to `bundle.originalPath`
 * or session `cwd` MUST prefer those sources over this function.
 *
 * The `null` return only signals STRUCTURAL invalidity (the slug could not have
 * been produced by a valid path on the given platform). It does NOT signal
 * decode ambiguity for hyphenated folder names — such ambiguity is undetectable
 * from the slug alone. Use this as a last-resort fallback only.
 */
export function slugToPath(slug: string, sourcePlatform: NodeJS.Platform): string | null {
  if (sourcePlatform === 'win32') {
    if (!/^[A-Za-z]--/.test(slug)) return null;
    const drive = slug.charAt(0);
    const rest = slug.slice(3);
    return `${drive}:${win32.sep}${rest.replaceAll('-', win32.sep)}`;
  }
  if (sourcePlatform === 'darwin' || sourcePlatform === 'linux') {
    if (!slug.startsWith('-')) return null;
    return `${posix.sep}${slug.slice(1).replaceAll('-', posix.sep)}`;
  }
  return null;
}

// `originalPath` may originate from a foreign OS (cross-OS migration), so we
// can't use the runtime-default `basename` — on POSIX it would treat backslashes
// as filename characters and on win32 it would treat forward slashes as path
// separators only. Splitting on the last occurrence of either separator yields
// the correct basename regardless of which OS produced the path.
function lastSegment(p: string): string {
  const lastSep = Math.max(p.lastIndexOf(posix.sep), p.lastIndexOf(win32.sep));
  return lastSep === -1 ? p : p.slice(lastSep + 1);
}

export function findMatchingDir(originalPath: string, scanRoots: string[]): string | null {
  const target = lastSegment(originalPath);
  return scanRoots.find((root) => lastSegment(root) === target) ?? null;
}

export function isCrossPlatformMigration(
  sourcePlatform: NodeJS.Platform,
  currentPlatform: NodeJS.Platform,
): boolean {
  return sourcePlatform !== currentPlatform;
}

export function suggestRemap(
  originalPath: string,
  targetPlatform: NodeJS.Platform,
  targetHomedir: string,
): string | null {
  let relative: string | null = null;

  // Windows home: <drive>:\Users\<username>\<rest>
  const winMatch = /^[A-Za-z]:\\Users\\[^\\]+\\(.+)$/i.exec(originalPath);
  if (winMatch?.[1] !== undefined) relative = winMatch[1];

  // macOS home: /Users/<username>/<rest>
  if (relative === null) {
    const macMatch = /^\/Users\/[^/]+\/(.+)$/.exec(originalPath);
    if (macMatch?.[1] !== undefined) relative = macMatch[1];
  }

  // Linux home: /home/<username>/<rest>
  if (relative === null) {
    const linuxMatch = /^\/home\/[^/]+\/(.+)$/.exec(originalPath);
    if (linuxMatch?.[1] !== undefined) relative = linuxMatch[1];
  }

  if (relative === null) return null;

  if (targetPlatform === 'win32') {
    const norm = relative.replaceAll(posix.sep, win32.sep);
    return `${targetHomedir}${win32.sep}${norm}`;
  }
  const norm = relative.replaceAll(win32.sep, posix.sep);
  return `${targetHomedir}${posix.sep}${norm}`;
}
