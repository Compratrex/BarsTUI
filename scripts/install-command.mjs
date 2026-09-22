import { access, appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const marker = 'Bars Helper command';
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function existing(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export async function installCommand({
  root,
  platform = process.platform,
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA,
  shell = process.env.SHELL ?? '',
  updatePath = true,
}) {
  if (!['darwin', 'win32'].includes(platform))
    throw new Error('Установщик команды поддерживает macOS и Windows.');
  if (platform === 'win32' && (!localAppData || !isAbsolute(localAppData)))
    throw new Error('Не найдена папка LOCALAPPDATA.');
  const directory =
    platform === 'darwin' ? join(home, '.local', 'bin') : join(localAppData, 'BarsHelper', 'bin');
  const command = join(directory, platform === 'darwin' ? 'bars' : 'bars.cmd');
  const launcher = join(root, platform === 'darwin' ? 'Bars Helper.command' : 'Bars Helper.cmd');
  await access(launcher);
  const previous = await existing(command);
  if (previous && !previous.includes(marker))
    throw new Error(`В ${command} уже находится другая команда. Она не была заменена.`);
  await mkdir(directory, { recursive: true });
  const script =
    platform === 'darwin'
      ? `#!/bin/sh\n# ${marker}\nexec ${quote(launcher)} "$@"\n`
      : `@echo off\r\nrem ${marker}\r\ncall "${launcher.replaceAll('%', '%%')}" %*\r\nexit /b %errorlevel%\r\n`;
  await writeFile(command, script, { mode: 0o755 });
  await chmod(command, 0o755);
  if (updatePath) {
    if (platform === 'darwin') {
      const profile = join(home, shell.endsWith('/bash') ? '.bash_profile' : '.zshrc');
      const content = await existing(profile);
      if (!content.includes(`# ${marker}`)) {
        await appendFile(
          profile,
          `\n# ${marker}\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) export PATH="$HOME/.local/bin:$PATH" ;;\nesac\n`,
          { mode: 0o600 },
        );
      }
    } else {
      execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$p=[Environment]::GetEnvironmentVariable("Path","User"); $d=$env:BARS_COMMAND_DIRECTORY; if (($p -split ";") -notcontains $d) { [Environment]::SetEnvironmentVariable("Path", ($d+";"+$p), "User") }',
        ],
        { stdio: 'inherit', env: { ...process.env, BARS_COMMAND_DIRECTORY: directory } },
      );
    }
  }
  return command;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = await installCommand({
      root: dirname(dirname(fileURLToPath(import.meta.url))),
      updatePath: !process.argv.includes('--no-path'),
    });
    console.log(
      `Команда установлена: ${command}\nОткрой новое окно терминала и введи bars. Папка приложения должна оставаться на месте.`,
    );
    if (process.platform === 'win32')
      console.log(
        'Если Windows Terminal уже был открыт, полностью закрой его и открой заново. При необходимости выйди из учётной записи Windows и войди снова.',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
