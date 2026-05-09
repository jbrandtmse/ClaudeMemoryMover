import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@clack/prompts', () => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    error: vi.fn(),
  })),
}));

import * as clack from '@clack/prompts';
import { CmemmovError } from '../core/error.js';
import {
  selectCategories,
  selectMergeMode,
  selectProjects,
  confirmCredentials,
  confirmCrossOsPath,
  confirmOverwrite,
  confirmProjectPath,
  createSpinner,
  promptOriginalPath,
} from './prompts.js';

const CANCEL_SYMBOL = Symbol('clack:cancel');

beforeEach(() => {
  vi.mocked(clack.multiselect).mockReset();
  vi.mocked(clack.select).mockReset();
  vi.mocked(clack.confirm).mockReset();
  vi.mocked(clack.text).mockReset();
  vi.mocked(clack.isCancel).mockReset().mockReturnValue(false);
  vi.mocked(clack.cancel).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selectCategories', () => {
  it('returns the value immediately in silent mode without calling clack', async () => {
    const result = await selectCategories({ silent: true, value: ['globalMemory', 'claudeMd'] });
    expect(result).toEqual(['globalMemory', 'claudeMd']);
    expect(clack.multiselect).not.toHaveBeenCalled();
  });

  it('throws CmemmovError(INTERNAL) when silent and value is missing', async () => {
    await expect(selectCategories({ silent: true })).rejects.toBeInstanceOf(CmemmovError);
    await expect(selectCategories({ silent: true })).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: '--categories required in silent mode',
    });
  });

  it('calls clack.multiselect in interactive mode and returns its result', async () => {
    vi.mocked(clack.multiselect).mockResolvedValueOnce(['projectMemory']);
    const result = await selectCategories({ silent: false });
    expect(result).toEqual(['projectMemory']);
    expect(clack.multiselect).toHaveBeenCalledTimes(1);
  });

  it('on Ctrl+C calls cancel("Operation cancelled.") and process.exit(130)', async () => {
    vi.mocked(clack.multiselect).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(selectCategories({ silent: false })).rejects.toThrow('exit');
    expect(clack.cancel).toHaveBeenCalledWith('Operation cancelled.');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('selectMergeMode', () => {
  it('returns the value in silent mode without calling clack', async () => {
    const result = await selectMergeMode({ silent: true, value: 'merge' });
    expect(result).toBe('merge');
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('throws CmemmovError(INTERNAL) with --mode hint when silent and value is missing', async () => {
    await expect(selectMergeMode({ silent: true })).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: '--mode required in silent mode',
    });
  });

  it('calls clack.select in interactive mode and returns its result', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('overwrite');
    const result = await selectMergeMode({ silent: false });
    expect(result).toBe('overwrite');
    expect(clack.select).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C → cancel + exit(130)', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(selectMergeMode({ silent: false })).rejects.toThrow('exit');
    expect(clack.cancel).toHaveBeenCalledWith('Operation cancelled.');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('confirmCredentials', () => {
  it('returns the value in silent mode without calling clack', async () => {
    const result = await confirmCredentials({ silent: true, value: true });
    expect(result).toBe(true);
    expect(clack.confirm).not.toHaveBeenCalled();
  });

  it('throws CmemmovError(INTERNAL) with --include-credentials hint when silent and value is missing', async () => {
    await expect(confirmCredentials({ silent: true })).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: '--include-credentials required in silent mode',
    });
  });

  it('calls clack.confirm in interactive mode and returns its result', async () => {
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);
    const result = await confirmCredentials({ silent: false });
    expect(result).toBe(false);
    expect(clack.confirm).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C → cancel + exit(130)', async () => {
    vi.mocked(clack.confirm).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(confirmCredentials({ silent: false })).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('confirmOverwrite', () => {
  it('returns the value in silent mode', async () => {
    const result = await confirmOverwrite({ silent: true, value: true });
    expect(result).toBe(true);
  });

  it('throws CmemmovError(INTERNAL) with --force hint when silent and value missing', async () => {
    await expect(confirmOverwrite({ silent: true })).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: '--force required in silent mode',
    });
  });

  it('calls clack.confirm in interactive mode', async () => {
    vi.mocked(clack.confirm).mockResolvedValueOnce(true);
    const result = await confirmOverwrite({ silent: false });
    expect(result).toBe(true);
  });
});

describe('selectProjects', () => {
  it('returns [] when given no options without calling clack', async () => {
    const result = await selectProjects({ options: [] });
    expect(result).toEqual([]);
    expect(clack.multiselect).not.toHaveBeenCalled();
  });

  it('calls clack.multiselect with the provided options', async () => {
    vi.mocked(clack.multiselect).mockResolvedValueOnce(['slug-a']);
    const result = await selectProjects({
      options: [
        { slug: 'slug-a', label: '/home/a' },
        { slug: 'slug-b', label: '/home/b' },
      ],
    });
    expect(result).toEqual(['slug-a']);
    expect(clack.multiselect).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C → cancel + exit(130)', async () => {
    vi.mocked(clack.multiselect).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(selectProjects({ options: [{ slug: 's', label: 'l' }] })).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('promptOriginalPath', () => {
  it('returns the value in silent mode without calling clack', async () => {
    const result = await promptOriginalPath({
      slug: '-home-x',
      suggestedPath: '/home/x',
      silent: true,
      value: '/home/x',
    });
    expect(result).toBe('/home/x');
    expect(clack.text).not.toHaveBeenCalled();
  });

  it('throws CmemmovError(PATH_REMAP_AMBIGUOUS) when silent and value missing', async () => {
    await expect(
      promptOriginalPath({ slug: '-home-x', suggestedPath: '/home/x', silent: true }),
    ).rejects.toBeInstanceOf(CmemmovError);
    await expect(
      promptOriginalPath({ slug: '-home-x', suggestedPath: '/home/x', silent: true }),
    ).rejects.toMatchObject({
      code: 'PATH_REMAP_AMBIGUOUS',
      hint: '--project-path <slug>=<path> required for memory-only project -home-x',
    });
  });

  it('calls clack.text in interactive mode and returns trimmed result', async () => {
    vi.mocked(clack.text).mockResolvedValueOnce('  /home/y  ');
    const result = await promptOriginalPath({
      slug: '-home-y',
      suggestedPath: '/home/y',
      silent: false,
    });
    expect(result).toBe('/home/y');
    expect(clack.text).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C → cancel + exit(130)', async () => {
    vi.mocked(clack.text).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(
      promptOriginalPath({ slug: '-home-y', suggestedPath: '/home/y', silent: false }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('confirmProjectPath', () => {
  it('returns { action: "skip" } in silent mode without calling clack', async () => {
    const result = await confirmProjectPath({
      slug: '-home-x-app',
      originalPath: '/home/x/app',
      suggestion: '/home/y/app',
      silent: true,
    });
    expect(result).toEqual({ action: 'skip', path: '/home/x/app' });
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.text).not.toHaveBeenCalled();
  });

  it('interactive: select accept returns suggestion path when suggestion is not null', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('accept');
    const result = await confirmProjectPath({
      slug: '-home-x-app',
      originalPath: '/home/x/app',
      suggestion: '/home/y/app',
      silent: false,
    });
    expect(result).toEqual({ action: 'accept', path: '/home/y/app' });
    const optsArg = vi.mocked(clack.select).mock.calls[0]?.[0] as
      | { options: { value: string }[] }
      | undefined;
    const values = optsArg?.options.map((o) => o.value) ?? [];
    expect(values).toContain('accept');
    expect(values).toContain('override');
    expect(values).toContain('skip');
  });

  it('interactive: when suggestion is null, accept option is omitted', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('skip');
    await confirmProjectPath({
      slug: '-home-x-app',
      originalPath: '/home/x/app',
      suggestion: null,
      silent: false,
    });
    const optsArg = vi.mocked(clack.select).mock.calls[0]?.[0] as
      | { options: { value: string }[] }
      | undefined;
    const values = optsArg?.options.map((o) => o.value) ?? [];
    expect(values).not.toContain('accept');
    expect(values).toContain('override');
    expect(values).toContain('skip');
  });

  it('interactive: override calls clack.text and returns trimmed path', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('override');
    vi.mocked(clack.text).mockResolvedValueOnce('  /home/new/path  ');
    const result = await confirmProjectPath({
      slug: '-home-x-app',
      originalPath: '/home/x/app',
      suggestion: null,
      silent: false,
    });
    expect(result).toEqual({ action: 'override', path: '/home/new/path' });
    expect(clack.text).toHaveBeenCalledTimes(1);
  });

  it('interactive: skip returns originalPath without calling clack.text', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('skip');
    const result = await confirmProjectPath({
      slug: '-home-x-app',
      originalPath: '/home/x/app',
      suggestion: '/home/y/app',
      silent: false,
    });
    expect(result).toEqual({ action: 'skip', path: '/home/x/app' });
    expect(clack.text).not.toHaveBeenCalled();
  });

  it('Ctrl+C on select → cancel + exit(130)', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(
      confirmProjectPath({
        slug: '-home-x',
        originalPath: '/home/x',
        suggestion: null,
        silent: false,
      }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('confirmCrossOsPath', () => {
  it('returns { action: "skip" } in silent mode without calling clack', async () => {
    const result = await confirmCrossOsPath({
      slug: '-home-x-app',
      originalPath: 'C:\\Users\\maya\\app',
      suggestion: '/Users/maya/app',
      silent: true,
    });
    expect(result).toEqual({ action: 'skip', path: 'C:\\Users\\maya\\app' });
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.text).not.toHaveBeenCalled();
  });

  it('interactive: select accept returns suggestion path when suggestion is not null', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('accept');
    const result = await confirmCrossOsPath({
      slug: '-home-x-app',
      originalPath: 'C:\\Users\\maya\\app',
      suggestion: '/Users/maya/app',
      silent: false,
    });
    expect(result).toEqual({ action: 'accept', path: '/Users/maya/app' });
    const optsArg = vi.mocked(clack.select).mock.calls[0]?.[0] as
      | { options: { value: string }[] }
      | undefined;
    const values = optsArg?.options.map((o) => o.value) ?? [];
    expect(values).toContain('accept');
    expect(values).toContain('override');
    expect(values).toContain('skip');
  });

  it('interactive: when suggestion is null, accept option is omitted', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('skip');
    await confirmCrossOsPath({
      slug: '-home-x-app',
      originalPath: 'C:\\Users\\maya\\app',
      suggestion: null,
      silent: false,
    });
    const optsArg = vi.mocked(clack.select).mock.calls[0]?.[0] as
      | { options: { value: string }[] }
      | undefined;
    const values = optsArg?.options.map((o) => o.value) ?? [];
    expect(values).not.toContain('accept');
    expect(values).toContain('override');
    expect(values).toContain('skip');
  });

  it('interactive: override calls clack.text and returns trimmed path', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('override');
    vi.mocked(clack.text).mockResolvedValueOnce('  /Users/maya/dev/app  ');
    const result = await confirmCrossOsPath({
      slug: '-home-x-app',
      originalPath: 'C:\\Users\\maya\\app',
      suggestion: '/Users/maya/app',
      silent: false,
    });
    expect(result).toEqual({ action: 'override', path: '/Users/maya/dev/app' });
    expect(clack.text).toHaveBeenCalledTimes(1);
  });

  it('interactive: skip returns originalPath without calling clack.text', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('skip');
    const result = await confirmCrossOsPath({
      slug: '-home-x-app',
      originalPath: 'C:\\Users\\maya\\app',
      suggestion: '/Users/maya/app',
      silent: false,
    });
    expect(result).toEqual({ action: 'skip', path: 'C:\\Users\\maya\\app' });
    expect(clack.text).not.toHaveBeenCalled();
  });

  it('Ctrl+C on select → cancel + exit(130)', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(
      confirmCrossOsPath({
        slug: '-home-x',
        originalPath: 'C:\\Users\\maya\\app',
        suggestion: null,
        silent: false,
      }),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });
});

describe('createSpinner', () => {
  it('wraps clack.spinner; start/stop/fail are callable', () => {
    const handle = createSpinner();
    expect(() => {
      handle.start('working...');
      handle.stop('done');
      handle.fail('boom');
    }).not.toThrow();
    expect(clack.spinner).toHaveBeenCalled();
  });

  it('fail routes to clack spinner.error (not stop) so failures render distinctly', () => {
    const stopFn = vi.fn();
    const errorFn = vi.fn();
    vi.mocked(clack.spinner).mockReturnValueOnce({
      start: vi.fn(),
      stop: stopFn,
      cancel: vi.fn(),
      error: errorFn,
      message: vi.fn(),
      clear: vi.fn(),
      isCancelled: false,
    });
    const handle = createSpinner();
    handle.fail('boom');
    expect(errorFn).toHaveBeenCalledWith('boom');
    expect(stopFn).not.toHaveBeenCalled();
  });
});
