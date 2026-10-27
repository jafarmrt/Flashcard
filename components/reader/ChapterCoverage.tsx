import React, { useEffect, useMemo, useState } from 'react';
import type { Flashcard } from '../../types';
import { callProxy } from '../../services/apiService';
import { buildProfile, coverageOf, knownByTerms, savedProfile, saveProfile, VERDICT_TEXT, type BookProfile } from '../../services/coverage';
import { fa } from '../common/ui';

interface ChapterCoverageProps {
  chapterId: string;
  loadTexts: () => Promise<string[]>;
  cards: Flashcard[];
  knownTerms: string[];
  userLevel?: string;
  label?: string; // "the next chapter"
}

// How much of a chapter the reader already knows, before starting it: by
// level, by the cards that have grown and by the "I know it" list. Measured
// once per chapter (one frequency request) and kept on the device.
export const ChapterCoverage: React.FC<ChapterCoverageProps> = ({ chapterId, loadTexts, cards, knownTerms, userLevel, label = 'فصل بعد' }) => {
  const key = `chapter:${chapterId}`;
  const [profile, setProfile] = useState<BookProfile | null>(() => savedProfile(key));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (profile) return;
    let live = true;
    loadTexts()
      .then(texts => buildProfile(texts, async words => (await callProxy('word-frequencies', { words })).frequencies || {}))
      .then(p => { if (!live) return; saveProfile(key, p); setProfile(p); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);
  const known = useMemo(() => knownByTerms(cards, new Set(knownTerms)), [cards, knownTerms]);
  const coverage = useMemo(() => (profile ? coverageOf(profile, userLevel, known) : null), [profile, userLevel, known]);
  if (failed) return null;
  if (!coverage) return <p className="text-sm opacity-60" role="status">در حال سنجیدن واژه‌های {label}…</p>;
  return (
    <div className="w-full rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] px-4 py-3 flex flex-col gap-1 text-center">
      <p className="font-bold">{fa(Math.round(coverage.percent))}٪ واژه‌های {label} را می‌شناسی</p>
      <p className="text-sm opacity-75">{VERDICT_TEXT[coverage.verdict]} حدود {fa(coverage.unknownPer300)} واژهٔ ناآشنا در هر بخش.</p>
    </div>
  );
};
