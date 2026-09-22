#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!existsSync(join(root, 'dist/cli.js'))) {
  console.error(
    'Сначала собери исходники: npm install, затем npm run build. В готовом релизе сборка уже есть.',
  );
  process.exitCode = 1;
} else {
  const portable = existsSync(
    join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
  );
  if (portable) {
    // Playwright reads this at import time, before the CLI and its dependencies load.
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'browsers');
    const dataRoot =
      process.platform === 'win32'
        ? process.env.LOCALAPPDATA
        : join(homedir(), 'Library', 'Application Support');
    if (!dataRoot || !isAbsolute(dataRoot))
      throw new Error('Не найдена папка данных текущего пользователя.');
    const data = join(dataRoot, 'BarsHelper');
    await mkdir(data, { recursive: true, mode: 0o700 });
    process.chdir(data);
  } else {
    process.chdir(root);
  }
  await import(pathToFileURL(join(root, 'dist/cli.js')).href);
}
