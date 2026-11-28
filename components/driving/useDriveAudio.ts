// The audio engine of driving mode, apart from its screen: one <audio>
// element, the device's speech, the AI voice with its cache, and the run
// counter that lets a skip, a pause or leaving cut off whatever is playing.
// Which way an utterance is spoken is decided by services/drivingMode
// `utteranceWays` (tested there); this hook only plays.

import { useCallback, useEffect, useRef } from 'react';
import type { Settings } from '../../types';
import type { ReadAloudVoice } from '../../services/readAloud';
import { aiSpeechWithMeta, speechProvider } from '../../services/aiSpeech';
import { utteranceWays } from '../../services/drivingMode';
import { isSpeechSupported, speakText, stopSpeech } from '../../services/ttsService';

// A short silent WAV: played on the first tap so that later playback, which
// starts without a tap, is allowed by mobile browsers.
const SILENCE_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export interface DriveAudioConfig {
  rate: number;
  voice: ReadAloudVoice;
  settings: Settings;
}

export interface UtteranceOptions {
  lang: 'en-US' | 'fa-IR';
  audioSrc?: string; // a recorded dictionary sound for the word
  slow?: boolean;
  prefetchNext?: string; // the next AI piece, made while this one plays
}

// `getConfig` is read at the moment each utterance starts, so a change of
// rate, voice or settings never recreates the player mid-sentence.
export function useDriveAudio(getConfig: () => DriveAudioConfig, onFromCache: (fromCache: boolean) => void) {
  const runIdRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const urlRef = useRef<string | null>(null);
  // Resolves the utterance now playing on the <audio> element. Halting
  // removed the element's handlers, so its promise never settled and the
  // loop that awaited it stayed suspended for good, one per pause or skip.
  const settleRef = useRef<((ok: boolean) => void) | null>(null);

  const revokeUrls = useCallback(() => {
    if (urlRef.current) {
      try { URL.revokeObjectURL(urlRef.current); } catch { /* already gone */ }
      urlRef.current = null;
    }
  }, []);

  const haltAudio = useCallback(() => {
    runIdRef.current += 1;
    stopSpeech();
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
      } catch { /* not playing */ }
    }
    settleRef.current?.(false);
    settleRef.current = null;
  }, []);

  const ensureAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    if (unlockedRef.current) return;
    try {
      const a = ensureAudioElement();
      unlockedRef.current = true;
      a.src = SILENCE_WAV;
      a.play().catch(() => undefined);
    } catch { /* no audio element here */ }
  }, [ensureAudioElement]);

  // Plays `src` on the element; true when it played to the end.
  const playOnElement = useCallback((src: string, rate: number): Promise<boolean> => new Promise<boolean>(resolve => {
    const audio = ensureAudioElement();
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (settleRef.current === settle) settleRef.current = null;
      resolve(ok);
    };
    settleRef.current = settle;
    audio.onended = () => settle(true);
    audio.onerror = () => settle(false);
    audio.src = src;
    audio.playbackRate = rate;
    unlockedRef.current = true;
    audio.play().catch(() => settle(false));
  }), [ensureAudioElement]);

  // Speaks one utterance and resolves when it is done or cut off: true only
  // when it finished and `expectedRun` is still the current run.
  const playUtterance = useCallback(async (text: string, opts: UtteranceOptions, expectedRun: number): Promise<boolean> => {
    const current = () => runIdRef.current === expectedRun;
    if (!current() || !text.trim()) return false;
    const { rate, voice, settings } = getConfig();
    const effectiveRate = opts.slow ? Math.max(0.7, rate * 0.85) : rate;
    const ways = utteranceWays({ voice, lang: opts.lang, hasRecording: !!opts.audioSrc, provider: speechProvider(settings) });

    for (const way of ways) {
      if (!current()) return false;
      if (way === 'recorded') {
        onFromCache(false);
        if (await playOnElement(opts.audioSrc!, effectiveRate)) return current();
        continue;
      }
      if (way === 'ai') {
        try {
          // aiSpeechWithMeta keeps every clip on the device (services/speechCache).
          const { blob, fromCache } = await aiSpeechWithMeta(text, settings);
          if (!current()) return false;
          onFromCache(fromCache);
          if (opts.prefetchNext?.trim()) aiSpeechWithMeta(opts.prefetchNext, settings).catch(() => undefined);
          // The piece before has ended or been cut off; keeping its URL kept
          // its sound in memory for the whole drive (over 150 MB in an hour).
          revokeUrls();
          urlRef.current = URL.createObjectURL(blob);
          if (await playOnElement(urlRef.current, effectiveRate)) return current();
        } catch {
          onFromCache(false);
        }
        continue;
      }
      onFromCache(false);
      if (!isSpeechSupported()) {
        await new Promise<void>(r => setTimeout(r, 1200));
        return current();
      }
      return new Promise<boolean>(resolve => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve(current());
        };
        speakText(text, { lang: opts.lang, rate: effectiveRate, onEnd: done, onError: done });
      });
    }
    return false;
  }, [getConfig, onFromCache, playOnElement, revokeUrls]);

  useEffect(() => () => {
    haltAudio();
    revokeUrls();
  }, [haltAudio, revokeUrls]);

  return { runIdRef, haltAudio, revokeUrls, unlockAudio, playUtterance };
}

// Keeps the screen on while `on`, taking the lock again when the page comes
// back into view (the browser drops it when the page is hidden).
export function useWakeLock(on: boolean) {
  const sentinelRef = useRef<any>(null);
  useEffect(() => {
    const nav = navigator as any;
    const release = () => {
      sentinelRef.current?.release?.().catch(() => undefined);
      sentinelRef.current = null;
    };
    if (!on || !nav?.wakeLock?.request) {
      release();
      return;
    }
    let cancelled = false;
    const acquire = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      nav.wakeLock.request('screen')
        .then((sentinel: any) => {
          if (cancelled) sentinel.release?.().catch(() => undefined);
          else sentinelRef.current = sentinel;
        })
        .catch(() => undefined);
    };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      release();
    };
  }, [on]);
}
