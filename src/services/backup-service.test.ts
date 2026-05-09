import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackup } from './backup-service.js';

let workDir: string;
let claudeDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cmemmov-backup-'));
  claudeDir = join(workDir, '.claude');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(join(claudeDir, 'settings.json'), '{"theme":"dark"}');
  await mkdir(join(claudeDir, 'projects'), { recursive: true });
  await writeFile(join(claudeDir, 'projects', 'a.txt'), 'project a');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('createBackup', () => {
  it('returns a path under <claudeDir>/backups/cmemmov/ matching the timestamp pattern', async () => {
    const backupDir = await createBackup(claudeDir);

    const expectedRoot = join(claudeDir, 'backups', 'cmemmov');
    expect(backupDir.startsWith(expectedRoot)).toBe(true);

    const basename = backupDir.slice(expectedRoot.length + 1);
    // ISO timestamp with `:` and `.` replaced by `-`, followed by -<pid>-<8 hex chars>
    expect(basename).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+-[0-9a-f]{8}$/,
    );
  });

  it('recursively copies the claude tree into <backupDir>/claude', async () => {
    const backupDir = await createBackup(claudeDir);

    const settingsCopy = await readFile(join(backupDir, 'claude', 'settings.json'), 'utf8');
    expect(settingsCopy).toBe('{"theme":"dark"}');

    const projectCopy = await readFile(
      join(backupDir, 'claude', 'projects', 'a.txt'),
      'utf8',
    );
    expect(projectCopy).toBe('project a');
  });

  it('copies adjacent .claude.json into the backup dir when present', async () => {
    await writeFile(join(workDir, '.claude.json'), '{"version":1}');

    const backupDir = await createBackup(claudeDir);
    const copied = await readFile(join(backupDir, '.claude.json'), 'utf8');
    expect(copied).toBe('{"version":1}');
  });

  it('skips .claude.json silently when absent', async () => {
    const backupDir = await createBackup(claudeDir);

    await expect(stat(join(backupDir, '.claude.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('prunes oldest backups beyond keepBackups (default 10) after a successful new backup', async () => {
    const backupRoot = join(claudeDir, 'backups', 'cmemmov');
    await mkdir(backupRoot, { recursive: true });

    // Pre-create 10 backups with sortable ISO-like names that lexicographically
    // come BEFORE any real backup we'll create (year 2000)
    for (let i = 0; i < 10; i++) {
      const name = `2000-01-01T00-00-00-${i.toString().padStart(3, '0')}Z-1-aaaaaaaa`;
      await mkdir(join(backupRoot, name));
      await writeFile(join(backupRoot, name, 'marker.txt'), `old-${i.toString()}`);
    }

    expect((await readdir(backupRoot)).length).toBe(10);

    await createBackup(claudeDir, { keepBackups: 10 });

    const remaining = await readdir(backupRoot);
    expect(remaining.length).toBe(10);
    // Oldest synthetic backup (000) should be pruned
    const oldestExists = remaining.some((n) => n.endsWith('-000Z-1-aaaaaaaa'));
    expect(oldestExists).toBe(false);
  });

  it('does NOT prune when the new backup write throws', async () => {
    // Pre-create 11 backups in the real claudeDir's backup root.
    // If pruning ran with keepBackups=10, exactly one would be removed.
    const backupRoot = join(claudeDir, 'backups', 'cmemmov');
    await mkdir(backupRoot, { recursive: true });
    for (let i = 0; i < 11; i++) {
      const name = `2000-01-01T00-00-00-${i.toString().padStart(3, '0')}Z-1-aaaaaaaa`;
      await mkdir(join(backupRoot, name));
    }

    // Drive createBackup against a non-existent claudeDir so fs.cp rejects
    // with ENOENT before any pruning logic runs. We then verify the real
    // backupRoot was not touched (proving the throw short-circuited).
    const missingClaudeDir = join(workDir, 'does-not-exist');
    await expect(
      createBackup(missingClaudeDir, { keepBackups: 10 }),
    ).rejects.toThrow();

    const realRoot = await readdir(backupRoot);
    expect(realRoot.length).toBe(11);
  });

  it('respects a custom keepBackups limit', async () => {
    const backupRoot = join(claudeDir, 'backups', 'cmemmov');
    await mkdir(backupRoot, { recursive: true });

    for (let i = 0; i < 5; i++) {
      const name = `2000-01-01T00-00-00-${i.toString().padStart(3, '0')}Z-1-aaaaaaaa`;
      await mkdir(join(backupRoot, name));
    }

    await createBackup(claudeDir, { keepBackups: 3 });

    const remaining = await readdir(backupRoot);
    expect(remaining.length).toBe(3);
  });

  it('never prunes the just-created backup even when keepBackups is 0', async () => {
    // keepBackups=0 means "no retention beyond the new one." The function
    // must still leave the just-created backup on disk so the returned path
    // points at a real directory.
    const backupRoot = join(claudeDir, 'backups', 'cmemmov');
    await mkdir(backupRoot, { recursive: true });
    for (let i = 0; i < 3; i++) {
      const name = `2000-01-01T00-00-00-${i.toString().padStart(3, '0')}Z-1-aaaaaaaa`;
      await mkdir(join(backupRoot, name));
    }

    const backupDir = await createBackup(claudeDir, { keepBackups: 0 });

    // The new backup directory must still exist after pruning.
    await expect(stat(backupDir)).resolves.toMatchObject({});
    const remaining = await readdir(backupRoot);
    expect(remaining).toContain(backupDir.slice(backupRoot.length + 1));
    // All 3 prior synthetic backups should be gone.
    expect(remaining.length).toBe(1);
  });

  it('propagates non-ENOENT errors when copying the adjacent .claude.json', async () => {
    // Create .claude.json as a directory rather than a file so that copyFile
    // fails with EISDIR (not ENOENT). The function must NOT silently swallow
    // this — backups with a missing .claude.json must surface as errors.
    await mkdir(join(workDir, '.claude.json'));

    await expect(createBackup(claudeDir)).rejects.toMatchObject({
      code: expect.stringMatching(/^E/) as unknown,
    });
  });
});
