import React, { useEffect, useRef, useState } from 'react';
import type { ReaderSection } from '../../services/readerText';

export type Range = { from: number; to: number };

interface ReaderTextProps {
  section: ReaderSection;
  selection: Range | null;
  classFor: (index: number) => string; // highlight of a word outside the selection
  onTap: (index: number) => void;
  onSelect: (range: Range) => void;
}

// A touch must rest this long on a word before dragging selects instead of
// scrolling; moving further than this before that is a scroll.
const LONG_PRESS_MS = 400;
const SCROLL_SLOP_PX = 8;

const ordered = (a: number, b: number): Range => (a <= b ? { from: a, to: b } : { from: b, to: a });

const wordAt = (x: number, y: number): number | null => {
  const el = document.elementFromPoint(x, y)?.closest('[data-wi]') as HTMLElement | null;
  return el ? Number(el.dataset.wi) : null;
};

// The section's text, each word a button. A tap looks a word up; dragging
// over several words (with a mouse at once, with a finger after resting on
// the first word), or shift-clicking, picks a phrase or a sentence.
export const ReaderText: React.FC<ReaderTextProps> = ({ section, selection, classFor, onTap, onSelect }) => {
  const [drag, setDrag] = useState<Range | null>(null);
  const gesture = useRef<{ id: number; start: number; x: number; y: number; touch: boolean; active: boolean; moved: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);
  const anchor = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // While a finger selects, the page must not scroll: only a non-passive
  // touchmove listener can stop it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (gesture.current?.active) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  const end = () => {
    const g = gesture.current;
    if (g?.timer) clearTimeout(g.timer);
    gesture.current = null;
    setDrag(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    suppressClick.current = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = (e.target as HTMLElement).closest('[data-wi]') as HTMLElement | null;
    if (!target) return;
    const start = Number(target.dataset.wi);
    const touch = e.pointerType !== 'mouse';
    const g = { id: e.pointerId, start, x: e.clientX, y: e.clientY, touch, active: !touch, moved: false } as NonNullable<typeof gesture.current>;
    if (touch) {
      g.timer = setTimeout(() => {
        if (gesture.current !== g) return;
        g.active = true;
        setDrag({ from: start, to: start });
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.active) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > SCROLL_SLOP_PX) end(); // a scroll
      return;
    }
    const at = wordAt(e.clientX, e.clientY);
    if (at === null) return;
    if (at !== g.start && !g.moved) {
      g.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (g.moved || g.touch) setDrag(ordered(g.start, at));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.active && (g.moved || g.touch)) {
      // A finger that rested on one word and lifted picks that word, so it
      // can be widened from the bar.
      const at = g.moved ? wordAt(e.clientX, e.clientY) ?? g.start : g.start;
      suppressClick.current = true;
      onSelect(ordered(g.start, at));
      anchor.current = g.start;
    }
    end();
  };

  const onClick = (e: React.MouseEvent, index: number) => {
    if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); return; }
    if (e.shiftKey && anchor.current !== null) {
      onSelect(ordered(anchor.current, index));
      return;
    }
    anchor.current = index;
    onTap(index);
  };

  const shown = drag || selection;
  const inShown = (i: number) => !!shown && i >= shown.from && i <= shown.to;

  return (
    <div ref={box} dir="ltr" lang="en"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={end}
      onContextMenu={e => { if ((e.target as HTMLElement).closest('[data-wi]')) e.preventDefault(); }}
      className="font-read text-[17px] md:text-[19px] leading-[2] text-slate-800 dark:text-slate-100 max-w-[68ch] select-none [-webkit-touch-callout:none]">
      {section.paragraphs.map((p, pi) => {
        const parts: React.ReactNode[] = [];
        let cursor = p.start;
        for (const w of p.words) {
          if (w.start > cursor) parts.push(section.text.slice(cursor, w.start));
          const picked = inShown(w.i);
          // Spaces between picked words are tinted too, so a phrase reads as one.
          parts.push(
            <button key={w.i} type="button" data-wi={w.i} onClick={e => onClick(e, w.i)}
              className={`inline rounded px-0.5 -mx-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${picked ? 'bg-brand-500 text-white dark:bg-brand-500' : `hover:bg-brand-100 dark:hover:bg-slate-700 ${classFor(w.i)}`}`}>
              {w.text}
            </button>,
          );
          cursor = w.end;
          const next = p.words[w.i - p.words[0].i + 1];
          if (picked && next && inShown(next.i) && next.start > cursor) {
            parts.push(<span key={`g${w.i}`} className="bg-brand-500/25">{section.text.slice(cursor, next.start)}</span>);
            cursor = next.start;
          }
        }
        if (cursor < p.end) parts.push(section.text.slice(cursor, p.end));
        return <p key={pi} className="mb-4 last:mb-0">{parts}</p>;
      })}
    </div>
  );
};
