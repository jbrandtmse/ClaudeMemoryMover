import pc from 'picocolors';
import type { CmemmovError } from '../core/error.js';

export interface ErrorRecord {
  code: string;
  file?: string;
  operation?: string;
  hint?: string;
}

export interface OutputResult {
  success: boolean;
  command: string;
  summary: string;
  errors: ErrorRecord[];
  warnings: string[];
}

export class Output {
  readonly #json: boolean;
  readonly #command: string;
  readonly #errors: ErrorRecord[] = [];
  readonly #warnings: string[] = [];

  constructor(command: string, opts: { json?: boolean } = {}) {
    this.#command = command;
    this.#json = opts.json ?? false;
  }

  progress(msg: string): void {
    process.stderr.write(msg + '\n');
  }

  warn(msg: string): void {
    this.#warnings.push(msg);
    process.stderr.write(pc.yellow('⚠ ' + msg) + '\n');
  }

  error(err: CmemmovError): void {
    const record: ErrorRecord = { code: err.code };
    if (err.file !== undefined) record.file = err.file;
    if (err.operation !== undefined) record.operation = err.operation;
    if (err.hint !== undefined) record.hint = err.hint;
    this.#errors.push(record);

    if (this.#json) return;

    const lines: string[] = [pc.red(pc.bold(`[${err.code}]`))];
    if (err.file !== undefined) lines.push('  file: ' + err.file);
    if (err.operation !== undefined) lines.push('  operation: ' + err.operation);
    if (err.hint !== undefined) lines.push('  hint: ' + err.hint);
    process.stderr.write(lines.join('\n') + '\n');
  }

  finish(summary: string, success = true): void {
    if (this.#json) {
      const result: OutputResult = {
        success,
        command: this.#command,
        summary,
        errors: this.#errors,
        warnings: this.#warnings,
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      return;
    }
    process.stdout.write(summary + '\n');
  }
}
