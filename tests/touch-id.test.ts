import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchIdSessionUnlock } from '../src/infrastructure/auth/touch-id.js';

test('only an explicit successful native authentication unlocks the session', async () => {
  for (const status of [
    'authenticated',
    'cancelled',
    'unavailable',
    'locked-out',
    'failed',
  ] as const) {
    const controller = new AbortController();
    const unlock = new TouchIdSessionUnlock(async (signal) => {
      assert.equal(signal, controller.signal);
      return JSON.stringify({ version: 1, status });
    });
    assert.deepEqual(await unlock.unlock(controller.signal), { status });
  }
});

test('capability-only responses, invalid output and native errors fail closed', async () => {
  for (const output of [
    '{"version":1,"status":"available"}',
    '{"status":"authenticated"}',
    '{"version":2,"status":"authenticated"}',
    'true',
    'null',
    '"authenticated"',
    'authenticated',
    '',
    '{"version":1,"status":true}',
  ]) {
    assert.deepEqual(
      await new TouchIdSessionUnlock(async () => output).unlock(new AbortController().signal),
      { status: 'failed' },
    );
  }
  const unlock = new TouchIdSessionUnlock(async () => {
    throw new Error('Native details must not reach the interface');
  });
  assert.deepEqual(await unlock.unlock(new AbortController().signal), { status: 'failed' });
});

test('aborted attempts cannot prompt or accept a late successful result', async () => {
  const before = new AbortController();
  before.abort();
  const never = new TouchIdSessionUnlock(async () => {
    assert.fail('An aborted attempt must not start the helper');
  });
  assert.deepEqual(await never.unlock(before.signal), { status: 'cancelled' });
  const during = new AbortController();
  const late = new TouchIdSessionUnlock(async (signal) => {
    assert.equal(signal, during.signal);
    during.abort();
    return '{"version":1,"status":"authenticated"}';
  });
  assert.deepEqual(await late.unlock(during.signal), { status: 'cancelled' });
});
