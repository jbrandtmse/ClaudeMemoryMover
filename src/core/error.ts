export type ErrorCode =
  | 'BUNDLE_INVALID_SCHEMA'
  | 'BUNDLE_CHECKSUM_MISMATCH'
  | 'BUNDLE_VERSION_MISMATCH'
  | 'PATH_REMAP_AMBIGUOUS'
  | 'PATH_NOT_FOUND'
  | 'BACKUP_FAILED'
  | 'ROLLBACK_NOT_AVAILABLE'
  | 'IMPORT_PARTIAL'
  | 'EXPORT_NOTHING_SELECTED'
  // share command rejects --include-credentials (NFR6); other share-time invalid-source conditions can also use this
  | 'SHARE_INVALID_SOURCE'
  | 'FIXPATHS_NO_PROJECTS'
  | 'INTERNAL';

const EXIT_CODE_MAP: Record<ErrorCode, 1 | 2> = {
  BUNDLE_INVALID_SCHEMA: 2,
  BUNDLE_CHECKSUM_MISMATCH: 2,
  BUNDLE_VERSION_MISMATCH: 2,
  PATH_REMAP_AMBIGUOUS: 2,
  PATH_NOT_FOUND: 2,
  BACKUP_FAILED: 2,
  ROLLBACK_NOT_AVAILABLE: 2,
  IMPORT_PARTIAL: 1,
  EXPORT_NOTHING_SELECTED: 1,
  SHARE_INVALID_SOURCE: 2,
  FIXPATHS_NO_PROJECTS: 1,
  INTERNAL: 2,
};

export interface CmemmovErrorOptions {
  code: ErrorCode;
  file?: string;
  operation?: string;
  hint?: string;
  cause?: unknown;
}

function buildMessage(options: CmemmovErrorOptions): string {
  const parts = [`[${options.code}]`];
  if (options.operation !== undefined) parts.push(` during ${options.operation}`);
  if (options.file !== undefined) parts.push(` on ${options.file}`);
  if (options.hint !== undefined) parts.push(` - ${options.hint}`);
  return parts.join('');
}

export class CmemmovError extends Error {
  readonly code: ErrorCode;
  readonly file?: string;
  readonly operation?: string;
  readonly hint?: string;
  readonly exitCode: 1 | 2;
  override readonly cause?: unknown;

  constructor(options: CmemmovErrorOptions) {
    super(
      buildMessage(options),
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'CmemmovError';
    this.code = options.code;
    if (options.file !== undefined) this.file = options.file;
    if (options.operation !== undefined) this.operation = options.operation;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.cause !== undefined) this.cause = options.cause;
    this.exitCode = EXIT_CODE_MAP[options.code];
  }
}
