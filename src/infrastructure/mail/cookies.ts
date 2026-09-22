import { parseCookie } from 'undici';

/** In-memory cookies scoped to the university mail host and its login form. */
export class MailCookies {
  private readonly values = new Map<
    string,
    { name: string; value: string; path: string; expires: number }
  >();
  constructor(
    private readonly endpoint: URL,
    private readonly now: () => number = Date.now,
  ) {}
  remember(headers: Headers, source: URL = this.endpoint) {
    if (source.origin !== this.endpoint.origin) return;
    for (const line of headers.getSetCookie()) {
      const cookie = parseCookie(line);
      if (
        !cookie?.name ||
        /[\x00-\x20\x7f;,=]/.test(cookie.name) ||
        /[\x00-\x1f\x7f;]/.test(cookie.value)
      )
        continue;
      const domain = cookie.domain?.toLowerCase().replace(/^\./, '') ?? this.endpoint.hostname;
      // Accept only this university's domain or this exact mail host.
      if (domain !== this.endpoint.hostname && domain !== 'mpei.ru') continue;
      const path = cookie.path?.startsWith('/')
        ? cookie.path
        : source.pathname.slice(0, source.pathname.lastIndexOf('/')) || '/';
      if (cookie.secure && this.endpoint.protocol !== 'https:') continue;
      const key = `${domain}\n${path}\n${cookie.name}`;
      const parsedExpiry =
        cookie.expires instanceof Date ? cookie.expires.getTime() : cookie.expires;
      const expires =
        cookie.maxAge !== undefined
          ? this.now() + cookie.maxAge * 1000
          : Number.isFinite(parsedExpiry)
            ? parsedExpiry!
            : Infinity;
      if (expires <= this.now()) this.values.delete(key);
      else this.values.set(key, { name: cookie.name, value: cookie.value, path, expires });
    }
  }
  header(target: URL = this.endpoint) {
    if (target.origin !== this.endpoint.origin) return '';
    for (const [key, cookie] of this.values)
      if (cookie.expires <= this.now()) this.values.delete(key);
    return [...this.values.values()]
      .filter(
        (cookie) =>
          target.pathname === cookie.path ||
          target.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
  clear() {
    this.values.clear();
  }
}
