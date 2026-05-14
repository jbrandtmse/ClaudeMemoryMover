import os from 'node:os';
import { join } from 'node:path';

export interface ClaudeLocation {
  claudeDir: string;
  claudeJson: string;
}

export function locateClaude(): ClaudeLocation {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir !== undefined && envDir.length > 0) {
    return { claudeDir: envDir, claudeJson: envDir + '.json' };
  }
  const home = os.homedir();
  return { claudeDir: join(home, '.claude'), claudeJson: join(home, '.claude.json') };
}

// Single allowed os.homedir() call site (enforced by no-restricted-imports ESLint rule).
export function getSourceHomedir(): string {
  return os.homedir();
}
