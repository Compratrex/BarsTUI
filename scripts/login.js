import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const AUTH_DIR = path.resolve('.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'bars-storage.json');
const START_URL = 'https://bars.mpei.ru/';

await fs.mkdir(AUTH_DIR, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

console.log('Открыл браузер. Войди в БАРС вручную.');
console.log('Когда вход будет завершен и откроется сайт БАРС, вернись в терминал и нажми Enter.');

await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once('data', resolve);
});

await page.context().storageState({ path: AUTH_FILE });
await browser.close();

console.log(`Сессия сохранена: ${AUTH_FILE}`);
