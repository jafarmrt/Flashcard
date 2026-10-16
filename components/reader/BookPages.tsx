// File: /components/reader/BookPages.tsx
// A section of a book laid out as pages, like a printed book: the text flows
// into CSS columns as tall as the screen, and a page turn moves the next
// columns into view. Every word stays in the page (with its global index in
// data-wi), so a tap, a drag, read-aloud and the word's highlights work as in
// the scrolling reader. Wide screens show two facing pages.

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

const GAP = 64; // between two columns, and between page spreads
const TWO_PAGES_FROM = 960; // px of page area for two facing pages
const ONE_PAGE_MAX = 700; // a single page is not wider than a book page
const TWO_PAGES_MAX = 1240;

export interface PageLayout { width: number; height: number; spread: 1 | 2; roomWidth: number }

// One page, or two facing pages, for the room there is.
export const pageLayout = (roomWidth: number, roomHeight: number): PageLayout => {
  const spread = roomWidth >= TWO_PAGES_FROM ? 2 : 1;
  return { width: Math.floor(Math.min(roomWidth, spread === 2 ? TWO_PAGES_MAX : ONE_PAGE_MAX)), height: Math.max(120, Math.floor(roomHeight)), spread, roomWidth };
};

// Which page a horizontal offset (from the start of the text) falls on. Half
// a gap of leeway: a word may start a few pixels before its column (its own
// negative margin), never as far back as the gap between pages.
export const pageOfOffset = (offset: number, width: number): number => Math.max(0, Math.floor((offset + GAP / 2) / (width + GAP)));

interface Pagination {
  layout: PageLayout | null;
  pages: number;
  page: number;
  turnTo: (page: number) => void;
  pageOfWord: (index: number) => number;
  firstWordOn: (page: number) => number;
}

// Pages of the text in `content`, laid out in `room`. `anchor` is the word
// the reader is at: after a resize or a new font size the page that holds it
// is shown, so the place is never lost.
export const usePagination = (room: React.RefObject<HTMLElement>, content: React.RefObject<HTMLElement>, anchorWord: number, relayoutKey: string): Pagination & { onAnchor: (word: number) => void } => {
  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const anchor = useRef(anchorWord);

  const words = (): HTMLElement[] => (content.current ? Array.from(content.current.querySelectorAll<HTMLElement>('[data-wi]')) : []);
  const offsetOf = (el: Element) => {
    const box = content.current!.getBoundingClientRect();
    return el.getBoundingClientRect().left - box.left;
  };
  const pageOfWord = useCallback((index: number): number => {
    if (!content.current || !layout) return 0;
    const el = content.current.querySelector(`[data-wi="${index}"]`);
    return el ? pageOfOffset(offsetOf(el), layout.width) : 0;
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstWordOn = useCallback((p: number): number => {
    if (!layout) return 0;
    for (const el of words()) if (pageOfOffset(offsetOf(el), layout.width) >= p) return Number(el.dataset.wi);
    return 0;
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // The room's size decides the page size.
  useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    const measure = () => {
      const next = pageLayout(el.clientWidth, el.clientHeight);
      setLayout(prev => (prev && prev.width === next.width && prev.height === next.height && prev.spread === next.spread && prev.roomWidth === next.roomWidth ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [room, relayoutKey]); // the room appears when book mode is turned on

  // Count the pages and go to the anchor's page whenever the layout or the
  // type changes; fonts arriving late count too.
  useLayoutEffect(() => {
    if (!layout || !content.current) return;
    const count = () => {
      const all = words();
      const last = all[all.length - 1];
      const n = last ? pageOfOffset(offsetOf(last), layout.width) + 1 : 1;
      setPages(n);
      const el = content.current?.querySelector(`[data-wi="${anchor.current}"]`);
      setPage(Math.min(n - 1, el ? pageOfOffset(offsetOf(el), layout.width) : 0));
    };
    count();
    let live = true;
    document.fonts?.ready.then(() => { if (live) count(); });
    return () => { live = false; };
  }, [layout, relayoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const turnTo = (p: number) => {
    const next = Math.max(0, Math.min(pages - 1, p));
    setPage(next);
    anchor.current = firstWordOn(next);
  };

  return { layout, pages, page, turnTo, pageOfWord, firstWordOn, onAnchor: word => { anchor.current = word; } };
};

// The columns themselves: `page` decides which ones are in view.
export const PageColumns: React.FC<{ layout: PageLayout; page: number; contentRef: React.RefObject<HTMLDivElement>; children: React.ReactNode }> = ({ layout, page, contentRef, children }) => (
  <div dir="ltr" className="relative overflow-hidden mx-auto" style={{ width: layout.width, height: layout.height }}>
    {/* An English book: its columns, and so its pages, run left to right. */}
    <div ref={contentRef} dir="ltr" style={{
      width: layout.width,
      height: layout.height,
      columnCount: layout.spread,
      columnGap: GAP,
      columnFill: 'auto',
      transform: `translateX(${-page * (layout.width + GAP)}px)`,
    }}>
      {children}
    </div>
    {/* The book's spine between two facing pages. */}
    {layout.spread === 2 && (
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-8 -translate-x-1/2 bg-gradient-to-r from-transparent via-black/[0.06] to-transparent dark:via-black/30" />
    )}
  </div>
);
