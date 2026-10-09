import React, { useState } from 'react';
import { DailyGoal, Deck, Flashcard, UserProfile } from '../types';
import { isDue } from '../services/srsService';
import { calculateLevel } from '../services/gamificationService';
import { fa, Icon, StreakChip } from './common/ui';

interface DeckListProps {
    decks: Deck[];
    cards: Flashcard[];
    onStudyDeck: (deckId: string) => void;
    onRenameDeck: (deckId: string, newName: string) => Promise<void>;
    onDeleteDeck: (deckId: string) => Promise<void>;
    onViewAllCards: () => void;
    onBulkAdd: () => void;
    onAiExtract?: () => void;
    userProfile: UserProfile | null;
    streak: number;
}

const RenameIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const SparkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>;

// A daily goal in words, from its type (the stored description is English).
const goalLabel = (goal: DailyGoal): string => {
    switch (goal.type) {
        case 'STUDY': return `${fa(goal.target)} مرور`;
        case 'QUIZ': return `${fa(goal.target)} تمرین آزمون`;
        case 'STREAK': return `زنجیرهٔ ${fa(goal.target)} روزه`;
        default: return goal.description;
    }
};

const Bar: React.FC<{ percent: number; tone?: 'brand' | 'done' }> = ({ percent, tone = 'brand' }) => (
    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${tone === 'done' ? 'bg-emerald-600' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
);

// Level, streak and today's goals at the top of the deck list.
const Progress: React.FC<{ userProfile: UserProfile; streak: number }> = ({ userProfile, streak }) => {
    const { level, progress, xpForNextLevel, xp } = calculateLevel(userProfile.xp);
    const goals = userProfile.dailyGoals?.goals || [];
    const doneGoals = goals.filter(g => g.isComplete).length;
    const showGoals = goals.length > 0 && doneGoals < goals.length;
    return (
        <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[12rem]">
                    <div className="flex justify-between items-center gap-2 mb-1.5 text-sm">
                        <span className="inline-flex items-center gap-1.5 font-bold text-brand-600 dark:text-brand-300"><Icon.Star size={15} />سطح {fa(level)}</span>
                        <span className="text-ink-muted dark:text-slate-400">{fa(xp)} از {fa(xpForNextLevel)} امتیاز</span>
                    </div>
                    <Bar percent={progress} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <StreakChip streak={streak} />
                    {goals.length > 0 && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold ${doneGoals === goals.length
                            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100'
                            : 'bg-slate-100 text-ink dark:bg-slate-700 dark:text-slate-100'}`}>
                            <Icon.Check size={14} />{fa(doneGoals)} از {fa(goals.length)} هدف
                        </span>
                    )}
                </div>
            </div>
            {showGoals && (
                <div className="flex flex-col gap-3 pt-4 border-t border-slate-100 dark:border-slate-700">
                    <h2 className="text-sm font-bold text-ink dark:text-white">هدف‌های امروز</h2>
                    {goals.map(goal => (
                        <div key={goal.id} className="flex flex-col gap-1.5">
                            <div className="flex justify-between items-center gap-2 text-sm">
                                <span className="text-ink dark:text-slate-200">{goalLabel(goal)}</span>
                                {goal.isComplete
                                    ? <Icon.Check size={18} className="text-emerald-600 dark:text-emerald-400" />
                                    : <span className="text-ink-muted dark:text-slate-400">{fa(goal.progress)} از {fa(goal.target)}</span>}
                            </div>
                            <Bar percent={goal.target > 0 ? (goal.progress / goal.target) * 100 : 0} tone={goal.isComplete ? 'done' : 'brand'} />
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};

const DeckCard: React.FC<{
    deck: Deck;
    cardCount: number;
    dueCount: number;
    onStudy: () => void;
    onRename: (newName: string) => Promise<void>;
    onDelete: () => Promise<void>;
}> = ({ deck, cardCount, dueCount, onStudy, onRename, onDelete }) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState(deck.name);

    const handleRename = async () => {
        if (newName.trim() && newName.trim() !== deck.name) {
            await onRename(newName.trim());
        }
        setIsRenaming(false);
    };

    const handleDelete = () => {
        if (confirm(`دستهٔ «${deck.name}» حذف شود؟ ${fa(cardCount)} کارت داخل آن هم حذف می‌شود و برنمی‌گردد.`)) {
            onDelete();
        }
    };

    const dueProgress = cardCount > 0 ? (dueCount / cardCount) * 100 : 0;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4 min-w-0 transition-all hover:shadow-md hover:-translate-y-0.5">
            <div className="min-w-0">
                {isRenaming ? (
                    <div className="flex gap-2">
                        <input
                            type="text"
                            dir="auto"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onBlur={handleRename}
                            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                            autoFocus
                            aria-label="نام تازهٔ دسته"
                            className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white font-en focus:border-brand-500 focus:outline-none"
                        />
                        <button onClick={handleRename} className="min-h-[40px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600">ذخیره</button>
                    </div>
                ) : (
                    <h3 dir="auto" className="font-en text-xl font-bold text-ink dark:text-white truncate text-right" title={deck.name}>{deck.name}</h3>
                )}
                <p className="mt-1 text-sm text-ink-muted dark:text-slate-400">{fa(cardCount)} کارت</p>
            </div>

            <div>
                <div className="flex justify-between items-center mb-1.5 text-xs font-bold">
                    <span className="text-brand-600 dark:text-brand-300">موعد مرور</span>
                    <span className="text-ink-muted dark:text-slate-300">{fa(dueCount)} از {fa(cardCount)}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500" title={`${fa(dueCount)} کارت موعد مرور دارد`} style={{ width: `${dueProgress}%` }} />
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={onStudy}
                    disabled={cardCount === 0}
                    className="flex-1 flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Icon.Cards size={18} /> مرور
                </button>
                <button onClick={() => setIsRenaming(true)} aria-label={`تغییر نام ${deck.name}`} title="تغییر نام"
                    className="flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <RenameIcon /> <span className="sm:hidden">تغییر نام</span>
                </button>
                <button onClick={handleDelete} aria-label={`حذف ${deck.name}`} title="حذف دسته"
                    className="flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50">
                    <DeleteIcon /> <span className="sm:hidden">حذف</span>
                </button>
            </div>
        </div>
    );
};


const DeckList: React.FC<DeckListProps> = ({ decks, cards, onStudyDeck, onRenameDeck, onDeleteDeck, onViewAllCards, onBulkAdd, onAiExtract, userProfile, streak }) => {

    if (decks.length === 0) {
        return (
            <div dir="rtl" className="font-fa max-w-5xl mx-auto w-full text-center py-16 px-5 bg-white dark:bg-slate-800 rounded-3xl">
                <span className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-brand-100 text-brand-500 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center"><Icon.Layers size={28} /></span>
                <h1 className="text-2xl font-extrabold text-ink dark:text-white">هنوز دسته‌ای نداری</h1>
                <p className="mt-2 text-ink-muted dark:text-slate-400">اولین کارت را که بسازی، دسته‌اش هم خودکار ساخته می‌شود. کارت‌ها را از تنظیمات هم می‌شود از فایل CSV وارد کرد.</p>
            </div>
        );
    }

    const deckData = decks.map(deck => {
        const cardsInDeck = cards.filter(card => card.deckId === deck.id);
        const dueCardsInDeck = cardsInDeck.filter(card => isDue(card));
        return {
            ...deck,
            cardCount: cardsInDeck.length,
            dueCount: dueCardsInDeck.length,
        };
    }).sort((a,b) => a.name.localeCompare(b.name));

    const totalCards = cards.length;

    return (
        <div dir="rtl" className="font-fa max-w-5xl mx-auto w-full flex flex-col gap-5">
            {userProfile && <Progress userProfile={userProfile} streak={streak} />}

            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div>
                    <h1 className="text-2xl md:text-3xl font-extrabold text-ink dark:text-white">دسته‌ها</h1>
                    <p className="text-sm text-ink-muted dark:text-slate-400">{fa(decks.length)} دسته، {fa(totalCards)} کارت</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={onViewAllCards} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                        <Icon.List size={16} />همهٔ {fa(totalCards)} کارت
                    </button>
                    {onAiExtract && (
                      <button onClick={onAiExtract} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors">
                        <SparkIcon />
                        <span>استخراج واژه از متن</span>
                      </button>
                    )}
                    <button onClick={onBulkAdd} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors">
                        <Icon.Layers size={16} />
                        <span>افزودن گروهی</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {deckData.map(deck => (
                    <DeckCard
                        key={deck.id}
                        deck={deck}
                        cardCount={deck.cardCount}
                        dueCount={deck.dueCount}
                        onStudy={() => onStudyDeck(deck.id)}
                        onRename={(newName) => onRenameDeck(deck.id, newName)}
                        onDelete={() => onDeleteDeck(deck.id)}
                    />
                ))}
            </div>
        </div>
    );
};

export default DeckList;
