import React from 'react';
import { fa, Icon } from '../common/ui';

export type SelectionTask = 'meaning' | 'grammar' | 'translate';

interface SelectionBarProps {
  text: string; // the picked words, as written
  words: number;
  maxMeaningWords: number;
  canGrowBack: boolean;
  canGrowForward: boolean;
  wholeSentence: boolean;
  aiNote?: string; // why the grammar needs something else, when it cannot run
  busy: SelectionTask | null;
  translation?: string;
  structures?: { uid: string; name: string }[]; // grammar found in the sentence
  onGrow: (side: -1 | 1) => void;
  onWholeSentence: () => void;
  onMeaning: () => void;
  onGrammar: () => void;
  onTranslate: () => void;
  onOpenStructure: (uid: string) => void;
  onClose: () => void;
}

const chip = 'min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40';
const action = 'min-h-[44px] px-4 rounded-xl font-bold disabled:opacity-50';

// Several words picked in the text: widen the pick, then get the meaning of
// the phrase, the grammar of the sentence, or its translation.
export const SelectionBar: React.FC<SelectionBarProps> = props => {
  const { text, words, maxMeaningWords, busy } = props;
  return (
    <section aria-label="عبارت انتخاب‌شده"
      className="fixed z-30 inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-5 md:left-6 md:right-[17.5rem] max-h-[52vh] overflow-y-auto shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 xl:static xl:max-h-none xl:shadow-none xl:ring-0 bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3 animate-reveal">
      <div className="flex items-start gap-2">
        <p dir="ltr" lang="en" className="flex-1 font-read text-[17px] text-ink dark:text-white line-clamp-4 text-left">{text}</p>
        <button type="button" onClick={props.onClose} aria-label="لغو انتخاب" className="w-9 h-9 -m-1.5 shrink-0 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip} disabled={!props.canGrowBack} onClick={() => props.onGrow(-1)}>+ واژهٔ قبل</button>
        <button type="button" className={chip} disabled={!props.canGrowForward} onClick={() => props.onGrow(1)}>واژهٔ بعد +</button>
        {!props.wholeSentence && <button type="button" className={chip} onClick={props.onWholeSentence}>کل جمله</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {words <= maxMeaningWords && (
          <button type="button" onClick={props.onMeaning} disabled={!!busy} className={`${action} bg-brand-500 hover:bg-brand-600 text-white`}>
            {busy === 'meaning' ? 'در حال پیدا کردن…' : words === 1 ? 'معنی این واژه' : 'معنی این عبارت'}
          </button>
        )}
        <button type="button" onClick={props.onGrammar} disabled={!!busy || !!props.aiNote} className={`${action} bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-100`}>
          {busy === 'grammar' ? 'در حال بررسی…' : 'ساختار دستوری جمله'}
        </button>
        <button type="button" onClick={props.onTranslate} disabled={!!busy} className={`${action} bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600`}>
          {busy === 'translate' ? 'در حال ترجمه…' : 'ترجمهٔ جمله'}
        </button>
      </div>
      {words > maxMeaningWords && <p className="text-xs text-ink-muted dark:text-slate-400">برای معنی، حداکثر {fa(maxMeaningWords)} واژه انتخاب کن؛ برای جملهٔ کامل، ساختار یا ترجمه را بزن.</p>}
      {props.aiNote && <p className="text-xs text-ink-muted dark:text-slate-400">{props.aiNote}</p>}
      {props.translation && <p className="rounded-xl bg-slate-50 dark:bg-slate-900/50 px-3 py-2 text-ink dark:text-slate-100">{props.translation}</p>}
      {props.structures && props.structures.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-ink-muted dark:text-slate-400">ساختارهای این جمله به فهرست اضافه شد؛ برای توضیح و تمرین بزن:</p>
          <div className="flex flex-wrap gap-1.5">
            {props.structures.map(s => (
              <button key={s.uid} type="button" onClick={() => props.onOpenStructure(s.uid)} dir="ltr"
                className="min-h-[36px] px-3 rounded-full border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-sm font-en">{s.name}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
