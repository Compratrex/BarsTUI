import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Windows may briefly retain a handle to the bundled runtime after its process exits.
export async function moveReleaseDirectory(
  source,
  destination,
  { platform = process.platform, move = rename, wait = delay } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await move(source, destination);
      return;
    } catch (error) {
      if (
        platform !== 'win32' ||
        !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) ||
        attempt >= 7
      )
        throw error;
      await wait(Math.min(200 * 2 ** attempt, 2_000));
    }
  }
}
