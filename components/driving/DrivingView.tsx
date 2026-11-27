import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Chapter,
  ChapterText,
  Deck,
  ExtractedWordCard,
  Flashcard,
  KnownWord,
  Occurrence,
  Settings,
  Source,
  TextNote,
} from '../../types';
import {
  DRIVE_NOTE_BY,
  buildCardAudioScript,
  canSpeakPersianInDrive,
  displayDeckName,
  drivingBookmarksOf,
  nextBookPosition,
  orderedBookChapters,
  prevBookPosition,
  resolveDriveStartPosition,
  type CardAudioPhase,
} from '../../services/drivingMode';
import { placesByCard } from '../../services/library';
import { newNote } from '../../services/notes';
import { readerSection } from '../../services/readerText';
import { piecesOf, type Piece, type ReadAloudVoice } from '../../services/readAloud';
import { aiSpeech, speechModel, speechProvider, speechVoice } from '../../services/aiSpeech';
import { hasPersianDeviceVoice, isSpeechSupported, speakText, stopSpeech } from '../../services/ttsService';
import { cardHasTheme, themeSummaries } from '../../services/wordThemes';
import { DriveBookmarksTray } from './DriveBookmarksTray';
import { fa, Icon } from '../common/ui';

const SILENCE_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export interface DrivingViewProps {
  sources: Source[];
  chapters: Chapter[];
  decks: Deck[];
  cards: Flashcard[];
  todayQueue: Flashcard[];
  occurrences: Occurrence[];
  notes: TextNote[];
  knownWords: KnownWord[];
  settings: Settings;
  currentReadingSourceId?: string;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  loadChapterText: (chapterId: string) => Promise<ChapterText>;
  onCompleteChunk: (
    chapterId: string,
    chunk: number,
    then?: 'next' | 'stay',
    readingMs?: number,
  ) => Promise<unknown>;
  onSaveNote: (note: TextNote) => Promise<unknown>;
  onDeleteNote: (noteId: string) => Promise<unknown>;
  onSaveReaderCard: (
    sourceId: string,
    chapterId: string,
    chunk: number,
    card: ExtractedWordCard,
  ) => Promise<number>;
  onOpenBookChunk: (sourceId: string, chapterId: string, chunk: number) => void;
  onStudyCards: (cards: Flashcard[], title: string) => void;
  onExit: () => void;
}

type DriveMode = 'book' | 'cards';

const PHASE_LABELS: Record<CardAudioPhase, string> = {
  listen: 'گوش بده',
  think: 'فکر کن…',
  meaning: 'معنی واژه',
  repeat: 'تکرار واژه',
};

export const DrivingView: React.FC<DrivingViewProps> = ({
  sources,
  chapters,
  decks,
  cards,
  todayQueue,
  occurrences,
  notes,
  knownWords,
  settings,
  currentReadingSourceId,
  onUpdateSettings,
  loadChapterText,
  onCompleteChunk,
  onSaveNote,
  onDeleteNote,
  onSaveReaderCard,
  onOpenBookChunk,
  onStudyCards,
  onExit,
}) => {
  const liveSources = useMemo(
    () =>
      sources
        .filter(s => !s.isDeleted && orderedBookChapters(s.id, chapters).length > 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sources, chapters],
  );
  const liveDecks = useMemo(() => decks.filter(d => !d.isDeleted), [decks]);
  const liveCards = useMemo(
    () => cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim()),
    [cards],
  );
  const bundles = useMemo(
    () => themeSummaries(liveCards, settings.savedThemes || []).filter(b => b.cardCount > 0),
    [liveCards, settings.savedThemes],
  );
  const placesMap = useMemo(
    () => placesByCard(occurrences, sources, chapters),
    [occurrences, sources, chapters],
  );

  const [mode, setMode] = useState<DriveMode>(() =>
    liveSources.length > 0 ? 'book' : 'cards',
  );
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    () => currentReadingSourceId || liveSources[0]?.id || '',
  );
  const [cardPoolKey, setCardPoolKey] = useState<string>(() =>
    todayQueue.length > 0 ? 'today' : bundles[0] ? `theme:${bundles[0].name}` : 'all',
  );

  const voice: ReadAloudVoice = settings.driveVoice || settings.readAloudVoice || 'device';
  const rate = settings.driveRate || 1;
  const pauseSeconds = settings.drivePauseSeconds || 5;
  const flaggedCardIds = settings.driveFlaggedCardIds || [];

  const [faDeviceAvailable, setFaDeviceAvailable] = useState<boolean>(() =>
    hasPersianDeviceVoice(),
  );
  useEffect(() => {
    if (!isSpeechSupported()) return;
    const refresh = () => setFaDeviceAvailable(hasPersianDeviceVoice());
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', refresh);
  }, []);

  const canSpeakPersian = canSpeakPersianInDrive(voice, settings, faDeviceAvailable);

  // Selected card pool for audio review loop
  const activeCardQueue = useMemo(() => {
    if (cardPoolKey === 'today' && todayQueue.length > 0) {
      return todayQueue.filter(c => c.kind !== 'grammar');
    }
    if (cardPoolKey.startsWith('deck:')) {
      const id = cardPoolKey.slice(5);
      return liveCards.filter(c => c.deckId === id);
    }
    if (cardPoolKey.startsWith('theme:')) {
      const themeName = cardPoolKey.slice(6);
      return liveCards.filter(c => cardHasTheme(c, themeName));
    }
    return liveCards.slice(0, 40);
  }, [cardPoolKey, todayQueue, liveCards]);

  // Active session state
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flashSaved, setFlashSaved] = useState<string | null>(null);

  // Book playback state
  const [bookChapterId, setBookChapterId] = useState<string>('');
  const [bookChunk, setBookChunk] = useState<number>(0);
  const [bookPieces, setBookPieces] = useState<Piece[]>([]);
  const [pieceIndex, setPieceIndex] = useState<number>(0);
  const [loadingBook, setLoadingBook] = useState(false);

  // Card playback state
  const [cardIndex, setCardIndex] = useState<number>(0);
  const [cardPhase, setCardPhase] = useState<CardAudioPhase>('listen');

  // Mutable refs for async audio loop cancellation and MediaSession handlers
  const runIdRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const chunkStartedAtRef = useRef<number>(Date.now());
  const wakeLockRef = useRef<any>(null);

  const selectedSource = useMemo(
    () => liveSources.find(s => s.id === selectedSourceId) || liveSources[0],
    [liveSources, selectedSourceId],
  );

  const activeChapter = useMemo(
    () => chapters.find(c => c.id === bookChapterId),
    [chapters, bookChapterId],
  );

  const revokeUrls = useCallback(() => {
    for (const u of objectUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    objectUrlsRef.current = [];
  }, []);

  const haltAudio = useCallback(() => {
    runIdRef.current += 1;
    stopSpeech();
    if (audioRef.current) {
      try {
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
      } catch {
        // ignore
      }
    }
  }, []);

  // Screen Wake Lock while actively playing
  useEffect(() => {
    const shouldLock = active && !paused;
    const nav = navigator as any;
    if (!shouldLock || !nav?.wakeLock?.request) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release?.().catch(() => undefined);
        wakeLockRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const acquire = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      nav.wakeLock
        .request('screen')
        .then((sentinel: any) => {
          if (cancelled) sentinel.release?.().catch(() => undefined);
          else wakeLockRef.current = sentinel;
        })
        .catch(() => undefined);
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      if (wakeLockRef.current) {
        wakeLockRef.current.release?.().catch(() => undefined);
        wakeLockRef.current = null;
      }
    };
  }, [active, paused]);

  useEffect(() => {
    return () => {
      haltAudio();
      revokeUrls();
    };
  }, [haltAudio, revokeUrls]);

  const ensureAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    try {
      const a = ensureAudioElement();
      a.src = SILENCE_WAV;
      a.play().catch(() => undefined);
    } catch {
      // ignore
    }
  }, [ensureAudioElement]);

  // Speaks one utterance (AI or device voice) and resolves when done or cancelled.
  const playUtterance = useCallback(
    async (
      text: string,
      opts: { lang: 'en-US' | 'fa-IR'; audioSrc?: string; slow?: boolean },
      expectedRun: number,
    ): Promise<boolean> => {
      if (runIdRef.current !== expectedRun || !text.trim()) return false;
      const effectiveRate = opts.slow ? Math.max(0.7, rate * 0.85) : rate;

      // Prefer recorded dictionary audio for single English headwords in device mode
      if (opts.audioSrc && voice === 'device' && opts.lang === 'en-US') {
        const played = await new Promise<boolean>(resolve => {
          const audio = ensureAudioElement();
          audio.onended = () => resolve(true);
          audio.onerror = () => resolve(false);
          audio.src = opts.audioSrc!;
          audio.playbackRate = effectiveRate;
          audio.play().catch(() => resolve(false));
        });
        if (played || runIdRef.current !== expectedRun) return runIdRef.current === expectedRun;
      }

      // AI voice path (Gemini speaks both English & Persian; OpenRouter speaks English)
      if (voice === 'ai' && (opts.lang === 'en-US' || speechProvider(settings) === 'gemini')) {
        try {
          const blob = await aiSpeech(text, settings);
          if (runIdRef.current !== expectedRun) return false;
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          const ok = await new Promise<boolean>(resolve => {
            const audio = ensureAudioElement();
            audio.onended = () => resolve(true);
            audio.onerror = () => resolve(false);
            audio.src = url;
            audio.playbackRate = effectiveRate;
            audio.play().catch(() => resolve(false));
          });
          if (ok) return runIdRef.current === expectedRun;
        } catch {
          // Fall through to device speech synthesis
        }
      }

      if (runIdRef.current !== expectedRun) return false;
      if (!isSpeechSupported()) {
        // Headless or unsupported speech environment: brief readable dwell so
        // progression remains deterministic without crashing.
        await new Promise<void>(r => setTimeout(r, 1200));
        return runIdRef.current === expectedRun;
      }

      return new Promise<boolean>(resolve => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok && runIdRef.current === expectedRun);
        };
        speakText(text, {
          lang: opts.lang,
          rate: effectiveRate,
          onEnd: () => done(true),
          onError: () => done(true),
        });
      });
    },
    [ensureAudioElement, rate, settings, voice],
  );

  // Loads a section's pieces for continuous book mode
  const loadSectionPieces = useCallback(
    async (chapterId: string, chunk: number): Promise<Piece[]> => {
      setLoadingBook(true);
      try {
        const chapterText = await loadChapterText(chapterId);
        const raw = chapterText.chunks[chunk] || '';
        const parsed = readerSection(raw);
        const maxWords = voice === 'ai' ? 45 : 0;
        return piecesOf(parsed, maxWords, voice === 'ai' ? 25 : 0);
      } finally {
        setLoadingBook(false);
      }
    },
    [loadChapterText, voice],
  );

  // Advances to next section/chapter when current section ends
  const advanceBookSection = useCallback(
    async (sourceId: string, chapterId: string, chunk: number, markCompleted: boolean) => {
      const elapsed = Math.max(0, Date.now() - chunkStartedAtRef.current);
      if (markCompleted) {
        try {
          await onCompleteChunk(chapterId, chunk, 'stay', elapsed);
        } catch {
          // keep playing even if saving fails momentarily
        }
      }
      const nextPos = nextBookPosition(sourceId, chapters, chapterId, chunk);
      if (!nextPos) {
        haltAudio();
        setBookPieces(pieces => {
          setPieceIndex(Math.max(0, pieces.length - 1));
          return pieces;
        });
        setPaused(true);
        setStatusMessage('پخش کتاب به پایان رسید.');
        return;
      }
      chunkStartedAtRef.current = Date.now();
      setBookChapterId(nextPos.chapter.id);
      setBookChunk(nextPos.chunk);
      setPieceIndex(0);
      const nextPieces = await loadSectionPieces(nextPos.chapter.id, nextPos.chunk);
      setBookPieces(nextPieces);
    },
    [chapters, haltAudio, loadSectionPieces, onCompleteChunk],
  );

  // Continuous Book Playback Effect
  useEffect(() => {
    if (!active || paused || mode !== 'book' || loadingBook) return;
    if (!selectedSource || !bookChapterId) return;

    if (bookPieces.length === 0) {
      // Empty section: skip straight to the next one
      const timer = setTimeout(() => {
        advanceBookSection(selectedSource.id, bookChapterId, bookChunk, true);
      }, 300);
      return () => clearTimeout(timer);
    }

    if (pieceIndex >= bookPieces.length) {
      advanceBookSection(selectedSource.id, bookChapterId, bookChunk, true);
      return;
    }

    const expectedRun = ++runIdRef.current;
    const currentPiece = bookPieces[pieceIndex];

    playUtterance(currentPiece.text, { lang: 'en-US' }, expectedRun).then(ok => {
      if (!ok || runIdRef.current !== expectedRun) return;
      setPieceIndex(i => i + 1);
    });
  }, [
    active,
    paused,
    mode,
    loadingBook,
    selectedSource,
    bookChapterId,
    bookChunk,
    bookPieces,
    pieceIndex,
    advanceBookSection,
    playUtterance,
  ]);

  // Eyes-Free Audio Flashcard Loop Effect
  useEffect(() => {
    if (!active || paused || mode !== 'cards') return;
    if (activeCardQueue.length === 0) return;

    const card = activeCardQueue[cardIndex % activeCardQueue.length];
    if (!card) return;

    const expectedRun = ++runIdRef.current;
    const places = placesMap.get(card.id);
    const script = buildCardAudioScript(card, places, {
      pauseSeconds,
      canSpeakPersian,
    });

    (async () => {
      for (const step of script) {
        if (runIdRef.current !== expectedRun) return;
        setCardPhase(step.phase);
        if (step.kind === 'pause') {
          await new Promise<void>(r => setTimeout(r, step.ms));
        } else if (step.kind === 'fa') {
          await playUtterance(step.text, { lang: 'fa-IR' }, expectedRun);
        } else {
          await playUtterance(
            step.text,
            {
              lang: 'en-US',
              audioSrc: step.kind === 'en' ? step.audioSrc : undefined,
              slow: step.kind === 'en' ? step.slow : false,
            },
            expectedRun,
          );
        }
        if (runIdRef.current !== expectedRun) return;
        await new Promise<void>(r => setTimeout(r, 280));
      }
      if (runIdRef.current !== expectedRun) return;
      setCardIndex(i => (i + 1) % activeCardQueue.length);
    })();
  }, [
    active,
    paused,
    mode,
    activeCardQueue,
    cardIndex,
    placesMap,
    pauseSeconds,
    canSpeakPersian,
    playUtterance,
  ]);

  const startSession = async () => {
    setStatusMessage(null);
    unlockAudio();
    if (mode === 'book') {
      if (!selectedSource) return;
      const startPos = resolveDriveStartPosition(selectedSource, chapters);
      if (!startPos) return;
      setBookChapterId(startPos.chapter.id);
      setBookChunk(startPos.chunk);
      setPieceIndex(0);
      chunkStartedAtRef.current = Date.now();
      setActive(true);
      setPaused(false);
      try {
        const pieces = await loadSectionPieces(startPos.chapter.id, startPos.chunk);
        setBookPieces(pieces);
      } catch {
        setPaused(true);
        setStatusMessage('متن این بخش در دسترس نیست. اتصال را بررسی کن.');
      }
    } else {
      if (activeCardQueue.length === 0) return;
      setCardIndex(0);
      setCardPhase('listen');
      setActive(true);
      setPaused(false);
    }
  };

  const togglePlayPause = useCallback(() => {
    if (!active) return;
    if (paused) {
      unlockAudio();
      setPaused(false);
    } else {
      haltAudio();
      setPaused(true);
    }
  }, [active, haltAudio, paused, unlockAudio]);

  const handlePrevOrRepeat = useCallback(async () => {
    if (!active) return;
    haltAudio();
    if (mode === 'book') {
      if (pieceIndex > 0) {
        setPieceIndex(i => Math.max(0, i - 1));
      } else if (selectedSource && bookChapterId) {
        const prev = prevBookPosition(selectedSource.id, chapters, bookChapterId, bookChunk);
        if (prev) {
          setBookChapterId(prev.chapter.id);
          setBookChunk(prev.chunk);
          const prevPieces = await loadSectionPieces(prev.chapter.id, prev.chunk);
          setBookPieces(prevPieces);
          setPieceIndex(Math.max(0, prevPieces.length - 1));
        }
      }
      setPaused(false);
    } else {
      setCardIndex(i => (i - 1 + activeCardQueue.length) % Math.max(1, activeCardQueue.length));
      setPaused(false);
    }
  }, [
    active,
    activeCardQueue.length,
    bookChapterId,
    bookChunk,
    chapters,
    haltAudio,
    loadSectionPieces,
    mode,
    pieceIndex,
    selectedSource,
  ]);

  const handleNext = useCallback(async () => {
    if (!active) return;
    haltAudio();
    if (mode === 'book') {
      if (pieceIndex + 1 < bookPieces.length) {
        setPieceIndex(i => i + 1);
      } else if (selectedSource && bookChapterId) {
        await advanceBookSection(selectedSource.id, bookChapterId, bookChunk, false);
      }
      setPaused(false);
    } else {
      setCardIndex(i => (i + 1) % Math.max(1, activeCardQueue.length));
      setPaused(false);
    }
  }, [
    active,
    activeCardQueue.length,
    advanceBookSection,
    bookChapterId,
    bookChunk,
    bookPieces.length,
    haltAudio,
    mode,
    pieceIndex,
    selectedSource,
  ]);

  // Car steering-wheel / Bluetooth MediaSession integration
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      const currentCard = activeCardQueue[cardIndex % Math.max(1, activeCardQueue.length)];
      ms.metadata = new MediaMetadata({
        title:
          mode === 'book'
            ? selectedSource?.title || 'پیوسته‌خوانی کتاب'
            : currentCard?.front || 'مرور شنیداری واژه‌ها',
        artist:
          mode === 'book'
            ? `${activeChapter?.title || ''} · بخش ${fa(bookChunk + 1)}`
            : 'واژه‌خوان · حالت رانندگی',
      });
      ms.playbackState = paused ? 'paused' : 'playing';
      ms.setActionHandler('play', () => {
        if (paused) togglePlayPause();
      });
      ms.setActionHandler('pause', () => {
        if (!paused) togglePlayPause();
      });
      ms.setActionHandler('previoustrack', () => {
        handlePrevOrRepeat();
      });
      ms.setActionHandler('nexttrack', () => {
        handleNext();
      });
    } catch {
      // MediaSession partially supported
    }
    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('previoustrack', null);
        ms.setActionHandler('nexttrack', null);
      } catch {
        // ignore
      }
    };
  }, [
    active,
    paused,
    mode,
    selectedSource,
    activeChapter,
    bookChunk,
    activeCardQueue,
    cardIndex,
    togglePlayPause,
    handlePrevOrRepeat,
    handleNext,
  ]);

  // Giant One-Tap Bookmark handler (never interrupts playback!)
  const handleBookmarkNow = async () => {
    try {
      navigator.vibrate?.(60);
    } catch {
      // ignore
    }

    if (mode === 'book') {
      const piece = bookPieces[pieceIndex] || bookPieces[bookPieces.length - 1];
      if (!selectedSource || !bookChapterId || !piece) return;
      const already = drivingBookmarksOf(notes).some(
        n =>
          n.chapterId === bookChapterId &&
          n.chunk === bookChunk &&
          n.quote.trim() === piece.text.trim(),
      );
      if (!already) {
        const note = newNote({
          sourceId: selectedSource.id,
          chapterId: bookChapterId,
          chunk: bookChunk,
          kind: 'comment',
          from: piece.from,
          to: piece.to,
          quote: piece.text,
          text: 'نشان رانندگی',
          by: DRIVE_NOTE_BY,
        });
        await onSaveNote(note);
      }
      setFlashSaved('جمله برای بعد از رانندگی نشان شد');
    } else {
      const currentCard = activeCardQueue[cardIndex % Math.max(1, activeCardQueue.length)];
      if (!currentCard) return;
      if (!flaggedCardIds.includes(currentCard.id)) {
        onUpdateSettings({
          driveFlaggedCardIds: [...flaggedCardIds, currentCard.id],
        });
      }
      setFlashSaved(`«${currentCard.front}» برای بعد از رانندگی نشان شد`);
    }

    setTimeout(() => {
      setFlashSaved(prev => (prev ? null : prev));
    }, 2400);
  };

  const stopAndExitSession = () => {
    haltAudio();
    revokeUrls();
    setActive(false);
    setPaused(false);
  };

  const currentCard = activeCardQueue[cardIndex % Math.max(1, activeCardQueue.length)];
  const currentPiece = bookPieces[pieceIndex] || bookPieces[bookPieces.length - 1];
  const shownPieceNumber = bookPieces.length > 0 ? Math.min(pieceIndex + 1, bookPieces.length) : 0;
  const speechCacheHint = `${speechProvider(settings)} · ${speechModel(settings)}${speechVoice(settings) ? ` · ${speechVoice(settings)}` : ''}`;

  // --- ACTIVE HANDS-FREE AUTOMOTIVE VIEW ---
  if (active) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#0B110F] text-slate-100 font-fa flex flex-col justify-between p-4 sm:p-6 lg:p-8 select-none"
      >
        <div className="w-full max-w-4xl mx-auto flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={stopAndExitSession}
            className="min-h-[48px] px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-bold text-sm flex items-center gap-2 whitespace-nowrap"
          >
            <Icon.Back size={18} />
            پایان حالت رانندگی
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-400 tabular-nums">
            <span>{mode === 'book' ? 'پیوسته‌خوانی کتاب' : 'مرور شنیداری واژه‌ها'}</span>
            <span aria-hidden="true">·</span>
            <span>سرعت {fa(rate)}×</span>
          </div>
        </div>

        {/* Center Glanceable Display */}
        <main className="w-full max-w-4xl mx-auto my-auto py-6 flex flex-col items-center text-center gap-5">
          {statusMessage && (
            <p role="status" className="text-base font-bold text-amber-300">
              {statusMessage}
            </p>
          )}

          {mode === 'book' ? (
            <>
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-slate-400">
                <span dir="auto" className="font-read font-semibold text-slate-200">
                  {selectedSource?.title}
                </span>
                {activeChapter && activeChapter.title !== selectedSource?.title && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span dir="auto">{activeChapter.title}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">بخش {fa(bookChunk + 1)}</span>
                {bookPieces.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      جمله {fa(shownPieceNumber)} از {fa(bookPieces.length)}
                    </span>
                  </>
                )}
              </div>

              {loadingBook || !currentPiece ? (
                <p dir="rtl" className="text-lg sm:text-xl text-slate-400 max-w-2xl">
                  {loadingBook ? 'در حال بارگذاری بخش…' : 'در حال آماده‌سازی بخش…'}
                </p>
              ) : (
                <p
                  dir="ltr"
                  className="font-read text-2xl sm:text-3xl lg:text-4xl leading-relaxed text-slate-50 max-w-3xl"
                >
                  {currentPiece.text}
                </p>
              )}
            </>
          ) : (
            currentCard && (
              <>
                <div className="flex items-center gap-2 text-sm text-emerald-300 font-bold">
                  <span>{PHASE_LABELS[cardPhase]}</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="text-slate-400 font-normal tabular-nums">
                    کارت {fa((cardIndex % activeCardQueue.length) + 1)} از {fa(activeCardQueue.length)}
                  </span>
                </div>

                <h1
                  dir="ltr"
                  className="font-read font-bold text-4xl sm:text-5xl lg:text-6xl text-white tracking-tight"
                >
                  {currentCard.front}
                </h1>

                {(cardPhase === 'meaning' || cardPhase === 'repeat') ? (
                  <p className="text-2xl sm:text-3xl font-bold text-emerald-300 max-w-2xl leading-relaxed">
                    {currentCard.back}
                  </p>
                ) : (
                  <p className="text-base text-slate-500">
                    معنی پس از مکث نمایش داده و خوانده می‌شود
                  </p>
                )}
              </>
            )
          )}

          {flashSaved && (
            <p
              role="status"
              className="text-sm font-bold text-amber-300 bg-amber-950/70 border border-amber-700/60 px-4 py-2 rounded-xl"
            >
              {flashSaved}
            </p>
          )}
        </main>

        {/* Giant Eyes-Free Bottom Controls */}
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-3.5 pt-2">
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={handlePrevOrRepeat}
              aria-label="تکرار یا مورد قبلی"
              className="min-h-[88px] rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] border border-slate-800 text-slate-100 font-extrabold text-base sm:text-lg flex flex-col items-center justify-center gap-1 transition-transform"
            >
              <span>قبلی / تکرار</span>
            </button>

            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={paused ? 'ادامه پخش' : 'مکث پخش'}
              className="min-h-[88px] rounded-2xl bg-brand-600 hover:bg-brand-500 active:scale-[0.99] text-white font-extrabold text-lg sm:text-xl flex items-center justify-center gap-2 transition-transform"
            >
              {paused ? <Icon.Speaker size={26} /> : <Icon.Pause size={26} />}
              <span>{paused ? 'ادامه' : 'مکث'}</span>
            </button>

            <button
              type="button"
              onClick={handleNext}
              aria-label="مورد بعدی"
              className="min-h-[88px] rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] border border-slate-800 text-slate-100 font-extrabold text-base sm:text-lg flex flex-col items-center justify-center gap-1 transition-transform"
            >
              <span>بعدی</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleBookmarkNow}
            className="w-full min-h-[104px] rounded-3xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-extrabold text-xl sm:text-2xl flex items-center justify-center gap-3 transition-transform"
          >
            <Icon.Bookmark size={26} />
            <span>ثبت نشان برای بررسی بعد از رانندگی</span>
          </button>
        </div>
      </div>
    );
  }

  // --- SETUP & POST-DRIVE REVIEW VIEW ---
  const startPreview = selectedSource
    ? resolveDriveStartPosition(selectedSource, chapters)
    : null;

  return (
    <div dir="rtl" className="min-h-screen bg-[#0B110F] text-slate-100 font-fa p-4 sm:p-6 lg:p-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <Icon.Headphones size={24} className="text-brand-400 shrink-0" />
            <h1 className="text-xl sm:text-2xl font-extrabold text-white whitespace-nowrap">
              حالت رانندگی
            </h1>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sm font-bold text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Icon.Back size={18} />
            برگشت
          </button>
        </header>

        <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
          پخش بی‌نیاز از نگاه به صفحه، همراه با پشتیبانی از دکمه‌های روی فرمان خودرو و ثبت تک‌لمسی نشان برای بررسی سر فرصت بعد از توقف.
        </p>

        {/* Mode Selector */}
        <div
          role="tablist"
          aria-label="نوع پخش در رانندگی"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'book'}
            disabled={liveSources.length === 0}
            onClick={() => setMode('book')}
            className={`min-h-[72px] p-4 rounded-2xl border text-right flex flex-col justify-center gap-1 transition-colors disabled:opacity-40 ${
              mode === 'book'
                ? 'bg-brand-900/50 border-brand-500 text-white'
                : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <span className="font-extrabold text-base">پیوسته‌خوانی کتاب</span>
            <span className="text-xs text-slate-400">
              خوانش پیاپی بخش‌ها و فصل‌ها بدون نیاز به لمس صفحه
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'cards'}
            disabled={liveCards.length === 0}
            onClick={() => setMode('cards')}
            className={`min-h-[72px] p-4 rounded-2xl border text-right flex flex-col justify-center gap-1 transition-colors disabled:opacity-40 ${
              mode === 'cards'
                ? 'bg-brand-900/50 border-brand-500 text-white'
                : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <span className="font-extrabold text-base">مرور شنیداری واژه‌ها</span>
            <span className="text-xs text-slate-400">
              واژه و جملهٔ انگلیسی، مکث فکر کردن، معنی و تکرار خودکار
            </span>
          </button>
        </div>

        {/* Source or Queue Configuration */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 flex flex-col gap-5">
          {mode === 'book' ? (
            liveSources.length === 0 ? (
              <p className="text-sm text-slate-400">
                هنوز کتاب یا متنی در کتابخانه نیست. ابتدا یک کتاب یا مقاله به کتابخانه اضافه کن.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="drive-book-select" className="text-sm font-bold text-slate-200">
                  انتخاب کتاب یا مقاله
                </label>
                <select
                  id="drive-book-select"
                  value={selectedSource?.id || ''}
                  onChange={e => setSelectedSourceId(e.target.value)}
                  className="min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm"
                >
                  {liveSources.map(src => (
                    <option key={src.id} value={src.id}>
                      {src.title}
                    </option>
                  ))}
                </select>
                {startPreview && (
                  <p className="text-xs text-slate-400">
                    شروع از: <span dir="auto" className="font-read text-slate-200">{startPreview.chapter.title}</span> · بخش {fa(startPreview.chunk + 1)}
                  </p>
                )}
              </div>
            )
          ) : liveCards.length === 0 ? (
            <p className="text-sm text-slate-400">
              هنوز کارتی برای مرور شنیداری ساخته نشده است.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="drive-cards-select" className="text-sm font-bold text-slate-200">
                مجموعهٔ واژه‌ها برای مرور شنیداری
              </label>
              <select
                id="drive-cards-select"
                value={cardPoolKey}
                onChange={e => setCardPoolKey(e.target.value)}
                className="min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm"
              >
                {todayQueue.length > 0 && (
                  <option value="today">نوبت امروز ({fa(todayQueue.length)} کارت)</option>
                )}
                {bundles.map(b => (
                  <option key={`theme:${b.name}`} value={`theme:${b.name}`}>
                    بستهٔ موضوعی: {b.name} ({fa(b.cardCount)} واژه)
                  </option>
                ))}
                {liveDecks.map(d => {
                  const count = liveCards.filter(c => c.deckId === d.id).length;
                  if (count === 0) return null;
                  return (
                    <option key={`deck:${d.id}`} value={`deck:${d.id}`}>
                      دسته: {displayDeckName(d.name)} ({fa(count)} واژه)
                    </option>
                  );
                })}
                <option value="all">همهٔ واژه‌ها ({fa(Math.min(40, liveCards.length))} واژه)</option>
              </select>
            </div>
          )}

          {/* Audio Settings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-300">نوع صدا</span>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ driveVoice: 'device' })}
                  className={`min-h-[40px] rounded-lg text-xs font-bold whitespace-nowrap ${
                    voice === 'device' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  صدای دستگاه
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ driveVoice: 'ai' })}
                  className={`min-h-[40px] rounded-lg text-xs font-bold whitespace-nowrap ${
                    voice === 'ai' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  هوش مصنوعی
                </button>
              </div>
              {voice === 'ai' && (
                <span dir="ltr" className="text-[11px] font-en text-slate-500 truncate">
                  {speechCacheHint}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-300">سرعت خواندن</span>
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
                {[0.85, 1, 1.15].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onUpdateSettings({ driveRate: r })}
                    className={`min-h-[40px] rounded-lg text-xs font-bold tabular-nums ${
                      Math.abs(rate - r) < 0.02
                        ? 'bg-brand-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {fa(r)}×
                  </button>
                ))}
              </div>
            </div>

            {mode === 'cards' && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-300">مکث برای فکر کردن</span>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
                  {[3, 5, 7].map(sec => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => onUpdateSettings({ drivePauseSeconds: sec })}
                      className={`min-h-[40px] rounded-lg text-xs font-bold tabular-nums ${
                        pauseSeconds === sec
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {fa(sec)} ثانیه
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {mode === 'cards' && (
            <p className="text-xs text-slate-400 leading-relaxed">
              {canSpeakPersian
                ? 'معنی فارسی واژه‌ها پس از مکث بلند خوانده می‌شود.'
                : 'این دستگاه صدای فارسی آفلاین ندارد؛ در حالت صدای دستگاه، به‌جای خواندن ناقص متن فارسی، تعریف انگلیسی واژه خوانده می‌شود (برای خوانش معنی فارسی، «هوش مصنوعی» با Gemini را برگزین).'}
            </p>
          )}

          <button
            type="button"
            disabled={
              (mode === 'book' && !selectedSource) ||
              (mode === 'cards' && activeCardQueue.length === 0)
            }
            onClick={startSession}
            className="w-full min-h-[60px] rounded-2xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-extrabold text-lg flex items-center justify-center gap-2.5 transition-colors"
          >
            <Icon.Headphones size={22} />
            <span>شروع حالت رانندگی</span>
          </button>
        </section>

        <DriveBookmarksTray
          notes={notes}
          sources={sources}
          chapters={chapters}
          cards={cards}
          knownWords={knownWords}
          flaggedCardIds={flaggedCardIds}
          onDismissNote={onDeleteNote}
          onOpenChunk={onOpenBookChunk}
          onSaveReaderCard={onSaveReaderCard}
          onStudyFlaggedCards={list => onStudyCards(list, 'واژه‌های نشان‌گذاری‌شده در رانندگی')}
          onUnflagCard={id =>
            onUpdateSettings({
              driveFlaggedCardIds: flaggedCardIds.filter(x => x !== id),
            })
          }
          onClearFlaggedCards={() => onUpdateSettings({ driveFlaggedCardIds: [] })}
          darkSurface
        />
      </div>
    </div>
  );
};

export default DrivingView;
