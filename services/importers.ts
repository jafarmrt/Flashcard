// File: /services/importers.ts
// Turns what the user brings (pasted text, a .txt file, an EPUB book, an
// article link) into a title, an author and chapters for the library. All of
// it runs in the browser; only an article's page is fetched by the server.

import type { SourceKind } from '../types';
import type { ChapterInput } from './library';
import { wordCount } from './textChunker';
import { readZip, readZipText, ZipEntry } from './zip';

export interface ImportedSource {
  kind: SourceKind;
  title: string;
  author?: string;
  url?: string;
  chapters: ChapterInput[];
}

// A chapter this long is cut into parts, so one chapter never makes a
// request too large to sync.
export const MAX_CHAPTER_WORDS = 30_000;

// --- Plain text ---

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last';
const HEADING = new RegExp(
  `^(?:(?:chapter|part|book|letter|section)\\s+(?:\\d+|[ivxlcdm]+|(?:${NUMBER_WORDS})(?:[\\s-](?:${NUMBER_WORDS}))*)\\b[^\\n]{0,60}|[IVXLC]{1,7}\\.?|\\d{1,3}\\.)$`,
  'i',
);

export const isChapterHeading = (line: string): boolean => {
  const text = line.trim();
  return text.length > 0 && text.length <= 70 && !text.includes('\n') && HEADING.test(text);
};

// A long text with headings such as "Chapter 3" or "XII" on a line of their
// own is split there; without at least two headings it stays one chapter.
export const splitTextIntoChapters = (text: string): ChapterInput[] => {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const found: { title: string; parts: string[] }[] = [{ title: '', parts: [] }];
  let headings = 0;
  for (const p of paragraphs) {
    if (isChapterHeading(p)) {
      headings++;
      found.push({ title: p.trim().replace(/\s+/g, ' '), parts: [] });
    } else if (p.trim()) {
      found[found.length - 1].parts.push(p.trim());
    }
  }
  if (headings < 2) return [{ title: '', text: text.trim() }];
  return found
    .map(c => ({ title: c.title || 'Opening', text: c.parts.join('\n\n') }))
    .filter(c => wordCount(c.text) > 0);
};

// Chapters longer than the limit become "Title · 1", "Title · 2"…, cut
// between paragraphs.
export const splitLongChapters = (chapters: ChapterInput[], maxWords = MAX_CHAPTER_WORDS): ChapterInput[] => {
  const out: ChapterInput[] = [];
  for (const chapter of chapters) {
    if (wordCount(chapter.text) <= maxWords) { out.push(chapter); continue; }
    const parts: string[][] = [[]];
    let words = 0;
    for (const p of chapter.text.split(/\n\s*\n/)) {
      const n = wordCount(p);
      if (words + n > maxWords && parts[parts.length - 1].length > 0) { parts.push([]); words = 0; }
      parts[parts.length - 1].push(p);
      words += n;
    }
    parts.forEach((p, i) => out.push({ title: `${chapter.title || 'Part'} · ${i + 1}`, text: p.join('\n\n') }));
  }
  return out;
};

export const importPlainText = (text: string, title = '', kind: SourceKind = 'text'): ImportedSource => {
  const lines = text.trim().split('\n');
  // A .txt book often starts with its title on the first line.
  const guessed = title || (lines[0] && lines[0].length <= 80 && lines.length > 3 ? lines[0].trim() : '');
  return { kind, title: guessed, chapters: splitLongChapters(splitTextIntoChapters(text)) };
};

// Chapters worth reading by default: front matter, a table of contents or a
// copyright page is offered but left unticked.
export const suggestedChapter = (c: ChapterInput): boolean =>
  wordCount(c.text) >= 40 && !/^(contents|table of contents|copyright|dedication|title page|cover|index|acknowledg)/i.test(c.title.trim());

// --- HTML (EPUB pages and articles) ---

const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DD', 'DT', 'FIGCAPTION', 'TD', 'TH']);
const SKIP = 'script, style, noscript, svg, math, nav, aside, iframe, form, button, sup, a[epub\\:type="noteref"], [role="doc-noteref"]';

const blockText = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const isBlock = (el: Element) => BLOCKS.has(el.localName.toUpperCase());

// The readable paragraphs of a page, separated by blank lines: each block
// element that holds no other block (a <p> inside a <blockquote> counts once),
// and loose text between blocks.
export const htmlToText = (root: Element): string => {
  root.querySelectorAll(SKIP).forEach(el => el.remove());
  const holdsBlock = new Map<Element, boolean>();
  const mark = (el: Element): boolean => {
    let found = false;
    for (const child of Array.from(el.children)) if (mark(child)) found = true;
    holdsBlock.set(el, found);
    return found || isBlock(el);
  };
  mark(root);

  const out: string[] = [];
  const emit = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean) out.push(clean);
  };
  const walk = (el: Element) => {
    if (!holdsBlock.get(el)) { emit(el.textContent || ''); return; }
    let loose = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) { loose += node.textContent || ''; continue; }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      if (isBlock(child) || holdsBlock.get(child)) {
        emit(loose);
        loose = '';
        walk(child);
      } else {
        loose += child.textContent || '';
      }
    }
    emit(loose);
  };
  walk(root);
  return out.join('\n\n');
};

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

const parseXml = (xml: string): Document => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return parseHtml(xml);
  return doc;
};

// --- EPUB ---

export class ImportError extends Error {}

const byLocalName = (doc: Document | Element, name: string): Element[] =>
  Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === name);

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

export const resolvePath = (base: string, href: string): string => {
  const clean = decodeURIComponent(href.split('#')[0]);
  const parts = (clean.startsWith('/') ? clean.slice(1) : dirOf(base) + clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
};

// Titles from the table of contents, by the file each entry opens.
const tocTitles = async (zip: Map<string, ZipEntry>, opfPath: string, opf: Document): Promise<Map<string, string>> => {
  const titles = new Map<string, string>();
  const items = byLocalName(opf, 'item');
  const add = (file: string, title: string) => { if (title && !titles.has(file)) titles.set(file, title.replace(/\s+/g, ' ').trim()); };

  const navItem = items.find(i => (i.getAttribute('properties') || '').split(/\s+/).includes('nav'));
  if (navItem) {
    const navPath = resolvePath(opfPath, navItem.getAttribute('href') || '');
    const navText = await readZipText(zip, navPath);
    if (navText) {
      const nav = parseXml(navText);
      const tocNav = byLocalName(nav, 'nav').find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || n.getAttribute('role') || 'toc')) || byLocalName(nav, 'nav')[0];
      for (const a of tocNav ? byLocalName(tocNav, 'a') : []) add(resolvePath(navPath, a.getAttribute('href') || ''), a.textContent || '');
    }
  }
  if (titles.size === 0) {
    const ncxId = byLocalName(opf, 'spine')[0]?.getAttribute('toc');
    const ncxItem = items.find(i => i.getAttribute('id') === ncxId) || items.find(i => i.getAttribute('media-type') === 'application/x-dtbncx+xml');
    if (ncxItem) {
      const ncxPath = resolvePath(opfPath, ncxItem.getAttribute('href') || '');
      const ncxText = await readZipText(zip, ncxPath);
      if (ncxText) {
        for (const point of byLocalName(parseXml(ncxText), 'navPoint')) {
          const label = byLocalName(point, 'text')[0]?.textContent || '';
          const src = byLocalName(point, 'content')[0]?.getAttribute('src') || '';
          add(resolvePath(ncxPath, src), label);
        }
      }
    }
  }
  return titles;
};

// The book's title, author and chapters in reading order. A page the table
// of contents points to starts a chapter; pages it skips join the chapter
// before them.
export const importEpub = async (buffer: ArrayBuffer): Promise<ImportedSource> => {
  const zip = readZip(buffer);
  const container = await readZipText(zip, 'META-INF/container.xml');
  const opfPath = container ? byLocalName(parseXml(container), 'rootfile')[0]?.getAttribute('full-path') : null;
  const opfText = opfPath ? await readZipText(zip, opfPath) : null;
  if (!opfPath || !opfText) throw new ImportError('This EPUB file has no book description (content.opf).');
  const opf = parseXml(opfText);

  const title = (byLocalName(opf, 'title')[0]?.textContent || '').trim();
  const author = (byLocalName(opf, 'creator')[0]?.textContent || '').trim();
  const manifest = new Map<string, Element>();
  for (const item of byLocalName(opf, 'item')) manifest.set(item.getAttribute('id') || '', item);
  const titles = await tocTitles(zip, opfPath, opf);

  const chapters: ChapterInput[] = [];
  let pageNumber = 0;
  for (const ref of byLocalName(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref') || '');
    if (!item || !/html/.test(item.getAttribute('media-type') || '')) continue;
    const path = resolvePath(opfPath, item.getAttribute('href') || '');
    const html = await readZipText(zip, path);
    if (!html) continue;
    pageNumber++;
    const doc = parseXml(html);
    const body = byLocalName(doc, 'body')[0] || doc.documentElement;
    const heading = byLocalName(body, 'h1')[0] || byLocalName(body, 'h2')[0];
    const tocTitle = titles.get(path);
    const text = htmlToText(body);
    if (!text) continue;
    if (tocTitle || chapters.length === 0 || titles.size === 0) {
      chapters.push({ title: tocTitle || blockText(heading || body).slice(0, 80) || `Section ${pageNumber}`, text });
    } else {
      chapters[chapters.length - 1].text += `\n\n${text}`;
    }
  }
  if (chapters.length === 0) throw new ImportError('No readable text was found in this EPUB file.');
  return { kind: 'book', title, ...(author ? { author } : {}), chapters: splitLongChapters(chapters) };
};

// --- Articles ---

// The main text of a fetched page: Mozilla's Readability (the engine of
// Firefox's reader view), or every paragraph of the page when it finds none.
export const importArticle = async (html: string, url: string): Promise<ImportedSource> => {
  const doc = parseHtml(html);
  const base = doc.createElement('base');
  base.href = url;
  doc.head?.prepend(base);
  const { Readability } = await import('@mozilla/readability');
  const article = new Readability(doc.cloneNode(true) as Document).parse();
  let text = '';
  if (article?.content) text = htmlToText(parseHtml(article.content).body);
  if (wordCount(text) < 50) {
    doc.querySelectorAll('header, footer, nav, aside, form').forEach(el => el.remove());
    text = htmlToText(doc.body);
  }
  if (wordCount(text) === 0) throw new ImportError('No readable text was found on this page.');
  const title = (article?.title || doc.title || '').trim();
  const author = (article?.byline || '').replace(/^by\s+/i, '').trim();
  return { kind: 'article', title, ...(author ? { author } : {}), url, chapters: splitLongChapters([{ title, text }]) };
};
