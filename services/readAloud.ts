// File: /services/readAloud.ts
// Reading a text aloud, piece by piece, with the device's voice or an AI
// voice. Going piece by piece is what lets a pause be picked up again where
// it stopped (the device voice's own pause is unreliable, and on Android it
// forgets the text), lets the piece being read be marked in the text, and
// keeps each AI request short. The AI voice fetches the next piece while one
// plays; when it fails, the device voice carries on from the same piece.

import type { ReaderSection } from './readerText.js';

export type ReadAloudVoice = 'device' | 'ai';

export interface Piece {
  text: string;
  from: number; // first and last word, as numbered in the section
  to: number;
  paragraph: number;
}

// A sentence with no full stop for this many words (a list, a PDF extract)
// is cut, so no piece is too long for the device voice.
export const LONGEST_SENTENCE = 40;

// Whole sentences of one paragraph, up to `maxWords` a piece. The first piece
// can be shorter, so the first AI audio is ready sooner. maxWords 0: one
// sentence a piece. A sentence longer than that (or LONGEST_SENTENCE with
// maxWords 0) is cut between words, so no piece is ever longer.
export const piecesOf = (section: ReaderSection, maxWords = 0, firstMaxWords = maxWords): Piece[] => {
  const out: Piece[] = [];
  const cut = maxWords > 0 ? maxWords : LONGEST_SENTENCE;
  section.paragraphs.forEach((p, paragraph) => {
    if (p.words.length === 0) return;
    // The paragraph's sentences, long ones cut into parts.
    const parts: { start: number; end: number; from: number; to: number }[] = [];
    for (let s = p.words[0].sentence; s <= p.words[p.words.length - 1].sentence; s++) {
      const sentence = section.sentences[s];
      if (!sentence) continue;
      for (let a = sentence.first; a <= sentence.last; a += cut) {
        const b = Math.min(a + cut - 1, sentence.last);
        parts.push({
          start: a === sentence.first ? sentence.start : section.words[a].start,
          end: b === sentence.last ? sentence.end : section.words[b + 1].start, // what follows a word ("29" of "word29") stays with it
          from: a,
          to: b,
        });
      }
    }
    let current: { start: number; end: number; from: number; to: number } | null = null;
    const flush = () => {
      if (!current) return;
      out.push({ text: section.text.slice(current.start, current.end).replace(/\s+/g, ' ').trim(), from: current.from, to: current.to, paragraph });
      current = null;
    };
    for (const part of parts) {
      const limit = out.length === 0 ? firstMaxWords : maxWords;
      if (current && (limit <= 0 || part.to - current.from + 1 > limit)) flush();
      if (!current) current = { ...part };
      else { current.end = part.end; current.to = part.to; }
    }
    flush();
  });
  return out.filter(p => p.text);
};

// The piece a word is in.
export const pieceAt = (pieces: Piece[], wordIndex: number): number => {
  const i = pieces.findIndex(p => wordIndex >= p.from && wordIndex <= p.to);
  return i < 0 ? 0 : i;
};

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlayerState {
  status: PlayerStatus;
  index: number; // the piece being read, or where reading goes on from
  voice: ReadAloudVoice; // the voice in use (the device's after an AI failure)
}

// The parts of an <audio> element the player uses.
export interface AudioLike {
  src: string;
  playbackRate: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export interface PlayerDeps {
  speak(text: string, onEnd: () => void, onError: () => void): void;
  stopSpeaking(): void;
  synthesize(text: string): Promise<string>; // a URL the audio can play
  revoke(url: string): void;
  newAudio(): AudioLike;
  audioRate?(): number; // the AI voice's speed, 1 by default
  onChange(state: PlayerState): void;
  onAiFailed(error: unknown): void;
  cacheKey?(): string; // the AI voice and model: audio made with others is not reused
}

// A short silent WAV, played inside the tap that starts reading so phones
// let the same audio element play the AI pieces that arrive later.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export class ReadAloudPlayer {
  private pieces: string[] = [];
  private index = 0;
  private status: PlayerStatus = 'idle';
  private voice: ReadAloudVoice;
  private preferred: ReadAloudVoice;
  // Every start, pause or stop begins a new run; callbacks of older runs
  // (a cancelled utterance's error, a late audio) do nothing.
  private run = 0;
  private audio: AudioLike | null = null;
  private audioReady = false; // the current piece's audio is loaded and can resume
  private cache = new Map<number, Promise<string>>();
  private cacheTag = '';
  private urls: string[] = [];

  constructor(private deps: PlayerDeps, voice: ReadAloudVoice = 'device') {
    this.voice = voice;
    this.preferred = voice;
  }

  get state(): PlayerState {
    return { status: this.status, index: this.index, voice: this.voice };
  }

  // The voice to use from the next setPieces on.
  setPreferred(voice: ReadAloudVoice): void {
    this.preferred = voice;
  }

  // The text to read, in the preferred voice. Without `keepAt` (another
  // section) reading starts over; with it (the same text in another voice,
  // cut into other pieces) it goes on from that piece, playing if it was.
  setPieces(pieces: string[], keepAt?: number): void {
    const same = pieces.length === this.pieces.length && pieces.every((p, i) => p === this.pieces[i]);
    if (same && this.voice === this.preferred) return;
    // The same pieces (a space typed after the text): the place is kept.
    if (same && keepAt === undefined && this.status !== 'idle') keepAt = this.index;
    const was = this.status;
    this.halt();
    if (!same) this.clearCache();
    this.pieces = pieces;
    this.voice = this.preferred;
    if (keepAt === undefined || pieces.length === 0) {
      this.index = 0;
      this.status = 'idle';
      this.emit();
      return;
    }
    this.index = Math.max(0, Math.min(keepAt, pieces.length - 1));
    if (was === 'playing' || was === 'loading') { this.playFrom(this.index); return; }
    this.status = was === 'idle' ? 'idle' : 'paused';
    this.emit();
  }

  // Play: after a pause, from where it stopped; with `from`, from that piece.
  play(from?: number): void {
    this.unlock();
    if (from !== undefined) { this.playFrom(from); return; }
    if (this.status === 'playing' || this.status === 'loading') return;
    if (this.status === 'paused' && this.voice === 'ai' && this.audio && this.audioReady) {
      const run = ++this.run;
      this.watch(this.audio, run, this.index);
      this.audio.playbackRate = this.deps.audioRate?.() || 1;
      this.status = 'playing';
      this.emit();
      this.audio.play().catch(() => { if (run === this.run) { this.status = 'paused'; this.emit(); } });
      return;
    }
    this.playFrom(this.index);
  }

  pause(): void {
    if (this.status !== 'playing' && this.status !== 'loading') return;
    this.run++;
    if (this.voice === 'ai' && this.audio && this.status === 'playing') this.audio.pause();
    else { this.deps.stopSpeaking(); this.audioReady = false; }
    this.status = 'paused';
    this.emit();
  }

  toggle(): void {
    if (this.status === 'playing' || this.status === 'loading') this.pause();
    else this.play();
  }

  // Stop and go back to the start.
  stop(): void {
    this.halt();
    this.index = 0;
    this.status = 'idle';
    this.emit();
  }

  dispose(): void {
    this.halt();
    this.clearCache();
    this.status = 'idle';
  }

  private emit() {
    this.deps.onChange(this.state);
  }

  private unlock() {
    if (this.voice !== 'ai' || this.audio) return;
    const audio = this.deps.newAudio();
    this.audio = audio;
    try {
      audio.src = SILENCE;
      audio.play().catch(() => undefined);
    } catch {
      // Not allowed or not supported: the first piece may need another tap.
    }
  }

  private halt() {
    this.run++;
    this.deps.stopSpeaking();
    if (this.audio && !this.audio.paused) this.audio.pause();
    this.audioReady = false;
  }

  private clearCache() {
    this.cache.clear();
    for (const url of this.urls) this.deps.revoke(url);
    this.urls = [];
  }

  private urlFor(i: number): Promise<string> | null {
    if (i < 0 || i >= this.pieces.length) return null;
    const tag = this.deps.cacheKey?.() ?? '';
    if (tag !== this.cacheTag) { this.clearCache(); this.cacheTag = tag; }
    const cached = this.cache.get(i);
    if (cached) return cached;
    const p: Promise<string> = this.deps.synthesize(this.pieces[i]).then(url => {
      // The text changed, or the view closed, while it was coming.
      if (this.cache.get(i) !== p) { this.deps.revoke(url); throw new Error('no longer needed'); }
      this.urls.push(url);
      return url;
    });
    // A failed piece is asked for again next time.
    p.catch(() => { if (this.cache.get(i) === p) this.cache.delete(i); });
    this.cache.set(i, p);
    return p;
  }

  private watch(audio: AudioLike, run: number, i: number) {
    audio.onended = () => { if (run === this.run) this.playFrom(i + 1); };
    audio.onerror = () => { if (run === this.run) this.aiFailed(new Error('the audio could not be played'), i); };
  }

  private aiFailed(error: unknown, i: number) {
    this.deps.onAiFailed(error);
    this.voice = 'device';
    this.playFrom(i);
  }

  private playFrom(i: number): void {
    this.halt();
    if (i >= this.pieces.length || i < 0) {
      this.index = 0;
      this.status = 'idle';
      this.emit();
      return;
    }
    this.index = i;
    const run = this.run;
    if (this.voice === 'device') {
      this.status = 'playing';
      this.emit();
      this.deps.speak(this.pieces[i], () => { if (run === this.run) this.playFrom(i + 1); }, () => {
        if (run !== this.run) return;
        this.status = 'paused';
        this.emit();
      });
      return;
    }
    this.status = 'loading';
    this.emit();
    this.urlFor(i)!.then(url => {
      if (run !== this.run) return;
      const audio = this.audio || (this.audio = this.deps.newAudio());
      this.watch(audio, run, i);
      audio.src = url;
      audio.playbackRate = this.deps.audioRate?.() || 1;
      this.audioReady = true;
      this.status = 'playing';
      this.emit();
      audio.play().catch(() => {
        // The browser would not play without a tap: wait for one.
        if (run !== this.run) return;
        this.status = 'paused';
        this.emit();
      });
      this.urlFor(i + 1)?.catch(() => undefined);
    }, error => {
      if (run !== this.run) return;
      this.aiFailed(error, i);
    });
  }
}
