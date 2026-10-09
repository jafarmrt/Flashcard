import React from 'react';
import ReactDOM from 'react-dom/client';
import { useAppLogic, View, HealthStatus } from './hooks/useAppLogic';

import { Flashcard, Deck } from './types';
import FlashcardList from './components/FlashcardList';
import FlashcardForm from './components/FlashcardForm';
import { StudyView } from './components/StudyView';
import { StatsView } from './components/StatsView';
import { PracticeView } from './components/ConversationView';
import { aiRequestOptions, geminiAudioOptions } from './services/aiSettings';
import Toast from './components/Toast';
import DeckList from './components/DeckList';
import { ChangelogView } from './components/ChangelogView';
import SettingsView from './components/SettingsView';
import { BulkAddView } from './components/BulkAddView';
import { StudySetupModal } from './components/StudySetupModal';
import { AchievementsView } from './components/AchievementsView';
import { ProfileView } from './components/ProfileView';
import { AuthView } from './components/AuthView';
import { Sidebar, BottomTabs, AddFab } from './components/layout/Navigation';
import { TodayView } from './components/TodayView';
import { MeView } from './components/MeView';
import { TextsView } from './components/TextsView';
import { ChunkReaderView } from './components/ChunkReaderView';
import { isDue, isNewCard } from './services/srsService';
import { dayString } from './services/streakService';
import { DEFAULT_DAILY_REVIEW_GOAL } from './services/xpRules';
import { AutoFixReportModal } from './components/AutoFixReportModal';
import { AiTextExtractorView } from './components/AiTextExtractorView';

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
        syncStatus, studyMode, studyLogs, studySessionId, texts, activeTextId, activeChunk,
        startQuickReview, openStudySetup, handleCreateText, handleOpenText, handleOpenChunk,
        handleDeleteText, handleCompleteChunk
    } = useAppLogic();

    const visibleFlashcards = flashcards.filter(c => !c.isDeleted);
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
    const activeText = texts.find(t => t.id === activeTextId && !t.isDeleted);

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
                    texts={texts}
                    dueCount={dueCards.length}
                    newDueCount={dueCards.filter(isNewCard).length}
                    onStartReview={mode => startQuickReview(mode)}
                    onOpenSetup={() => openStudySetup()}
                    onNavigate={handleNavigate}
                    onOpenText={handleOpenText}
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
                return <TextsView
                    texts={texts}
                    activeTextId={activeTextId}
                    onCreateText={handleCreateText}
                    onOpenText={handleOpenText}
                    onOpenChunk={handleOpenChunk}
                    onDeleteText={handleDeleteText}
                    onNavigate={handleNavigate}
                />;
            case 'READER':
                if (!activeText) return null;
                return <ChunkReaderView
                    key={`${activeText.id}-${activeChunk}`}
                    doc={activeText}
                    index={activeChunk}
                    settings={settings}
                    existingFronts={visibleFlashcards.map(c => c.front)}
                    onSaveCards={(cards, deckName) => handleSaveExtractedCards(cards, deckName, { stay: true })}
                    onComplete={() => handleCompleteChunk(activeText.id, activeChunk)}
                    onBack={() => handleOpenText(activeText.id)}
                    onOpenChunk={i => handleOpenChunk(activeText.id, i)}
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
                    existingFronts={visibleFlashcards.map(c => c.front)}
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
    const PERSIAN_VIEWS = ['TODAY', 'ME', 'TEXTS', 'READER', 'STUDY'];
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
                {PERSIAN_VIEWS.includes(view)
                    ? renderContent()
                    : <div dir="ltr" className="font-sans max-w-6xl mx-auto">{renderContent()}</div>}
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