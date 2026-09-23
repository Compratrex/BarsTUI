import test from 'node:test';
import assert from 'node:assert/strict';
import { moveReleaseDirectory } from '../scripts/release-files.mjs';

test('release move retries a temporary Windows lock and preserves both paths', async () => {
  const waits = [];
  const calls = [];
  await moveReleaseDirectory('staging', 'release', {
    platform: 'win32',
    move: async (...paths) => {
      calls.push(paths);
      if (calls.length < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(
    calls,
    Array.from({ length: 3 }, () => ['staging', 'release']),
  );
  assert.deepEqual(waits, [200, 400]);
});

test('release move has a bounded retry and never masks other filesystem errors', async () => {
  for (const [platform, code, attempts] of [
    ['win32', 'EBUSY', 8],
    ['win32', 'ENOENT', 1],
    ['darwin', 'EPERM', 1],
  ]) {
    const error = Object.assign(new Error('move failed'), { code });
    let calls = 0;
    await assert.rejects(
      moveReleaseDirectory('staging', 'release', {
        platform,
        move: async () => {
          calls++;
          throw error;
        },
        wait: async () => {},
      }),
      (candidate) => candidate === error,
    );
    assert.equal(calls, attempts);
  }
});
