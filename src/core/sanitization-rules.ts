import type { Bundle } from './bundle-schema.js';

// `profile` is reserved for the union it becomes in Story 4.1 (adds 'strip-personal').
// Returns the input reference unchanged when no credentials are present; otherwise
// returns a shallow copy — top-level fields (projects, global, etc.) share identity.
export function applySanitization(bundle: Bundle, profile: 'redact-credentials'): Bundle {
  void profile;
  if (!bundle.credentials) return bundle;
  return {
    ...bundle,
    credentials: { content: null, wasRedacted: true },
  };
}
