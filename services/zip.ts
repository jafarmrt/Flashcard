// File: /services/zip.ts
// Reads the files of a ZIP archive (an EPUB book is one) in the browser,
// without a library: the central directory lists the files, and compressed
// ones are inflated with the built-in DecompressionStream.

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  read: () => Promise<Uint8Array>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const readZip = (buffer: ArrayBuffer): Map<string, ZipEntry> => {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // The end-of-directory record sits in the last 64 KB (after an optional comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('This file is not a ZIP archive (an EPUB file is one).');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError('The archive is damaged.');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.set(name, {
      name,
      read: async () => {
        if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new ZipError('The archive is damaged.');
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const data = bytes.subarray(start, start + compressedSize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new ZipError(`Unsupported compression in ${name}.`);
      },
    });
  }
  return entries;
};

export const readZipText = async (entries: Map<string, ZipEntry>, name: string): Promise<string | null> => {
  const entry = entries.get(name) || entries.get(decodeURIComponent(name));
  return entry ? new TextDecoder().decode(await entry.read()) : null;
};
