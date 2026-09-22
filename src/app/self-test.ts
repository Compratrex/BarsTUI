import { chromium } from 'playwright';
import { checkTouchId } from '../infrastructure/auth/touch-id.js';
import { WindowsDataProtector } from '../infrastructure/auth/windows-secrets.js';

/** Package smoke check: local synthetic data only, no account access and no fingerprint prompt. */
export async function selfTest() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Bars Helper smoke test</title>');
    if ((await page.title()) !== 'Bars Helper smoke test')
      throw new Error('Chromium: неверный результат проверки.');
    console.log('Chromium: OK');
  } finally {
    await browser.close();
  }
  if (process.platform === 'darwin') {
    await import('@napi-rs/keyring');
    console.log('Модуль Связки ключей: OK');
    const touchId = await checkTouchId();
    if (touchId.status === 'failed') throw new Error('Touch ID: неверный ответ модуля.');
    console.log(`Модуль Touch ID: OK (${touchId.status})`);
  } else if (process.platform === 'win32') {
    const cipher = new WindowsDataProtector(),
      data = Buffer.from('Bars Helper — synthetic test');
    const encrypted = await cipher.transform('protect', data, 'auth-v1');
    const decrypted = await cipher.transform('unprotect', encrypted, 'auth-v1');
    if (encrypted.equals(data) || !decrypted.equals(data))
      throw new Error('DPAPI: неверный результат проверки.');
    console.log('Windows DPAPI: OK');
  }
  console.log('Проверка сборки завершена. Данные входа не использовались.');
}
