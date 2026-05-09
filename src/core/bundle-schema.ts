import { z } from 'zod';

export const BUNDLE_FORMAT_VERSION = '1.0.0';

const MemoryFileSchema = z.object({
  filename: z.string(),
  content: z.string(),
}).strict();

const SessionFileSchema = z.object({
  filename: z.string(),
  lines: z.array(z.string()),
}).strict();

export const ProjectSchema = z.object({
  slug: z.string(),
  originalPath: z.string(),
  settings: z.unknown().optional(),
  memories: z.array(MemoryFileSchema).optional(),
  sessions: z.array(SessionFileSchema).optional(),
}).strict();

const GlobalSchema = z.object({
  settings: z.unknown().optional(),
  claudeJson: z.unknown().optional(),
  memories: z.array(MemoryFileSchema).optional(),
}).strict();

const CredentialsSchema = z.object({
  content: z.unknown(),
  wasRedacted: z.boolean(),
}).strict();

export const BundleSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  sourcePlatform: z.enum(['win32', 'darwin', 'linux']),
  claudeVersion: z.string(),
  hasCredentials: z.boolean(),
  integrity: z.string().optional(),
  projects: z.array(ProjectSchema),
  global: GlobalSchema,
  credentials: CredentialsSchema.optional(),
}).strict();

export type Bundle = z.infer<typeof BundleSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Global = z.infer<typeof GlobalSchema>;
