import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../types';
import { aiSpeech, speechModel, speechVoice } from '../services/aiSpeech';
import { pieceAt, ReadAloudPlayer, type AudioLike, type Piece, type PlayerState, type ReadAloudVoice } from '../services/readAloud';
import { splitSentences } from '../services/textChunker';
import { isSpeechSupported, speakText, stopSpeech } from '../services/ttsService';

interface Options {
  pieces: Piece[];
  textKey: string; // the text the pieces are cut from: another text starts over
  voice: ReadAloudVoice;
  settings: Settings;
  rate?: number; // the device voice's speed
  aiRate?: number; // the AI voice's speed
  voiceURI?: string; // the device voice to use
  onAiFailed: (error: unknown) => void;
}

// Reading a text aloud (services/readAloud) from a React view: the state to
// show and the controls. Leaving the view stops it.
export const useReadAloud = ({ pieces, textKey, voice, settings, rate = 0.95, aiRate = 1, voiceURI, onAiFailed }: Options) => {
  const [state, setState] = useState<PlayerState>({ status: 'idle', index: 0, voice });
  const latest = useRef({ settings, rate, aiRate, voiceURI, onAiFailed });
  latest.current = { settings, rate, aiRate, voiceURI, onAiFailed };
  const player = useRef<ReadAloudPlayer | null>(null);
  const speechRun = useRef(0);
  if (!player.current) {
    player.current = new ReadAloudPlayer({
      // A long piece (after the AI voice failed) is said sentence by
      // sentence: some browsers cut a long utterance off after about 15 s.
      speak: (text, onEnd, onError) => {
        if (!isSpeechSupported()) { setTimeout(onError, 0); return; }
        const run = ++speechRun.current;
        const parts = splitSentences(text);
        let k = 0;
        const next = () => {
          if (run !== speechRun.current) return;
          if (k >= parts.length) { onEnd(); return; }
          speakText(parts[k++], { rate: latest.current.rate, voiceURI: latest.current.voiceURI, onEnd: next, onError: () => { if (run === speechRun.current) onError(); } });
        };
        next();
      },
      stopSpeaking: () => { speechRun.current++; stopSpeech(); },
      synthesize: async text => URL.createObjectURL(await aiSpeech(text, latest.current.settings)),
      revoke: url => URL.revokeObjectURL(url),
      newAudio: () => new Audio() as unknown as AudioLike,
      audioRate: () => latest.current.aiRate,
      cacheKey: () => `${speechModel(latest.current.settings)}/${speechVoice(latest.current.settings)}`,
      onChange: setState,
      onAiFailed: error => latest.current.onAiFailed(error),
    }, voice);
  }

  // The same text cut for another voice goes on from the word it was at.
  const shown = useRef<{ pieces: Piece[]; textKey: string } | null>(null);
  useEffect(() => {
    const pl = player.current!;
    const prev = shown.current;
    shown.current = { pieces, textKey };
    const { status, index } = pl.state;
    const word = prev && prev.textKey === textKey && status !== 'idle' ? prev.pieces[index]?.from : undefined;
    pl.setPreferred(voice);
    pl.setPieces(pieces.map(p => p.text), word === undefined ? undefined : pieceAt(pieces, word));
  }, [pieces, textKey, voice]);
  useEffect(() => () => player.current?.dispose(), []);

  const p = player.current;
  return {
    ...state,
    active: state.status === 'playing' || state.status === 'loading',
    play: (from?: number) => p.play(from),
    pause: () => p.pause(),
    toggle: () => p.toggle(),
    stop: () => p.stop(),
  };
};
