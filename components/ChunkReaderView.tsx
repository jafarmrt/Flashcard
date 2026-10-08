import React, { useMemo, useRef, useState } from 'react';
import { ExtractedWordCard, Settings, TextDoc } from '../types';
import { extractFromLongText, ExtractionSource } from '../services/extractionPipeline';
import { enrichmentToCard, freeEnrich } from '../services/freeExtractionService';
import { findSentence } from '../services/textChunker';
import { normalizeTerm } from '../services/vocabMerge';
import { isSpeechSupported, speakText, stopSpeech } from '../services/ttsService';
import { CHUNK_COMPLETE_XP, isChestSection } from '../services/xpRules';
import { fa, Icon } from './common/ui';

interface ChunkReaderViewProps {
  doc: TextDoc;
  index: number;
  settings: Settings;
  existingFronts: string[];
  onSaveCards: (cards: ExtractedWordCard[], deckName: string) => Promise<void>;
  onComplete: () => void;
  onBack: () => void;
  onOpenChunk: (index: number) => void;
  showToast: (message: string) => void;
}

type Item = ExtractedWordCard & { loading?: boolean };

const KIND_LABEL: Record<string, string> = { word: 'واژه', phrase: 'عبارت', idiom: 'اصطلاح', grammar: 'دستوری' };

// One section of a text: read it, pick its hard words (AI, free dictionaries,
// or by tapping a word), turn them into cards, then finish the section.
export const ChunkReaderView: React.FC<ChunkReaderViewProps> = ({
  doc, index, settings, existingFronts, onSaveCards, onComplete, onBack, onOpenChunk, showToast,
}) => {
  const chunk = doc.chunks[index] || '';
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [source, setSource] = useState<ExtractionSource>(settings.extractionSource || 'ai');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reading, setReading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const done = doc.completed.includes(index);

  const known = useMemo(() => new Set(existingFronts.map(normalizeTerm)), [existingFronts]);
  const itemKeys = useMemo(() => new Map(items.map((it, i) => [normalizeTerm(it.front), i])), [items]);

  const extract = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const result = await extractFromLongText({
        text: chunk,
        level: settings.userLevel || 'B2',
        perSection: 12,
        source,
        existingFronts,
        includeGrammar: source === 'ai',
        aiOptions: {
          aiProvider: settings.aiProvider || 'gemini',
          aiBaseUrl: settings.aiBaseUrl || undefined,
          customApiKey: settings.customApiKey || undefined,
          model: settings.aiModel || 'gemini-2.5-flash',
        },
        signal: controller.signal,
      });
      if (result.fallbackSections > 0) showToast('هوش مصنوعی جواب نداد؛ از دیکشنری‌های رایگان استفاده شد.');
      if (result.cards.length === 0) showToast(result.failedSections > 0 ? 'پیدا کردن واژه‌ها ناموفق بود. تنظیمات یا اتصال را بررسی کن.' : 'واژهٔ سخت تازه‌ای پیدا نشد.');
      setItems(prev => {
        const have = new Set(prev.map(p => normalizeTerm(p.front)));
        return [...prev, ...result.cards.filter(c => !have.has(normalizeTerm(c.front))).map(c => ({ ...c, selected: !c.alreadyInDeck }))];
      });
      setSaved(false);
    } finally {
      setLoading(false);
    }
  };

  // Tap a word in the text to look it up and add it to the list.
  const addWord = async (raw: string) => {
    const term = raw.toLowerCase();
    const existing = itemKeys.get(normalizeTerm(term));
    if (existing !== undefined) { setSelected(existing); return; }
    const position = items.length;
    setItems(prev => [...prev, { front: term, back: '…', loading: true, selected: true, alreadyInDeck: known.has(normalizeTerm(term)) }]);
    setSelected(position);
    try {
      const e = await freeEnrich(term);
      if (!e.found && !e.translation) {
        showToast(`«${term}» در دیکشنری پیدا نشد.`);
        setItems(prev => prev.filter(p => !(p.loading && p.front === term)));
        setSelected(null);
        return;
      }
      const card = enrichmentToCard(term, findSentence(chunk, term), e, 'word');
      setItems(prev => prev.map(p => (p.loading && p.front === term ? { ...card, alreadyInDeck: known.has(normalizeTerm(card.front)) } : p)));
      setSaved(false);
    } catch (error) {
      console.error('Lookup failed:', error);
      showToast('جست‌وجوی واژه ناموفق بود.');
      setItems(prev => prev.filter(p => !(p.loading && p.front === term)));
      setSelected(null);
    }
  };

  const toggle = (i: number) => setItems(prev => prev.map((p, j) => (j === i ? { ...p, selected: !p.selected } : p)));
  const toSave = items.filter(it => it.selected && !it.alreadyInDeck && !it.loading && it.back && it.back !== '…');

  const save = async () => {
    if (toSave.length === 0) return;
    await onSaveCards(toSave, doc.deckName);
    setItems(prev => prev.map(p => (toSave.includes(p) ? { ...p, alreadyInDeck: true, selected: false } : p)));
    setSaved(true);
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
      {p.split(/([A-Za-z][A-Za-z'’-]*)/).map((part, i) => {
        if (i % 2 === 0) return <React.Fragment key={i}>{part}</React.Fragment>;
        const key = normalizeTerm(part);
        const itemIndex = itemKeys.get(key);
        const isSelected = itemIndex !== undefined && itemIndex === selected;
        const cls = itemIndex !== undefined
          ? isSelected ? 'bg-brand-200 ring-2 ring-brand-500 dark:bg-brand-800' : 'bg-amber-100 dark:bg-amber-900/50'
          : known.has(key) ? 'underline decoration-emerald-500/60 decoration-2 underline-offset-4' : '';
        return (
          <button key={i} type="button" onClick={() => addWord(part)}
            className={`inline rounded px-0.5 -mx-0.5 hover:bg-brand-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${cls}`}>
            {part}
          </button>
        );
      })}
    </p>
  );

  const detail = selected !== null ? items[selected] : undefined;

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-5 w-full">
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} aria-label="برگشت به مسیر" className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-white dark:hover:bg-slate-800"><Icon.Back /></button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-ink-muted dark:text-slate-400">بخش {fa(index + 1)} از {fa(doc.chunks.length)}</p>
          <h1 dir="auto" className="font-en font-bold text-lg text-ink dark:text-white truncate">{doc.title}</h1>
        </div>
        <nav aria-label="بخش‌ها" className="flex flex-wrap gap-1.5">
          {doc.chunks.map((_, i) => {
            const isDone = doc.completed.includes(i);
            const open = isDone || i <= Math.max(index, ...doc.completed.map(c => c + 1));
            return (
              <button key={i} type="button" disabled={!open} onClick={() => onOpenChunk(i)} aria-current={i === index ? 'page' : undefined}
                className={`w-9 h-9 rounded-[10px] text-sm font-bold ${i === index ? 'bg-brand-500 text-white ring-4 ring-brand-200 dark:ring-brand-900' : isDone ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'} disabled:opacity-50`}>
                {fa(i + 1)}
              </button>
            );
          })}
        </nav>
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
                {items.map((it, i) => (
                  <li key={`${it.front}-${i}`}>
                    <div className={`flex items-center gap-2.5 min-h-[44px] px-2.5 rounded-xl ${selected === i ? 'bg-brand-50 dark:bg-brand-900/40' : ''}`}>
                      <input type="checkbox" checked={!!it.selected && !it.alreadyInDeck} disabled={it.alreadyInDeck || it.loading}
                        onChange={() => toggle(i)} aria-label={`انتخاب ${it.front}`} className="w-[18px] h-[18px] accent-brand-500" />
                      <button type="button" onClick={() => setSelected(i)} className="flex-1 min-w-0 flex items-center gap-2 text-right">
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
            <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2.5 animate-reveal">
              <div dir="ltr" className="flex items-baseline gap-2.5 flex-wrap">
                <span className="font-en font-bold text-2xl text-ink dark:text-white">{detail.front}</span>
                {detail.pronunciation && <span className="text-ink-muted dark:text-slate-400">{detail.pronunciation}</span>}
                {isSpeechSupported() && (
                  <button type="button" onClick={() => speakText(detail.front, { rate: 0.9 })} aria-label="پخش تلفظ" className="text-brand-500 dark:text-brand-300"><Icon.Speaker size={18} /></button>
                )}
              </div>
              <p className="text-ink dark:text-white">{detail.back}</p>
              {detail.grammarPattern && <p dir="ltr" className="font-mono text-sm text-rose-700 dark:text-rose-300">{detail.grammarPattern}</p>}
              {detail.collocations && detail.collocations.length > 0 && (
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {detail.collocations.slice(0, 5).map((c, i) => (
                    <span key={i} className="rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-0.5 text-[13px]">{c.phrase}</span>
                  ))}
                </div>
              )}
              {detail.definition && detail.definition[0] && <p dir="ltr" className="text-sm text-ink-muted dark:text-slate-400">{detail.definition[0]}</p>}
            </section>
          )}

          <div className="flex flex-col gap-2">
            {toSave.length > 0 && (
              <button type="button" onClick={save} className="min-h-[56px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg">
                ساخت {fa(toSave.length)} کارت
              </button>
            )}
            <button type="button" onClick={onComplete}
              className={`min-h-[52px] rounded-2xl font-extrabold ${toSave.length === 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'border-2 border-emerald-600 text-emerald-800 dark:text-emerald-200'}`}>
              {done ? 'برگشت به مسیر' : `پایان این بخش · +${fa(CHUNK_COMPLETE_XP)} امتیاز${isChestSection(index) ? ' و صندوق جایزه' : ''}`}
            </button>
            {saved && <p className="text-center text-sm text-emerald-700 dark:text-emerald-300">کارت‌ها ساخته شد و در مرور بعدی می‌آیند.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
};
