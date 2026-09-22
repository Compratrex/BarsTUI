import { stripVTControlCharacters } from 'node:util';

export function mailText(value: string, multiline = false): string {
  const clean = stripVTControlCharacters(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\u00a0/g, ' ');
  return multiline
    ? clean
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : clean.replace(/\s+/g, ' ').trim();
}
