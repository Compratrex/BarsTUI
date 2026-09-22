import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// src/ and dist/ have the same nesting, so assets resolve from either entry point.
const root = fileURLToPath(new URL('../../../', import.meta.url));

export function projectFile(...segments: string[]): string {
  return join(root, ...segments);
}
