import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Bundle } from '../core/bundle-schema.js';

const FIVE_MB = 5 * 1024 * 1024;

export function serializeBundle(bundle: Bundle): Buffer {
  const hasSessions = bundle.projects.some((p) => (p.sessions?.length ?? 0) > 0);

  const bundleWithoutIntegrity: Omit<Bundle, 'integrity'> = { ...bundle };
  delete (bundleWithoutIntegrity as { integrity?: string }).integrity;
  const canonical = JSON.stringify(bundleWithoutIntegrity);
  const checksum = createHash('sha256').update(canonical, 'utf8').digest('hex');

  const finalBundle: Bundle = { ...bundle, integrity: checksum };
  const json = JSON.stringify(finalBundle, null, 2);
  const jsonBytes = Buffer.from(json, 'utf8');

  if (hasSessions || jsonBytes.length >= FIVE_MB) {
    return gzipSync(jsonBytes);
  }
  return jsonBytes;
}
