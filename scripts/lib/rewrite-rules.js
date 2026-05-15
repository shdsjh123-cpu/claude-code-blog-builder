/**
 * quality-check.js 가 만든 hits[] 를 바탕으로 본문을 안전한 표현으로 치환합니다.
 *
 * 새로운 판단은 하지 않고, banned-words.json 의 replacements 매핑(또는
 * quality-check 의 replacementFor fallback)이 채워준 대체 표현을 그대로 적용합니다.
 *
 * 의미가 미세하게 변할 수 있으므로 반드시 호출자가 diff 를 사람에게 보여줘야 합니다.
 */

/**
 * 기본 활성 카테고리.
 *
 * 사용자 요구(법률대리 오인 / 불법 위치추적 / 개인정보 조회 / 과장광고)를
 * banned-words.template.json 의 카테고리로 매핑한 결과입니다.
 *
 * - domain_specific      : 위치추적·개인정보·통신내역·해킹·승소보장·변호사없이해결 등
 * - superlatives         : 최고/100%/무조건/절대 류 과장
 * - exaggerated_percent  : "300% 증가", "매출 5배" 같은 검증 불가 수치
 *
 * ai_cliches / overused_conjunctions 는 의미 보존 위해 기본 OFF.
 */
export const DEFAULT_ACTIVE_CATEGORIES = Object.freeze([
  'domain_specific',
  'superlatives',
  'exaggerated_percent',
]);

/**
 * quality-report.json 객체에서 모든 hit 을 평탄화해서 반환.
 */
export function collectHits(qualityReport) {
  const out = [];
  for (const result of qualityReport?.results || []) {
    for (const hit of result.hits || []) {
      out.push(hit);
    }
  }
  return out;
}

/**
 * 본문에 hits 를 적용합니다.
 *
 * 같은 (category, expression) 가 N 번 등장하면 본문에서 앞에서부터 N 번
 * 모두 치환합니다. 본문에서 더 이상 찾을 수 없는 hit 은 skipped 에 기록합니다.
 *
 * @param {string} text                — 원본 본문
 * @param {Array}  hits                — quality-report.results[].hits 평탄화 결과
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.activeCategories=DEFAULT_ACTIVE_CATEGORIES]
 * @returns {{ rewritten: string, changes: Array, skipped: Array }}
 */
export function applyRewrites(text, hits, opts = {}) {
  const active = new Set(opts.activeCategories || DEFAULT_ACTIVE_CATEGORIES);

  const groups = new Map();
  const skipped = [];

  // 긴 expression 먼저 치환해야 짧은 일반 표현이 같은 자리에서 충돌하지 않습니다.
  // (예: "무조건 잡아드립니다" 가 "무조건" 보다 먼저 적용되어야 도메인 치환이 살아남음)
  const sortedHits = [...hits].sort(
    (a, b) => (b?.expression?.length || 0) - (a?.expression?.length || 0)
  );

  for (const hit of sortedHits) {
    if (!hit?.expression) {
      skipped.push({ hit, reason: 'no-expression' });
      continue;
    }
    if (!hit.replacement) {
      skipped.push({ hit, reason: 'no-replacement' });
      continue;
    }
    if (!active.has(hit.category)) {
      skipped.push({ hit, reason: 'category-disabled' });
      continue;
    }
    const key = `${hit.category}::${hit.expression}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hit);
  }

  let rewritten = text;
  const changes = [];

  for (const [, groupHits] of groups) {
    const { expression, replacement, category } = groupHits[0];
    let from = 0;

    for (const hit of groupHits) {
      const idx = rewritten.indexOf(expression, from);
      if (idx === -1) {
        skipped.push({ hit, reason: 'not-found-in-current-text' });
        continue;
      }
      rewritten =
        rewritten.slice(0, idx) +
        replacement +
        rewritten.slice(idx + expression.length);
      changes.push({
        category,
        before: expression,
        after: replacement,
        offset: idx,
        context: hit.context || null,
      });
      from = idx + replacement.length;
    }
  }

  return { rewritten, changes, skipped };
}
