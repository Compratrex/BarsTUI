import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCommand } from '../scripts/install-command.mjs';

test('bars installer preserves shell settings, is repeatable, and quotes paths and arguments', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bars-command-'));
  const root = join(home, "project's folder"),
    cwd = join(home, 'other folder');
  try {
    await mkdir(root);
    await mkdir(cwd);
    const launcher = join(root, 'Bars Helper.command');
    await writeFile(launcher, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n');
    await chmod(launcher, 0o755);
    await writeFile(join(home, '.zshrc'), '# Existing user configuration\n');
    const command = await installCommand({ root, home, platform: 'darwin', shell: '/bin/zsh' });
    await installCommand({ root, home, platform: 'darwin', shell: '/bin/zsh' });
    const profile = await readFile(join(home, '.zshrc'), 'utf8');
    assert.ok(profile.startsWith('# Existing user configuration\n'));
    assert.equal(profile.match(/# Bars Helper command/g).length, 1);
    if (process.platform !== 'win32') {
      const args = ['--version', 'two words', '$not_an_expansion'];
      const output = execFileSync(command, args, { cwd, encoding: 'utf8' });
      // macOS resolves /var to /private/var in the child shell's PWD.
      assert.deepEqual(output.trim().split('\n').slice(1), args);
      assert.ok(output.split('\n')[0].endsWith('other folder'));
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('installer refuses to replace unrelated commands; Windows wrapper escapes percent characters', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bars-command-'));
  try {
    const root = join(home, 'app%name');
    await mkdir(root);
    await writeFile(join(root, 'Bars Helper.command'), '#!/bin/sh\n');
    await writeFile(join(root, 'Bars Helper.cmd'), '@echo off\r\n');
    const bin = join(home, '.local', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'bars'), 'unrelated tool');
    await assert.rejects(installCommand({ root, home, platform: 'darwin' }), /другая команда/);
    assert.equal(await readFile(join(bin, 'bars'), 'utf8'), 'unrelated tool');
    const command = await installCommand({
      root,
      home,
      platform: 'win32',
      localAppData: home,
      updatePath: false,
    });
    const content = await readFile(command, 'utf8');
    assert.match(content, /app%%name/);
    assert.match(content, /" %\*/);
    assert.match(content, /exit \/b %errorlevel%/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
