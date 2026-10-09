import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chapter, ChapterText, ExtractedWordCard, Settings, Source } from '../types';
import { ProxyError } from '../services/apiService';
import { aiRequestOptions } from '../services/aiSettings';
import { extractFromLongText, ExtractionSource } from '../services/extractionPipeline';
import { lemmaCandidates } from '../services/lemma';
import { enrichmentToCard, freeEnrich } from '../services/freeExtractionService';
import { findSentence } from '../services/textChunker';
import { cardsInText, isChunkOpen } from '../services/library';
import { normalizeTerm } from '../services/vocabMerge';
import { isSpeechSupported, speakText, stopSpeech } from '../services/ttsService';
import { CHUNK_COMPLETE_XP, isChestSection } from '../services/xpRules';
import { fa, Icon } from './common/ui';

interface ChunkReaderViewProps {
  source: Source;
  chapter: Chapter;
  chunks: string[];
  index: number;
  chapterCount: number;
  settings: Settings;
  existingFronts: string[];
  onSaveCards: (cards: ExtractedWordCard[]) => Promise<void>;
  onComplete: () => void;
  onBack: () => void;
  onOpenChunk: (index: number) => void;
  showToast: (message: string) => void;
}

// `key` identifies an item (its term, normalised); `forms` are the words of
// the text that were tapped for it ("running" for "run"), for highlighting.
type Item = ExtractedWordCard & { key: string; forms: string[]; loading?: boolean };

const KIND_LABEL: Record<string, string> = { word: 'واژه', phrase: 'عبارت', idiom: 'اصطلاح', grammar: 'دستوری' };

// Words of the text, keeping inner apostrophes and hyphens ("don't",
// "well-known"); everything else is plain text between them.
const WORD_SPLIT = /(\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*)/u;

const toItem = (card: ExtractedWordCard, forms: string[] = []): Item => ({ ...card, key: normalizeTerm(card.front), forms });

// Sections of a chapter in the header; a long chapter gets a list instead.
const MAX_SECTION_BUTTONS = 12;

// One section of a chapter: read it, pick its hard words (AI, free dictionaries,
// or by tapping a word), turn them into cards, then finish the section.
export const ChunkReaderView: React.FC<ChunkReaderViewProps> = ({
  source: book, chapter, chunks, index, chapterCount, settings, existingFronts, onSaveCards, onComplete, onBack, onOpenChunk, showToast,
}) => {
  const chunk = chunks[index] || '';
  const [items, setItems] = useState<Item[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [source, setSource] = useState<ExtractionSource>(settings.extractionSource || 'ai');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reading, setReading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lookups = useRef(new Set<string>());
  const done = chapter.completed.includes(index);

  // Leaving the section stops a running search and reading aloud.
  useEffect(() => () => { abortRef.current?.abort(); stopSpeech(); }, []);

  const known = useMemo(() => new Set(existingFronts.map(normalizeTerm)), [existingFronts]);
  // Words of this section that already have a card; finishing the section
  // adds this place to them.
  const metAgain = useMemo(() => {
    const listed = new Set(items.map(it => it.key));
    return cardsInText(chunk, existingFronts.filter(front => !listed.has(normalizeTerm(front))).map(front => ({ front }))).length;
  }, [chunk, existingFronts, items]);
  // Any base form with a card counts: "decided" is known when "decide" has a card.
  const isKnown = (word: string) => lemmaCandidates(word).some(form => known.has(normalizeTerm(form)));

  // Every way an item can appear in the text -> its key.
  const formIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      map.set(it.key, it.key);
      for (const form of it.forms) map.set(normalizeTerm(form), it.key);
    }
    return map;
  }, [items]);
  const itemKeyFor = (word: string): string | undefined =>
    formIndex.get(normalizeTerm(word)) ?? lemmaCandidates(word).map(f => formIndex.get(normalizeTerm(f))).find(Boolean);

  const extract = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      // Items already in the list are not asked for again.
      const listed = items.filter(it => !it.loading).map(it => it.front);
      const result = await extractFromLongText({
        text: chunk,
        level: settings.userLevel || 'B2',
        perSection: 12,
        source,
        existingFronts: [...existingFronts, ...listed],
        includeGrammar: source === 'ai',
        aiOptions: aiRequestOptions(settings),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const listedKeys = new Set(listed.map(normalizeTerm));
      const fresh = result.cards
        .filter(c => !listedKeys.has(normalizeTerm(c.front)))
        .map(c => toItem({ ...c, selected: !c.alreadyInDeck }));
      if (result.fallbackSections > 0) {
        showToast(`هوش مصنوعی جواب نداد${result.aiError ? ` (${result.aiError})` : ''}؛ از دیکشنری رایگان استفاده شد.`);
      } else if (fresh.length === 0) {
        showToast(result.failedSections > 0 ? 'پیدا کردن واژه‌ها ناموفق بود. تنظیمات یا اتصال را بررسی کن.' : 'واژهٔ سخت تازه‌ای پیدا نشد.');
      }
      setItems(prev => {
        const have = new Set(prev.map(p => p.key));
        return [...prev, ...fresh.filter(c => !have.has(c.key))];
      });
      if (fresh.length > 0) setSaved(false);
    } catch (error) {
      console.error('Extraction failed:', error);
      if (!controller.signal.aborted) showToast('پیدا کردن واژه‌ها ناموفق بود. اتصال را بررسی کن.');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  // Tap a word in the text to look it up and add it to the list. The word is
  // saved under its dictionary form ("running" -> "run"), once.
  const addWord = async (raw: string) => {
    const surface = raw.toLowerCase().replace(/’/g, "'");
    const existing = itemKeyFor(surface);
    if (existing) { setSelectedKey(existing); return; }
    if (lookups.current.has(surface)) return;
    lookups.current.add(surface);
    const tempKey = `lookup:${surface}`;
    setItems(prev => [...prev, { key: tempKey, forms: [surface], front: surface, back: '…', loading: true, selected: true, alreadyInDeck: isKnown(surface) }]);
    setSelectedKey(tempKey);
    const drop = () => {
      setItems(prev => prev.filter(p => p.key !== tempKey));
      setSelectedKey(k => (k === tempKey ? null : k));
    };
    try {
      const e = await freeEnrich(surface);
      if (!e.found && !e.translation) {
        showToast(`«${surface}» در دیکشنری پیدا نشد.`);
        drop();
        return;
      }
      const card = toItem(enrichmentToCard(surface, findSentence(chunk, surface), e, 'word'), [surface]);
      card.alreadyInDeck = known.has(card.key) || isKnown(surface);
      card.selected = !card.alreadyInDeck;
      setItems(prev => {
        // Another form of the same word is already listed: keep one item.
        if (prev.some(p => p.key === card.key)) {
          return prev
            .filter(p => p.key !== tempKey)
            .map(p => (p.key === card.key ? { ...p, forms: Array.from(new Set([...p.forms, surface])) } : p));
        }
        return prev.map(p => (p.key === tempKey ? card : p));
      });
      setSelectedKey(k => (k === tempKey ? card.key : k));
      setSaved(false);
    } catch (error) {
      console.error('Lookup failed:', error);
      showToast('جست‌وجوی واژه ناموفق بود.');
      drop();
    } finally {
      lookups.current.delete(surface);
    }
  };

  const toggle = (key: string) => setItems(prev => prev.map(p => (p.key === key ? { ...p, selected: !p.selected } : p)));
  const toSave = items.filter(it => it.selected && !it.alreadyInDeck && !it.loading && it.back && it.back !== '…');

  const save = async () => {
    if (saving || toSave.length === 0) return;
    setSaving(true);
    const keys = new Set(toSave.map(it => it.key));
    try {
      await onSaveCards(toSave.map(({ key, forms, loading: _loading, ...card }) => card));
      setItems(prev => prev.map(p => (keys.has(p.key) ? { ...p, alreadyInDeck: true, selected: false } : p)));
      setSaved(true);
    } catch (error) {
      console.error('Saving cards failed:', error);
      showToast('ساخت کارت‌ها ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    if (toSave.length > 0 && !window.confirm(`${fa(toSave.length)} واژهٔ انتخاب‌شده هنوز کارت نشده‌اند. بدون ساختن کارت تمام شود؟`)) return;
    onComplete();
  };

  const toggleReading = () => {
    if (reading) { stopSpeech(); setReading(false); return; }
    setReading(true);
    speakText(chunk.replace(/\n+/g, ' '), { rate: 0.95, onEnd: () => setReading(false), onError: () => setReading(false) });
  };

  // The text, with each English word as a button and found terms highlighted.
  const paragraphs = useMemo(() => chunk.split(/\n\s*\n/), [chunk]);
  const renderParagraph = (p: string, pi: number) => (
    <p key={pi} className="mb-4 last:mb-0">
      {p.split(WORD_SPLIT).map((part, i) => {
        if (i % 2 === 0) return <React.Fragment key={i}>{part}</React.Fragment>;
        const itemKey = itemKeyFor(part);
        const isSelected = itemKey !== undefined && itemKey === selectedKey;
        const cls = itemKey !== undefined
          ? isSelected ? 'bg-brand-200 ring-2 ring-brand-500 dark:bg-brand-800' : 'bg-amber-100 dark:bg-amber-900/50'
          : isKnown(part) ? 'underline decoration-emerald-500/60 decoration-2 underline-offset-4' : '';
        return (
          <button key={i} type="button" onClick={() => addWord(part)}
            className={`inline rounded px-0.5 -mx-0.5 hover:bg-brand-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${cls}`}>
            {part}
          </button>
        );
      })}
    </p>
  );

  const detail = selectedKey !== null ? items.find(it => it.key === selectedKey) : undefined;

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-5 w-full">
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} aria-label="برگشت به مسیر" className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-white dark:hover:bg-slate-800"><Icon.Back /></button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-ink-muted dark:text-slate-400 truncate">
            {chapterCount > 1 && <><bdi dir="auto">{chapter.title}</bdi> · </>}بخش {fa(index + 1)} از {fa(chunks.length)}
          </p>
          <h1 dir="auto" className="font-en font-bold text-lg text-ink dark:text-white truncate text-right">{book.title}</h1>
        </div>
        {chunks.length <= MAX_SECTION_BUTTONS ? (
          <nav aria-label="بخش‌ها" className="flex flex-wrap gap-1.5">
            {chunks.map((_, i) => {
              const isDone = chapter.completed.includes(i);
              return (
                <button key={i} type="button" disabled={!isChunkOpen(chapter, i) && i !== index} onClick={() => onOpenChunk(i)} aria-current={i === index ? 'page' : undefined}
                  className={`w-9 h-9 rounded-[10px] text-sm font-bold ${i === index ? 'bg-brand-500 text-white ring-4 ring-brand-200 dark:ring-brand-900' : isDone ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'} disabled:opacity-50`}>
                  {fa(i + 1)}
                </button>
              );
            })}
          </nav>
        ) : (
          <nav aria-label="بخش‌ها" className="flex items-center gap-1.5">
            <button type="button" disabled={index === 0} onClick={() => onOpenChunk(index - 1)} aria-label="بخش قبلی"
              className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-white dark:bg-slate-800 disabled:opacity-40"><Icon.Back size={18} /></button>
            <select value={index} onChange={e => onOpenChunk(Number(e.target.value))} aria-label="رفتن به بخش"
              className="h-9 rounded-[10px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-2 text-sm">
              {chunks.map((_, i) => (
                <option key={i} value={i} disabled={!isChunkOpen(chapter, i) && i !== index}>
                  {chapter.completed.includes(i) ? '✓ ' : ''}بخش {fa(i + 1)}
                </option>
              ))}
            </select>
            <button type="button" disabled={!isChunkOpen(chapter, index + 1) || index + 1 >= chunks.length} onClick={() => onOpenChunk(index + 1)} aria-label="بخش بعدی"
              className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-white dark:bg-slate-800 disabled:opacity-40"><Icon.Back size={18} className="rotate-180" /></button>
          </nav>
        )}
      </header>

      <div className="flex flex-wrap gap-5 items-start">
        <article className="flex-[999_1_30rem] min-w-0 bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-9 flex flex-col gap-4">
          <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-ink-muted dark:text-slate-400">
            <span>روی هر واژه بزن تا معنی‌اش بیاید و به فهرست اضافه شود</span>
            {isSpeechSupported() && (
              <button type="button" onClick={toggleReading} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">
                <Icon.Speaker size={16} />{reading ? 'توقف' : 'خواندن بلند'}
              </button>
            )}
          </div>
          <div dir="ltr" lang="en" className="font-read text-[17px] md:text-[19px] leading-[2] text-slate-800 dark:text-slate-100 max-w-[68ch]">
            {paragraphs.map(renderParagraph)}
          </div>
        </article>

        <aside className="flex-[1_1_20rem] max-w-full lg:max-w-md flex flex-col gap-4 lg:sticky lg:top-6">
          <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center gap-2">
              <h2 className="font-bold text-ink dark:text-white">{items.length > 0 ? `${fa(items.length)} واژه و عبارت` : 'واژه‌های سخت'}</h2>
              <span className="text-xs text-ink-muted dark:text-slate-400">{toSave.length > 0 ? `${fa(toSave.length)} انتخاب شده` : ''}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-muted dark:text-slate-400">منبع:</span>
              {(['ai', 'free'] as ExtractionSource[]).map(s => (
                <button key={s} type="button" onClick={() => setSource(s)} aria-pressed={source === s}
                  className={`rounded-full px-3 py-1 ${source === s ? 'bg-brand-100 text-brand-700 font-bold dark:bg-brand-900/60 dark:text-brand-200' : 'border border-slate-200 dark:border-slate-600'}`}>
                  {s === 'ai' ? 'هوش مصنوعی' : 'دیکشنری رایگان'}
                </button>
              ))}
            </div>
            <button type="button" onClick={extract} disabled={loading}
              className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 font-bold disabled:opacity-60">
              {loading ? 'در حال پیدا کردن…' : items.length > 0 ? 'پیدا کردن واژه‌های بیشتر' : 'پیدا کردن واژه‌های سخت این بخش'}
            </button>
            {items.length > 0 && (
              <ul className="flex flex-col gap-1 max-h-[22rem] overflow-y-auto -mx-1 px-1">
                {items.map(it => (
                  <li key={it.key}>
                    <div className={`flex items-center gap-2.5 min-h-[44px] px-2.5 rounded-xl ${selectedKey === it.key ? 'bg-brand-50 dark:bg-brand-900/40' : ''}`}>
                      <input type="checkbox" checked={!!it.selected && !it.alreadyInDeck} disabled={it.alreadyInDeck || it.loading}
                        onChange={() => toggle(it.key)} aria-label={`انتخاب ${it.front}`} className="w-[18px] h-[18px] accent-brand-500" />
                      <button type="button" onClick={() => setSelectedKey(it.key)} className="flex-1 min-w-0 flex items-center gap-2 text-right">
                        <span dir="ltr" className="font-en font-medium text-ink dark:text-white truncate">{it.front}</span>
                        {it.kind && it.kind !== 'word' && <span className="text-[11px] rounded-full bg-slate-100 dark:bg-slate-700 px-2">{KIND_LABEL[it.kind]}</span>}
                        <span className="flex-1" />
                        <span className="text-xs text-ink-muted dark:text-slate-400 truncate max-w-[45%]">
                          {it.loading ? 'در حال جست‌وجو…' : it.alreadyInDeck ? 'کارت دارد' : it.back}
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail && !detail.loading && (
            // Below xl the list sits under the text, so the tapped word opens
            // as a sheet at the bottom of the screen, where the reader is.
            <section aria-label="جزئیات واژه"
              className="fixed z-30 inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-5 md:left-6 md:right-[17.5rem] max-h-[46vh] overflow-y-auto shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 xl:static xl:max-h-none xl:shadow-none xl:ring-0 bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2.5 animate-reveal">
              <div dir="ltr" className="flex items-baseline gap-2.5 flex-wrap">
                <span className="font-en font-bold text-2xl text-ink dark:text-white">{detail.front}</span>
                {detail.pronunciation && <span className="text-ink-muted dark:text-slate-400">{detail.pronunciation}</span>}
                {isSpeechSupported() && (
                  <button type="button" onClick={() => speakText(detail.front, { rate: 0.9 })} aria-label="پخش تلفظ" className="text-brand-500 dark:text-brand-300"><Icon.Speaker size={18} /></button>
                )}
                <span className="flex-1" />
                <button type="button" onClick={() => setSelectedKey(null)} aria-label="بستن" className="xl:hidden w-9 h-9 -m-1.5 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
              </div>
              <p className="text-ink dark:text-white">{detail.back}</p>
              {detail.grammarPattern && <p dir="ltr" className="font-mono text-sm text-rose-700 dark:text-rose-300">{detail.grammarPattern}</p>}
              {detail.definition && detail.definition[0] && <p dir="ltr" className="text-sm text-ink-muted dark:text-slate-400">{detail.definition[0]}</p>}
              {detail.collocations && detail.collocations.length > 0 && (
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {detail.collocations.slice(0, 5).map((c, i) => (
                    <span key={i} className="rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-0.5 text-[13px]">{c.phrase}</span>
                  ))}
                </div>
              )}
              {detail.notes && <p className="text-sm text-ink dark:text-slate-200">{detail.notes}</p>}
              {detail.practicePrompt && (
                <p className="text-sm rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-100 px-3 py-2">تمرین: {detail.practicePrompt}</p>
              )}
              {detail.sourceSentence && <p dir="ltr" className="font-read text-sm italic text-ink-muted dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-2">“{detail.sourceSentence}”</p>}
              <div className="xl:hidden flex items-center gap-3 pt-1">
                {!detail.alreadyInDeck && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!detail.selected} onChange={() => toggle(detail.key)} className="w-[18px] h-[18px] accent-brand-500" />
                    کارت ساخته شود
                  </label>
                )}
                <span className="flex-1" />
                {toSave.length > 0 && (
                  <button type="button" onClick={save} disabled={saving} className="min-h-[44px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-60">
                    {saving ? 'در حال ساخت…' : `ساخت ${fa(toSave.length)} کارت`}
                  </button>
                )}
              </div>
            </section>
          )}

          <div className="flex flex-col gap-2">
            {toSave.length > 0 && (
              <button type="button" onClick={save} disabled={saving} className="min-h-[56px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg disabled:opacity-60">
                {saving ? 'در حال ساخت…' : `ساخت ${fa(toSave.length)} کارت`}
              </button>
            )}
            <button type="button" onClick={finish}
              className={`min-h-[52px] rounded-2xl font-extrabold ${toSave.length === 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'border-2 border-emerald-600 text-emerald-800 dark:text-emerald-200'}`}>
              {done ? 'برگشت به مسیر' : `پایان این بخش (+${fa(CHUNK_COMPLETE_XP)} امتیاز${isChestSection(index) ? ' و صندوق جایزه' : ''})`}
            </button>
            {saved && <p className="text-center text-sm text-emerald-700 dark:text-emerald-300">کارت‌ها ساخته شد و در مرور بعدی می‌آیند.</p>}
            {!done && metAgain > 0 && (
              <p className="text-center text-xs text-ink-muted dark:text-slate-400">{fa(metAgain)} واژهٔ این بخش از قبل کارت دارد (زیرخط سبز)؛ با پایان بخش، دیده‌شدنشان در این کتاب ثبت می‌شود.</p>
            )}
          </div>
          {/* Room to scroll the buttons above the word sheet on small screens. */}
          {detail && !detail.loading && <div aria-hidden className="h-[46vh] xl:hidden" />}
        </aside>
      </div>
    </div>
  );
};

type ReaderScreenProps = Omit<ChunkReaderViewProps, 'chunks'> & {
  loadText: (chapterId: string) => Promise<ChapterText>;
};

// The reader, once the chapter's text is here: it is kept in this browser,
// and fetched from the server the first time the chapter is opened on a new
// device.
export const ReaderScreen: React.FC<ReaderScreenProps> = ({ loadText, ...props }) => {
  const chapterId = props.chapter.id;
  const [text, setText] = useState<{ id: string; chunks?: string[]; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadText(chapterId)
      .then(t => { if (live) setText({ id: chapterId, chunks: t.chunks }); })
      .catch(error => {
        console.error('Loading the chapter failed:', error);
        if (!live) return;
        const missing = error instanceof ProxyError && error.status === 404;
        setText({
          id: chapterId,
          error: missing
            ? 'متن این فصل هنوز روی سرور نیست. برنامه را روی دستگاهی که کتاب را افزوده باز کن تا همگام شود.'
            : 'متن این فصل نیامد. اتصال را بررسی کن و دوباره امتحان کن.',
        });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, attempt]);

  if (!text || text.id !== chapterId) {
    return <div dir="rtl" className="font-fa py-24 text-center text-ink-muted dark:text-slate-400" role="status">در حال آوردن متن…</div>;
  }
  if (text.error || !text.chunks) {
    return (
      <div dir="rtl" className="font-fa max-w-md mx-auto py-16 flex flex-col items-center gap-4 text-center">
        <p className="text-ink dark:text-white">{text.error}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setText(null); setAttempt(a => a + 1); }} className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold">دوباره</button>
          <button type="button" onClick={props.onBack} className="min-h-[44px] px-5 rounded-xl bg-slate-100 dark:bg-slate-700 font-bold">برگشت</button>
        </div>
      </div>
    );
  }
  return <ChunkReaderView key={`${chapterId}-${props.index}`} {...props} chunks={text.chunks} />;
};
