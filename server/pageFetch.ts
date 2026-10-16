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
    const h = ipv6Hextets(address);
    if (!h) return true;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const zeros = (from: number, to: number) => h.slice(from, to).every(x => x === 0);
    // IPv4 inside IPv6: mapped (::ffff:a.b.c.d, also written ::ffff:7f00:1),
    // compatible (::a.b.c.d, and :: / ::1), translated (::ffff:0:a.b.c.d),
    // NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
    if (zeros(0, 5) && h[5] === 0xffff) return isPrivateAddress(v4(h[6], h[7]));
    if (zeros(0, 6)) return true;
    if (zeros(0, 4) && h[4] === 0xffff && h[5] === 0) return isPrivateAddress(v4(h[6], h[7]));
    if (h[0] === 0x64 && h[1] === 0xff9b) return zeros(2, 6) ? isPrivateAddress(v4(h[6], h[7])) : true; // 64:ff9b:1::/48 is local
    if (h[0] === 0x2002) return isPrivateAddress(v4(h[1], h[2]));
    return (h[0] & 0xfe00) === 0xfc00 // unique local fc00::/7
      || (h[0] & 0xffc0) === 0xfe80 // link-local fe80::/10
      || (h[0] & 0xffc0) === 0xfec0 // old site-local fec0::/10
      || (h[0] & 0xff00) === 0xff00 // multicast
      || (h[0] === 0x100 && zeros(1, 4)) // discard 100::/64
      || (h[0] === 0x2001 && h[1] === 0) // Teredo: reaches IPv4 hosts
      || (h[0] === 0x2001 && h[1] === 0xdb8); // documentation
  }
  return true;
};

// The eight 16-bit groups of an IPv6 address, with "::" and a dotted IPv4
// tail expanded. Undefined for anything that is not one.
const ipv6Hextets = (address: string): number[] | undefined => {
  let text = address.toLowerCase().replace(/%.*$/, '');
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return undefined;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const part = (s: string) => (s ? s.split(':') : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map(g => parseInt(g, 16));
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
  await checkPublicHost(url, lookup);
  return url;
};

// Throws unless every address the host name stands for is on the public internet.
export const checkPublicHost = async (url: URL, lookup: Lookup = systemLookup): Promise<void> => {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : await lookup(host).catch(() => {
    throw new PageFetchError('This site could not be found.', 502);
  });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new PageFetchError('This address is not on the public internet.');
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
