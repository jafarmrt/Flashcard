// File: /services/wordThemes.ts
// Multi-dimensional thematic bundles ("بسته‌های موضوعی") that group vocabulary
// across books without moving cards out of their book decks, plus:
//   1. scene-role grouping (nouns, verbs, modifiers, phrases) inside a bundle;
//   2. human-approved batch and single-card AI theme proposals;
//   3. cohesive micro-story cloze passages weaving 4-7 bundle words together
//      (with an offline book-sentence fallback);
//   4. contrastive nuance drills pairing close/confusable words in a bundle;
//   5. persistent saving & replay of generated exercises + two-layer anti-repetition
//      (unseen word/pair prioritization + prompt history exclusion).

import type {
  Flashcard,
  PracticeAnswer,
  SavedContrastUnit,
  SavedMicroStory,
  SavedStorySegment,
  SavedThemeExercise,
} from '../types';
import type { CardPlace } from './library';
import type { AiRequestOptions } from './geminiService';
import { parseJsonFromAiResponse } from './geminiService';
import { aiGenerate } from './aiClient';
import { clozeFor } from './cloze';
import { isDue, isNewCard } from './srsService';

export const THEME_BATCH_SIZE = 20;
export const MAX_THEME_LEN = 40;

export const STARTER_THEMES = [
  'جنگل و طبیعت',
  'حیوانات',
  'تاریخی',
  'سفر و دریا',
  'احساسات و منش',
  'خانه و شهر',
  'علم و اندیشه',
  'گفت‌وگو و لحن',
] as const;

export type SceneRole = 'nouns' | 'verbs' | 'modifiers' | 'phrases';

export const SCENE_ROLE_LABELS: Record<SceneRole, string> = {
  nouns: 'نام‌ها و اجزای صحنه',
  verbs: 'کنش‌ها و فعل‌ها',
  modifiers: 'ویژگی‌ها و حالت‌ها',
  phrases: 'عبارت‌ها و اصطلاح‌ها',
};

export const SCENE_ROLE_SHORT: Record<SceneRole, string> = {
  nouns: 'نام',
  verbs: 'فعل',
  modifiers: 'توصیف',
  phrases: 'عبارت',
};

const themeKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

export const normalizeThemeName = (raw: string): string =>
  raw.trim().replace(/^#+\s*/, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_THEME_LEN);

export const normalizeThemes = (list: readonly string[] | undefined): string[] => {
  if (!list || list.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const clean = normalizeThemeName(String(item || ''));
    if (!clean) continue;
    const key = themeKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
};

export const sameTheme = (a: string, b: string): boolean => {
  const ka = themeKey(normalizeThemeName(a));
  const kb = themeKey(normalizeThemeName(b));
  return !!ka && ka === kb;
};

export const cardHasTheme = (card: Pick<Flashcard, 'themes'>, theme: string): boolean =>
  (card.themes || []).some(t => sameTheme(t, theme));

export const withCardThemes = (card: Flashcard, themes: readonly string[], nowIso: string): Flashcard => {
  const clean = normalizeThemes(themes);
  const next: Flashcard = { ...card, updatedAt: nowIso };
  if (clean.length > 0) next.themes = clean;
  else delete next.themes;
  return next;
};

// Classifies a word's role in a mental scene so bundles read like a picture
// (objects, actions, qualities, expressions) rather than a flat list.
export const wordRoleOf = (card: Pick<Flashcard, 'front' | 'kind' | 'partOfSpeech'>): SceneRole => {
  const kind = card.kind || 'word';
  if (kind === 'phrase' || kind === 'collocation' || kind === 'idiom' || kind === 'expression' || kind === 'slang') {
    return 'phrases';
  }
  const pos = (card.partOfSpeech || '').toLowerCase();
  if (/\b(phrasal|idiom|phrase|expression)\b/.test(pos) || card.front.trim().split(/\s+/).length >= 3) {
    return 'phrases';
  }
  if (/\b(verb|v\.)/.test(pos)) return 'verbs';
  if (/\b(adj|adjective|adv|adverb)\b/.test(pos)) return 'modifiers';
  return 'nouns';
};

export interface ThemeSummary {
  name: string;
  cardCount: number;
  dueCount: number;
  roles: Record<SceneRole, number>;
  previewWords: string[];
}

export const themeSummaries = (
  cards: Flashcard[],
  savedThemes: readonly string[] = [],
  now: Date = new Date(),
): ThemeSummary[] => {
  const live = cards.filter(c => !c.isDeleted && c.kind !== 'grammar');
  const canonicalByKey = new Map<string, string>();
  const buckets = new Map<string, Flashcard[]>();

  for (const saved of normalizeThemes(savedThemes)) {
    const key = themeKey(saved);
    canonicalByKey.set(key, saved);
    buckets.set(key, []);
  }
  for (const card of live) {
    for (const raw of normalizeThemes(card.themes)) {
      const key = themeKey(raw);
      if (!canonicalByKey.has(key)) canonicalByKey.set(key, raw);
      const list = buckets.get(key) || [];
      list.push(card);
      buckets.set(key, list);
    }
  }

  const summaries: ThemeSummary[] = [];
  for (const [key, list] of buckets.entries()) {
    const roles: Record<SceneRole, number> = { nouns: 0, verbs: 0, modifiers: 0, phrases: 0 };
    let dueCount = 0;
    for (const card of list) {
      roles[wordRoleOf(card)]++;
      if (isDue(card, now)) dueCount++;
    }
    summaries.push({
      name: canonicalByKey.get(key)!,
      cardCount: list.length,
      dueCount,
      roles,
      previewWords: list.slice(0, 4).map(c => c.front.trim()),
    });
  }

  return summaries.sort((a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name, 'fa'));
};

// Renames (or merges) a theme across all live cards; returns only modified cards.
export const renameThemeInCards = (cards: Flashcard[], from: string, to: string, nowIso: string): Flashcard[] => {
  const cleanTo = normalizeThemeName(to);
  if (!cleanTo || sameTheme(from, cleanTo)) return [];
  const changed: Flashcard[] = [];
  for (const card of cards) {
    if (card.isDeleted || !cardHasTheme(card, from)) continue;
    const nextThemes = (card.themes || []).map(t => (sameTheme(t, from) ? cleanTo : t));
    changed.push(withCardThemes(card, nextThemes, nowIso));
  }
  return changed;
};

// Removes a theme tag from all cards that carry it without deleting the cards.
export const removeThemeFromCards = (cards: Flashcard[], theme: string, nowIso: string): Flashcard[] => {
  const changed: Flashcard[] = [];
  for (const card of cards) {
    if (card.isDeleted || !cardHasTheme(card, theme)) continue;
    const nextThemes = (card.themes || []).filter(t => !sameTheme(t, theme));
    changed.push(withCardThemes(card, nextThemes, nowIso));
  }
  return changed;
};

// Updates membership of `theme` so exactly `memberIds` carry it; returns only modified cards.
export const setThemeMembership = (
  cards: Flashcard[],
  theme: string,
  memberIds: ReadonlySet<string>,
  nowIso: string,
): Flashcard[] => {
  const clean = normalizeThemeName(theme);
  if (!clean) return [];
  const changed: Flashcard[] = [];
  for (const card of cards) {
    if (card.isDeleted) continue;
    const has = cardHasTheme(card, clean);
    const wants = memberIds.has(card.id);
    if (has === wants) continue;
    const nextThemes = wants
      ? [...(card.themes || []), clean]
      : (card.themes || []).filter(t => !sameTheme(t, clean));
    changed.push(withCardThemes(card, nextThemes, nowIso));
  }
  return changed;
};

// --- AI Batch & Single-Card Theme Proposals ---

export interface CardThemeProposal {
  cardId: string;
  themes: string[];
}

export const buildBatchThemePrompt = (
  cards: Pick<Flashcard, 'front' | 'back' | 'partOfSpeech'>[],
  existingThemes: readonly string[] = [],
  guideThemes: readonly string[] = [],
): string => {
  const known = normalizeThemes([...guideThemes, ...existingThemes]);
  return `You organize English vocabulary flashcards into memorable Persian thematic bundles ("بسته‌های موضوعی") for a native Persian speaker.
Group words by concrete mental scenes, domains, or conceptual worlds (for example: "جنگل و طبیعت", "حیوانات", "تاریخی", "سفر و دریا", "احساسات و منش", "حقوق و سیاست", "پزشکی و بدن", "خانه و شهر", "نور و صدا").

Rules:
- Give each numbered item 1 or 2 short Persian bundle names (1 to 3 words each).
- Reuse an existing bundle name whenever it fits well instead of inventing near-duplicates.${known.length ? `\n- Existing / preferred bundles: ${known.map(t => JSON.stringify(t)).join(', ')}` : ''}
- Avoid vague catch-all labels like "واژه‌های عمومی" or "متفرقه"; if a word is abstract, place it in a clear conceptual theme like "استدلال و اندیشه" or "تغییر و زمان".
- Return ONLY one JSON object: {"items": [{"index": 1, "themes": ["بسته اول"]}]}.

Words:
${cards.map((c, i) => `${i + 1}. ${JSON.stringify(c.front)}${c.partOfSpeech ? ` (${c.partOfSpeech})` : ''} — ${JSON.stringify(c.back)}`).join('\n')}`;
};

export const parseBatchThemeReply = (
  raw: unknown,
  cards: Pick<Flashcard, 'id'>[],
): CardThemeProposal[] => {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.items) ? obj.items : Array.isArray(raw) ? raw : [];
  if (list.length === 0 || cards.length === 0) return [];

  const nums = list.map((item: any) => Number(item?.index));
  const zeroBased = nums.some(n => n === 0) && !nums.some(n => n === cards.length);
  const out: CardThemeProposal[] = [];
  const seen = new Set<string>();

  list.forEach((item: any, order: number) => {
    const n = Number(item?.index);
    const idx = Number.isInteger(n) ? (zeroBased ? n : n - 1) : (list.length === cards.length ? order : -1);
    if (idx < 0 || idx >= cards.length) return;
    const cardId = cards[idx].id;
    if (seen.has(cardId)) return;
    const themes = normalizeThemes(
      Array.isArray(item?.themes)
        ? item.themes
        : typeof item?.theme === 'string'
          ? [item.theme]
          : [],
    ).slice(0, 3);
    if (themes.length === 0) return;
    seen.add(cardId);
    out.push({ cardId, themes });
  });

  return out;
};

export const suggestThemesBatch = async (
  cards: Flashcard[],
  existingThemes: readonly string[],
  guideThemes: readonly string[],
  options?: AiRequestOptions,
): Promise<CardThemeProposal[]> => {
  if (cards.length === 0) return [];
  const prompt = buildBatchThemePrompt(cards, existingThemes, guideThemes);
  const reply = await aiGenerate(options, { contents: prompt }, 'details');
  const parsed = parseJsonFromAiResponse(reply.text);
  return parseBatchThemeReply(parsed, cards);
};

export const suggestThemesForCard = async (
  card: Pick<Flashcard, 'front' | 'back' | 'partOfSpeech' | 'sourceSentence'>,
  existingThemes: readonly string[],
  options?: AiRequestOptions,
): Promise<string[]> => {
  const known = normalizeThemes(existingThemes);
  const prompt = `Suggest up to 3 short Persian thematic bundle names (1-3 words each, such as "جنگل و طبیعت", "حیوانات", "تاریخی") that help remember this English term in a mental scene.
Term: ${JSON.stringify(card.front)}${card.partOfSpeech ? ` (${card.partOfSpeech})` : ''}
Meaning: ${JSON.stringify(card.back)}${card.sourceSentence ? `\nSentence: ${JSON.stringify(card.sourceSentence)}` : ''}${known.length ? `\nReuse from existing bundles when fitting: ${known.map(t => JSON.stringify(t)).join(', ')}` : ''}
Return ONLY JSON: {"themes": ["..."]}`;
  const reply = await aiGenerate(options, { contents: prompt }, 'details');
  const parsed = parseJsonFromAiResponse(reply.text) as { themes?: string[] } | null;
  return normalizeThemes(parsed?.themes).slice(0, 3);
};

// --- Saved Exercises & Anti-Repetition Helpers ---

export type StorySegment = SavedStorySegment;
export type MicroStoryData = SavedMicroStory;

const sameWord = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const savedExercisesForTheme = (
  exercises: readonly SavedThemeExercise[] | undefined,
  themeName: string,
  kind?: 'story' | 'contrast',
): SavedThemeExercise[] =>
  (exercises || [])
    .filter(
      e =>
        !e.isDeleted &&
        sameTheme(e.themeName, themeName) &&
        (!kind || e.kind === kind),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const renameThemeInExercises = (
  exercises: readonly SavedThemeExercise[],
  from: string,
  to: string,
  nowIso: string,
): SavedThemeExercise[] => {
  const cleanTo = normalizeThemeName(to);
  if (!cleanTo || sameTheme(from, cleanTo)) return [];
  const changed: SavedThemeExercise[] = [];
  for (const ex of exercises) {
    if (ex.isDeleted || !sameTheme(ex.themeName, from)) continue;
    changed.push({ ...ex, themeName: cleanTo, updatedAt: nowIso });
  }
  return changed;
};

export const storyPlainExcerpt = (story: MicroStoryData, maxChars = 140): string => {
  const full = story.segments
    .map(seg => (seg.kind === 'text' ? seg.text : seg.surface))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return full.length <= maxChars ? full : `${full.slice(0, maxChars).trim()}…`;
};

export const makeSavedStoryExercise = (
  themeName: string,
  story: MicroStoryData,
  nowIso: string,
  id: string = crypto.randomUUID(),
): SavedThemeExercise => ({
  id,
  themeName: normalizeThemeName(themeName),
  kind: 'story',
  titleFa: story.titleFa,
  cardIds: Array.from(new Set(story.blanks.map(b => b.cardId))),
  targetWords: Array.from(new Set(story.blanks.map(b => b.targetWord))),
  story,
  playCount: 1,
  lastPlayedAt: nowIso,
  createdAt: nowIso,
  updatedAt: nowIso,
});

export const markThemeExercisePlayed = (
  exercise: SavedThemeExercise,
  nowIso: string,
): SavedThemeExercise => ({
  ...exercise,
  playCount: (exercise.playCount || 0) + 1,
  lastPlayedAt: nowIso,
  updatedAt: nowIso,
});

export const hasUncoveredStoryWords = (
  bundleCards: readonly Flashcard[],
  savedStories: readonly SavedThemeExercise[],
): boolean => {
  const usedWords = new Set<string>();
  const usedIds = new Set<string>();
  for (const ex of savedStories) {
    if (ex.isDeleted || ex.kind !== 'story') continue;
    for (const id of ex.cardIds || []) usedIds.add(id);
    for (const w of ex.targetWords || []) usedWords.add(w.trim().toLowerCase());
  }
  return bundleCards.some(
    c =>
      !c.isDeleted &&
      c.kind !== 'grammar' &&
      c.front.trim() &&
      !usedIds.has(c.id) &&
      !usedWords.has(c.front.trim().toLowerCase()),
  );
};

// --- Micro-Story Cloze Engine ("داستانک هم‌بافت") ---

export const pickStoryCards = (
  bundleCards: Flashcard[],
  count = 5,
  now: Date = new Date(),
  excludeIds: ReadonlySet<string> = new Set(),
  savedStories: readonly SavedThemeExercise[] = [],
): Flashcard[] => {
  const pool = bundleCards.filter(
    c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim(),
  );
  if (pool.length === 0) return [];

  // Count how many saved stories already featured each card or headword so
  // fresh, unpractised words in the bundle are woven into new stories first.
  const usageByCard = new Map<string, number>();
  const usageByWord = new Map<string, number>();
  const priorSets: Set<string>[] = [];

  for (const ex of savedStories) {
    if (ex.isDeleted || ex.kind !== 'story') continue;
    for (const id of ex.cardIds || []) {
      usageByCard.set(id, (usageByCard.get(id) || 0) + 1);
    }
    const wordSet = new Set<string>();
    for (const w of ex.targetWords || []) {
      const k = w.trim().toLowerCase();
      if (!k) continue;
      wordSet.add(k);
      usageByWord.set(k, (usageByWord.get(k) || 0) + 1);
    }
    if (wordSet.size > 0) priorSets.push(wordSet);
  }

  const usageScore = (c: Flashcard): number =>
    Math.max(
      usageByCard.get(c.id) || 0,
      usageByWord.get(c.front.trim().toLowerCase()) || 0,
    );

  const freshPool = pool.filter(c => !excludeIds.has(c.id));
  const source = freshPool.length >= Math.min(3, pool.length) ? freshPool : pool;

  const ranked = [...source].sort((a, b) => {
    const usageDiff = usageScore(a) - usageScore(b);
    if (usageDiff !== 0) return usageDiff;
    const dueDiff = Number(isDue(b, now)) - Number(isDue(a, now));
    if (dueDiff !== 0) return dueDiff;
    const newDiff = Number(!isNewCard(b)) - Number(!isNewCard(a));
    if (newDiff !== 0) return newDiff;
    return (a.stability ?? a.interval ?? 0) - (b.stability ?? b.interval ?? 0);
  });

  const picked: Flashcard[] = [];
  for (const card of ranked) {
    if (picked.some(p => sameWord(p.front, card.front))) continue;
    picked.push(card);
    if (picked.length >= count) break;
  }

  // If the picked word combination exactly matches an earlier saved story and
  // other distinct words exist in the pool, swap the last word to vary the mix.
  if (picked.length >= 2 && pool.length > picked.length && priorSets.length > 0) {
    const pickedKeySet = new Set(picked.map(c => c.front.trim().toLowerCase()));
    const exactRepeat = priorSets.some(
      s => s.size === pickedKeySet.size && Array.from(pickedKeySet).every(w => s.has(w)),
    );
    if (exactRepeat) {
      const alternate = pool.find(
        c => !picked.some(p => sameWord(p.front, c.front)),
      );
      if (alternate) {
        picked[picked.length - 1] = alternate;
      }
    }
  }

  return picked;
};

export const buildMicroStoryPrompt = (
  themeName: string,
  cards: Pick<Flashcard, 'front' | 'back' | 'partOfSpeech'>[],
  userLevel = 'B1-B2',
  previousStories: readonly SavedThemeExercise[] = [],
): string => {
  const recent = previousStories
    .filter(e => !e.isDeleted && e.kind === 'story' && e.story)
    .slice(0, 6);

  const avoidBlock =
    recent.length > 0
      ? `\nPreviously generated stories in this bundle (DO NOT repeat or imitate their titles, settings, plots, or sentences — invent a distinctly different scene, time, character, or perspective within "${themeName}"):\n${recent
          .map(
            (e, idx) =>
              `- Story ${idx + 1}: "${e.titleFa}" — ${storyPlainExcerpt(e.story!, 110)}`,
          )
          .join('\n')}\n`
      : '';

  return `Write a vivid, cohesive short English scene (80 to 130 words, CEFR ${userLevel}) set in the theme "${themeName}" for a Persian learner.
Weave EVERY target word below naturally into ONE connected micro-story so the learner pictures them together in a single scene.
Wrap the FIRST occurrence of each target word in double brackets as [[base_word|surface_form_in_sentence]], for example [[prowl|prowled]] or [[canopy|canopy]].
${avoidBlock}
Target words:
${cards.map((c, i) => `${i + 1}. ${c.front.trim()}${c.partOfSpeech ? ` (${c.partOfSpeech})` : ''} — meaning: ${c.back.trim()}`).join('\n')}

Return ONLY one JSON object:
{
  "titleFa": "یک عنوان کوتاه و خوش‌آهنگ فارسی برای این صحنه",
  "story": "The English micro-story containing [[base_word|surface]] markers...",
  "translationFa": "ترجمهٔ روان و طبیعی کل داستانک به فارسی"
}`;
};

const shuffleDeterministic = <T,>(items: T[], seed = 0): T[] => {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Turns a marked story ("... under the [[canopy|canopy]] ...") into interactive
// text and blank segments, and also catches any target word the model forgot to
// wrap in [[...]] using clozeFor.
export const parseMicroStory = (
  raw: { titleFa?: string; story?: string; translationFa?: string } | null | undefined,
  themeName: string,
  cards: Flashcard[],
): MicroStoryData | null => {
  const storyText = typeof raw?.story === 'string' ? raw.story.trim() : '';
  if (!storyText || cards.length === 0) return null;

  const byFront = new Map(cards.map(c => [c.front.trim().toLowerCase(), c]));
  const usedCardIds = new Set<string>();
  const rawParts: ({ kind: 'text'; text: string } | { kind: 'hit'; card: Flashcard; surface: string })[] = [];

  const marker = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(storyText)) !== null) {
    if (match.index > lastIndex) {
      rawParts.push({ kind: 'text', text: storyText.slice(lastIndex, match.index) });
    }
    const base = match[1].trim();
    const surface = (match[2] || match[1]).trim();
    const card = byFront.get(base.toLowerCase()) || cards.find(c => sameWord(c.front, surface));
    if (card && !usedCardIds.has(card.id)) {
      usedCardIds.add(card.id);
      rawParts.push({ kind: 'hit', card, surface });
    } else {
      rawParts.push({ kind: 'text', text: surface });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < storyText.length) {
    rawParts.push({ kind: 'text', text: storyText.slice(lastIndex) });
  }

  // Catch any target card not wrapped in [[...]] inside plain text segments.
  for (const card of cards) {
    if (usedCardIds.has(card.id)) continue;
    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i];
      if (part.kind !== 'text') continue;
      const found = clozeFor({ ...card, sourceSentence: undefined, exampleSentenceTarget: [part.text] }, []);
      if (!found) continue;
      usedCardIds.add(card.id);
      const nextParts: typeof rawParts = [];
      if (found.before) nextParts.push({ kind: 'text', text: found.before });
      nextParts.push({ kind: 'hit', card, surface: found.answer });
      if (found.after) nextParts.push({ kind: 'text', text: found.after });
      rawParts.splice(i, 1, ...nextParts);
      break;
    }
  }

  const blanks: Extract<StorySegment, { kind: 'blank' }>[] = [];
  const segments: StorySegment[] = [];
  for (const part of rawParts) {
    if (part.kind === 'text') {
      if (part.text) segments.push({ kind: 'text', text: part.text });
    } else {
      const blank: Extract<StorySegment, { kind: 'blank' }> = {
        kind: 'blank',
        blankIndex: blanks.length,
        cardId: part.card.id,
        targetWord: part.card.front.trim(),
        surface: part.surface,
        hintFa: part.card.back.trim(),
        ...(part.card.audioSrc ? { audioSrc: part.card.audioSrc } : {}),
      };
      blanks.push(blank);
      segments.push(blank);
    }
  }

  if (blanks.length === 0) return null;
  const seed = blanks.reduce((acc, b) => acc + b.targetWord.charCodeAt(0), blanks.length);
  return {
    titleFa: (raw?.titleFa || '').trim() || `صحنه‌ای از «${themeName}»`,
    segments,
    blanks,
    wordBank: shuffleDeterministic(blanks.map(b => b.targetWord), seed),
    ...(raw?.translationFa?.trim() ? { translationFa: raw.translationFa.trim() } : {}),
    byAi: true,
  };
};

// Offline / zero-key fallback: weaves the cards' own book or example sentences
// into a connected thematic passage so the practice always works.
export const offlineMicroStory = (
  themeName: string,
  cards: Flashcard[],
  places?: Map<string, CardPlace[]>,
): MicroStoryData | null => {
  if (cards.length === 0) return null;
  const segments: StorySegment[] = [];
  const blanks: Extract<StorySegment, { kind: 'blank' }>[] = [];

  for (const card of cards) {
    const bookSentences = (places?.get(card.id) || []).map(p => p.sentence).filter((s): s is string => !!s);
    const cloze = clozeFor(card, bookSentences);
    if (segments.length > 0) segments.push({ kind: 'text', text: ' ' });
    if (cloze) {
      if (cloze.before) segments.push({ kind: 'text', text: cloze.before });
      const blank: Extract<StorySegment, { kind: 'blank' }> = {
        kind: 'blank',
        blankIndex: blanks.length,
        cardId: card.id,
        targetWord: card.front.trim(),
        surface: cloze.answer,
        hintFa: card.back.trim(),
        ...(card.audioSrc ? { audioSrc: card.audioSrc } : {}),
      };
      blanks.push(blank);
      segments.push(blank);
      if (cloze.after) segments.push({ kind: 'text', text: cloze.after });
    } else {
      const blank: Extract<StorySegment, { kind: 'blank' }> = {
        kind: 'blank',
        blankIndex: blanks.length,
        cardId: card.id,
        targetWord: card.front.trim(),
        surface: card.front.trim(),
        hintFa: card.back.trim(),
        ...(card.audioSrc ? { audioSrc: card.audioSrc } : {}),
      };
      segments.push({ kind: 'text', text: `(${card.back.trim()}: ` });
      blanks.push(blank);
      segments.push(blank);
      segments.push({ kind: 'text', text: '.)' });
    }
  }

  if (blanks.length === 0) return null;
  const seed = blanks.reduce((acc, b) => acc + b.targetWord.charCodeAt(0), 7);
  return {
    titleFa: `مرور بافتیِ بستهٔ «${themeName}» (از جمله‌های خودت)`,
    segments,
    blanks,
    wordBank: shuffleDeterministic(blanks.map(b => b.targetWord), seed),
    byAi: false,
  };
};

export const generateMicroStory = async (
  themeName: string,
  cards: Flashcard[],
  places?: Map<string, CardPlace[]>,
  options?: AiRequestOptions,
  userLevel?: string,
  previousStories: readonly SavedThemeExercise[] = [],
): Promise<MicroStoryData | null> => {
  if (cards.length === 0) return null;
  try {
    const prompt = buildMicroStoryPrompt(themeName, cards, userLevel || 'B1-B2', previousStories);
    const reply = await aiGenerate(options, { contents: prompt }, 'practice');
    const parsed = parseJsonFromAiResponse(reply.text) as { titleFa?: string; story?: string; translationFa?: string } | null;
    const built = parseMicroStory(parsed, themeName, cards);
    if (built && built.blanks.length >= Math.min(2, cards.length)) return built;
  } catch {
    // Offline or no AI key: fall through to book-sentence story.
  }
  return offlineMicroStory(themeName, cards, places);
};

// --- Contrast & Nuance Drill Engine ("تفکیک واژه‌های نزدیک") ---

export interface ContrastSentenceBlank {
  before: string;
  after: string;
  answerWord: string;
  cardId: string;
}

export interface ContrastUnit {
  id: string;
  cardA: Flashcard;
  cardB: Flashcard;
  differenceFa: string; // concise Persian explanation of what sets A and B apart
  sentence1: ContrastSentenceBlank;
  sentence2: ContrastSentenceBlank;
  byAi: boolean;
}

const pairKeyByWords = (w1: string, w2: string): string =>
  [w1.trim().toLowerCase(), w2.trim().toLowerCase()].sort().join('|');

export const serializeContrastUnit = (unit: ContrastUnit): SavedContrastUnit => ({
  id: unit.id,
  cardAId: unit.cardA.id,
  cardBId: unit.cardB.id,
  wordA: unit.cardA.front.trim(),
  backA: unit.cardA.back.trim(),
  ...(unit.cardA.partOfSpeech ? { posA: unit.cardA.partOfSpeech } : {}),
  ...(unit.cardA.register ? { regA: unit.cardA.register } : {}),
  wordB: unit.cardB.front.trim(),
  backB: unit.cardB.back.trim(),
  ...(unit.cardB.partOfSpeech ? { posB: unit.cardB.partOfSpeech } : {}),
  ...(unit.cardB.register ? { regB: unit.cardB.register } : {}),
  differenceFa: unit.differenceFa,
  sentence1: unit.sentence1,
  sentence2: unit.sentence2,
  byAi: unit.byAi,
});

const fallbackFlashcard = (
  id: string,
  front: string,
  back: string,
  partOfSpeech?: string,
  register?: string,
): Flashcard => ({
  id,
  deckId: 'default',
  front,
  back,
  ...(partOfSpeech ? { partOfSpeech } : {}),
  ...(register ? { register } : {}),
  createdAt: '',
  updatedAt: '',
  repetition: 0,
  easinessFactor: 2.5,
  interval: 0,
  dueDate: '',
});

export const rehydrateContrastUnits = (
  savedUnits: readonly SavedContrastUnit[] | undefined,
  cards: readonly Flashcard[],
): ContrastUnit[] => {
  if (!savedUnits || savedUnits.length === 0) return [];
  const byId = new Map(cards.filter(c => !c.isDeleted).map(c => [c.id, c]));
  const byWord = new Map(cards.filter(c => !c.isDeleted).map(c => [c.front.trim().toLowerCase(), c]));
  return savedUnits.map(u => {
    const cardA =
      byId.get(u.cardAId) ||
      byWord.get(u.wordA.trim().toLowerCase()) ||
      fallbackFlashcard(u.cardAId, u.wordA, u.backA, u.posA, u.regA);
    const cardB =
      byId.get(u.cardBId) ||
      byWord.get(u.wordB.trim().toLowerCase()) ||
      fallbackFlashcard(u.cardBId, u.wordB, u.backB, u.posB, u.regB);
    return {
      id: u.id,
      cardA,
      cardB,
      differenceFa: u.differenceFa,
      sentence1: u.sentence1,
      sentence2: u.sentence2,
      byAi: u.byAi,
    };
  });
};

export const makeSavedContrastExercise = (
  themeName: string,
  units: readonly ContrastUnit[],
  nowIso: string,
  id: string = crypto.randomUUID(),
): SavedThemeExercise => {
  const pairLabels = units
    .slice(0, 3)
    .map(u => `${u.cardA.front.trim()} / ${u.cardB.front.trim()}`)
    .join(' · ');
  const cardIds = Array.from(new Set(units.flatMap(u => [u.cardA.id, u.cardB.id])));
  const targetWords = Array.from(
    new Set(units.flatMap(u => [u.cardA.front.trim(), u.cardB.front.trim()])),
  );
  return {
    id,
    themeName: normalizeThemeName(themeName),
    kind: 'contrast',
    titleFa: pairLabels ? `تفکیک: ${pairLabels}` : `تفکیک واژه‌های «${themeName}»`,
    cardIds,
    targetWords,
    contrastUnits: units.map(serializeContrastUnit),
    playCount: 1,
    lastPlayedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
};

export const hasUncoveredContrastPairs = (
  bundleCards: readonly Flashcard[],
  savedContrasts: readonly SavedThemeExercise[],
): boolean => {
  const words = bundleCards.filter(
    c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim(),
  );
  if (words.length < 2) return false;
  const coveredPairs = new Set<string>();
  for (const ex of savedContrasts) {
    if (ex.isDeleted || ex.kind !== 'contrast') continue;
    for (const u of ex.contrastUnits || []) {
      coveredPairs.add(pairKeyByWords(u.wordA, u.wordB));
    }
  }
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      if (sameWord(words[i].front, words[j].front)) continue;
      if (!coveredPairs.has(pairKeyByWords(words[i].front, words[j].front))) {
        return true;
      }
    }
  }
  return false;
};

// Pairs words inside a bundle that are most worth contrasting:
//   0. unseen pairs not yet drilled in saved contrast exercises come first;
//   1. words previously confused with each other in practice history;
//   2. words naming each other in their `synonyms` field;
//   3. words sharing the same scene role / part of speech or prefix.
export const pickContrastPairs = (
  bundleCards: Flashcard[],
  practice: readonly PracticeAnswer[] = [],
  maxPairs = 4,
  savedContrasts: readonly SavedThemeExercise[] = [],
): [Flashcard, Flashcard][] => {
  const words = bundleCards.filter(
    c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim(),
  );
  if (words.length < 2) return [];

  const seenPairCount = new Map<string, number>();
  for (const ex of savedContrasts) {
    if (ex.isDeleted || ex.kind !== 'contrast') continue;
    for (const u of ex.contrastUnits || []) {
      const k = pairKeyByWords(u.wordA, u.wordB);
      seenPairCount.set(k, (seenPairCount.get(k) || 0) + 1);
    }
  }

  const confusedCount = new Map<string, number>();
  const byLower = new Map(words.map(w => [w.front.trim().toLowerCase(), w.id]));
  for (const ans of practice) {
    if (ans.isDeleted || ans.right || !ans.chose) continue;
    const otherId = byLower.get(ans.chose.trim().toLowerCase());
    if (!otherId || otherId === ans.cardId) continue;
    const key = [ans.cardId, otherId].sort().join('|');
    confusedCount.set(key, (confusedCount.get(key) || 0) + 1);
  }

  const candidates: { a: Flashcard; b: Flashcard; score: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i];
      const b = words[j];
      if (sameWord(a.front, b.front)) continue;
      let score = 0;
      const key = [a.id, b.id].sort().join('|');
      const wKey = pairKeyByWords(a.front, b.front);
      score -= (seenPairCount.get(wKey) || 0) * 30;
      score += (confusedCount.get(key) || 0) * 10;
      if (
        (a.synonyms || []).some(s => sameWord(s.word, b.front)) ||
        (b.synonyms || []).some(s => sameWord(s.word, a.front))
      ) {
        score += 8;
      }
      if (wordRoleOf(a) === wordRoleOf(b)) score += 4;
      if (
        (a.partOfSpeech || '').toLowerCase() &&
        (a.partOfSpeech || '').toLowerCase() === (b.partOfSpeech || '').toLowerCase()
      ) {
        score += 3;
      }
      if (a.front.trim().slice(0, 3).toLowerCase() === b.front.trim().slice(0, 3).toLowerCase()) {
        score += 2;
      }
      candidates.push({ a, b, score });
    }
  }

  candidates.sort((x, y) => y.score - x.score);
  const used = new Set<string>();
  const pairs: [Flashcard, Flashcard][] = [];
  for (const item of candidates) {
    if (used.has(item.a.id) || used.has(item.b.id)) continue;
    used.add(item.a.id);
    used.add(item.b.id);
    pairs.push([item.a, item.b]);
    if (pairs.length >= maxPairs) break;
  }
  // If strict disjoint selection found only 1 pair in a small bundle of 3 cards, allow one shared card.
  if (pairs.length < maxPairs && candidates.length > pairs.length) {
    for (const item of candidates) {
      if (
        pairs.some(
          ([x, y]) =>
            (x.id === item.a.id && y.id === item.b.id) ||
            (x.id === item.b.id && y.id === item.a.id),
        )
      ) {
        continue;
      }
      pairs.push([item.a, item.b]);
      if (pairs.length >= maxPairs) break;
    }
  }
  return pairs;
};

const blankForCard = (
  card: Flashcard,
  places?: Map<string, CardPlace[]>,
  customSentence?: string,
): ContrastSentenceBlank => {
  if (customSentence) {
    const marker = /\[\[([^\]]+)\]\]/.exec(customSentence);
    if (marker) {
      return {
        before: customSentence.slice(0, marker.index),
        after: customSentence.slice(marker.index + marker[0].length),
        answerWord: card.front.trim(),
        cardId: card.id,
      };
    }
    const found = clozeFor({ ...card, sourceSentence: undefined, exampleSentenceTarget: [customSentence] }, []);
    if (found) {
      return {
        before: found.before,
        after: found.after,
        answerWord: card.front.trim(),
        cardId: card.id,
      };
    }
  }
  const bookSentences = (places?.get(card.id) || []).map(p => p.sentence).filter((s): s is string => !!s);
  const cloze = clozeFor(card, bookSentences);
  if (cloze) {
    return { before: cloze.before, after: cloze.after, answerWord: card.front.trim(), cardId: card.id };
  }
  return {
    before: `معنی «${card.back.trim()}»: `,
    after: '',
    answerWord: card.front.trim(),
    cardId: card.id,
  };
};

export const localContrastUnit = (
  cardA: Flashcard,
  cardB: Flashcard,
  places?: Map<string, CardPlace[]>,
  flipOrder = false,
): ContrastUnit => {
  const synNoteA = (cardA.synonyms || []).find(s => sameWord(s.word, cardB.front))?.note;
  const synNoteB = (cardB.synonyms || []).find(s => sameWord(s.word, cardA.front))?.note;
  const parts = [
    synNoteA || synNoteB,
    !synNoteA && !synNoteB
      ? `«${cardA.front}» یعنی «${cardA.back}»${cardA.register ? ` (${cardA.register})` : ''}، در حالی که «${cardB.front}» برای «${cardB.back}»${cardB.register ? ` (${cardB.register})` : ''} به کار می‌رود.`
      : '',
  ].filter(Boolean);

  const blankA = blankForCard(cardA, places);
  const blankB = blankForCard(cardB, places);
  return {
    id: `${cardA.id}:${cardB.id}`,
    cardA,
    cardB,
    differenceFa: parts.join(' — '),
    sentence1: flipOrder ? blankB : blankA,
    sentence2: flipOrder ? blankA : blankB,
    byAi: false,
  };
};

const reconstructBlankSentence = (b: ContrastSentenceBlank): string =>
  `${b.before}${b.answerWord}${b.after}`.replace(/\s+/g, ' ').trim();

export const buildContrastPrompt = (
  themeName: string,
  pairs: [Flashcard, Flashcard][],
  previousContrasts: readonly SavedThemeExercise[] = [],
): string => {
  const wantedWords = new Set(
    pairs.flatMap(([a, b]) => [a.front.trim().toLowerCase(), b.front.trim().toLowerCase()]),
  );
  const priorSentences: string[] = [];
  for (const ex of previousContrasts) {
    if (ex.isDeleted || ex.kind !== 'contrast') continue;
    for (const u of ex.contrastUnits || []) {
      if (
        wantedWords.has(u.wordA.trim().toLowerCase()) ||
        wantedWords.has(u.wordB.trim().toLowerCase())
      ) {
        const s1 = reconstructBlankSentence(u.sentence1);
        const s2 = reconstructBlankSentence(u.sentence2);
        if (s1 && !s1.startsWith('معنی «')) priorSentences.push(s1);
        if (s2 && !s2.startsWith('معنی «')) priorSentences.push(s2);
      }
    }
    if (priorSentences.length >= 10) break;
  }

  const avoidBlock =
    priorSentences.length > 0
      ? `\nPreviously used example sentences (DO NOT reuse or paraphrase these — write completely fresh contexts and situations):\n${Array.from(
          new Set(priorSentences),
        )
          .slice(0, 8)
          .map(s => `- ${s}`)
          .join('\n')}\n`
      : '';

  return `You help a Persian speaker distinguish pairs of English words inside the thematic bundle "${themeName}" so they never mix them up.
For each numbered pair (A and B):
1. Write "differenceFa": 1 or 2 clear, concrete Persian sentences explaining the exact difference in meaning, imagery, or usage between A and B.
2. Write "sentenceA": a natural English sentence where A fits clearly and B does NOT, wrapping A in [[double brackets]], e.g. "A narrow [[brook]] ran behind the cottage."
3. Write "sentenceB": a natural English sentence where B fits clearly and A does NOT, wrapping B in [[double brackets]].
${avoidBlock}
Pairs:
${pairs.map(([a, b], i) => `${i + 1}. A = ${JSON.stringify(a.front)} (${a.back}) vs B = ${JSON.stringify(b.front)} (${b.back})`).join('\n')}

Return ONLY JSON: {"items": [{"index": 1, "differenceFa": "...", "sentenceA": "...", "sentenceB": "..."}]}`;
};

export const generateContrastUnits = async (
  themeName: string,
  bundleCards: Flashcard[],
  places?: Map<string, CardPlace[]>,
  practice: readonly PracticeAnswer[] = [],
  options?: AiRequestOptions,
  savedContrasts: readonly SavedThemeExercise[] = [],
): Promise<ContrastUnit[]> => {
  const pairs = pickContrastPairs(bundleCards, practice, 4, savedContrasts);
  if (pairs.length === 0) return [];
  try {
    const reply = await aiGenerate(
      options,
      { contents: buildContrastPrompt(themeName, pairs, savedContrasts) },
      'practice',
    );
    const parsed = parseJsonFromAiResponse(reply.text) as { items?: any[] } | null;
    const list = Array.isArray(parsed?.items) ? parsed!.items : [];
    if (list.length > 0) {
      return pairs.map(([a, b], i) => {
        const item = list.find((x: any) => Number(x?.index) === i + 1) || list[i];
        const flip = i % 2 === 1;
        if (!item || typeof item.differenceFa !== 'string' || !item.differenceFa.trim()) {
          return localContrastUnit(a, b, places, flip);
        }
        const blankA = blankForCard(
          a,
          places,
          typeof item.sentenceA === 'string' ? item.sentenceA : undefined,
        );
        const blankB = blankForCard(
          b,
          places,
          typeof item.sentenceB === 'string' ? item.sentenceB : undefined,
        );
        return {
          id: `${a.id}:${b.id}`,
          cardA: a,
          cardB: b,
          differenceFa: item.differenceFa.trim(),
          sentence1: flip ? blankB : blankA,
          sentence2: flip ? blankA : blankB,
          byAi: true,
        };
      });
    }
  } catch {
    // Offline or no AI key: fall back to card-based contrast units.
  }
  return pairs.map(([a, b], i) => localContrastUnit(a, b, places, i % 2 === 1));
};
