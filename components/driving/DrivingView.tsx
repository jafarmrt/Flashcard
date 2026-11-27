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
  bookAudioOverview,
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
import { sectionPiecesForVoice, type Piece, type ReadAloudVoice } from '../../services/readAloud';
import {
  aiSpeechWithMeta,
  countCachedSpeechForSettings,
  prefetchSpeechTexts,
  speechModel,
  speechProvider,
  speechVoice,
} from '../../services/aiSpeech';
import { speechCacheSize } from '../../services/speechCache';
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
  onSaveAudioPosition?: (
    sourceId: string,
    chapterId: string,
    chunk: number,
    pieceIndex: number,
  ) => Promise<void> | void;
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
  onSaveAudioPosition,
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

  const selectedSource = useMemo(
    () => liveSources.find(s => s.id === selectedSourceId) || liveSources[0],
    [liveSources, selectedSourceId],
  );

  const bookOverview = useMemo(
    () => (selectedSource ? bookAudioOverview(selectedSource.id, chapters) : null),
    [selectedSource, chapters],
  );

  const savedSpot = useMemo(
    () => (selectedSource ? resolveDriveStartPosition(selectedSource, chapters) : null),
    [selectedSource, chapters],
  );

  // Setup target chapter, section, and resume-from-sentence selection
  const [targetChapterId, setTargetChapterId] = useState<string>(
    () => savedSpot?.chapter.id || '',
  );
  const [targetChunk, setTargetChunk] = useState<number>(() => savedSpot?.chunk || 0);
  const [resumeFromPiece, setResumeFromPiece] = useState<boolean>(true);
  const prevSourceIdRef = useRef<string | undefined>(selectedSource?.id);

  // Sync setup picker to the book's saved listening spot when switching books
  // or when the selected chapter no longer belongs to this book.
  useEffect(() => {
    if (!selectedSource || !savedSpot) return;
    const bookChapters = orderedBookChapters(selectedSource.id, chapters);
    const chapterStillValid = bookChapters.some(c => c.id === targetChapterId);
    if (prevSourceIdRef.current !== selectedSource.id || !chapterStillValid) {
      prevSourceIdRef.current = selectedSource.id;
      setTargetChapterId(savedSpot.chapter.id);
      setTargetChunk(savedSpot.chunk);
      setResumeFromPiece(true);
    }
  }, [selectedSource, savedSpot, chapters, targetChapterId]);

  const targetChapter = useMemo(() => {
    if (!selectedSource) return undefined;
    const list = orderedBookChapters(selectedSource.id, chapters);
    return list.find(c => c.id === targetChapterId) || savedSpot?.chapter || list[0];
  }, [selectedSource, chapters, targetChapterId, savedSpot]);

  const isAtSavedSpot = Boolean(
    savedSpot &&
      targetChapter &&
      targetChapter.id === savedSpot.chapter.id &&
      targetChunk === savedSpot.chunk,
  );

  const effectiveStartPiece =
    isAtSavedSpot && resumeFromPiece ? Math.max(0, savedSpot?.pieceIndex || 0) : 0;

  // AI Speech Cache inspection & pre-save state for the selected section/chapter
  const [sectionCacheStats, setSectionCacheStats] = useState<{
    cached: number;
    total: number;
  } | null>(null);
  const [totalCachedPieces, setTotalCachedPieces] = useState<number>(0);
  const [prefetchProgress, setPrefetchProgress] = useState<{
    done: number;
    total: number;
    label: string;
  } | null>(null);
  const [prefetchFeedback, setPrefetchFeedback] = useState<string | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [cacheRefreshTick, setCacheRefreshTick] = useState(0);

  const activeSpeechModel = speechModel(settings);
  const activeSpeechProvider = speechProvider(settings);
  const activeSpeechVoice = speechVoice(settings);

  useEffect(() => {
    if (voice !== 'ai' || mode !== 'book' || !targetChapter) {
      setSectionCacheStats(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [chapterText, deviceCache] = await Promise.all([
          loadChapterText(targetChapter.id),
          speechCacheSize(),
        ]);
        if (!alive) return;
        setTotalCachedPieces(deviceCache.pieces);
        const raw = chapterText.chunks[targetChunk] || '';
        const pieces = sectionPiecesForVoice(readerSection(raw), 'ai').map(p => p.text);
        const cached = await countCachedSpeechForSettings(pieces, settings);
        if (!alive) return;
        setSectionCacheStats({ cached, total: pieces.length });
      } catch {
        if (alive) setSectionCacheStats(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    voice,
    mode,
    targetChapter,
    targetChunk,
    loadChapterText,
    settings,
    activeSpeechProvider,
    activeSpeechModel,
    activeSpeechVoice,
    cacheRefreshTick,
  ]);

  const handlePrefetchAudio = async (scope: 'section' | 'chapter') => {
    if (!targetChapter || prefetchProgress) return;
    setPrefetchFeedback(null);
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    try {
      const chapterText = await loadChapterText(targetChapter.id);
      const texts: string[] = [];
      if (scope === 'section') {
        const raw = chapterText.chunks[targetChunk] || '';
        texts.push(...sectionPiecesForVoice(readerSection(raw), 'ai').map(p => p.text));
      } else {
        for (const raw of chapterText.chunks) {
          texts.push(...sectionPiecesForVoice(readerSection(raw || ''), 'ai').map(p => p.text));
        }
      }
      if (texts.length === 0) {
        setPrefetchFeedback('متنی برای تولید صدا در این بخش نیست.');
        return;
      }
      const label =
        scope === 'section'
          ? `بخش ${fa(targetChunk + 1)}`
          : `فصل «${targetChapter.title}»`;
      setPrefetchProgress({ done: 0, total: texts.length, label });
      const res = await prefetchSpeechTexts(
        texts,
        settings,
        (done, total) => setPrefetchProgress({ done, total, label }),
        controller.signal,
      );
      setCacheRefreshTick(t => t + 1);
      if (!controller.signal.aborted) {
        setPrefetchFeedback(
          `صدای ${fa(res.saved)} تکه در برنامه ذخیره شد؛ پخش‌های بعدی بدون اینترنت و بدون هزینهٔ مجدد انجام می‌شود.`,
        );
      }
    } catch (err) {
      const msg = (err as Error)?.message || '';
      setPrefetchFeedback(
        msg
          ? `ذخیرهٔ صدای هوش مصنوعی ناتمام ماند: ${msg}`
          : 'ذخیرهٔ صدای هوش مصنوعی ناتمام ماند؛ تنظیمات کلید صدا را بررسی کن.',
      );
    } finally {
      prefetchAbortRef.current = null;
      setPrefetchProgress(null);
    }
  };

  // Active session state
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flashSaved, setFlashSaved] = useState<string | null>(null);
  const [currentPieceFromCache, setCurrentPieceFromCache] = useState(false);

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

  // Persist exact audiobook listening spot (chapter, section, sentence) whenever it moves
  useEffect(() => {
    if (!active || mode !== 'book' || loadingBook) return;
    if (!selectedSource || !bookChapterId) return;
    const clampedPiece =
      bookPieces.length > 0 ? Math.max(0, Math.min(pieceIndex, bookPieces.length - 1)) : 0;
    void onSaveAudioPosition?.(selectedSource.id, bookChapterId, bookChunk, clampedPiece);
  }, [
    active,
    mode,
    loadingBook,
    selectedSource,
    bookChapterId,
    bookChunk,
    pieceIndex,
    bookPieces.length,
    onSaveAudioPosition,
  ]);

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
      prefetchAbortRef.current?.abort();
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
      opts: { lang: 'en-US' | 'fa-IR'; audioSrc?: string; slow?: boolean; prefetchNext?: string },
      expectedRun: number,
    ): Promise<boolean> => {
      if (runIdRef.current !== expectedRun || !text.trim()) return false;
      const effectiveRate = opts.slow ? Math.max(0.7, rate * 0.85) : rate;

      // Prefer recorded dictionary audio for single English headwords in device mode
      if (opts.audioSrc && voice === 'device' && opts.lang === 'en-US') {
        setCurrentPieceFromCache(false);
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

      // AI voice path (Gemini speaks both English & Persian; OpenRouter speaks English).
      // `aiSpeechWithMeta` persists every generated clip in IndexedDB (`LinguaSpeechCache`)
      // so replaying a section or card never calls the API twice.
      if (voice === 'ai' && (opts.lang === 'en-US' || speechProvider(settings) === 'gemini')) {
        try {
          const { blob, fromCache } = await aiSpeechWithMeta(text, settings);
          if (runIdRef.current !== expectedRun) return false;
          setCurrentPieceFromCache(fromCache);
          if (opts.prefetchNext?.trim()) {
            aiSpeechWithMeta(opts.prefetchNext, settings).catch(() => undefined);
          }
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
          setCurrentPieceFromCache(false);
          // Fall through to device speech synthesis
        }
      } else {
        setCurrentPieceFromCache(false);
      }

      if (runIdRef.current !== expectedRun) return false;
      if (!isSpeechSupported()) {
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

  // Loads a section's pieces using the exact same piece boundaries as ChunkReaderView
  const loadSectionPieces = useCallback(
    async (chapterId: string, chunk: number): Promise<Piece[]> => {
      setLoadingBook(true);
      try {
        const chapterText = await loadChapterText(chapterId);
        const raw = chapterText.chunks[chunk] || '';
        const parsed = readerSection(raw);
        return sectionPiecesForVoice(parsed, voice);
      } finally {
        setLoadingBook(false);
      }
    },
    [loadChapterText, voice],
  );

  // Jumps directly to any chosen chapter & section while inside the active player
  const jumpToChapterChunk = useCallback(
    async (chapterId: string, chunk: number, startPiece = 0) => {
      haltAudio();
      setStatusMessage(null);
      setChapterDrawerOpen(false);
      chunkStartedAtRef.current = Date.now();
      setBookChapterId(chapterId);
      setBookChunk(chunk);
      setTargetChapterId(chapterId);
      setTargetChunk(chunk);
      try {
        const pieces = await loadSectionPieces(chapterId, chunk);
        const clamped = pieces.length > 0 ? Math.max(0, Math.min(startPiece, pieces.length - 1)) : 0;
        setBookPieces(pieces);
        setPieceIndex(clamped);
        if (selectedSource) {
          void onSaveAudioPosition?.(selectedSource.id, chapterId, chunk, clamped);
        }
        unlockAudio();
        setPaused(false);
      } catch {
        setPaused(true);
        setStatusMessage('متن این بخش در دسترس نیست. اتصال را بررسی کن.');
      }
    },
    [haltAudio, loadSectionPieces, onSaveAudioPosition, selectedSource, unlockAudio],
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
          const endIdx = Math.max(0, pieces.length - 1);
          setPieceIndex(endIdx);
          void onSaveAudioPosition?.(sourceId, chapterId, chunk, endIdx);
          return pieces;
        });
        setPaused(true);
        setStatusMessage('پخش کتاب به پایان رسید.');
        return;
      }
      chunkStartedAtRef.current = Date.now();
      setBookChapterId(nextPos.chapter.id);
      setBookChunk(nextPos.chunk);
      setTargetChapterId(nextPos.chapter.id);
      setTargetChunk(nextPos.chunk);
      setPieceIndex(0);
      void onSaveAudioPosition?.(sourceId, nextPos.chapter.id, nextPos.chunk, 0);
      const nextPieces = await loadSectionPieces(nextPos.chapter.id, nextPos.chunk);
      setBookPieces(nextPieces);
    },
    [chapters, haltAudio, loadSectionPieces, onCompleteChunk, onSaveAudioPosition],
  );

  // Continuous Book Playback Effect
  useEffect(() => {
    if (!active || paused || mode !== 'book' || loadingBook) return;
    if (!selectedSource || !bookChapterId) return;

    if (bookPieces.length === 0) {
      const timer = setTimeout(() => {
        void advanceBookSection(selectedSource.id, bookChapterId, bookChunk, true);
      }, 300);
      return () => clearTimeout(timer);
    }

    if (pieceIndex >= bookPieces.length) {
      void advanceBookSection(selectedSource.id, bookChapterId, bookChunk, true);
      return;
    }

    const expectedRun = ++runIdRef.current;
    const currentPiece = bookPieces[pieceIndex];
    const nextPieceText = bookPieces[pieceIndex + 1]?.text;

    playUtterance(
      currentPiece.text,
      { lang: 'en-US', prefetchNext: nextPieceText },
      expectedRun,
    ).then(ok => {
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
    prefetchAbortRef.current?.abort();
    unlockAudio();
    if (mode === 'book') {
      if (!selectedSource || !targetChapter) return;
      const startChapterId = targetChapter.id;
      const startChunk = Math.max(0, Math.min(targetChunk, Math.max(1, targetChapter.chunkCount) - 1));
      setBookChapterId(startChapterId);
      setBookChunk(startChunk);
      setChapterDrawerOpen(false);
      chunkStartedAtRef.current = Date.now();
      setActive(true);
      setPaused(false);
      try {
        const pieces = await loadSectionPieces(startChapterId, startChunk);
        const clampedPiece =
          pieces.length > 0 ? Math.max(0, Math.min(effectiveStartPiece, pieces.length - 1)) : 0;
        setBookPieces(pieces);
        setPieceIndex(clampedPiece);
        void onSaveAudioPosition?.(selectedSource.id, startChapterId, startChunk, clampedPiece);
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
          setTargetChapterId(prev.chapter.id);
          setTargetChunk(prev.chunk);
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
        void handlePrevOrRepeat();
      });
      ms.setActionHandler('nexttrack', () => {
        void handleNext();
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
    if (mode === 'book' && selectedSource && bookChapterId) {
      const clamped =
        bookPieces.length > 0 ? Math.max(0, Math.min(pieceIndex, bookPieces.length - 1)) : 0;
      void onSaveAudioPosition?.(selectedSource.id, bookChapterId, bookChunk, clamped);
      setTargetChapterId(bookChapterId);
      setTargetChunk(bookChunk);
      setResumeFromPiece(true);
    }
    setCacheRefreshTick(t => t + 1);
    haltAudio();
    revokeUrls();
    setChapterDrawerOpen(false);
    setActive(false);
    setPaused(false);
  };

  const currentCard = activeCardQueue[cardIndex % Math.max(1, activeCardQueue.length)];
  const currentPiece = bookPieces[pieceIndex] || bookPieces[bookPieces.length - 1];
  const shownPieceNumber = bookPieces.length > 0 ? Math.min(pieceIndex + 1, bookPieces.length) : 0;
  const speechCacheHint = `${activeSpeechProvider} · ${activeSpeechModel}${activeSpeechVoice ? ` · ${activeSpeechVoice}` : ''}`;

  // --- ACTIVE HANDS-FREE AUTOMOTIVE VIEW ---
  if (active) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#0B110F] text-slate-100 font-fa flex flex-col justify-between p-4 sm:p-6 lg:p-8 select-none"
      >
        <div className="w-full max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={stopAndExitSession}
            className="min-h-[48px] px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-bold text-sm flex items-center gap-2 whitespace-nowrap"
          >
            <Icon.Back size={18} />
            پایان حالت رانندگی
          </button>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 tabular-nums">
              <span>{mode === 'book' ? 'پیوسته‌خوانی کتاب' : 'مرور شنیداری واژه‌ها'}</span>
              <span aria-hidden="true">·</span>
              <span>سرعت {fa(rate)}×</span>
              {voice === 'ai' && currentPieceFromCache && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400">از حافظهٔ برنامه</span>
                </>
              )}
            </div>

            {mode === 'book' && bookOverview && bookOverview.chapters.length > 0 && (
              <button
                type="button"
                onClick={() => setChapterDrawerOpen(v => !v)}
                aria-expanded={chapterDrawerOpen}
                className="min-h-[48px] px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-100 font-bold text-sm flex items-center gap-2 whitespace-nowrap"
              >
                <Icon.List size={18} />
                <span>فصل و بخش</span>
              </button>
            )}
          </div>
        </div>

        {/* In-Player Chapter & Section Switcher Sheet */}
        {chapterDrawerOpen && mode === 'book' && bookOverview && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="انتخاب فصل و بخش در حال پخش"
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-6"
            onClick={e => {
              if (e.target === e.currentTarget) setChapterDrawerOpen(false);
            }}
          >
            <div className="w-full max-w-2xl max-h-[82vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700 p-5 sm:p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-white">رفتن به فصل یا بخش دیگر</h2>
                  <p className="text-xs text-slate-400 tabular-nums">
                    در حال پخش: {activeChapter?.title} · بخش {fa(bookChunk + 1)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setChapterDrawerOpen(false)}
                  aria-label="بستن فهرست فصل‌ها"
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                >
                  <Icon.Close size={18} />
                </button>
              </div>

              <div className="divide-y divide-slate-800">
                {bookOverview.chapters.map(chSum => {
                  const isCurrentChapter = chSum.chapter.id === bookChapterId;
                  return (
                    <div key={chSum.chapter.id} className="py-3.5 first:pt-1 last:pb-1 flex flex-col gap-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 dir="auto" className="font-read text-sm sm:text-base font-bold text-slate-100">
                          {bookOverview.chapters.length > 1 ? `فصل ${fa(chSum.orderNumber)}: ` : ''}
                          {chSum.chapter.title}
                        </h3>
                        <span className="text-xs text-slate-400 tabular-nums shrink-0">
                          {fa(chSum.completedSections)} از {fa(chSum.totalSections)} بخش
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: chSum.totalSections }, (_, idx) => {
                          const isPlayingHere = isCurrentChapter && idx === bookChunk;
                          const isDone = chSum.chapter.completed.includes(idx);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                void jumpToChapterChunk(chSum.chapter.id, idx, 0);
                              }}
                              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold tabular-nums transition-colors whitespace-nowrap ${
                                isPlayingHere
                                  ? 'bg-brand-600 text-white'
                                  : isDone
                                    ? 'bg-slate-800/90 border border-emerald-800/70 text-emerald-300 hover:bg-slate-800'
                                    : 'bg-slate-950 border border-slate-800 text-slate-300 hover:border-slate-600'
                              }`}
                            >
                              بخش {fa(idx + 1)}
                              {isDone ? ' ✓' : ''}
                              {isPlayingHere ? ' · در حال پخش' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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
              onClick={() => {
                void handlePrevOrRepeat();
              }}
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
              onClick={() => {
                void handleNext();
              }}
              aria-label="مورد بعدی"
              className="min-h-[88px] rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] border border-slate-800 text-slate-100 font-extrabold text-base sm:text-lg flex flex-col items-center justify-center gap-1 transition-transform"
            >
              <span>بعدی</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleBookmarkNow();
            }}
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
  const targetSectionCount = targetChapter ? Math.max(1, targetChapter.chunkCount) : 0;

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
          پخش بی‌نیاز از نگاه به صفحه، همراه با انتخاب فصل و بخش مثل کتاب صوتی، ادامه از همان جمله‌ای که شنیده‌ای و ثبت تک‌لمسی نشان برای بررسی بعد از توقف.
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
              خوانش پیاپی بخش‌ها و فصل‌ها با امکان انتخاب هر فصل و بخش دلخواه
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
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label htmlFor="drive-book-select" className="text-sm font-bold text-slate-200">
                      انتخاب کتاب یا مقاله
                    </label>
                    {bookOverview && (
                      <span className="text-xs text-slate-400 tabular-nums">
                        پیشرفت کتاب: {fa(bookOverview.completedSections)} از {fa(bookOverview.totalSections)} بخش تمام‌شده
                      </span>
                    )}
                  </div>
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
                </div>

                {/* Saved Listening Spot Summary & Quick Jump Back */}
                {savedSpot && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 pt-1">
                    <p className="flex flex-wrap items-center gap-1.5 tabular-nums">
                      <span className="text-slate-400">
                        {savedSpot.sourceOfSpot === 'audio'
                          ? 'آخرین جای شنیده‌شده:'
                          : savedSpot.sourceOfSpot === 'reading'
                            ? 'آخرین جای مطالعه:'
                            : 'بخش پیشنهادی شروع:'}
                      </span>
                      <span dir="auto" className="font-read font-semibold text-emerald-300">
                        {savedSpot.chapter.title}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>بخش {fa(savedSpot.chunk + 1)}</span>
                      {savedSpot.pieceIndex > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>جملهٔ {fa(savedSpot.pieceIndex + 1)}</span>
                        </>
                      )}
                    </p>
                    {!isAtSavedSpot && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetChapterId(savedSpot.chapter.id);
                          setTargetChunk(savedSpot.chunk);
                          setResumeFromPiece(true);
                        }}
                        className="min-h-[36px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-emerald-300 transition-colors whitespace-nowrap"
                      >
                        برگشت به آخرین جای توقف
                      </button>
                    )}
                  </div>
                )}

                {/* Audiobook Chapter & Section Picker */}
                {bookOverview && targetChapter && (
                  <div className="flex flex-col gap-4 pt-3 border-t border-slate-800/80">
                    {bookOverview.chapters.length > 1 && (
                      <div className="flex flex-col gap-2">
                        <label htmlFor="drive-chapter-select" className="text-sm font-bold text-slate-200">
                          انتخاب فصل ({fa(bookOverview.chapters.length)} فصل)
                        </label>
                        <select
                          id="drive-chapter-select"
                          value={targetChapter.id}
                          onChange={e => {
                            const nextCh = bookOverview.chapters.find(
                              c => c.chapter.id === e.target.value,
                            )?.chapter;
                            if (!nextCh) return;
                            setTargetChapterId(nextCh.id);
                            if (savedSpot && savedSpot.chapter.id === nextCh.id) {
                              setTargetChunk(savedSpot.chunk);
                              setResumeFromPiece(true);
                            } else {
                              const firstUnread = Array.from(
                                { length: Math.max(1, nextCh.chunkCount) },
                                (_, i) => i,
                              ).find(i => !nextCh.completed.includes(i));
                              setTargetChunk(firstUnread ?? 0);
                              setResumeFromPiece(false);
                            }
                          }}
                          className="min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm"
                        >
                          {bookOverview.chapters.map(chSum => (
                            <option key={chSum.chapter.id} value={chSum.chapter.id}>
                              فصل {fa(chSum.orderNumber)}: {chSum.chapter.title} ({fa(chSum.completedSections)} از {fa(chSum.totalSections)} بخش{chSum.isComplete ? ' ✓' : ''})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-slate-200">
                          انتخاب بخش برای شنیدن
                        </span>
                        <span className="text-xs text-slate-400 tabular-nums">
                          شروع پخش از: <bdi dir="auto" className="font-read text-slate-200">{targetChapter.title}</bdi> · بخش {fa(targetChunk + 1)}
                          {effectiveStartPiece > 0 ? ` · جملهٔ ${fa(effectiveStartPiece + 1)}` : ''}
                        </span>
                      </div>

                      <div
                        role="group"
                        aria-label="بخش‌های فصل انتخاب‌شده"
                        className="flex flex-wrap gap-2"
                      >
                        {Array.from({ length: targetSectionCount }, (_, idx) => {
                          const isSelected = idx === targetChunk;
                          const isDone = targetChapter.completed.includes(idx);
                          const isSavedChunk =
                            savedSpot?.chapter.id === targetChapter.id && savedSpot.chunk === idx;
                          return (
                            <button
                              key={idx}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => {
                                setTargetChunk(idx);
                                setResumeFromPiece(Boolean(isSavedChunk));
                              }}
                              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold tabular-nums transition-colors whitespace-nowrap ${
                                isSelected
                                  ? 'bg-brand-600 text-white border border-brand-400'
                                  : isDone
                                    ? 'bg-slate-950/90 border border-emerald-800/70 text-emerald-300 hover:border-emerald-600'
                                    : isSavedChunk
                                      ? 'bg-slate-950 border border-amber-600/70 text-amber-200 hover:border-amber-400'
                                      : 'bg-slate-950 border border-slate-800 text-slate-300 hover:border-slate-600'
                              }`}
                            >
                              بخش {fa(idx + 1)}
                              {isDone ? ' ✓' : ''}
                              {isSavedChunk && !isDone ? ' · ادامه' : ''}
                            </button>
                          );
                        })}
                      </div>

                      {isAtSavedSpot && (savedSpot?.pieceIndex || 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="text-xs text-slate-400">نقطهٔ شروع در این بخش:</span>
                          <button
                            type="button"
                            onClick={() => setResumeFromPiece(true)}
                            className={`min-h-[36px] px-3 rounded-lg text-xs font-bold tabular-nums transition-colors whitespace-nowrap ${
                              resumeFromPiece
                                ? 'bg-brand-600 text-white'
                                : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            ادامه از جملهٔ {fa((savedSpot?.pieceIndex || 0) + 1)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setResumeFromPiece(false)}
                            className={`min-h-[36px] px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                              !resumeFromPiece
                                ? 'bg-brand-600 text-white'
                                : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            از ابتدای بخش
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-800">
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

          {/* Persistent AI Audio Cache Status & Pre-Save Controls */}
          {voice === 'ai' && mode === 'book' && targetChapter && (
            <div className="flex flex-col gap-2.5 pt-3 border-t border-slate-800/80 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-300 tabular-nums">
                  {sectionCacheStats ? (
                    sectionCacheStats.total > 0 &&
                    sectionCacheStats.cached >= sectionCacheStats.total ? (
                      <span className="text-emerald-300 font-bold">
                        صدای هوش مصنوعی این بخش کامل در برنامه ذخیره شده است ({fa(sectionCacheStats.cached)} از {fa(sectionCacheStats.total)} تکه · پخش بدون هزینهٔ مجدد)
                      </span>
                    ) : (
                      <span>
                        صدای هوش مصنوعی این بخش: {fa(sectionCacheStats.cached)} از {fa(sectionCacheStats.total)} تکه در برنامه ذخیره شده
                      </span>
                    )
                  ) : (
                    <span>هر تکه‌ای که با صدای هوش مصنوعی خوانده شود خودکار در برنامه ذخیره می‌ماند</span>
                  )}
                  {totalCachedPieces > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-slate-400">
                        در کل {fa(totalCachedPieces)} تکه صدای ذخیره‌شده
                      </span>
                    </>
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {prefetchProgress ? (
                    <>
                      <span className="text-emerald-300 font-bold tabular-nums">
                        در حال ذخیرهٔ صدای {prefetchProgress.label}: {fa(prefetchProgress.done)} از {fa(prefetchProgress.total)}…
                      </span>
                      <button
                        type="button"
                        onClick={() => prefetchAbortRef.current?.abort()}
                        className="min-h-[38px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold whitespace-nowrap"
                      >
                        توقف ذخیره
                      </button>
                    </>
                  ) : (
                    <>
                      {(!sectionCacheStats ||
                        sectionCacheStats.cached < sectionCacheStats.total) && (
                        <button
                          type="button"
                          onClick={() => {
                            void handlePrefetchAudio('section');
                          }}
                          className="min-h-[38px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold transition-colors whitespace-nowrap"
                        >
                          ذخیرهٔ صدای این بخش
                        </button>
                      )}
                      {targetSectionCount > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            void handlePrefetchAudio('chapter');
                          }}
                          className="min-h-[38px] px-3.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold transition-colors whitespace-nowrap"
                        >
                          ذخیرهٔ صدای کل این فصل
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {prefetchFeedback && (
                <p role="status" className="text-slate-300 leading-relaxed">
                  {prefetchFeedback}
                </p>
              )}
            </div>
          )}

          {mode === 'cards' && (
            <p className="text-xs text-slate-400 leading-relaxed">
              {canSpeakPersian
                ? 'معنی فارسی واژه‌ها پس از مکث بلند خوانده می‌شود (و صدای هوش مصنوعی هر واژه پس از اولین پخش در برنامه ذخیره می‌ماند).'
                : 'این دستگاه صدای فارسی آفلاین ندارد؛ در حالت صدای دستگاه، به‌جای خواندن ناقص متن فارسی، تعریف انگلیسی واژه خوانده می‌شود (برای خوانش معنی فارسی، «هوش مصنوعی» با Gemini را برگزین).'}
            </p>
          )}

          <button
            type="button"
            disabled={
              (mode === 'book' && (!selectedSource || !targetChapter)) ||
              (mode === 'cards' && activeCardQueue.length === 0)
            }
            onClick={() => {
              void startSession();
            }}
            className="w-full min-h-[60px] rounded-2xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-extrabold text-lg flex items-center justify-center gap-2.5 transition-colors"
          >
            <Icon.Headphones size={22} />
            <span>
              {mode === 'book' && targetChapter
                ? `شروع شنیدن (${targetChapter.title} · بخش ${fa(targetChunk + 1)})`
                : 'شروع حالت رانندگی'}
            </span>
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
