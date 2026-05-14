import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BundleSchema, type Bundle } from '../core/bundle-schema.js';

const FIVE_MB = 5 * 1024 * 1024;

export function serializeBundle(bundle: Bundle): Buffer {
  const hasSessions = bundle.projects.some((p) => (p.sessions?.length ?? 0) > 0);

  // Normalize key order to Zod schema-declaration order so the canonical form
  // matches what parseBundle recomputes after BundleSchema.parse — without this,
  // applySanitization spreads can place wasRedacted after projects, causing a
  // checksum mismatch on any bundle that has stripped items.
  const normalized = BundleSchema.parse({ ...bundle, integrity: undefined });
  const bundleWithoutIntegrity: Omit<Bundle, 'integrity'> = { ...normalized };
  delete (bundleWithoutIntegrity as { integrity?: string }).integrity;
  const canonical = JSON.stringify(bundleWithoutIntegrity);
  const checksum = createHash('sha256').update(canonical, 'utf8').digest('hex');

  const finalBundle: Bundle = { ...normalized, integrity: checksum };
  const json = JSON.stringify(finalBundle, null, 2);
  const jsonBytes = Buffer.from(json, 'utf8');

  if (hasSessions || jsonBytes.length >= FIVE_MB) {
    return gzipSync(jsonBytes);
  }
  return jsonBytes;
}
