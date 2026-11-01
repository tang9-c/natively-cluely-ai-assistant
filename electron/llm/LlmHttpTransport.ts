import { app } from 'electron';
import { version } from '../../package.json';

export function getLlmUserAgent(): string {
  // Electron's running version is authoritative; Node-mode tests have no app.
  return `CueUp/${app?.getVersion() ?? version}`;
}

export const llmFetch: typeof globalThis.fetch = (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  // Headers.set replaces case-insensitive SDK or custom-cURL identities.
  headers.set('User-Agent', getLlmUserAgent());
  return globalThis.fetch(input, { ...init, headers });
};
