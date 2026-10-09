import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { useAppLogic, View, HealthStatus } from './hooks/useAppLogic';

import { Flashcard, Deck } from './types';
import FlashcardList from './components/FlashcardList';
import FlashcardForm from './components/FlashcardForm';
import { StudyView } from './components/StudyView';
import { aiRequestOptions, geminiAudioOptions } from './services/aiSettings';
import Toast from './components/Toast';
import DeckList from './components/DeckList';
import SettingsView from './components/SettingsView';
import { StudySetupModal } from './components/StudySetupModal';
import { AuthView } from './components/AuthView';
import { Sidebar, BottomTabs, AddFab } from './components/layout/Navigation';
import { TodayView } from './components/TodayView';
import { MeView } from './components/MeView';
import { LibraryView } from './components/LibraryView';
import { chaptersOf, placesByCard } from './services/library';
import { knownTermSet } from './services/knownWords';
import { isDue, isNewCard } from './services/srsService';
import { dayString } from './services/streakService';
import { DEFAULT_DAILY_REVIEW_GOAL } from './services/xpRules';
import { AutoFixReportModal } from './components/AutoFixReportModal';

// Screens opened now and then load on first use, so the app starts faster.
// They are fetched in the background soon after, so they open offline too.
const SCREENS = {
    stats: () => import('./components/StatsView'),
    practice: () => import('./components/ConversationView'),
    changelog: () => import('./components/ChangelogView'),
    bulkAdd: () => import('./components/BulkAddView'),
    achievements: () => import('./components/AchievementsView'),
    profile: () => import('./components/ProfileView'),
    aiExtract: () => import('./components/AiTextExtractorView'),
    reader: () => import('./components/ChunkReaderView'),
    usage: () => import('./components/UsageView'),
};
const StatsView = lazy(() => SCREENS.stats().then(m => ({ default: m.StatsView })));
const PracticeView = lazy(() => SCREENS.practice().then(m => ({ default: m.PracticeView })));
const ChangelogView = lazy(() => SCREENS.changelog().then(m => ({ default: m.ChangelogView })));
const BulkAddView = lazy(() => SCREENS.bulkAdd().then(m => ({ default: m.BulkAddView })));
const AchievementsView = lazy(() => SCREENS.achievements().then(m => ({ default: m.AchievementsView })));
const ProfileView = lazy(() => SCREENS.profile().then(m => ({ default: m.ProfileView })));
const AiTextExtractorView = lazy(() => SCREENS.aiExtract().then(m => ({ default: m.AiTextExtractorView })));
const UsageView = lazy(() => SCREENS.usage().then(m => ({ default: m.UsageView })));
const ReaderScreen = lazy(() => SCREENS.reader().then(m => ({ default: m.ReaderScreen })));

// A screen that fails to load (offline before it was ever opened) or to
// draw shows a message instead of taking the whole app down.
type BoundaryProps = { view: string; children: React.ReactNode };
class ScreenBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
    // The project has no React type package, so the inherited members are named here.
    declare props: BoundaryProps;
    declare setState: (state: { failed: boolean }) => void;
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: unknown) { console.error('A screen failed:', error); }
    componentDidUpdate(prev: { view: string }) { if (prev.view !== this.props.view && this.state.failed) this.setState({ failed: false }); }
    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div dir="rtl" className="font-fa py-20 flex flex-col items-center gap-4 text-center text-ink dark:text-white">
                <p>این صفحه باز نشد. اگر اینترنت قطع است، وصل که شد دوباره امتحان کن.</p>
                <button type="button" onClick={() => window.location.reload()} className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold">دوباره</button>
            </div>
        );
    }
}

const App: React.FC = () => {
    const {
        // State
        flashcards, decks, view, editingCard, toastMessage, isLoggedIn, currentUser, authLoading, appLoading,
        studyDeckId, isStudySetupModalOpen, dbStatus, apiStatus, freeDictApiStatus, mwDictApiStatus,
        settings, userProfile, streak, earnedAchievements, autoFixReport,
        // Handlers
        setView, showToast, handleAddCard, handleEditCard, handleDeleteCard, handleSaveCard,
        handleSaveProfile, handleBulkSaveCards, handleSessionEnd, handleExportCSV, handleImportCSV,
        handleResetApp, handleStudyDeck, handleStartStudySession, setIsStudySetupModalOpen,
        handleNavigate, handleRenameDeck, handleDeleteDeck, handleLogin, handleRegister, handleLogout,
        updateSettings, handleCheckAchievements, handleGoalUpdate, studyCards,
        handleCompleteCardDetails, handleAutoFixCards, handleStopAutoFix, autoFixProgress,
        handleCloseAutoFixReport, handleSaveExtractedCards, previousViewRef,
        syncStatus, studyMode, studyLogs, studySessionId, sources, chapters, occurrences,
        activeSourceId, activeChapterId, activeChunk, startQuickReview, openStudySetup,
        handleAddSource, handleOpenSource, handleOpenChapter, handleOpenChunk, handleDeleteSource,
        handleCompleteChunk, loadChapterText, handleSaveReaderCards,
        knownWords, sectionReview, handleMarkKnown, handleUnmarkKnown, handleStartSectionReview, dismissSectionReview, handleCheckCards,
    } = useAppLogic();

    const visibleFlashcards = useMemo(() => flashcards.filter(c => !c.isDeleted), [flashcards]);
    const knownTerms = useMemo(() => Array.from(knownTermSet(knownWords)), [knownWords]);
    const visibleDecks = decks.filter(d => !d.isDeleted);
    const dueCards = visibleFlashcards.filter(c => isDue(c));
    const health = [
        { label: 'DB', status: dbStatus },
        { label: 'AI', status: apiStatus },
        { label: 'Free Dict.', status: freeDictApiStatus },
        { label: 'MW', status: mwDictApiStatus },
    ];
    const todayUtc = dayString(new Date());
    const studyGoal = userProfile?.dailyGoals?.goals.find(g => g.type === 'STUDY');
    const activeSource = sources.find(s => s.id === activeSourceId && !s.isDeleted);
    const activeChapter = chapters.find(c => c.id === activeChapterId && !c.isDeleted);
    const existingFronts = useMemo(() => visibleFlashcards.map(c => c.front), [flashcards]);
    // Where each card was met while reading, shown on the card.
    const places = useMemo(() => placesByCard(occurrences, sources, chapters), [occurrences, sources, chapters]);

    useEffect(() => {
        // The reader is fetched at once so a book opens offline even right
        // after an update; the other screens a little later.
        SCREENS.reader().catch(() => {});
        const timer = setTimeout(() => Object.values(SCREENS).forEach(load => load().catch(() => {})), 5000);
        return () => clearTimeout(timer);
    }, []);

    const cardsForSetupModal = studyDeckId
        ? visibleFlashcards.filter(c => c.deckId === studyDeckId)
        : visibleFlashcards;

    const renderContent = () => {
        switch (view) {
            case 'TODAY':
                return <TodayView
                    userProfile={userProfile}
                    username={currentUser?.username}
                    streak={streak}
                    cards={visibleFlashcards}
                    studyLogs={studyLogs}
                    sources={sources}
                    chapters={chapters}
                    dueCount={dueCards.length}
                    newDueCount={dueCards.filter(isNewCard).length}
                    onStartReview={mode => startQuickReview(mode)}
                    onOpenSetup={() => openStudySetup()}
                    onNavigate={handleNavigate}
                    onOpenChunk={handleOpenChunk}
                />;
            case 'ME':
                return <MeView
                    userProfile={userProfile}
                    username={currentUser?.username}
                    streak={streak}
                    earnedAchievements={earnedAchievements}
                    syncStatus={syncStatus}
                    health={health}
                    hasCards={visibleFlashcards.length > 0}
                    onNavigate={handleNavigate}
                />;
            case 'TEXTS':
                return <LibraryView
                    sources={sources}
                    chapters={chapters}
                    occurrences={occurrences}
                    cards={visibleFlashcards}
                    decks={visibleDecks}
                    activeSourceId={activeSourceId}
                    activeChapterId={activeChapterId}
                    onAddSource={handleAddSource}
                    onOpenSource={handleOpenSource}
                    onOpenChapter={handleOpenChapter}
                    onOpenChunk={handleOpenChunk}
                    onDeleteSource={handleDeleteSource}
                    onNavigate={handleNavigate}
                    knownWords={knownWords}
                    onUnmarkKnown={handleUnmarkKnown}
                    sectionReview={sectionReview}
                    onStartSectionReview={handleStartSectionReview}
                    onDismissSectionReview={dismissSectionReview}
                    aiOptions={aiRequestOptions(settings)}
                    onCheckCards={handleCheckCards}
                />;
            case 'READER':
                if (!activeSource || !activeChapter) return null;
                return <ReaderScreen
                    source={activeSource}
                    chapter={activeChapter}
                    chapterCount={chaptersOf(activeSource.id, chapters).length}
                    index={activeChunk}
                    loadText={loadChapterText}
                    settings={settings}
                    cards={visibleFlashcards}
                    knownTerms={knownTerms}
                    onMarkKnown={handleMarkKnown}
                    onUnmarkKnown={handleUnmarkKnown}
                    onUpdateSettings={updateSettings}
                    onSaveCards={cards => handleSaveReaderCards(cards, activeChapter.id, activeChunk)}
                    onComplete={() => handleCompleteChunk(activeChapter.id, activeChunk)}
                    onBack={() => handleOpenChapter(activeChapter.id)}
                    onOpenChunk={i => handleOpenChunk(activeChapter, i)}
                    showToast={showToast}
                />;
            case 'STUDY':
                return <StudyView
                    key={studySessionId}
                    cards={studyCards}
                    initialMode={studyMode}
                    streak={streak}
                    studiedToday={studyLogs.some(l => l.date === todayUtc)}
                    goal={{ progress: studyGoal?.progress || 0, target: studyGoal?.target || DEFAULT_DAILY_REVIEW_GOAL }}
                    onExit={handleSessionEnd}
                    places={places}
                    aiOptions={aiRequestOptions(settings)}
                />;
            case 'PRACTICE':
                return <PracticeView cards={visibleFlashcards} aiOptions={aiRequestOptions(settings)} audioOptions={geminiAudioOptions(settings)} awardXP={userProfile ? (points) => handleGoalUpdate('QUIZ', points, true) : () => {}} onQuizComplete={(score) => {
                    handleCheckAchievements(score);
                    handleGoalUpdate('QUIZ', 1);
                }} />;
            case 'AI_EXTRACT':
                return <AiTextExtractorView
                    decks={visibleDecks}
                    settings={settings}
                    onUpdateSettings={updateSettings}
                    onSaveExtractedCards={handleSaveExtractedCards}
                    existingFronts={existingFronts}
                    knownTerms={knownTerms}
                    onCancel={() => setView('TEXTS')}
                    showToast={showToast}
                />;
            case 'SETTINGS':
                return <SettingsView
                    settings={settings}
                    onUpdateSettings={updateSettings}
                    onExportCSV={handleExportCSV}
                    onImportCSV={handleImportCSV}
                    onResetApp={handleResetApp}
                    onNavigateToChangelog={() => setView('CHANGELOG')}
                    onNavigateToAchievements={() => setView('ACHIEVEMENTS')}
                    onNavigateToProfile={() => setView('PROFILE')}
                    onNavigateToUsage={() => setView('USAGE')}
                    currentUser={currentUser}
                    onLogout={handleLogout}
                />
            case 'DECKS':
                return <DeckList
                    decks={visibleDecks}
                    cards={visibleFlashcards}
                    onStudyDeck={handleStudyDeck}
                    onRenameDeck={handleRenameDeck}
                    onDeleteDeck={handleDeleteDeck}
                    onViewAllCards={() => setView('LIST')}
                    onBulkAdd={() => setView('BULK_ADD')}
                    onAiExtract={() => setView('AI_EXTRACT')}
                    userProfile={userProfile}
                    streak={streak}
                />;
            case 'FORM':
                const editingCardDeckName = visibleDecks.find(d => d.id === editingCard?.deckId)?.name || '';
                return <FlashcardForm
                    card={editingCard}
                    decks={visibleDecks}
                    onSave={handleSaveCard}
                    onCancel={() => setView(previousViewRef.current)}
                    initialDeckName={editingCardDeckName}
                    showToast={showToast}
                    defaultApiSource={settings.defaultApiSource}
                    aiOptions={aiRequestOptions(settings)}
                    audioOptions={geminiAudioOptions(settings)}
                />;
            case 'STATS':
                return <StatsView onBack={() => setView('DECKS')} />;
            case 'USAGE':
                return <UsageView cards={visibleFlashcards} onBack={() => setView('SETTINGS')} />;
            case 'CHANGELOG':
                return <ChangelogView onBack={() => setView('SETTINGS')} />;
            case 'ACHIEVEMENTS':
                return <AchievementsView earnedAchievements={earnedAchievements} onBack={() => setView('SETTINGS')} />;
            case 'PROFILE':
                return <ProfileView
                    userProfile={userProfile}
                    streak={streak}
                    onSave={handleSaveProfile}
                    onBack={() => setView('SETTINGS')}
                    earnedAchievements={earnedAchievements}
                    onNavigateToAchievements={() => setView('ACHIEVEMENTS')}
                />;
            case 'BULK_ADD':
                return <BulkAddView
                    onSave={handleBulkSaveCards}
                    onCancel={() => setView('DECKS')}
                    showToast={showToast}
                    defaultApiSource={settings.defaultApiSource}
                    concurrency={settings.bulkAddConcurrency || 3}
                    aiTimeout={settings.bulkAddAiTimeout || 15}
                    dictTimeout={settings.bulkAddDictTimeout || 2.5}
                    aiOptions={aiRequestOptions(settings)}
                />;
            case 'LIST':
            default:
                return <FlashcardList 
                    cards={visibleFlashcards} 
                    decks={visibleDecks} 
                    onEdit={handleEditCard} 
                    onDelete={handleDeleteCard} 
                    onBackToDecks={() => setView('DECKS')} 
                    onCompleteCard={async (id) => { await handleCompleteCardDetails(id); }}
                    onAutoFixAll={handleAutoFixCards}
                    onStopAutoFix={handleStopAutoFix}
                    autoFixProgress={autoFixProgress}
                    places={places}
                />;
        }
    };

    if (appLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900">
                <div className="text-xl font-medium text-slate-600 dark:text-slate-300">Loading Lingua Cards...</div>
            </div>
        );
    }

    if (!isLoggedIn) {
        return <AuthView onLogin={handleLogin} onRegister={handleRegister} isLoading={authLoading} />
    }

    // New screens are Persian (right to left); the older screens keep their
    // English, left-to-right layout inside the same shell.
    const PERSIAN_VIEWS = ['TODAY', 'ME', 'TEXTS', 'READER', 'STUDY', 'SETTINGS', 'USAGE', 'DECKS', 'LIST', 'FORM', 'BULK_ADD', 'ACHIEVEMENTS'];
    const isStudy = view === 'STUDY';

    return (
        <div dir="rtl" className="min-h-screen flex bg-[#F5F6FA] dark:bg-slate-950 font-fa">
            {!isStudy && (
                <Sidebar
                    view={view}
                    dueCount={dueCards.length}
                    userProfile={userProfile}
                    username={currentUser?.username}
                    syncStatus={syncStatus}
                    health={health}
                    hasCards={visibleFlashcards.length > 0}
                    onNavigate={handleNavigate}
                    onStartReview={() => startQuickReview('flip')}
                    onAddCard={handleAddCard}
                />
            )}
            <main className={`flex-1 min-w-0 w-full ${isStudy ? 'px-3 md:px-0' : 'px-4 md:px-8 py-6 md:py-8 pb-28 md:pb-10'}`}>
                <ScreenBoundary view={view}>
                    <Suspense fallback={<div className="py-24 text-center text-ink-muted dark:text-slate-400" role="status">…</div>}>
                        {PERSIAN_VIEWS.includes(view)
                            ? renderContent()
                            : <div dir="ltr" className="font-sans max-w-6xl mx-auto">{renderContent()}</div>}
                    </Suspense>
                </ScreenBoundary>
            </main>

            <div dir="ltr">
                <StudySetupModal
                    isOpen={isStudySetupModalOpen}
                    onClose={() => setIsStudySetupModalOpen(false)}
                    onStart={options => handleStartStudySession(options)}
                    cards={cardsForSetupModal}
                />
                <AutoFixReportModal
                    isOpen={!!autoFixReport}
                    onClose={handleCloseAutoFixReport}
                    stats={autoFixReport}
                />
            </div>

            {['TODAY', 'LIST', 'DECKS'].includes(view) && <AddFab onClick={handleAddCard} />}
            {!isStudy && <BottomTabs view={view} onNavigate={handleNavigate} />}

            {toastMessage && <Toast message={toastMessage} />}
        </div>
    );
};

export default App;