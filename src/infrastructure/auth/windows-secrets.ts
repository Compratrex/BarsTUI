import { execFile } from 'node:child_process';
import { projectFile } from '../../shared/runtime/paths.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { SecretEntry, SecretAccount } from './secret-store.js';

type Operation = 'protect' | 'unprotect';
export interface DataProtector {
  transform(operation: Operation, data: Buffer, purpose: SecretAccount): Promise<Buffer>;
}

async function runPowerShell(input: string): Promise<string> {
  if (
    process.platform !== 'win32' ||
    !process.env.SystemRoot ||
    !isAbsolute(process.env.SystemRoot)
  )
    throw new Error();
  const executable = join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const source = await readFile(projectFile('scripts', 'windows-dpapi.ps1'), 'utf8');

  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(source, 'utf16le').toString('base64'),
  ];
  return new Promise((resolve, reject) => {
    const failure = () => reject(new Error('Windows DPAPI недоступен.'));
    const child = execFile(
      executable,
      args,
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) failure();
        else resolve(stdout);
      },
    );
    child.stdin?.on('error', failure);
    child.stdin?.end(input);
  });
}

export class WindowsDataProtector implements DataProtector {
  constructor(private readonly invoke: (input: string) => Promise<string> = runPowerShell) {}
  async transform(operation: Operation, data: Buffer, purpose: SecretAccount): Promise<Buffer> {
    try {
      const response: unknown = JSON.parse(
        await this.invoke(JSON.stringify({ operation, purpose, data: data.toString('base64') })),
      );
      if (
        !response ||
        typeof response !== 'object' ||
        !('version' in response) ||
        response.version !== 1 ||
        !('data' in response) ||
        typeof response.data !== 'string'
      )
        throw new Error();
      const output = response.data;
      if (!output || output.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(output))
        throw new Error();
      const decoded = Buffer.from(output, 'base64');
      if (!decoded.length || decoded.toString('base64') !== output) throw new Error();
      return decoded;
    } catch {
      throw new Error('Не удалось выполнить шифрование или расшифровку данных Windows.');
    }
  }
}

export function windowsStorageDirectory(): string {
  const root = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !root || !isAbsolute(root))
    throw new Error('Папка защищённого хранилища Windows недоступна.');
  return join(root, 'BarsHelper');
}

export class WindowsProtectedEntry implements SecretEntry {
  private readonly file: string;
  constructor(
    private readonly account: SecretAccount,
    private readonly directory = windowsStorageDirectory(),
    private readonly cipher: DataProtector = new WindowsDataProtector(),
  ) {
    if (!['credentials-v1', 'session-v1', 'auth-v1'].includes(account))
      throw new Error('Неизвестная запись защищённого хранилища.');
    this.file = join(directory, `${account}.dpapi`);
  }
  async getPassword(): Promise<string | null> {
    try {
      let encrypted: Buffer;
      try {
        encrypted = await readFile(this.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const decrypted = await this.cipher.transform('unprotect', encrypted, this.account);
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(decrypted);
      } finally {
        decrypted.fill(0);
      }
    } catch {
      throw new Error('Не удалось прочитать защищённые данные Windows.');
    }
  }
  async setPassword(secret: string): Promise<void> {
    const temporary = join(this.directory, `.${this.account}-${randomUUID()}.tmp`);
    const plain = Buffer.from(secret, 'utf8');
    try {
      // Encrypt before touching the filesystem; both temporary and final files contain ciphertext only.
      const encrypted = await this.cipher.transform('protect', plain, this.account);
      if (!encrypted.length || encrypted.equals(plain)) throw new Error();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.file);
    } catch {
      throw new Error('Не удалось сохранить защищённые данные Windows.');
    } finally {
      plain.fill(0);
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  async deleteCredential(): Promise<boolean> {
    try {
      await unlink(this.file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new Error('Не удалось удалить защищённые данные Windows.');
    }
  }
}
