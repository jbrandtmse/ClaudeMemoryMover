import { z } from 'zod';

export const BUNDLE_FORMAT_VERSION = '1.1.0';

const MemoryFileSchema = z.object({
  filename: z.string(),
  content: z.string(),
}).strict();

const SessionFileSchema = z.object({
  filename: z.string(),
  lines: z.array(z.string()),
}).strict();

const CommandFileSchema = z.object({
  filename: z.string(),
  content: z.string(),
}).strict();

export const ProjectSchema = z.object({
  slug: z.string(),
  originalPath: z.string(),
  settings: z.unknown().optional(),
  memories: z.array(MemoryFileSchema).optional(),
  claudeMd: z.string().optional(),
  sessions: z.array(SessionFileSchema).optional(),
}).strict();

const GlobalSchema = z.object({
  settings: z.unknown().optional(),
  claudeJson: z.unknown().optional(),
  memories: z.array(MemoryFileSchema).optional(),
  claudeMd: z.string().optional(),
  customCommands: z.array(CommandFileSchema).optional(),
  teams: z.unknown().optional(),
  plugins: z.unknown().optional(),
  mcpConfig: z.unknown().optional(),
}).strict();

const CredentialsSchema = z.object({
  content: z.unknown(),
  wasRedacted: z.boolean(),
}).strict();

const WasRedactedSchema = z.object({
  credentials: z.boolean().optional(),
  personalMemoryFiles: z.array(z.string()).optional(),
  homeDirPermissionRules: z.array(z.string()).optional(),
  localMcpServers: z.array(z.string()).optional(),
  claudeJsonFields: z.array(z.string()).optional(),
}).strict();

export const BundleSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  sourcePlatform: z.enum(['win32', 'darwin', 'linux']),
  sourceHomedir: z.string(),
  claudeVersion: z.string(),
  profile: z.literal('team-baseline').optional(),
  hasCredentials: z.boolean(),
  warning: z.string().optional(),
  integrity: z.string().optional(),
  wasRedacted: WasRedactedSchema.optional(),
  projects: z.array(ProjectSchema),
  global: GlobalSchema,
  credentials: CredentialsSchema.optional(),
}).strict();

export type Bundle = z.infer<typeof BundleSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Global = z.infer<typeof GlobalSchema>;
export type CommandFile = z.infer<typeof CommandFileSchema>;
