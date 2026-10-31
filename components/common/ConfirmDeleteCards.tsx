import React, { useEffect, useRef, useState } from 'react';
import type { Flashcard } from '../../types';
import { deletionPreview } from '../../services/cardDelete';
import { fa } from './ui';

// Asks once more before cards are deleted, naming them. A native <dialog>
// opened as a modal: Escape and the back of the page cancel, focus starts on
// «انصراف» so a stray Enter never deletes.
export const ConfirmDeleteCards: React.FC<{
  cards: Flashcard[];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}> = ({ cards, onConfirm, onCancel }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // StrictMode mounts twice: opening an open dialog throws.
    if (!d.open) d.showModal();
    cancelRef.current?.focus();
    return () => { if (d.open) d.close(); };
  }, []);

  const { words, more } = deletionPreview(cards);
  const one = cards.length === 1;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    // A failure is already shown by the caller's toast; the dialog stays.
    try { await onConfirm(); } catch { /* stay open */ } finally { setBusy(false); }
  };

  return (
    <dialog ref={ref} dir="rtl" aria-labelledby="confirm-delete-title"
      onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}
      // Escape closes only this dialog, not the card form around it.
      onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      className="font-fa w-[min(92vw,26rem)] rounded-3xl p-0 bg-white dark:bg-slate-800 text-ink dark:text-slate-100 shadow-xl backdrop:bg-black/50">
      <div className="p-5 flex flex-col gap-3">
        <h2 id="confirm-delete-title" className="text-lg font-extrabold">
          {one ? 'این کارت حذف شود؟' : `${fa(cards.length)} کارت حذف شوند؟`}
        </h2>
        <ul className="flex flex-wrap gap-1.5" aria-label="کارت‌هایی که حذف می‌شوند">
          {words.map((w, i) => (
            <li key={i} dir="ltr" className="font-en text-sm font-bold rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 max-w-full truncate">{w}</li>
          ))}
          {more > 0 && <li className="text-sm text-ink-muted dark:text-slate-400 px-1 py-0.5">و {fa(more)} کارت دیگر</li>}
        </ul>
        <p className="text-sm leading-7 text-ink-muted dark:text-slate-300">
          {one ? 'کارت با سابقهٔ مرورش از همهٔ دستگاه‌هایت پاک می‌شود و برنمی‌گردد.' : 'کارت‌ها با سابقهٔ مرورشان از همهٔ دستگاه‌هایت پاک می‌شوند و برنمی‌گردند.'} کتاب‌ها و یادداشت‌ها دست نمی‌خورند.
        </p>
        <div className="flex gap-2 justify-end mt-1">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}
            className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50">انصراف</button>
          <button type="button" onClick={confirm} disabled={busy}
            className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
            {busy ? 'در حال حذف…' : one ? 'حذف کارت' : `حذف ${fa(cards.length)} کارت`}
          </button>
        </div>
      </div>
    </dialog>
  );
};
