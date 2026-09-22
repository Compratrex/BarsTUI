import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { projectFile } from '../../shared/runtime/paths.js';
import { promisify } from 'node:util';

import type { UnlockResult, SessionUnlock } from '../../features/auth/contracts.js';

const execute = promisify(execFile);
const source = projectFile('scripts', 'touch-id.swift');
const cache = projectFile('.cache', 'touch-id');
class SetupError extends Error {}

async function helper(signal: AbortSignal): Promise<string> {
  try {
    signal.throwIfAborted();
    if (process.platform !== 'darwin') throw new SetupError();
    const bundled = projectFile('native', 'bars-touch-id');
    try {
      await access(bundled, constants.X_OK);
      return bundled;
    } catch {
      /* Development builds compile the helper below. */
    }
    const hash = createHash('sha256')
      .update(await readFile(source))
      .update(process.arch)
      .digest('hex')
      .slice(0, 20);
    const binary = join(cache, `bars-touch-id-${hash}`);
    try {
      await access(binary, constants.X_OK);
      return binary;
    } catch {
      /* Build once for this source and architecture. */
    }
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const build = await mkdtemp(join(cache, 'build-'));
    try {
      const output = join(build, 'bars-touch-id');
      await execute(
        '/usr/bin/xcrun',
        [
          'swiftc',
          '-O',
          '-swift-version',
          '5',
          source,
          '-o',
          output,
          '-module-cache-path',
          join(cache, 'modules'),
        ],
        { signal, timeout: 60_000, maxBuffer: 128 * 1024 },
      );
      signal.throwIfAborted();
      await rename(output, binary);
    } finally {
      await rm(build, { recursive: true, force: true });
    }
    return binary;
  } catch {
    signal.throwIfAborted();
    throw new SetupError();
  }
}

async function invokeNative(
  mode: '--check' | '--authenticate',
  signal: AbortSignal,
): Promise<string> {
  const binary = await helper(signal);
  signal.throwIfAborted();
  const { stdout } = await execute(binary, [mode], {
    signal,
    timeout: mode === '--check' ? 5_000 : 120_000,
    maxBuffer: 4096,
  });
  return stdout;
}

function readStatus(output: string): string | undefined {
  const result: unknown = JSON.parse(output);
  if (
    !result ||
    typeof result !== 'object' ||
    !('version' in result) ||
    result.version !== 1 ||
    !('status' in result)
  )
    return;
  return typeof result.status === 'string' ? result.status : undefined;
}

export class TouchIdSessionUnlock implements SessionUnlock {
  constructor(
    private readonly invoke: (signal: AbortSignal) => Promise<string> = (signal) =>
      invokeNative('--authenticate', signal),
  ) {}
  async unlock(signal: AbortSignal): Promise<UnlockResult> {
    if (signal.aborted) return { status: 'cancelled' };
    try {
      const status = readStatus(await this.invoke(signal));
      if (signal.aborted) return { status: 'cancelled' };
      if (
        status === 'authenticated' ||
        status === 'cancelled' ||
        status === 'unavailable' ||
        status === 'locked-out' ||
        status === 'failed'
      )
        return { status };
      return { status: 'failed' };
    } catch (error) {
      return {
        status: signal.aborted
          ? 'cancelled'
          : error instanceof SetupError
            ? 'setup-error'
            : 'failed',
      };
    }
  }
}

export async function checkTouchId(): Promise<{ status: string }> {
  const status = readStatus(await invokeNative('--check', new AbortController().signal));
  return {
    status:
      status === 'available' || status === 'unavailable' || status === 'locked-out'
        ? status
        : 'failed',
  };
}
