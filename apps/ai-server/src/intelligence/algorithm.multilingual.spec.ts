/**
 * Multilingual coverage for AlgorithmService routing heuristics.
 *
 * The search/thinking feature detection and query-type/language analysis must
 * work for all four supported UI languages (en/ko/zh/ja), not just Korean and
 * English. This pins that contract so the zh/ja keyword coverage cannot silently
 * regress. `shouldEnableFeatures` computes its result synchronously from the
 * pattern lists (the GlobalLearning lookup is fire-and-forget), so a stubbed
 * service is sufficient.
 */
import { AlgorithmService } from './algorithm.service';

function makeService(): AlgorithmService {
  const stubAdapter = {} as never;
  const stubGlobalLearning = {
    findMatchingAction: async () => ({ action: 'none', confidence: 0 }),
  } as never;
  const stubRedis = { isReady: () => false } as never;
  return new AlgorithmService(stubAdapter, stubGlobalLearning, stubRedis);
}

describe('AlgorithmService — multilingual routing', () => {
  let svc: AlgorithmService;
  beforeEach(() => {
    svc = makeService();
  });

  describe('shouldEnableFeatures: web search intent in every language', () => {
    const searchQueries: Record<string, string> = {
      en: 'what is the latest news today',
      ko: '오늘 날씨 어때',
      ja: '今日の天気はどう',
      zh: '今天天气怎么样',
    };
    for (const [lang, query] of Object.entries(searchQueries)) {
      it(`enables search for ${lang}: "${query}"`, () => {
        expect(svc.shouldEnableFeatures(query).enableSearch).toBe(true);
      });
    }
  });

  describe('shouldEnableFeatures: thinking intent in every language', () => {
    const thinkingQueries: Record<string, string> = {
      en: 'analyze this algorithm and explain the architecture',
      ko: '이 코드의 버그를 분석해줘',
      ja: 'このアルゴリズムを説明して',
      zh: '帮我分析这段代码的错误',
    };
    for (const [lang, query] of Object.entries(thinkingQueries)) {
      it(`enables thinking for ${lang}: "${query}"`, () => {
        expect(svc.shouldEnableFeatures(query).enableThinking).toBe(true);
      });
    }
  });

  it('does not over-trigger on a neutral greeting (no search/thinking)', () => {
    const rec = svc.shouldEnableFeatures('안녕');
    expect(rec.enableSearch).toBe(false);
    expect(rec.enableThinking).toBe(false);
  });
});
