import React, { useState, useMemo } from 'react';
import { Flashcard, Deck } from '../types';
import { fetchAudioData } from '../services/dictionaryService';
import { CardPlace, originText } from '../services/library';
import { fa, Icon } from './common/ui';
import { isLeech, lacksExtras } from '../services/cardExtras';

interface FlashcardListProps {
  cards: Flashcard[];
  decks: Deck[];
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onBackToDecks: () => void;
  onCompleteCard: (cardId: string) => Promise<void>;
  onAutoFixAll: () => void;
  onStopAutoFix: () => void;
  autoFixProgress: { current: number, total: number } | null;
  places?: Map<string, CardPlace[]>; // where each card was met while reading
  onFillExtras?: (cards: Flashcard[]) => void; // synonyms, word family… for the cards that lack them
  extrasProgress?: { current: number, total: number } | null;
  onStopFillExtras?: () => void;
}

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const CompleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 3 2.5 5L10 3l2.5 5L15 3l2.5 5L20 3"/><path d="M10 13a2.5 2.5 0 0 0-2.5 2.5V21h5v-5.5A2.5 2.5 0 0 0 10 13Z"/><path d="M5 21h14"/></svg>;
const LoadingIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden="true"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>;
const SearchIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;
const MagicWandIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m19 2 2 2-2 2-2-2 2-2Z"/><path d="m5 17 2 2-2 2-2-2 2-2Z"/><path d="m15 17 2 2-2 2-2-2 2-2Z"/><path d="M14.5 4 2.5 16 5.5 19 17.5 7 14.5 4Z"/><line x1="21.5" y1="11" x2="17.5" y2="7"/></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>;

const MissingInfoIndicator: React.FC<{ card: Flashcard }> = ({ card }) => {
    const missing: string[] = [];
    if (!card.audioSrc) missing.push('صدا');
    if (!card.pronunciation) missing.push('تلفظ');
    if (!card.definition?.length) missing.push('تعریف');
    if (!card.exampleSentenceTarget?.length) missing.push('مثال');

    if (missing.length === 0) return null;

    const text = `بدون ${missing.join('، ')}`;
    return (
        <span className="text-[11px] rounded-full bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 px-2 py-0.5 truncate min-w-0" title={text}>
            {text}
        </span>
    );
};


// "Source: Book title and 2 more · Gemini · gemini-2.5-flash"
const CardSource: React.FC<{ places?: CardPlace[]; origin: string | null }> = ({ places = [], origin }) => {
    const titles = Array.from(new Set(places.map(p => p.sourceTitle)));
    if (titles.length === 0 && !origin) return null;
    return (
        <p className="mt-1.5 flex items-center gap-1 min-w-0 text-xs text-ink-muted dark:text-slate-400">
            {titles.length > 0 && <>
                <span className="shrink-0">منبع:</span>
                <bdi dir="auto" className="font-en font-medium text-ink dark:text-slate-300 truncate min-w-0">{titles[0]}</bdi>
                {titles.length > 1 && <span className="shrink-0">و {fa(titles.length - 1)} منبع دیگر</span>}
            </>}
            {titles.length > 0 && origin && <span className="shrink-0" aria-hidden="true">·</span>}
            {origin && <>
                <span className="shrink-0">سازنده:</span>
                <bdi dir="auto" className="truncate min-w-0">{origin}</bdi>
            </>}
        </p>
    );
};

const control = 'block w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-ink dark:text-white focus:border-brand-500 focus:outline-none';

const FlashcardList: React.FC<FlashcardListProps> = ({ cards, decks, onEdit, onDelete, onBackToDecks, onCompleteCard, onAutoFixAll, onStopAutoFix, autoFixProgress, places, onFillExtras, extrasProgress, onStopFillExtras }) => {
  const [show, setShow] = useState<'all' | 'leech' | 'no-extras'>('all');
  const [sortKey, setSortKey] = useState<string>('front-asc');
  const [selectedDeckId, setSelectedDeckId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [completingCardId, setCompletingCardId] = useState<string | null>(null);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const CARDS_PER_PAGE = 100;

  const decksById = useMemo(() => new Map(decks.map(deck => [deck.id, deck.name])), [decks]);

  const filteredCards = useMemo(() => {
    let result = cards;

    // 1. Deck Filter
    if (selectedDeckId !== 'all') {
        result = result.filter(card => card.deckId === selectedDeckId);
    }

    if (show === 'leech') result = result.filter(isLeech);
    else if (show === 'no-extras') result = result.filter(lacksExtras);

    // 2. Search Filter
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        result = result.filter(card =>
            card.front.toLowerCase().includes(query) ||
            card.back.toLowerCase().includes(query)
        );
    }

    return result;
  }, [cards, selectedDeckId, searchQuery, show]);

  const leechCount = useMemo(() => cards.filter(isLeech).length, [cards]);
  const missingExtras = useMemo(() => cards.filter(lacksExtras), [cards]);

  const sortedCards = useMemo(() => {
    let sortableCards = [...filteredCards];
    sortableCards.sort((a, b) => {
        switch (sortKey) {
            case 'front-asc':
                return a.front.localeCompare(b.front);
            case 'front-desc':
                return b.front.localeCompare(a.front);
            case 'back-asc':
                return a.back.localeCompare(b.back);
            case 'back-desc':
                return b.back.localeCompare(a.back);
            case 'latest':
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            case 'needs-audio':
                if (!a.audioSrc && b.audioSrc) return -1;
                if (a.audioSrc && !b.audioSrc) return 1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // secondary sort
            default:
                return 0;
        }
    });
    return sortableCards;
  }, [filteredCards, sortKey]);

  const paginatedCards = useMemo(() => {
    const startIndex = (currentPage - 1) * CARDS_PER_PAGE;
    return sortedCards.slice(startIndex, startIndex + CARDS_PER_PAGE);
  }, [sortedCards, currentPage]);

  const totalPages = Math.ceil(sortedCards.length / CARDS_PER_PAGE);

  // Reset page when filters change
  useMemo(() => {
      setCurrentPage(1);
  }, [selectedDeckId, searchQuery, sortKey, show]);


  const playAudio = async (audioUrl: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingAudioUrl) return;
    setPlayingAudioUrl(audioUrl);
    try {
      const dataUrl = await fetchAudioData(audioUrl);
      const audio = new Audio(dataUrl);
      audio.play();
      audio.addEventListener('ended', () => setPlayingAudioUrl(null));
      audio.addEventListener('error', () => setPlayingAudioUrl(null));
    } catch (error) {
      console.error("Failed to play audio:", error);
      setPlayingAudioUrl(null);
    }
  };

  const handleComplete = async (cardId: string) => {
    setCompletingCardId(cardId);
    await onCompleteCard(cardId);
    setCompletingCardId(null);
  };

  if (cards.length === 0) {
    return (
      <div dir="rtl" className="font-fa max-w-5xl mx-auto w-full text-center py-16 px-5 bg-white dark:bg-slate-800 rounded-3xl">
        <span className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-brand-100 text-brand-500 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center"><Icon.Cards size={28} /></span>
        <h1 className="text-2xl font-extrabold text-ink dark:text-white">هنوز کارتی نداری</h1>
        <p className="mt-2 text-ink-muted dark:text-slate-400">با دکمهٔ «+» اولین کارت را بساز، یا از تنظیمات کارت‌ها را از فایل CSV وارد کن.</p>
      </div>
    );
  }

  const actionButtonClasses = "w-9 h-9 flex items-center justify-center rounded-full transition-colors hover:bg-slate-100 dark:hover:bg-slate-700";


  return (
    <div dir="rtl" className="font-fa max-w-5xl mx-auto w-full flex flex-col gap-4">
        <header className="flex items-center gap-3">
            <button onClick={onBackToDecks} aria-label="بازگشت به دسته‌ها" title="بازگشت به دسته‌ها"
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-ink dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800">
                <Icon.Back size={20} />
            </button>
            <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-extrabold text-ink dark:text-white">کارت‌ها</h1>
                <p className="text-sm text-ink-muted dark:text-slate-400">
                    {sortedCards.length === cards.length ? `${fa(cards.length)} کارت` : `${fa(sortedCards.length)} از ${fa(cards.length)} کارت`}
                </p>
            </div>
            {autoFixProgress ? (
                 <button onClick={onStopAutoFix} className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors shrink-0">
                    <StopIcon /> توقف ({fa(autoFixProgress.current)} از {fa(autoFixProgress.total)})
                 </button>
            ) : (
                <button onClick={onAutoFixAll} disabled={!!extrasProgress} title="جزئیات ناقص همهٔ کارت‌ها پر شود"
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors shrink-0">
                    <MagicWandIcon /> تکمیل خودکار همه
                </button>
            )}
        </header>

        {onFillExtras && (extrasProgress || missingExtras.length > 0) && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white dark:bg-slate-800 p-4">
                <p className="flex-1 min-w-[12rem] text-sm text-ink dark:text-slate-200">
                    {extrasProgress
                        ? <>در حال افزودن هم‌معنی‌ها، اشتباه رایج، سبک و خانوادهٔ واژه: {fa(extrasProgress.current)} از {fa(extrasProgress.total)}</>
                        : <>{fa(missingExtras.length)} کارت هنوز هم‌معنی، اشتباه رایج، سبک و خانوادهٔ واژه ندارد.</>}
                </p>
                {extrasProgress ? (
                    <button type="button" onClick={onStopFillExtras} className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700"><StopIcon /> توقف</button>
                ) : (
                    <button type="button" onClick={() => onFillExtras(missingExtras)} disabled={!!autoFixProgress}
                        className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 disabled:opacity-50">
                        <MagicWandIcon /> افزودن با هوش مصنوعی
                    </button>
                )}
            </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
            <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <SearchIcon />
                </div>
                <input
                    type="search"
                    dir="auto"
                    placeholder="جست‌وجوی واژه یا معنی"
                    aria-label="جست‌وجوی کارت‌ها"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`${control} pr-10 pl-3 text-right`}
                />
            </div>

            <div className="grid grid-cols-2 sm:contents gap-2">
                <select id="show-filter" aria-label="نمایش" value={show} onChange={e => setShow(e.target.value as typeof show)} className={`${control} px-3 min-w-0 sm:w-auto col-span-2 sm:col-span-1`}>
                    <option value="all">همهٔ کارت‌ها</option>
                    <option value="leech">کارت‌های سمج ({fa(leechCount)})</option>
                    <option value="no-extras">بدون هم‌معنی و خانواده ({fa(missingExtras.length)})</option>
                </select>
                <select id="deck-filter" aria-label="دسته" value={selectedDeckId} onChange={e => setSelectedDeckId(e.target.value)} className={`${control} px-3 min-w-0 sm:w-auto`}>
                    <option value="all">همهٔ دسته‌ها</option>
                    {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
                </select>
                <select id="sort-order" aria-label="ترتیب" value={sortKey} onChange={e => setSortKey(e.target.value)} className={`${control} px-3 min-w-0 sm:w-auto`}>
                    <option value="front-asc">انگلیسی (A تا Z)</option>
                    <option value="front-desc">انگلیسی (Z تا A)</option>
                    <option value="back-asc">فارسی (الف تا ی)</option>
                    <option value="back-desc">فارسی (ی تا الف)</option>
                    <option value="latest">تازه‌ترین</option>
                    <option value="needs-audio">اول کارت‌های بی‌صدا</option>
                </select>
            </div>
        </div>

        {paginatedCards.length === 0 ? (
            <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-3xl">
                <p className="text-ink-muted dark:text-slate-400">کارتی با این جست‌وجو پیدا نشد.</p>
            </div>
        ) : (
            <div className="flex flex-col gap-2.5">
                {paginatedCards.map((card) => {
                    const deckName = decksById.get(card.deckId);
                    return (
                    <div key={card.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 flex justify-between items-center gap-2 transition-all hover:shadow-md">
                        <div className="flex-1 overflow-hidden min-w-0">
                            <p dir="ltr" className="font-en text-lg font-bold text-ink dark:text-white truncate text-right">{card.front}</p>
                            <p dir="auto" className="text-ink-muted dark:text-slate-300 truncate text-right">{card.back}</p>
                            <div className="flex items-center gap-2 text-xs text-ink-muted dark:text-slate-400 mt-2 min-w-0">
                                {deckName
                                    ? <span dir="auto" title={deckName} className="font-en bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full truncate max-w-[8rem] shrink-0">{deckName}</span>
                                    : <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full shrink-0">دستهٔ نامعلوم</span>}
                                {isLeech(card) && <span title={`${fa(card.lapses || 0)} بار فراموش شده`} className="shrink-0 rounded-full bg-rose-50 text-rose-900 dark:bg-rose-900/30 dark:text-rose-100 px-2 py-0.5 text-[11px]">سمج</span>}
                                <MissingInfoIndicator card={card} />
                            </div>
                            <CardSource places={places?.get(card.id)} origin={originText(card.origin)} />
                        </div>
                        <div className="flex flex-shrink-0 gap-0.5 sm:gap-1 ps-1 items-center">
                            {card.audioSrc && (
                                <button
                                    onClick={(e) => playAudio(card.audioSrc!, e)}
                                    disabled={!!playingAudioUrl}
                                    aria-label={`پخش تلفظ ${card.front}`}
                                    title="پخش تلفظ"
                                    className={`${actionButtonClasses} text-ink-muted hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 disabled:opacity-50`}
                                >
                                    {playingAudioUrl === card.audioSrc ? <LoadingIcon /> : <Icon.Speaker size={16} />}
                                </button>
                            )}
                            <button onClick={() => handleComplete(card.id)} disabled={completingCardId === card.id || !!autoFixProgress} aria-label={`تکمیل جزئیات ${card.front}`} title="تکمیل جزئیات" className={`${actionButtonClasses} text-brand-600 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200 disabled:opacity-50 disabled:cursor-wait`}>
                                {completingCardId === card.id ? <LoadingIcon /> : <CompleteIcon />}
                            </button>
                            <button onClick={() => onEdit(card)} aria-label={`ویرایش ${card.front}`} title="ویرایش" className={`${actionButtonClasses} text-brand-600 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200`}><EditIcon /></button>
                            <button onClick={() => onDelete(card.id)} aria-label={`حذف ${card.front}`} title="حذف" className={`${actionButtonClasses} text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300`}><DeleteIcon /></button>
                        </div>
                    </div>
                    );
                })}
            </div>
        )}

        {totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-2">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">قبلی</button>
                <span className="text-sm text-ink-muted dark:text-slate-300">صفحهٔ {fa(currentPage)} از {fa(totalPages)}</span>
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">بعدی</button>
            </div>
        )}
    </div>
  );
};

export default FlashcardList;
