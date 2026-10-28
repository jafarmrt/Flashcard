import React, { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useAppLogic, View, HealthStatus } from './hooks/useAppLogic';

import { Flashcard, Deck } from './types';
import { aiRequestOptions, pronunciationOptions } from './services/aiSettings';
import { refreshSources } from './services/cardRefresh';
import Toast from './components/Toast';
import { StudySetupModal } from './components/StudySetupModal';
import { AuthView } from './components/AuthView';
import { Sidebar, BottomTabs, AddFab } from './components/layout/Navigation';
import { TodayView } from './components/TodayView';
import { MeView } from './components/MeView';
import { chaptersOf, currentChunkOf, currentReading, placesByCard } from './services/library';
import { knownTermSet } from './services/knownWords';
import { isDue, isNewCard } from './services/srsService';
import { dayString } from './services/calendar';
import { AutoFixReportModal } from './components/AutoFixReportModal';

// Every screen but Today loads on first use, so the app starts faster. The
// reader and the review are fetched at once (the app is for reading, and a
// book or a review should open offline even right after an update), the rest
// in the background soon after, so they open offline too.
const SCREENS = {
    study: () => import('./components/StudyView'),
    library: () => import('./components/LibraryView'),
    settings: () => import('./components/SettingsView'),
    decks: () => import('./components/DeckList'),
    cardList: () => import('./components/FlashcardList'),
    cardForm: () => import('./components/FlashcardForm'),
    stats: () => import('./components/StatsView'),
    practice: () => import('./components/ConversationView'),
    changelog: () => import('./components/ChangelogView'),
    bulkAdd: () => import('./components/BulkAddView'),
    profile: () => import('./components/ProfileView'),
    aiExtract: () => import('./components/AiTextExtractorView'),
    reader: () => import('./components/ChunkReaderView'),
    usage: () => import('./components/UsageView'),
};
const StatsView = lazy(() => SCREENS.stats().then(m => ({ default: m.StatsView })));
const PracticeView = lazy(() => SCREENS.practice().then(m => ({ default: m.PracticeView })));
const ChangelogView = lazy(() => SCREENS.changelog().then(m => ({ default: m.ChangelogView })));
const BulkAddView = lazy(() => SCREENS.bulkAdd().then(m => ({ default: m.BulkAddView })));
const ProfileView = lazy(() => SCREENS.profile().then(m => ({ default: m.ProfileView })));
const AiTextExtractorView = lazy(() => SCREENS.aiExtract().then(m => ({ default: m.AiTextExtractorView })));
const UsageView = lazy(() => SCREENS.usage().then(m => ({ default: m.UsageView })));
const ReaderScreen = lazy(() => SCREENS.reader().then(m => ({ default: m.ReaderScreen })));
const StudyView = lazy(() => SCREENS.study().then(m => ({ default: m.StudyView })));
const LibraryView = lazy(() => SCREENS.library().then(m => ({ default: m.LibraryView })));
const SettingsView = lazy(SCREENS.settings);
const DeckList = lazy(SCREENS.decks);
const FlashcardList = lazy(SCREENS.cardList);
const FlashcardForm = lazy(SCREENS.cardForm);

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
        settings, userProfile, autoFixReport,
        // Handlers
        setView, showToast, handleAddCard, handleEditCard, handleDeleteCard, handleSaveCard,
        handleSaveProfile, handleBulkSaveCards, handleSessionEnd, handleExportCSV, handleImportCSV,
        handleResetApp, handleDeleteAllCards, handleStudyDeck, handleStartStudySession, setIsStudySetupModalOpen,
        handleNavigate, handleRenameDeck, handleDeleteDeck, handleLogin, handleRegister, handleLogout,
        updateSettings, studyCards,
        handleCompleteCardDetails, handleAutoFixCards, handleStopAutoFix, autoFixProgress,
        handleCloseAutoFixReport, handleSaveExtractedCards, previousViewRef,
        syncStatus, studyMode, studySourceId, studyLogs, studySessionId, sources, chapters, occurrences,
        activeSourceId, activeChapterId, activeChunk, startQuickReview, openStudySetup,
        handleAddSource, handleOpenSource, handleOpenChapter, handleOpenChunk, handleDeleteSource,
        handleCompleteChunk, handleReadingTime, loadChapterText, handleEditChunk, handleSaveReaderCards,
        knownWords, speechAttempts, handleSaveSpeechAttempt, notes, handleSaveNote, sectionReview, handleMarkKnown, handleUnmarkKnown, handleStartSectionReview, dismissSectionReview, handleCheckCards,
        handleStartSourceReview, handleReviewCards, handlePrestudyChapter,
        overlayEdit, openCardEditor, closeCardEditor, saveOverlayEdit,
        handleFillExtras, handleStopFillExtras, extrasProgress, handleSaveCardContent, handleApplyImprovements,
    } = useAppLogic();

    const visibleFlashcards = useMemo(() => flashcards.filter(c => !c.isDeleted), [flashcards]);
    const knownTerms = useMemo(() => Array.from(knownTermSet(knownWords)), [knownWords]);
    const visibleDecks = decks.filter(d => !d.isDeleted);
    const cardSources = useMemo(() => refreshSources(settings), [settings]);
    const backdropPress = useRef(false);
    const dueCards = visibleFlashcards.filter(c => isDue(c));
    const health = [
        { label: 'DB', status: dbStatus },
        { label: 'AI', status: apiStatus },
        { label: 'Free Dict.', status: freeDictApiStatus },
        { label: 'MW', status: mwDictApiStatus },
    ];
    const activeSource = sources.find(s => s.id === activeSourceId && !s.isDeleted);
    const activeChapter = chapters.find(c => c.id === activeChapterId && !c.isDeleted);
    const existingFronts = useMemo(() => visibleFlashcards.map(c => c.front), [visibleFlashcards]);
    // Where each card was met while reading, shown on the card.
    const places = useMemo(() => placesByCard(occurrences, sources, chapters), [occurrences, sources, chapters]);

    // "Open the app on the book": once, when the data is in, the page where
    // reading stopped opens instead of Today.
    const openedOnStart = useRef(false);
    useEffect(() => {
        if (openedOnStart.current || appLoading || !isLoggedIn) return;
        openedOnStart.current = true;
        if (!settings.openBookOnStart || view !== 'TODAY') return;
        const reading = currentReading(sources, chapters);
        if (reading?.next) handleOpenChunk(reading.next.chapter, reading.next.chunk);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appLoading, isLoggedIn]);

    useEffect(() => {
        // The reader is fetched at once so a book opens offline even right
        // after an update; the other screens a little later.
        SCREENS.reader().catch(() => {});
        SCREENS.study().catch(() => {});
        SCREENS.library().catch(() => {});
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
                    speechAttempts={speechAttempts}
                />;
            case 'ME':
                return <MeView
                    userProfile={userProfile}
                    username={currentUser?.username}
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
                    onEditCard={card => openCardEditor(card)}
                    settings={settings}
                    knownTerms={knownTerms}
                    loadText={loadChapterText}
                    onStartSourceReview={handleStartSourceReview}
                    onPrestudyChapter={handlePrestudyChapter}
                    notes={notes}
                />;
            case 'READER':
                if (!activeSource || !activeChapter) return null;
                {
                const bookChapters = chaptersOf(activeSource.id, chapters);
                const following = bookChapters[bookChapters.findIndex(c => c.id === activeChapter.id) + 1];
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
                    onComplete={(then, ms) => handleCompleteChunk(activeChapter.id, activeChunk, then, ms)}
                    onReadingTime={ms => handleReadingTime(activeSource.id, ms)}
                    previousChapterId={bookChapters[bookChapters.findIndex(c => c.id === activeChapter.id) - 1]?.id}
                    onEditChunk={(i, text) => handleEditChunk(activeChapter.id, i, text)}
                    notes={notes.filter(n => n.chapterId === activeChapter.id)}
                    onSaveNote={handleSaveNote}
                    onBack={() => handleOpenChapter(activeChapter.id)}
                    onOpenChunk={i => handleOpenChunk(activeChapter, i)}
                    onReviewChapter={() => handleStartSourceReview(activeSource.id, bookChapters.length > 1 ? activeChapter.id : undefined)}
                    nextChapter={following ? { id: following.id, title: following.title, open: () => handleOpenChunk(following, currentChunkOf(following)) } : undefined}
                    showToast={showToast}
                />;
                }
            case 'STUDY':
                return <StudyView
                    key={studySessionId}
                    cards={studyCards}
                    initialMode={studyMode}
                    onExit={handleSessionEnd}
                    places={places}
                    sourceId={studySourceId}
                    aiOptions={aiRequestOptions(settings)}
                    onEditCard={openCardEditor}
                    onSaveCard={handleSaveCardContent}
                    allCards={visibleFlashcards}
                />;
            case 'PRACTICE':
                return <PracticeView cards={visibleFlashcards} occurrences={occurrences} speechAttempts={speechAttempts} onSaveSpeechAttempt={handleSaveSpeechAttempt} aiOptions={aiRequestOptions(settings)} audioOptions={pronunciationOptions(settings)} />;
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
                    onDeleteAllCards={handleDeleteAllCards}
                    onNavigateToChangelog={() => setView('CHANGELOG')}
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
                    sources={cardSources}
                    audioOptions={pronunciationOptions(settings)}
                />;
            case 'STATS':
                return <StatsView cards={visibleFlashcards} sources={sources} occurrences={occurrences} chapters={chapters} knownWords={knownWords} userLevel={settings.userLevel}
                    onReviewCards={ids => { handleReviewCards(ids, 'STATS'); }} onOpenSource={handleOpenSource} />;
            case 'USAGE':
                return <UsageView cards={visibleFlashcards} onBack={() => setView('SETTINGS')} />;
            case 'CHANGELOG':
                return <ChangelogView onBack={() => setView('SETTINGS')} />;
            case 'PROFILE':
                return <ProfileView
                    userProfile={userProfile}
                    onSave={handleSaveProfile}
                    onBack={() => setView('SETTINGS')}
                />;
            case 'BULK_ADD':
                return <BulkAddView
                    onSave={handleBulkSaveCards}
                    onCancel={() => setView('DECKS')}
                    showToast={showToast}
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
                    onFillExtras={handleFillExtras}
                    onStopFillExtras={handleStopFillExtras}
                    aiSources={cardSources.filter(s => s.kind === 'ai')}
                    onApplyImprovements={handleApplyImprovements}
                    extrasProgress={extrasProgress}
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
        // The toast carries sign-in errors (wrong password, registration
        // closed, server trouble), so it must show on this screen too.
        return (
            <>
                <AuthView onLogin={handleLogin} onRegister={handleRegister} isLoading={authLoading} />
                {toastMessage && <Toast message={toastMessage} />}
            </>
        );
    }

    // New screens are Persian (right to left); the older screens keep their
    // English, left-to-right layout inside the same shell.
    const PERSIAN_VIEWS = ['TODAY', 'ME', 'TEXTS', 'READER', 'STUDY', 'SETTINGS', 'USAGE', 'DECKS', 'LIST', 'FORM', 'BULK_ADD', 'STATS', 'PROFILE', 'PRACTICE', 'AI_EXTRACT', 'CHANGELOG'];
    const isStudy = view === 'STUDY';
    // Reading a book in pages fills the screen: no menus around the page.
    const bookReading = view === 'READER' && settings.readerMode !== 'scroll';
    const fullScreen = isStudy || bookReading;

    return (
        <div dir="rtl" className="min-h-screen flex bg-[#F5F6FA] dark:bg-slate-950 font-fa">
            {!fullScreen && (
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

            {overlayEdit && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 px-2 py-4 sm:p-8" role="dialog" aria-modal="true" aria-label="ویرایش کارت"
                    // Closes only on a click that starts and ends on the backdrop: a text
                    // selection dragged out of the form must not throw the edits away.
                    onPointerDown={e => { backdropPress.current = e.target === e.currentTarget; }}
                    onClick={e => { if (backdropPress.current && e.target === e.currentTarget) closeCardEditor(); backdropPress.current = false; }}>
                    <Suspense fallback={null}>
                    <FlashcardForm
                        card={overlayEdit.card}
                        decks={visibleDecks}
                        onSave={saveOverlayEdit}
                        onCancel={closeCardEditor}
                        initialDeckName={visibleDecks.find(d => d.id === overlayEdit.card.deckId)?.name || ''}
                        showToast={showToast}
                        sources={cardSources}
                        audioOptions={pronunciationOptions(settings)}
                    />
                    </Suspense>
                </div>
            )}

            {['TODAY', 'LIST', 'DECKS'].includes(view) && <AddFab onClick={handleAddCard} />}
            {!fullScreen && <BottomTabs view={view} onNavigate={handleNavigate} />}

            {toastMessage && <Toast message={toastMessage} />}
        </div>
    );
};

export default App;