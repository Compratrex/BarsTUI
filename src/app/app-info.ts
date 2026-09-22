import { readFileSync } from 'node:fs';
import { projectFile } from '../shared/runtime/paths.js';

const info = JSON.parse(readFileSync(projectFile('package.json'), 'utf8')) as {
  version: string;
  codename: string;
};
export const APP_VERSION = info.version;
export const APP_CODENAME = info.codename;
