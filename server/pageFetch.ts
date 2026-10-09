// Fetches the page of an article link for the library. Only public web
// addresses are fetched: never this server itself, the machine's local
// network or a cloud metadata address, also not after a redirect.

import dns from 'dns';
import net from 'net';

export class PageFetchError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 15_000;

// Addresses that are not on the public internet.
export const isPrivateAddress = (address: string): boolean => {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
      || (a === 169 && b === 254) // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
  }
  return true;
};

type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async host => (await dns.promises.lookup(host, { all: true })).map(a => a.address);

export const checkPublicUrl = async (raw: string, lookup: Lookup = systemLookup): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PageFetchError('This is not a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PageFetchError('Only http and https links can be read.');
  if (url.username || url.password) throw new PageFetchError('Links with a user name or password are not read.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new PageFetchError('Only links on the standard web ports are read.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : await lookup(host).catch(() => {
    throw new PageFetchError('This site could not be found.', 502);
  });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new PageFetchError('This address is not on the public internet.');
  return url;
};

const readLimited = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new PageFetchError('This page is too large to read.', 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  const charset = /charset=([\w-]+)/i.exec(response.headers.get('content-type') || '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
};

export const fetchPublicPage = async (raw: string, fetchImpl: typeof fetch = fetch, lookup?: Lookup): Promise<{ url: string; html: string }> => {
  let url = await checkPublicUrl(raw, lookup);
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinguaCards/1.0; +reading)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(e => {
      if ((e as Error)?.name === 'TimeoutError') throw new PageFetchError('The site took too long to answer.', 504);
      throw new PageFetchError('The site could not be reached from the server.', 502);
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (hop >= MAX_REDIRECTS) throw new PageFetchError('This link redirects too many times.', 502);
      url = await checkPublicUrl(new URL(response.headers.get('location')!, url).toString(), lookup);
      continue;
    }
    if (!response.ok) throw new PageFetchError(`The site answered with an error (${response.status}).`, 502);
    const type = response.headers.get('content-type') || '';
    if (type && !/html|text\/plain|xml/i.test(type)) throw new PageFetchError('This link is not a web page (PDF and other files are not read yet).', 415);
    return { url: url.toString(), html: await readLimited(response) };
  }
};
