import React, { useMemo, useState } from 'react';
import { KIND_LABEL } from '../services/cardKinds';
import type { Chapter, ChapterText, Deck, ExtractedWordCard, Flashcard, KnownWord, Occurrence, Settings, Source, SourceKind } from '../types';
import type { StudyMode, View } from '../hooks/useAppLogic';
import type { ImportedSource } from '../services/importers';
import { chaptersOf, continuePoint, currentChunkOf, isChapterFinished, isChunkOpen, originText, sourceProgress } from '../services/library';
import { masteryStage, STAGE_NAMES } from '../services/masteryService';
import { convertToCSV, downloadCSV } from '../services/csvService';
import { isChestSection } from '../services/xpRules';
import { knownList } from '../services/knownWords';
import { needsCheck } from '../services/cardCheck';
import type { AiRequestOptions } from '../services/geminiService';
import { cardsOfSource } from '../services/readingStats';
import { isDue } from '../services/srsService';
import { coverageOf, knownByFrom, savedProfile } from '../services/coverage';
import { AddSourceForm } from './AddSourceForm';
import { BookCoverage } from './library/BookCoverage';
import { ChapterPrestudy } from './library/ChapterPrestudy';
import { CardCheckPanel } from './CardCheckPanel';
import { fa, Icon, StageDots } from './common/ui';

const KIND_NAMES: Record<SourceKind, string> = { book: 'کتاب', article: 'مقاله', text: 'متن' };
const KIND_STYLE: Record<SourceKind, string> = {
  book: 'bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200',
  article: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100',
  text: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};
const CARD_KIND: Record<string, string> = Object.fromEntries(Object.entries(KIND_LABEL).filter(([kind]) => kind !== 'word'));

interface LibraryViewProps {
  sources: Source[];
  chapters: Chapter[];
  occurrences: Occurrence[];
  cards: Flashcard[];
  decks: Deck[];
  activeSourceId: string | null;
  activeChapterId: string | null;
  onAddSource: (source: ImportedSource) => Promise<boolean>;
  onOpenSource: (sourceId: string | null) => void;
  onOpenChapter: (chapterId: string | null) => void;
  onOpenChunk: (chapter: Chapter, index: number) => void;
  onDeleteSource: (sourceId: string) => void;
  onNavigate: (view: View) => void;
  knownWords: KnownWord[];
  onUnmarkKnown: (term: string) => void;
  sectionReview: { sourceId: string; chapterId: string; chunk: number; cardIds: string[] } | null;
  onStartSectionReview: () => void;
  onDismissSectionReview: () => void;
  aiOptions?: AiRequestOptions;
  onCheckCards: (changes: { id: string; back?: string }[]) => Promise<void>;
  onEditCard?: (card: Flashcard) => void; // opens the card form over this page
  settings: Settings;
  knownTerms: string[];
  loadText: (chapterId: string) => Promise<ChapterText>;
  onStartSourceReview: (sourceId: string, chapterId?: string, mode?: StudyMode) => void;
  onPrestudyChapter: (chapterId: string, picks: { item: ExtractedWordCard; chunk: number }[]) => Promise<void>;
}

// Cards met in each source: card id -> set of source ids, without deleted rows.
const useCardsBySource = (occurrences: Occurrence[], cards: Flashcard[]) => useMemo(() => {
  const live = new Set(cards.filter(c => !c.isDeleted).map(c => c.id));
  const map = new Map<string, Set<string>>();
  for (const o of occurrences) {
    if (o.isDeleted || !live.has(o.cardId)) continue;
    let set = map.get(o.sourceId);
    if (!set) map.set(o.sourceId, (set = new Set()));
    set.add(o.cardId);
  }
  return map;
}, [occurrences, cards]);

const ProgressBar: React.FC<{ percent: number; done?: boolean }> = ({ percent, done }) => (
  <span className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
    <span className={`${done ? 'bg-emerald-600' : 'bg-brand-500'} rounded-full`} style={{ width: `${percent}%` }} />
  </span>
);

// --- A chapter as a path of 300-word sections, a chest every third ---

const ChapterPath: React.FC<{ chapter: Chapter; onOpenChunk: (i: number) => void }> = ({ chapter, onOpenChunk }) => {
  const current = currentChunkOf(chapter);
  const finished = isChapterFinished(chapter);
  const offsets = [0, 56, 84, 56, 0, -56, -84, -56]; // zigzag in px
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col items-center gap-5 py-4" aria-label="بخش‌های فصل">
        {Array.from({ length: chapter.chunkCount }, (_, i) => {
          const done = chapter.completed.includes(i);
          const isCurrent = !finished && i === current;
          const open = isChunkOpen(chapter, i);
          return (
            <React.Fragment key={i}>
              <li className="flex flex-col items-center gap-1.5" style={{ transform: `translateX(${offsets[i % offsets.length]}px)` }}>
                {isCurrent && <span className="rounded-xl bg-ink text-white dark:bg-white dark:text-ink px-3 py-1 text-xs font-bold">اینجایی</span>}
                <button type="button" disabled={!open} onClick={() => onOpenChunk(i)}
                  aria-label={`بخش ${fa(i + 1)}${done ? '، تمام شده' : open ? '' : '، قفل'}`}
                  className={`rounded-full flex items-center justify-center transition-transform hover:scale-105 disabled:hover:scale-100 ${isCurrent
                    ? 'w-20 h-20 bg-brand-500 text-white shadow-[0_6px_0_#2E2591] ring-8 ring-brand-200 dark:ring-brand-900'
                    : done ? 'w-16 h-16 bg-emerald-600 text-white shadow-[0_5px_0_#1D6B40]'
                    : 'w-16 h-16 bg-slate-200 text-slate-500 shadow-[0_5px_0_#CDD1DE] dark:bg-slate-700 dark:text-slate-400 dark:shadow-[0_5px_0_#334155]'}`}>
                  {done ? <Icon.Check size={26} /> : isCurrent ? <Icon.Book size={32} /> : <Icon.Lock size={22} />}
                </button>
                <span className={`text-xs ${isCurrent ? 'font-bold text-ink dark:text-white' : 'text-ink-muted dark:text-slate-400'}`}>بخش {fa(i + 1)}</span>
              </li>
              {isChestSection(i) && i < chapter.chunkCount - 1 && (
                <li className="flex flex-col items-center gap-1" aria-label="صندوق جایزه">
                  <span className={`w-14 h-14 rounded-2xl flex items-center justify-center ${done ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-amber-50 text-amber-700 dark:bg-slate-800 dark:text-amber-300'}`}>
                    <Icon.Gift size={26} />
                  </span>
                  <span className="text-[11px] text-ink-muted dark:text-slate-400">{done ? 'محافظ زنجیره گرفتی' : 'جایزه: محافظ زنجیره'}</span>
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ol>
      {finished && <p className="text-center font-bold text-emerald-700 dark:text-emerald-300">همهٔ بخش‌های این فصل را تمام کردی.</p>}
    </div>
  );
};

// --- The words of one source, by chapter ---

const SourceWords: React.FC<{ source: Source; chapters: Chapter[]; occurrences: Occurrence[]; cards: Flashcard[]; decks: Deck[]; onEditCard?: (card: Flashcard) => void }> = ({ source, chapters, occurrences, cards, decks, onEditCard }) => {
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(cards.filter(c => !c.isDeleted).map(c => [c.id, c])), [cards]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mine = occurrences.filter(o => o.sourceId === source.id && !o.isDeleted && byId.has(o.cardId));
    return chapters.map(chapter => ({
      chapter,
      rows: mine
        .filter(o => o.chapterId === chapter.id)
        .map(o => ({ o, card: byId.get(o.cardId)! }))
        .filter(({ card, o }) => !q || card.front.toLowerCase().includes(q) || card.back.includes(q) || (o.sentence || '').toLowerCase().includes(q))
        .sort((a, b) => a.o.chunk - b.o.chunk || a.o.createdAt.localeCompare(b.o.createdAt)),
    })).filter(g => g.rows.length > 0);
  }, [occurrences, source.id, chapters, byId, query]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  const exportCsv = () => {
    const rows = groups.flatMap(g => g.rows.map(({ o, card }) => ({ ...card, sourceSentence: o.sentence || card.sourceSentence })));
    const safe = source.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'words';
    downloadCSV(`${safe}-words.csv`, convertToCSV(rows, decks));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" dir="auto" value={query} onChange={e => setQuery(e.target.value)} placeholder="جست‌وجوی واژه، معنی یا جمله"
          className="flex-1 min-w-[12rem] min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 focus:border-brand-500 focus:outline-none" />
        <button type="button" onClick={exportCsv} disabled={total === 0}
          className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40">خروجی CSV</button>
      </div>
      {total === 0 && (
        <p className="text-sm text-ink-muted dark:text-slate-400 bg-white dark:bg-slate-800 rounded-3xl p-5">
          {query ? 'چیزی پیدا نشد.' : 'هنوز از این منبع کارتی نساخته‌ای. هنگام خواندن روی واژه‌ها بزن یا «پیدا کردن واژه‌های سخت» را بزن.'}
        </p>
      )}
      {groups.map(({ chapter, rows }) => (
        <section key={chapter.id} className="bg-white dark:bg-slate-800 rounded-3xl p-4 flex flex-col gap-1">
          {chapters.length > 1 && (
            <h3 className="flex items-center gap-2 px-1 pb-1 text-sm">
              <span className="font-bold text-ink dark:text-white">فصل {fa(chapter.order)}</span>
              <span dir="auto" className="font-en text-ink-muted dark:text-slate-400 truncate">{chapter.title}</span>
              <span className="flex-1" />
              <span className="text-xs text-ink-muted dark:text-slate-400">{fa(rows.length)}</span>
            </h3>
          )}
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map(({ o, card }) => {
              const origin = originText(card.origin);
              return (
                <li key={o.id} className="py-2.5 px-1 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span dir="ltr" className="font-en font-bold text-ink dark:text-white">{card.front}</span>
                    {card.kind && CARD_KIND[card.kind] && <span className="text-[11px] rounded-full bg-slate-100 dark:bg-slate-700 px-2">{CARD_KIND[card.kind]}</span>}
                    {card.level && <span className="font-en text-[11px] rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 px-2" title="سطح واژه">{card.level}</span>}
                    <span className="text-sm text-ink dark:text-slate-200">{card.back}</span>
                    {needsCheck(card) && <span className="text-[11px] rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 px-2">نیاز به بررسی</span>}
                    <span className="flex-1" />
                    <span className="flex items-center gap-1.5 text-[11px] text-ink-muted dark:text-slate-400" title={STAGE_NAMES[masteryStage(card)]}>
                      <StageDots stage={masteryStage(card)} />{STAGE_NAMES[masteryStage(card)]}
                    </span>
                  </div>
                  {o.sentence && <p dir="ltr" className="font-read text-[13px] italic text-ink-muted dark:text-slate-400">{o.sentence}</p>}
                  <div className="flex items-center gap-2">
                    {origin && <p className="text-[11px] text-ink-muted dark:text-slate-500">سازنده: <bdi>{origin}</bdi></p>}
                    <span className="flex-1" />
                    {onEditCard && (
                      <button type="button" onClick={() => onEditCard({ ...card, sourceSentence: card.sourceSentence || o.sentence })} aria-label={`ویرایش ${card.front}`}
                        className="min-h-[32px] px-3 rounded-lg text-xs font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">ویرایش</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

// --- One source: chapters (or the path of a one-chapter text) and its words ---

const SourcePage: React.FC<LibraryViewProps & { source: Source }> = props => {
  const { source, chapters: allChapters, occurrences, cards, decks, activeChapterId, onOpenSource, onOpenChapter, onOpenChunk, onDeleteSource } = props;
  const [tab, setTab] = useState<'read' | 'words' | 'check'>('read');
  const chapters = chaptersOf(source.id, allChapters);
  // This source's cards, each with the sentence of this source it was met in.
  const sourceCards: Flashcard[] = useMemo(() => {
    const byId = new Map<string, Flashcard>(cards.filter((c: Flashcard) => !c.isDeleted).map((c: Flashcard) => [c.id, c]));
    const seen = new Map<string, Flashcard>();
    for (const o of occurrences) {
      if (o.isDeleted || o.sourceId !== source.id || seen.has(o.cardId)) continue;
      const card = byId.get(o.cardId);
      if (card) seen.set(card.id, o.sentence ? { ...card, sourceSentence: o.sentence } : card);
    }
    return [...seen.values()];
  }, [cards, occurrences, source.id]);
  const flagged: number = useMemo(() => sourceCards.filter(needsCheck).length, [sourceCards]);
  const progress = sourceProgress(chapters);
  const cardCount = useCardsBySource(occurrences, cards).get(source.id)?.size || 0;
  const single = chapters.length === 1;
  const activeChapter = chapters.find(c => c.id === activeChapterId) || (single ? chapters[0] : undefined);
  const next = continuePoint(source, chapters);

  const back = () => (activeChapter && !single ? onOpenChapter(null) : onOpenSource(null));
  // Review: this chapter's cards inside a chapter, else the whole book's.
  const scopeChapter = activeChapter && !single ? activeChapter : undefined;
  const scopeCards: Flashcard[] = useMemo(() => cardsOfSource(occurrences, cards, source.id, scopeChapter?.id), [occurrences, cards, source.id, scopeChapter?.id]);
  const scopeDue: number = useMemo(() => scopeCards.filter(c => isDue(c)).length, [scopeCards]);
  const existingFronts: string[] = useMemo(() => cards.filter(c => !c.isDeleted).map(c => c.front), [cards]);
  // A section just finished here: its cards, for a short review.
  const review = props.sectionReview?.sourceId === source.id ? props.sectionReview : null;
  const reviewCount = useMemo(() => {
    if (!review) return 0;
    const live = new Set(cards.filter(c => !c.isDeleted).map(c => c.id));
    return review.cardIds.filter(id => live.has(id)).length;
  }, [review, cards]);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={back} aria-label={activeChapter && !single ? 'همهٔ فصل‌ها' : 'کتابخانه'} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Back /></button>
          <div className="flex-1 min-w-0">
            <h1 dir="auto" className="font-en font-bold text-xl text-ink dark:text-white truncate text-right">{source.title}</h1>
            {(source.author || (activeChapter && !single)) && (
              <p dir="auto" className="font-en text-sm text-ink-muted dark:text-slate-400 truncate text-right">
                {activeChapter && !single ? `${activeChapter.title}` : source.author}
              </p>
            )}
          </div>
          <button type="button" onClick={() => { if (confirm('این منبع از کتابخانه حذف شود؟ کارت‌هایی که از آن ساخته‌ای می‌مانند.')) onDeleteSource(source.id); }}
            className="text-sm text-red-700 dark:text-red-300 hover:underline">حذف</button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className={`rounded-full px-3 py-1 ${KIND_STYLE[source.kind]}`}>{KIND_NAMES[source.kind]}</span>
          <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">{fa(progress.words)} واژه، {chapters.length > 1 ? `${fa(chapters.length)} فصل، ` : ''}{fa(progress.sections)} بخش</span>
          <span className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100 px-3 py-1">{fa(progress.percent)}٪ خوانده شده</span>
          <span className="rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 px-3 py-1">{fa(cardCount)} کارت</span>
        </div>
        {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="font-en text-xs text-brand-500 dark:text-brand-300 truncate hover:underline">{source.url}</a>}
        {scopeCards.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => props.onStartSourceReview(source.id, scopeChapter?.id, 'flip')}
              className="min-h-[44px] px-4 rounded-xl bg-ink text-white dark:bg-white dark:text-ink font-bold inline-flex items-center gap-2">
              {scopeChapter ? 'مرور واژه‌های این فصل' : 'مرور واژه‌های این کتاب'}
              <span className="rounded-full bg-white/20 dark:bg-ink/10 text-xs px-2 py-0.5">{scopeDue > 0 ? `${fa(scopeDue)} موعد` : `${fa(scopeCards.length)} کارت`}</span>
            </button>
            <button type="button" onClick={() => props.onStartSourceReview(source.id, scopeChapter?.id, 'cloze')}
              title="واژه در جمله‌ای از همین کتاب جا افتاده؛ بنویسش"
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 font-bold">
              جای خالی در جمله‌های کتاب
            </button>
          </div>
        )}
      </div>

      {review && (
        <div role="status" className="rounded-3xl bg-emerald-50 dark:bg-emerald-900/30 p-5 flex flex-wrap items-center gap-3 animate-reveal">
          <p className="flex-1 min-w-[14rem] text-ink dark:text-slate-100">
            بخش {fa(review.chunk + 1)} تمام شد. {fa(reviewCount)} کارت این بخش را همین حالا یک مرور کوتاه کن تا بهتر بماند.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={props.onStartSectionReview} className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold">مرور کوتاه</button>
            <button type="button" onClick={props.onDismissSectionReview} className="min-h-[44px] px-4 rounded-xl text-emerald-900 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-900/50">بعداً</button>
          </div>
        </div>
      )}

      <div role="tablist" className="flex gap-1 p-1 rounded-2xl bg-white dark:bg-slate-800 self-start">
        {([['read', single ? 'مسیر خواندن' : 'فصل‌ها'], ['words', `واژه‌ها (${fa(cardCount)})`], ['check', flagged ? `بررسی (${fa(flagged)})` : 'بررسی']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`min-h-[40px] px-4 rounded-xl text-sm ${tab === id ? 'bg-brand-100 text-brand-700 font-bold dark:bg-brand-900/60 dark:text-brand-200' : 'text-ink-muted dark:text-slate-400'}`}>
            {label}
            {id === 'check' && flagged > 0 && tab !== id && <span className="inline-block w-2 h-2 rounded-full bg-amber-500 ms-1.5 align-middle" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {tab === 'check' ? (
        <CardCheckPanel cards={sourceCards} aiOptions={props.aiOptions} onCheckCards={props.onCheckCards} onEditCard={props.onEditCard} />
      ) : tab === 'words' ? (
        <SourceWords source={source} chapters={chapters} occurrences={occurrences} cards={cards} decks={decks} onEditCard={props.onEditCard} />
      ) : activeChapter ? (
        <>
          {single && <BookCoverage source={source} chapters={chapters} cards={cards} knownWords={props.knownWords} userLevel={props.settings.userLevel} loadText={props.loadText} />}
          {activeChapter.completed.length === 0 && (
            <ChapterPrestudy chapter={activeChapter} settings={props.settings} existingFronts={existingFronts} knownTerms={props.knownTerms}
              loadText={props.loadText} onPrestudy={props.onPrestudyChapter} />
          )}
          <ChapterPath chapter={activeChapter} onOpenChunk={i => onOpenChunk(activeChapter, i)} />
          {!isChapterFinished(activeChapter) && (
            <button type="button" onClick={() => onOpenChunk(activeChapter, currentChunkOf(activeChapter))}
              className="sticky bottom-24 md:bottom-6 self-center min-h-[56px] px-10 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg shadow-lg">
              {activeChapter.completed.length === 0 ? 'شروع بخش ۱' : `ادامهٔ بخش ${fa(currentChunkOf(activeChapter) + 1)}`}
            </button>
          )}
        </>
      ) : (
        <>
          {next && !progress.finished && (
            <button type="button" onClick={() => onOpenChunk(next.chapter, next.chunk)}
              className="self-start min-h-[52px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold">
              {progress.done === 0 ? 'شروع خواندن' : `ادامه: فصل ${fa(next.chapter.order)}، بخش ${fa(next.chunk + 1)}`}
            </button>
          )}
          <BookCoverage source={source} chapters={chapters} cards={cards} knownWords={props.knownWords} userLevel={props.settings.userLevel} loadText={props.loadText} />
          <ol className="bg-white dark:bg-slate-800 rounded-3xl p-2 flex flex-col">
            {chapters.map(c => {
              const done = isChapterFinished(c);
              const pct = Math.round((c.completed.length / Math.max(1, c.chunkCount)) * 100);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpenChapter(c.id)} className="w-full flex items-center gap-3 min-h-[56px] px-3 rounded-2xl text-right hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${done ? 'bg-emerald-600 text-white' : c.completed.length ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {done ? <Icon.Check size={18} /> : fa(c.order)}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-1">
                      <span dir="auto" className="font-en text-ink dark:text-white truncate">{c.title}</span>
                      {c.completed.length > 0 && !done && <ProgressBar percent={pct} />}
                    </span>
                    <span className="text-xs text-ink-muted dark:text-slate-400 whitespace-nowrap">{fa(Math.min(c.completed.length, c.chunkCount))} از {fa(c.chunkCount)} بخش</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
};

// Words on the "I know it" list: never suggested again while reading. A word
// taken off comes back in suggestions.
const SHOWN_KNOWN = 60;
const KnownWordsPanel: React.FC<{ rows: KnownWord[]; onRemove: (term: string) => void }> = ({ rows, onRemove }) => {
  const [all, setAll] = useState(false);
  const list = useMemo(() => knownList(rows), [rows]);
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, SHOWN_KNOWN);
  return (
    <details className="group bg-white dark:bg-slate-800 rounded-3xl p-5">
      <summary className="cursor-pointer list-none flex items-center gap-2 font-bold text-ink dark:text-white">
        <Icon.Back size={18} className="transition-transform rotate-180 group-open:-rotate-90" />
        واژه‌هایی که بلدی ({fa(list.length)})
      </summary>
      <p className="text-sm text-ink-muted dark:text-slate-400 mt-3">این واژه‌ها هنگام خواندن پیشنهاد نمی‌شوند، در هیچ کتابی. با × از فهرست بیرون می‌روند.</p>
      <ul dir="ltr" className="flex flex-wrap gap-1.5 mt-3">
        {shown.map(k => (
          <li key={k.term} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100 ps-3 pe-1 py-0.5 font-en text-sm">
            {k.term}
            <button type="button" onClick={() => onRemove(k.term)} aria-label={`بیرون بردن ${k.term} از فهرست بلدم`} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-emerald-100 dark:hover:bg-emerald-800"><Icon.Close size={14} /></button>
          </li>
        ))}
      </ul>
      {list.length > SHOWN_KNOWN && (
        <button type="button" onClick={() => setAll(v => !v)} className="mt-3 text-sm text-brand-500 dark:text-brand-300 hover:underline">
          {all ? 'کمتر' : `همهٔ ${fa(list.length)} واژه`}
        </button>
      )}
    </details>
  );
};

// --- The bookshelf: books being read, new ones, and finished ones ---

// A cover colour from the title, so each book keeps its own.
const COVERS = [
  'from-indigo-500 to-violet-700', 'from-sky-500 to-blue-700', 'from-emerald-500 to-teal-700', 'from-amber-500 to-orange-700',
  'from-rose-500 to-pink-700', 'from-fuchsia-500 to-purple-700', 'from-cyan-500 to-sky-700', 'from-lime-600 to-green-700',
];
const coverOf = (title: string) => {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
};

interface ShelfProps {
  sources: Source[];
  chapters: Chapter[];
  cardsBySource: Map<string, Set<string>>;
  knownBy: (word: string) => 'card' | 'list' | null;
  userLevel?: string;
  onOpen: (sourceId: string) => void;
}

const Shelf: React.FC<ShelfProps> = ({ sources, chapters, cardsBySource, knownBy, userLevel, onOpen }) => {
  const rows = sources.map(s => {
    const list = chaptersOf(s.id, chapters);
    const p = sourceProgress(list);
    const profile = savedProfile(s.id);
    return { s, list, p, next: continuePoint(s, list), coverage: profile ? coverageOf(profile, userLevel, knownBy).percent : null };
  });
  const groups = [
    { title: 'در حال خواندن', rows: rows.filter(r => r.p.done > 0 && !r.p.finished) },
    { title: 'هنوز شروع نشده', rows: rows.filter(r => r.p.done === 0) },
    { title: 'تمام‌شده', rows: rows.filter(r => r.p.finished) },
  ].filter(g => g.rows.length > 0);
  const chaptersDone = rows.reduce((n, r) => n + r.list.filter(isChapterFinished).length, 0);
  const finished = rows.filter(r => r.p.finished).length;

  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-white dark:bg-slate-800 px-3 py-1">{fa(rows.length)} کتاب و متن</span>
        <span className="rounded-full bg-white dark:bg-slate-800 px-3 py-1">{fa(chaptersDone)} فصل خوانده‌شده</span>
        {finished > 0 && <span className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100 px-3 py-1">{fa(finished)} تمام‌شده</span>}
      </p>
      {groups.map(g => (
        <section key={g.title} className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-ink-muted dark:text-slate-400">{g.title}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.rows.map(({ s, list, p, next, coverage }) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpen(s.id)} className="w-full h-full text-right bg-white dark:bg-slate-800 rounded-3xl p-4 flex gap-4 hover:ring-2 hover:ring-brand-200 dark:hover:ring-brand-800">
                  <span className={`relative w-20 h-28 shrink-0 rounded-xl bg-gradient-to-br ${coverOf(s.title)} text-white p-2 flex flex-col justify-between overflow-hidden shadow-[inset_4px_0_0_rgba(0,0,0,0.18)]`} aria-hidden="true">
                    <span dir="auto" className="font-en text-[11px] font-bold leading-tight line-clamp-4 break-words">{s.title}</span>
                    {p.finished && <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-white text-emerald-700 flex items-center justify-center"><Icon.Check size={14} /></span>}
                    <span className="h-1.5 rounded-full bg-white/30 overflow-hidden flex"><span className="bg-white rounded-full" style={{ width: `${p.percent}%` }} /></span>
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <span dir="auto" className="font-en font-bold text-ink dark:text-white truncate">{s.title}</span>
                    {s.author && <span dir="auto" className="font-en text-sm text-ink-muted dark:text-slate-400 truncate">{s.author}</span>}
                    <span className="flex flex-wrap gap-1.5">
                      <span className={`text-xs rounded-full px-2.5 py-0.5 ${KIND_STYLE[s.kind]}`}>{KIND_NAMES[s.kind]}</span>
                      {coverage !== null && <span className="text-xs rounded-full px-2.5 py-0.5 bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100" title="درصد واژه‌های متن که بلدی">{fa(Math.round(coverage))}٪ بلدی</span>}
                    </span>
                    <span className="text-sm text-ink-muted dark:text-slate-400">
                      {p.finished ? 'تمام شد' : next && list.length > 1 ? `فصل ${fa(next.chapter.order)} از ${fa(list.length)}` : next ? `بخش ${fa(next.chunk + 1)} از ${fa(next.chapter.chunkCount)}` : ''}
                      {'، '}{fa(cardsBySource.get(s.id)?.size || 0)} کارت
                    </span>
                    <span className="text-xs text-ink-muted dark:text-slate-500">{fa(p.words)} واژه · {fa(p.percent)}٪ خوانده شده</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

// The library: every book, article and text, and how far each one is read.
export const LibraryView: React.FC<LibraryViewProps> = props => {
  const { sources, chapters, occurrences, cards, activeSourceId, onAddSource, onOpenSource, onNavigate } = props;
  const [adding, setAdding] = useState(false);
  const cardsBySource = useCardsBySource(occurrences, cards);
  const knownBy = useMemo(() => knownByFrom(cards, props.knownWords), [cards, props.knownWords]);
  const visible = sources.filter(s => !s.isDeleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = visible.find(s => s.id === activeSourceId);

  if (active) return <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-3xl mx-auto w-full"><SourcePage {...props} source={active} /></div>;

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-3xl mx-auto w-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink dark:text-white">کتابخانه</h1>
          <p className="text-sm text-ink-muted dark:text-slate-400">کتاب، مقاله یا متن؛ هر فصل به بخش‌های ۳۰۰ واژه‌ای تقسیم می‌شود.</p>
        </div>
        <div className="flex gap-2">
          {!adding && visible.length > 0 && (
            <button type="button" onClick={() => setAdding(true)} className="min-h-[44px] px-4 rounded-xl bg-ink text-white dark:bg-white dark:text-ink font-bold inline-flex items-center gap-1.5">
              <Icon.Plus size={18} />افزودن
            </button>
          )}
          <button type="button" onClick={() => onNavigate('AI_EXTRACT')} className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800"
            title="کل متن را یکجا تحلیل کن، با همهٔ گزینه‌های پیشرفته">
            استخراج یکجا
          </button>
        </div>
      </header>

      {(adding || visible.length === 0) && (
        <AddSourceForm onAdd={async s => { const ok = await onAddSource(s); if (ok) setAdding(false); return ok; }} onCancel={visible.length > 0 ? () => setAdding(false) : undefined} />
      )}

      {visible.length > 0 && (
        <Shelf sources={visible} chapters={chapters} cardsBySource={cardsBySource} knownBy={knownBy} userLevel={props.settings.userLevel} onOpen={onOpenSource} />
      )}

      <KnownWordsPanel rows={props.knownWords} onRemove={props.onUnmarkKnown} />
    </div>
  );
};
