export const APP_ICOL_STORAGE_PREFIX = 'app-icol:';

export function clearAppIcolLocalStorage(storage: Storage = window.localStorage): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(APP_ICOL_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    storage.removeItem(key);
  }
}

export function stripResetMockFromHash(rawHash: string): {
  didStrip: boolean;
  cleanHash: string;
} {
  if (!rawHash || !rawHash.includes('resetMock=')) {
    return { didStrip: false, cleanHash: rawHash };
  }
  const withoutPound = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const qIndex = withoutPound.indexOf('?');
  if (qIndex === -1) {
    return { didStrip: false, cleanHash: rawHash };
  }
  const hashPath = withoutPound.slice(0, qIndex);
  const hashParams = new URLSearchParams(withoutPound.slice(qIndex + 1));
  const val = hashParams.get('resetMock');
  if (val !== '1' && val !== 'true') {
    return { didStrip: false, cleanHash: rawHash };
  }
  hashParams.delete('resetMock');
  const qs = hashParams.toString();
  return {
    didStrip: true,
    cleanHash: `#${hashPath}${qs ? `?${qs}` : ''}`,
  };
}

export function processBootstrapUrlReset(win: Window = window): boolean {
  const url = new URL(win.location.href);
  const queryVal = url.searchParams.get('resetMock');
  const hasQueryReset = queryVal === '1' || queryVal === 'true';
  const { didStrip: hasHashReset, cleanHash } = stripResetMockFromHash(url.hash);

  if (!hasQueryReset && !hasHashReset) {
    return false;
  }

  clearAppIcolLocalStorage(win.localStorage);

  if (hasQueryReset) {
    url.searchParams.delete('resetMock');
  }
  const finalHash = hasHashReset ? cleanHash : url.hash;
  const nextUrl = `${url.pathname}${url.search}${finalHash}`;
  win.history.replaceState(win.history.state, '', nextUrl);
  return true;
}
