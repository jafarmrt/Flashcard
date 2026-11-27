import React, { useMemo, useState } from 'react';
import type { Chapter, ExtractedWordCard, Flashcard, KnownWord, Source, TextNote } from '../../types';
import { bookmarkCandidateWords, drivingBookmarksOf } from '../../services/drivingMode';
import { enrichmentToCard, freeEnrich } from '../../services/freeExtractionService';
import { fa, Icon } from '../common/ui';

export interface DriveBookmarksTrayProps {
  notes: TextNote[];
  sources: Source[];
  chapters: Chapter[];
  cards: Flashcard[];
  knownWords: KnownWord[];
  flaggedCardIds: string[];
  onDismissNote: (noteId: string) => void;
  onOpenChunk: (sourceId: string, chapterId: string, chunk: number) => void;
  onSaveReaderCard: (
    sourceId: string,
    chapterId: string,
    chunk: number,
    card: ExtractedWordCard,
  ) => Promise<number>;
  onStudyFlaggedCards: (cards: Flashcard[]) => void;
  onUnflagCard: (cardId: string) => void;
  onClearFlaggedCards: () => void;
  darkSurface?: boolean;
}

interface LookupState {
  noteId: string;
  word: string;
  status: 'loading' | 'ready' | 'saved';
  card?: ExtractedWordCard;
  manualBack: string;
  existing?: Flashcard;
}

export const DriveBookmarksTray: React.FC<DriveBookmarksTrayProps> = ({
  notes,
  sources,
  chapters,
  cards,
  knownWords,
  flaggedCardIds,
  onDismissNote,
  onOpenChunk,
  onSaveReaderCard,
  onStudyFlaggedCards,
  onUnflagCard,
  onClearFlaggedCards,
  darkSurface = false,
}) => {
  const driveNotes = useMemo(() => drivingBookmarksOf(notes), [notes]);
  const knownSet = useMemo(
    () => new Set(knownWords.filter(k => !k.isDeleted).map(k => k.term.trim().toLowerCase())),
    [knownWords],
  );
  const sourceById = useMemo(() => new Map(sources.map(s => [s.id, s])), [sources]);
  const chapterById = useMemo(() => new Map(chapters.map(c => [c.id, c])), [chapters]);

  const flaggedCards = useMemo(() => {
    if (!flaggedCardIds.length) return [];
    const want = new Set(flaggedCardIds);
    return cards.filter(c => !c.isDeleted && want.has(c.id));
  }, [cards, flaggedCardIds]);

  const [lookup, setLookup] = useState<LookupState | null>(null);
  const [saving, setSaving] = useState(false);

  if (driveNotes.length === 0 && flaggedCards.length === 0) return null;

  const inspectWord = async (note: TextNote, word: string, existing?: Flashcard) => {
    if (lookup && lookup.noteId === note.id && lookup.word.toLowerCase() === word.toLowerCase()) {
      setLookup(null);
      return;
    }
    if (existing) {
      setLookup({
        noteId: note.id,
        word,
        status: 'ready',
        manualBack: existing.back,
        existing,
      });
      return;
    }
    setLookup({ noteId: note.id, word, status: 'loading', manualBack: '' });
    try {
      const enriched = await freeEnrich(word);
      const draft = enrichmentToCard(word, note.quote, enriched, 'word');
      setLookup(prev =>
        prev && prev.noteId === note.id && prev.word === word
          ? { ...prev, status: 'ready', card: draft, manualBack: draft.back || '' }
          : prev,
      );
    } catch {
      setLookup(prev =>
        prev && prev.noteId === note.id && prev.word === word
          ? {
              ...prev,
              status: 'ready',
              card: {
                front: word,
                back: '',
                sourceSentence: note.quote,
                kind: 'word',
                selected: true,
                origin: { by: 'manual', at: new Date().toISOString() },
              },
              manualBack: '',
            }
          : prev,
      );
    }
  };

  const saveWordAsCard = async (note: TextNote) => {
    if (!lookup || lookup.noteId !== note.id || saving) return;
    const back = lookup.manualBack.trim() || lookup.card?.back?.trim() || '';
    if (!back) return;
    setSaving(true);
    try {
      const cardToSave: ExtractedWordCard = lookup.card
        ? { ...lookup.card, back, sourceSentence: note.quote, selected: true }
        : {
            front: lookup.word,
            back,
            sourceSentence: note.quote,
            kind: 'word',
            selected: true,
            origin: { by: 'manual', at: new Date().toISOString() },
          };
      await onSaveReaderCard(note.sourceId, note.chapterId, note.chunk, cardToSave);
      setLookup(prev => (prev ? { ...prev, status: 'saved' } : null));
    } finally {
      setSaving(false);
    }
  };

  const shellClass = darkSurface
    ? 'bg-slate-900/90 border border-slate-800 text-slate-100'
    : 'bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 text-ink dark:text-slate-100';

  const subTextClass = darkSurface
    ? 'text-slate-400'
    : 'text-ink-muted dark:text-slate-400';

  return (
    <section
      dir="rtl"
      aria-label="نشان‌های رانندگی"
      className={`rounded-3xl p-5 sm:p-6 flex flex-col gap-5 ${shellClass}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon.Bookmark size={18} className="text-brand-600 dark:text-brand-300 shrink-0" />
          <h2 className="font-extrabold text-base sm:text-lg">نشان‌های رانندگی برای بررسی</h2>
        </div>
        <span className={`text-xs ${subTextClass} tabular-nums`}>
          {driveNotes.length > 0 && `${fa(driveNotes.length)} جمله`}
          {driveNotes.length > 0 && flaggedCards.length > 0 && ' · '}
          {flaggedCards.length > 0 && `${fa(flaggedCards.length)} کارت`}
        </span>
      </div>

      {driveNotes.length > 0 && (
        <div className="flex flex-col divide-y divide-stone-200/70 dark:divide-slate-800">
          {driveNotes.map(note => {
            const src = sourceById.get(note.sourceId);
            const ch = chapterById.get(note.chapterId);
            const candidates = bookmarkCandidateWords(note.quote, cards, knownSet);
            const activeHere = lookup?.noteId === note.id ? lookup : null;

            return (
              <div key={note.id} className="py-4 first:pt-0 last:pb-0 flex flex-col gap-3">
                <div className={`flex flex-wrap items-center justify-between gap-2 text-xs ${subTextClass}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {src && <span dir="auto" className="font-read font-semibold">{src.title}</span>}
                    {ch && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span dir="auto">{ch.title}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>بخش {fa(note.chunk + 1)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenChunk(note.sourceId, note.chapterId, note.chunk)}
                      className="min-h-[40px] px-2.5 rounded-lg font-bold text-brand-600 dark:text-brand-300 hover:underline whitespace-nowrap"
                    >
                      باز کردن در کتاب
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissNote(note.id)}
                      aria-label="بستن این نشان رانندگی"
                      className={`min-h-[40px] px-2.5 rounded-lg font-semibold ${subTextClass} hover:text-ink dark:hover:text-white whitespace-nowrap`}
                    >
                      بررسی شد
                    </button>
                  </div>
                </div>

                <p dir="ltr" className="font-read text-left text-base leading-relaxed">
                  {note.quote}
                </p>

                {candidates.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className={`text-xs ${subTextClass}`}>
                      روی واژهٔ مورد نظرت بزن تا معنی و ساخت کارت باز شود:
                    </span>
                    <div dir="ltr" className="flex flex-wrap gap-2">
                      {candidates.map(item => {
                        const selected =
                          activeHere && activeHere.word.toLowerCase() === item.word.toLowerCase();
                        return (
                          <button
                            key={item.normalized}
                            type="button"
                            onClick={() => inspectWord(note, item.word, item.existingCard)}
                            className={`min-h-[44px] px-3.5 rounded-xl font-read text-sm border transition-colors ${
                              selected
                                ? 'bg-brand-600 text-white border-brand-600 font-semibold'
                                : item.existingCard
                                  ? darkSurface
                                    ? 'bg-slate-800/80 border-emerald-700/60 text-emerald-300'
                                    : 'bg-brand-50/70 dark:bg-slate-800 border-brand-200 dark:border-emerald-800 text-brand-800 dark:text-emerald-300'
                                  : darkSurface
                                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-slate-500'
                                    : 'bg-stone-50 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-ink dark:text-slate-200 hover:border-brand-400'
                            }`}
                          >
                            {item.word}
                            {item.existingCard ? ' ✓' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeHere && (
                  <div
                    className={`rounded-2xl p-4 flex flex-col gap-3 border ${
                      darkSurface
                        ? 'bg-slate-950/80 border-slate-800'
                        : 'bg-[#F7F5F0] dark:bg-slate-800/80 border-stone-200/80 dark:border-slate-700'
                    }`}
                  >
                    {activeHere.status === 'loading' ? (
                      <p className={`text-sm ${subTextClass}`}>در حال جست‌وجوی معنی «{activeHere.word}»…</p>
                    ) : activeHere.existing ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span dir="ltr" className="font-read font-bold text-base">
                            {activeHere.existing.front}
                          </span>
                          <span className="text-xs text-emerald-700 dark:text-emerald-300">کارت موجود</span>
                        </div>
                        <p className="text-sm font-bold">{activeHere.existing.back}</p>
                      </div>
                    ) : activeHere.status === 'saved' ? (
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                        کارت «{activeHere.card?.front || activeHere.word}» ذخیره شد.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span dir="ltr" className="font-read font-bold text-lg">
                            {activeHere.card?.front || activeHere.word}
                          </span>
                          {activeHere.card?.pronunciation && (
                            <span dir="ltr" className={`font-en text-xs ${subTextClass}`}>
                              {activeHere.card.pronunciation}
                            </span>
                          )}
                        </div>
                        {activeHere.card?.definition?.[0] && (
                          <p dir="ltr" className={`font-read text-xs text-left ${subTextClass}`}>
                            {activeHere.card.definition[0]}
                          </p>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                          <label className="sr-only" htmlFor={`drive-back-${note.id}`}>
                            معنی فارسی واژه
                          </label>
                          <input
                            id={`drive-back-${note.id}`}
                            type="text"
                            value={activeHere.manualBack}
                            onChange={e =>
                              setLookup(prev => (prev ? { ...prev, manualBack: e.target.value } : null))
                            }
                            placeholder="معنی فارسی را بنویس یا ویرایش کن…"
                            className={`flex-1 min-h-[44px] px-3.5 rounded-xl border text-sm ${
                              darkSurface
                                ? 'bg-slate-900 border-slate-700 text-white'
                                : 'bg-white dark:bg-slate-900 border-stone-300 dark:border-slate-700 text-ink dark:text-white'
                            }`}
                          />
                          <button
                            type="button"
                            disabled={saving || !activeHere.manualBack.trim()}
                            onClick={() => saveWordAsCard(note)}
                            className="min-h-[44px] px-4 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold text-sm whitespace-nowrap shrink-0"
                          >
                            {saving ? 'در حال ذخیره…' : '+ ساخت کارت'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {flaggedCards.length > 0 && (
        <div className="flex flex-col gap-3 pt-2 border-t border-stone-200/70 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold">واژه‌های نشان‌گذاری‌شده در مرور صوتی</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onStudyFlaggedCards(flaggedCards)}
                className="min-h-[44px] px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold whitespace-nowrap"
              >
                مرور همین {fa(flaggedCards.length)} کارت
              </button>
              <button
                type="button"
                onClick={onClearFlaggedCards}
                className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold ${subTextClass} hover:text-ink dark:hover:text-white whitespace-nowrap`}
              >
                پاک کردن نشان‌ها
              </button>
            </div>
          </div>

          <ul className="divide-y divide-stone-200/60 dark:divide-slate-800">
            {flaggedCards.map(card => (
              <li key={card.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex flex-wrap items-baseline gap-2">
                  <span dir="ltr" className="font-read font-bold text-base">
                    {card.front}
                  </span>
                  <span aria-hidden="true" className={subTextClass}>·</span>
                  <span className="text-sm truncate">{card.back}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onUnflagCard(card.id)}
                  aria-label={`برداشتن نشان ${card.front}`}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl ${subTextClass} hover:text-ink dark:hover:text-white`}
                >
                  <Icon.Close size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
