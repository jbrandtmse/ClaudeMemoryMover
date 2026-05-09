import { multiselect, select, confirm, isCancel, cancel, spinner } from '@clack/prompts';
import { CmemmovError } from '../core/error.js';
import {
  type ClaudeCategory,
  type ImportMode,
  ALL_CATEGORIES,
  FLAG_NAMES,
} from '../core/decision-schema.js';

interface SilentOpts<T> {
  silent: boolean;
  value?: T;
}

function requireSilentValue<T>(opts: SilentOpts<T>, flag: string): T {
  if (opts.value === undefined) {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: `${flag} required in silent mode`,
    });
  }
  return opts.value;
}

function bailOnCancel<T>(result: T | symbol): asserts result is T {
  if (isCancel(result)) {
    cancel('Operation cancelled.');
    process.exit(130);
  }
}

export async function selectCategories(opts: SilentOpts<ClaudeCategory[]>): Promise<ClaudeCategory[]> {
  if (opts.silent) {
    return requireSilentValue(opts, FLAG_NAMES.categories);
  }

  const result = await multiselect<ClaudeCategory>({
    message: 'Select categories to include:',
    options: ALL_CATEGORIES.map((c) => ({ value: c, label: c })),
    required: true,
  });

  bailOnCancel<ClaudeCategory[]>(result);
  return result;
}

export async function selectMergeMode(opts: SilentOpts<ImportMode>): Promise<ImportMode> {
  if (opts.silent) {
    return requireSilentValue(opts, FLAG_NAMES.mode);
  }

  const result = await select<ImportMode>({
    message: 'How should the bundle be applied?',
    options: [
      { value: 'merge', label: 'merge', hint: 'keep existing on collision' },
      { value: 'overwrite', label: 'overwrite', hint: 'replace existing wholesale' },
    ],
  });

  bailOnCancel<ImportMode>(result);
  return result;
}

export async function confirmCredentials(opts: SilentOpts<boolean>): Promise<boolean> {
  if (opts.silent) {
    return requireSilentValue(opts, FLAG_NAMES.includeCredentials);
  }

  const result = await confirm({
    message: 'Include credentials (.credentials.json) in the bundle?',
    initialValue: false,
  });

  bailOnCancel<boolean>(result);
  return result;
}

export async function confirmOverwrite(opts: SilentOpts<boolean>): Promise<boolean> {
  if (opts.silent) {
    return requireSilentValue(opts, FLAG_NAMES.force);
  }

  const result = await confirm({
    message: 'Overwrite existing files at the destination?',
    initialValue: false,
  });

  bailOnCancel<boolean>(result);
  return result;
}

export interface SpinnerHandle {
  start(msg: string): void;
  stop(msg: string): void;
  fail(msg: string): void;
}

export function createSpinner(): SpinnerHandle {
  const s = spinner();
  return {
    start: (msg: string) => {
      s.start(msg);
    },
    stop: (msg: string) => {
      s.stop(msg);
    },
    fail: (msg: string) => {
      s.error(msg);
    },
  };
}
