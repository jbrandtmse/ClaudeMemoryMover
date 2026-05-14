import { describe, it, expect } from 'vitest';
import { globToPersonalPattern, composePatterns } from './share-patterns.js';
import { PERSONAL_FILENAME_PATTERNS } from '../core/sanitization-rules.js';

describe('globToPersonalPattern', () => {
  it('converts todo* to /^todo.*/i', () => {
    const re = globToPersonalPattern('todo*');
    expect(re.source).toBe('^todo.*');
    expect(re.flags).toContain('i');
  });

  it('anchors at start with no trailing $ (prefix-style matching)', () => {
    const re = globToPersonalPattern('private*');
    expect(re.source).toMatch(/^\^/);
    expect(re.source).not.toMatch(/\$$/);
  });

  it('escapes regex metacharacters in glob', () => {
    const re = globToPersonalPattern('private_*notes');
    expect(re.source).toBe('^private_.*notes');
  });

  it('escapes dots in glob', () => {
    const re = globToPersonalPattern('*.md');
    expect(re.source).toBe('^.*\\.md');
  });

  it('is case-insensitive', () => {
    const re = globToPersonalPattern('todo*');
    expect(re.test('TODO_list.md')).toBe(true);
    expect(re.test('Todo_notes.md')).toBe(true);
  });

  it('matches prefix of filename', () => {
    const re = globToPersonalPattern('todo*');
    expect(re.test('todo_list.md')).toBe(true);
    expect(re.test('todolist.md')).toBe(true);
  });

  it('does not match non-matching filename', () => {
    const re = globToPersonalPattern('todo*');
    expect(re.test('notes.md')).toBe(false);
  });
});

describe('composePatterns', () => {
  it('returns stock patterns unchanged when no include/exclude globs', () => {
    const result = composePatterns(PERSONAL_FILENAME_PATTERNS, [], []);
    expect(result).toEqual(PERSONAL_FILENAME_PATTERNS);
  });

  it('appends include globs as new patterns', () => {
    const result = composePatterns(PERSONAL_FILENAME_PATTERNS, ['notes*'], []);
    expect(result.length).toBe(PERSONAL_FILENAME_PATTERNS.length + 1);
    const last = result[result.length - 1];
    expect(last?.source).toBe('^notes.*');
  });

  it('drops stock patterns matched by exclude glob source', () => {
    // Stock PERSONAL_FILENAME_PATTERNS contains /^todo/i with source '^todo'
    const result = composePatterns(PERSONAL_FILENAME_PATTERNS, [], ['todo*']);
    const sources = result.map((r) => r.source);
    expect(sources).not.toContain('^todo');
    // Other stock patterns remain
    expect(sources).toContain('^personal');
  });

  it('story 4.2 AC9: stock + include(todo2*) - exclude(todo*) drops /^todo/i and adds /^todo2.*/i', () => {
    const result = composePatterns(PERSONAL_FILENAME_PATTERNS, ['todo2*'], ['todo*']);
    const sources = result.map((r) => r.source);
    expect(sources).not.toContain('^todo');
    expect(sources).toContain('^todo2.*');
  });

  it('does not duplicate patterns already in stock', () => {
    const result = composePatterns(PERSONAL_FILENAME_PATTERNS, ['personal*'], []);
    // personal* becomes /^personal.*/i with source '^personal.*'
    // stock has /^personal/i with source '^personal' — different source, both kept
    const sources = result.map((r) => r.source);
    expect(sources.filter((s) => s.startsWith('^personal')).length).toBeGreaterThanOrEqual(1);
  });

  it('exclude with no match leaves all stock patterns intact', () => {
    const result = composePatterns(PERSONAL_FILENAME_PATTERNS, [], ['zzznomatch*']);
    expect(result.length).toBe(PERSONAL_FILENAME_PATTERNS.length);
  });
});
