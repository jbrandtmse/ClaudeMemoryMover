import { PERSONAL_FILENAME_PATTERNS } from '../core/sanitization-rules.js';

export function globToPersonalPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*');
  return new RegExp('^' + body, 'i');
}

export function composePatterns(
  stock: readonly RegExp[],
  includeGlobs: readonly string[],
  excludeGlobs: readonly string[],
): readonly RegExp[] {
  // A stock pattern is dropped when an exclude regex's source starts with the
  // stock source — this lets `todo*` (→ `^todo.*`) remove `/^todo/i` (source `^todo`).
  const excludeRegexes = excludeGlobs.map(globToPersonalPattern);
  const keptStock = stock.filter(
    (r) => !excludeRegexes.some((excl) => excl.source.startsWith(r.source)),
  );
  const included = includeGlobs.map(globToPersonalPattern);
  return [...keptStock, ...included];
}

export function defaultPersonalPatterns(): readonly RegExp[] {
  return PERSONAL_FILENAME_PATTERNS;
}
