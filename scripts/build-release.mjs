import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { moveReleaseDirectory } from './release-files.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const info = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^(darwin-(arm64|x64)|win32-x64)$/.test(`${process.platform}-${process.arch}`))
  throw new Error(
    'Сборка поддерживает macOS arm64/x64 и Windows x64. Собирай на целевой ОС и архитектуре.',
  );
if (!process.env.npm_execpath) throw new Error('Запускай сборку через npm run release:build.');
const target = `${process.platform === 'darwin' ? 'macos' : 'windows'}-${process.arch}`;
const name = `bars-helper-${info.version}-${target}`;
const output = join(root, 'release'),
  stage = join(output, `.stage-${name}`),
  destination = join(output, name);
const cache = join(output, '.downloads');
await mkdir(cache, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

function run(program, args, { cwd = stage, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${program}: код завершения ${code}`)),
    );
  });
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function response(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!result.ok) throw new Error(`Загрузка ${url}: HTTP ${result.status}`);
  return result;
}
async function nodeRuntime() {
  const requested = process.env.BARS_RELEASE_NODE_VERSION;
  if (requested && !/^v?22\.\d+\.\d+$/.test(requested))
    throw new Error('BARS_RELEASE_NODE_VERSION должен иметь вид 22.x.y.');
  const channel = requested ? `v${requested.replace(/^v/, '')}` : 'latest-v22.x';
  const sums = await (await response(`https://nodejs.org/dist/${channel}/SHASUMS256.txt`)).text();
  const platform = process.platform === 'win32' ? 'win' : 'darwin';
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const match = sums.match(
    new RegExp(
      `^([a-f0-9]{64})\\s+(node-(v22\\.\\d+\\.\\d+)-${platform}-${process.arch}\\.${extension.replace('.', '\\.')})(?:\\r?$)`,
      'm',
    ),
  );
  if (!match) throw new Error('Не найден официальный архив Node.js для этой платформы.');
  const [, expected, filename, version] = match,
    archive = join(cache, filename);
  let cached = false;
  try {
    cached = (await hash(archive)) === expected;
  } catch {
    /* First download. */
  }
  if (!cached) {
    console.log(`Загрузка Node.js ${version} (${target})…`);
    const partial = `${archive}.partial`;
    await pipeline(
      Readable.fromWeb((await response(`https://nodejs.org/dist/${version}/${filename}`)).body),
      createWriteStream(partial),
    );
    if ((await hash(partial)) !== expected) {
      await rm(partial);
      throw new Error('Контрольная сумма Node.js не совпала.');
    }
    await rename(partial, archive);
  }
  const unpack = await mkdtemp(join(cache, 'unpack-'));
  try {
    await run(process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar', [
      '-xf',
      archive,
      '-C',
      unpack,
    ]);
    const extracted = join(unpack, `node-${version}-${platform}-${process.arch}`);
    await mkdir(join(stage, 'runtime'));
    const binary = process.platform === 'win32' ? 'node.exe' : 'node';
    await copyFile(
      join(extracted, process.platform === 'win32' ? binary : `bin/${binary}`),
      join(stage, 'runtime', binary),
    );
    await chmod(join(stage, 'runtime', binary), 0o755);
    await copyFile(join(extracted, 'LICENSE'), join(stage, 'runtime', 'LICENSE'));
    return { version, sha256: expected, file: filename };
  } finally {
    await rm(unpack, { recursive: true, force: true });
  }
}

console.log(`Сборка ${name}…`);
// Explicit allowlist: no sessions, caches, environment files, local scripts or user content.
for (const entry of ['dist', 'docs', 'README.md', 'package.json', 'package-lock.json']) {
  await cp(join(root, entry), join(stage, entry), { recursive: true });
}
await mkdir(join(stage, 'scripts'));
for (const entry of ['launch.mjs', 'install-command.mjs', 'windows-dpapi.ps1'])
  await copyFile(join(root, 'scripts', entry), join(stage, 'scripts', entry));
const launcher = process.platform === 'win32' ? 'Bars Helper.cmd' : 'Bars Helper.command';
await copyFile(join(root, launcher), join(stage, launcher));
await chmod(join(stage, launcher), 0o755);
const installer = process.platform === 'win32' ? 'Install bars.cmd' : 'Install bars.command';
await copyFile(join(root, installer), join(stage, installer));
await chmod(join(stage, installer), 0o755);
await chmod(join(stage, 'scripts/launch.mjs'), 0o755);
await run(process.execPath, [
  process.env.npm_execpath,
  'ci',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
]);
const node = await nodeRuntime();
const binary = join(stage, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
await run(
  binary,
  [join(stage, 'node_modules/playwright/cli.js'), 'install', '--only-shell', 'chromium'],
  {
    env: { PLAYWRIGHT_BROWSERS_PATH: join(stage, 'browsers') },
  },
);
// Browser GC stores an absolute installation path here; the portable bundle does not need it.
await rm(join(stage, 'browsers/.links'), { recursive: true, force: true });
if (process.platform === 'darwin') {
  await mkdir(join(stage, 'native'));
  await run('/usr/bin/xcrun', [
    'swiftc',
    '-O',
    '-swift-version',
    '5',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
    join(root, 'scripts/touch-id.swift'),
    '-o',
    join(stage, 'native/bars-touch-id'),
    '-module-cache-path',
    join(cache, `swift-${process.arch}`),
  ]);
}
const playwright = JSON.parse(
  await readFile(join(stage, 'node_modules/playwright/package.json'), 'utf8'),
).version;
await writeFile(
  join(stage, 'release-info.json'),
  JSON.stringify(
    { version: info.version, codename: info.codename, target, node, playwright },
    null,
    2,
  ) + '\n',
);
await writeFile(
  join(stage, 'THIRD-PARTY-NOTICES.txt'),
  'Node.js: runtime/LICENSE\nJavaScript dependencies: node_modules/*/{LICENSE,NOTICE,package.json}\nChromium / FFmpeg: licensing and credits files inside browsers/\nNo personal account or session data is included.\n',
);

// Move before testing, so machine-specific source paths cannot accidentally make the test pass.
await rm(destination, { recursive: true, force: true });
await moveReleaseDirectory(stage, destination);
const runtime = join(destination, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
await run(runtime, [join(destination, 'scripts/launch.mjs'), '--version'], { cwd: output });
await run(runtime, [join(destination, 'scripts/launch.mjs'), '--self-test'], { cwd: output });
const archive = join(output, `${name}.zip`);
await rm(archive, { force: true });
if (process.platform === 'darwin') {
  await run(
    '/usr/bin/ditto',
    ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', destination, archive],
    { cwd: output },
  );
} else {
  // .NET includes hidden entries, unlike Compress-Archive. Paths are data, not shell code.
  await run(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:BARS_ZIP_SOURCE, $env:BARS_ZIP_TARGET, [IO.Compression.CompressionLevel]::Optimal, $true)',
    ],
    {
      cwd: output,
      env: { BARS_ZIP_SOURCE: destination, BARS_ZIP_TARGET: archive },
    },
  );
}
await writeFile(`${archive}.sha256`, `${await hash(archive)}  ${name}.zip\n`);
console.log(`Готово: ${archive}`);
