import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { BundleSchema, BUNDLE_FORMAT_VERSION, type Bundle } from '../core/bundle-schema.js';
import { CmemmovError } from '../core/error.js';

export interface ParseBundleOpts {
  noIntegrityCheck?: boolean;
  warn?: (msg: string) => void;
}

export function parseBundle(bytes: Buffer, opts?: ParseBundleOpts): Bundle {
  const warn = opts?.warn ?? ((): undefined => undefined);

  let buf: Buffer;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      buf = gunzipSync(bytes);
    } catch (cause) {
      throw new CmemmovError({
        code: 'BUNDLE_INVALID_SCHEMA',
        hint: 'gzip decompression failed',
        cause,
      });
    }
  } else {
    buf = bytes;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch (cause) {
    throw new CmemmovError({
      code: 'BUNDLE_INVALID_SCHEMA',
      hint: 'bundle JSON is malformed',
      cause,
    });
  }

  let bundle: Bundle;
  try {
    bundle = BundleSchema.parse(raw);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new CmemmovError({
        code: 'BUNDLE_INVALID_SCHEMA',
        hint: `schema validation failed: ${cause.issues[0]?.message ?? 'unknown'}`,
        cause,
      });
    }
    throw cause;
  }

  if (bundle.integrity !== undefined) {
    const canonical = computeCanonical(bundle);
    const computed = createHash('sha256').update(canonical, 'utf8').digest('hex');
    if (computed !== bundle.integrity) {
      if (opts?.noIntegrityCheck === true) {
        warn('Bundle checksum mismatch — proceeding because --no-integrity-check was specified.');
      } else {
        throw new CmemmovError({
          code: 'BUNDLE_CHECKSUM_MISMATCH',
          hint: 'Bundle may be corrupted. Use --no-integrity-check to skip.',
        });
      }
    }
  }

  if (bundle.version !== BUNDLE_FORMAT_VERSION) {
    warn(
      `Bundle format version '${bundle.version}' differs from expected '${BUNDLE_FORMAT_VERSION}'.`,
    );
  }

  return bundle;
}

function computeCanonical(bundle: Bundle): string {
  const rest: Omit<Bundle, 'integrity'> = { ...bundle };
  delete (rest as { integrity?: string }).integrity;
  return JSON.stringify(rest);
}
