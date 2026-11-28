// File: /services/errorLog.ts
// The app's errors, kept on this device so they can be looked at later on
// «وضعیت و عیب‌یابی» and sent as one report. Before, an error showed for a
// moment (or not at all) and went to the console, which a phone does not
// show; "it did not work" could not be traced.
//
// Kept in localStorage (small, survives reloads, needs no database that may
// itself be what failed): at most MAX_ENTRIES, the newest first, a message
// repeated in a row counted instead of stored again. Nothing leaves the
// device unless the user copies the report.

export interface ErrorEntry {
  at: string; // ISO time of the latest occurrence
  where: string; // 'console' | 'window' | 'promise' or a label given by the app
  message: string;
  stack?: string;
  count: number; // occurrences in a row
  version?: string; // the app version it happened in
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ERROR_LOG_KEY = 'lc_error_log';
export const MAX_ENTRIES = 100;
const MAX_MESSAGE = 500;
const MAX_STACK = 1200;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

// A readable message and stack from whatever was thrown or logged.
export const describe = (value: unknown): { message: string; stack?: string } => {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, ...(value.stack ? { stack: value.stack } : {}) };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
};

export const readErrors = (store: KeyValueStore | undefined): ErrorEntry[] => {
  try {
    const raw = store?.getItem(ERROR_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(e => e && typeof e.message === 'string') : [];
  } catch {
    return [];
  }
};

// The log with one more error, newest first.
export const withError = (
  list: ErrorEntry[],
  entry: { where: string; message: string; stack?: string; version?: string },
  now: Date = new Date(),
): ErrorEntry[] => {
  const message = clip(entry.message.trim() || '(no message)', MAX_MESSAGE);
  const stack = entry.stack ? clip(entry.stack, MAX_STACK) : undefined;
  const last = list[0];
  if (last && last.message === message && last.where === entry.where) {
    return [{ ...last, at: now.toISOString(), count: last.count + 1 }, ...list.slice(1)];
  }
  const fresh: ErrorEntry = {
    at: now.toISOString(), where: entry.where, message, count: 1,
    ...(stack ? { stack } : {}), ...(entry.version ? { version: entry.version } : {}),
  };
  return [fresh, ...list].slice(0, MAX_ENTRIES);
};

const save = (
  store: KeyValueStore | undefined,
  entry: { where: string; message: string; stack?: string; version?: string },
  now: Date = new Date(),
): void => {
  if (!store) return;
  try {
    store.setItem(ERROR_LOG_KEY, JSON.stringify(withError(readErrors(store), entry, now)));
  } catch {
    // Storage full or blocked: the error is not kept, and must not throw here.
  }
};

export const recordError = (
  store: KeyValueStore | undefined,
  where: string,
  value: unknown,
  version?: string,
  now: Date = new Date(),
): void => save(store, { where, ...describe(value), version }, now);

export const clearErrors = (store: KeyValueStore | undefined): void => {
  try { store?.removeItem(ERROR_LOG_KEY); } catch { /* blocked storage */ }
};

// Plain text to paste into a message: where it happened first, then each
// error with its time, how often, and the first lines of its stack.
export const errorReport = (list: ErrorEntry[], about: { version: string; userAgent?: string; now?: Date }): string => {
  const head = [
    `Lingua Cards ${about.version}`,
    `Report made: ${(about.now ?? new Date()).toISOString()}`,
    ...(about.userAgent ? [`Browser: ${about.userAgent}`] : []),
    `Errors: ${list.length}`,
  ];
  const body = list.map(e => [
    `[${e.at}] (${e.where}${e.count > 1 ? `, ×${e.count}` : ''}${e.version && e.version !== about.version ? `, in ${e.version}` : ''}) ${e.message}`,
    ...(e.stack ? e.stack.split('\n').slice(0, 4).map(line => `    ${line.trim()}`) : []),
  ].join('\n'));
  return [...head, '', ...body].join('\n');
};

// Keeps every error the page reports: uncaught exceptions, rejected
// promises nobody handled, and what the app itself logs with console.error
// (failed syncs, saves, AI calls). Installed once, at start.
export const installErrorLog = (version: string): void => {
  if (typeof window === 'undefined') return;
  const store = (() => { try { return window.localStorage; } catch { return undefined; } })();
  if (!store || (window as any).__lcErrorLog) return;
  (window as any).__lcErrorLog = true;

  window.addEventListener('error', event => {
    recordError(store, 'window', event.error ?? event.message, version);
  });
  window.addEventListener('unhandledrejection', event => {
    recordError(store, 'promise', event.reason, version);
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    // "Sync failed: TypeError: …": the app's words, then the error's.
    const error = args.find(a => a instanceof Error);
    const text = args.filter(a => !(a instanceof Error)).map(a => describe(a).message).join(' ');
    const fromError = error ? describe(error) : undefined;
    save(store, {
      where: 'console',
      message: [text, fromError?.message].filter(Boolean).join(' '),
      ...(fromError?.stack ? { stack: fromError.stack } : {}),
      version,
    });
  };
};
