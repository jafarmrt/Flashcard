import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiModels, geminiUsage, openAiModels, openAiUsage } from '../server/aiModels';
import { contextLabel, dollars, filterModels } from '../services/aiModels';
import { periodOf, tokensByModel, tokensByPeriod, type UsageRow } from '../services/usageLog';

test('Gemini list keeps only text models, without the "models/" prefix', () => {
  const models = geminiModels({ models: [
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
  ] });
  assert.deepEqual(models, [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', context: 1048576 }]);
  assert.deepEqual(geminiModels({}), []);
});

test('OpenRouter list: prices per million tokens, free ones marked, image-only models left out', () => {
  const models = openAiModels({ data: [
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', context_length: 1048576, pricing: { prompt: '0.0000003', completion: '0.0000012' }, architecture: { output_modalities: ['text'] } },
    { id: 'nvidia/nemotron-3-ultra:free', name: 'Nemotron (free)', context_length: 262144, pricing: { prompt: '0', completion: '0' } },
    { id: 'some/image-maker', pricing: { prompt: '0.000001', completion: '0' }, architecture: { output_modalities: ['image'] } },
  ] });
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', context: 1048576, priceIn: 0.3, priceOut: 1.2 });
  assert.equal(models[1].free, true);
  // Groq and others: only ids.
  assert.deepEqual(openAiModels({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile', object: 'model', context_window: 131072 }] }),
    [{ id: 'llama-3.3-70b-versatile', context: 131072 }]);
});

test('tokens of an answer: Gemini counts thinking as output; OpenRouter adds the cost', () => {
  assert.deepEqual(geminiUsage({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 50, totalTokenCount: 200 } }), { input: 120, output: 80 });
  assert.equal(geminiUsage({}), undefined);
  assert.deepEqual(openAiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { input: 10, output: 5 });
  assert.deepEqual(openAiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00002 } }), { input: 10, output: 5, cost: 0.00002 });
  assert.equal(openAiUsage({ usage: { prompt_tokens: 0, completion_tokens: 0 } }), undefined);
});

test('model search, context and price labels', () => {
  const models = [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }, { id: 'x/free-one:free', free: true }, { id: 'google/gemini-3.8-flash' }];
  assert.deepEqual(filterModels(models, 'flash').map(m => m.id), ['deepseek/deepseek-v4.1-flash', 'google/gemini-3.8-flash']);
  assert.deepEqual(filterModels(models, 'DeepSeek v4').map(m => m.id), ['deepseek/deepseek-v4.1-flash']);
  assert.deepEqual(filterModels(models, '', true).map(m => m.id), ['x/free-one:free']);
  assert.equal(contextLabel(1048576), '1M');
  assert.equal(contextLabel(131072), '131K');
  assert.equal(dollars(0.3), '$0.3');
  assert.equal(dollars(2.5), '$2.50');
  assert.equal(dollars(0.000012), '<$0.0001');
});

test('periods: weeks start on Saturday, months follow the Persian calendar', () => {
  assert.equal(periodOf('2026-10-10', 'day'), '2026-10-10');
  assert.equal(periodOf('2026-10-10', 'week'), '2026-10-10'); // a Saturday
  assert.equal(periodOf('2026-10-16', 'week'), '2026-10-10'); // the Friday after
  assert.equal(periodOf('2026-10-09', 'week'), '2026-10-03');
  assert.equal(periodOf('2026-10-10', 'month'), '1405-07'); // 18 Mehr 1405
  assert.equal(periodOf('2026-09-22', 'month'), '1405-06'); // 31 Shahrivar
  assert.equal(periodOf('2026-09-23', 'month'), '1405-07'); // 1 Mehr
});

const row = (day: string, extra: Partial<UsageRow>): UsageRow => ({ day, at: `${day}T10:00:00Z`, service: 'OpenRouter', task: 'extract', ok: true, ...extra });

test('token report adds up AI requests per period and per model, without the dictionaries', () => {
  const rows: UsageRow[] = [
    row('2026-10-10', { model: 'deepseek/deepseek-v4.1-flash', tokensIn: 1000, tokensOut: 200, cost: 0.0005 }),
    row('2026-10-10', { model: 'deepseek/deepseek-v4.1-flash', tokensIn: 500, tokensOut: 100, cost: 0.0002 }),
    row('2026-10-09', { service: 'Gemini', model: 'gemini-3.8-flash', tokensIn: 300, tokensOut: 50 }),
    row('2026-10-09', { service: 'Gemini', model: 'gemini-3.8-flash', ok: false, status: 429 }),
    row('2026-10-08', { service: 'Groq' }), // before token counts were kept
    row('2026-10-10', { service: 'dictionary', task: 'lookup', chars: 5 }),
  ];
  const days = tokensByPeriod(rows, 'day', '2026-10-10', 3);
  assert.deepEqual(days.map(d => [d.key, d.requests, d.failed, d.tokensIn, d.tokensOut, d.priced, d.untracked]), [
    ['2026-10-10', 2, 0, 1500, 300, 2, 0],
    ['2026-10-09', 1, 1, 300, 50, 0, 0],
    ['2026-10-08', 1, 0, 0, 0, 0, 1],
  ]);
  assert.ok(Math.abs(days[0].cost - 0.0007) < 1e-12);

  const weeks = tokensByPeriod(rows, 'week', '2026-10-10', 2);
  assert.deepEqual(weeks.map(w => [w.key, w.from, w.requests, w.tokensIn]), [['2026-10-10', '2026-10-10', 2, 1500], ['2026-10-03', '2026-10-03', 2, 300]]);

  const months = tokensByPeriod(rows, 'month', '2026-10-10', 2);
  assert.deepEqual(months.map(m => [m.key, m.from, m.requests]), [['1405-07', '2026-09-23', 4], ['1405-06', '2026-08-23', 0]]);

  const models = tokensByModel(rows, '2026-10-09');
  assert.deepEqual(models.map(m => [m.service, m.model, m.requests, m.failed, m.tokensIn + m.tokensOut]), [
    ['OpenRouter', 'deepseek/deepseek-v4.1-flash', 2, 0, 1800],
    ['Gemini', 'gemini-3.8-flash', 1, 1, 350],
  ]);
});
