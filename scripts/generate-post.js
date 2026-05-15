#!/usr/bin/env node
/**
 * OpenAI 기반 탐정업 블로그 글 생성기.
 *
 * Usage:
 *   node scripts/generate-post.js --keyword "탐정 비용 산정 기준" [--type cost] [--output output/folder]
 */

import './lib/env.js';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText } from './lib/openai-text.js';
import { outputFolderForKeyword } from './lib/slug.js';

const BLOG_TYPES = {
  infidelity: {
    label: '외도/상간/배우자 문제',
    intent: '외도 정황이나 상간소송 준비 전, 합법적인 자료 정리와 상담 전 확인 사항을 안내',
    sections: ['상황을 먼저 정리해야 하는 이유', '상담 전 준비할 자료', '합법 범위에서 가능한 확인', '주의해야 할 표현과 요청', '상담 전 체크리스트'],
  },
  'people-search': {
    label: '사람 찾기/소재 확인',
    intent: '가출, 연락두절, 소재 확인 의뢰 전 합법적인 확인 범위와 준비 자료 안내',
    sections: ['사람 찾기 의뢰 전 구분할 점', '의뢰인이 정리할 기본 정보', '합법 범위의 확인 절차', '불가능하거나 위험한 요청', '상담 전 체크리스트'],
  },
  cost: {
    label: '탐정 비용/견적/추가 비용',
    intent: '탐정 비용이 달라지는 기준과 상담 전 견적을 명확히 하기 위한 준비 사항 안내',
    sections: ['탐정 비용이 달라지는 이유', '견적 전에 확인할 항목', '추가 비용이 생기는 경우', '무리한 저가 의뢰의 위험', '상담 전 체크리스트'],
  },
  evidence: {
    label: '증거수집/자료 정리/사실관계 확인',
    intent: '법적 문제가 없는 범위에서 사실관계와 자료를 정리하는 방법 안내',
    sections: ['증거보다 먼저 확인할 것', '이미 가진 자료 정리법', '합법적인 확인 범위', '피해야 할 불법 요청', '상담 전 체크리스트'],
  },
  general: {
    label: '일반 탐정업 정보성 글',
    intent: '탐정업 상담 전 합법 범위, 절차, 준비 자료를 일반 독자에게 안내',
    sections: ['상담 전 먼저 확인할 것', '진행 가능 범위', '준비하면 좋은 자료', '주의해야 할 요청', '상담 전 체크리스트'],
  },
};

const BASE_TAGS = [
  '탐정상담',
  '탐정법인범랑',
  '범랑탐정',
  '탐정사무소',
  '민간조사',
  '탐정보고서',
  '합법적증거수집',
];

const TYPE_TAGS = {
  infidelity: [
    '외도조사',
    '외도조사비용',
    '상간소송준비',
    '이혼소송증거',
    '서울외도조사',
    '경기외도조사',
  ],
  'people-search': [
    '사람찾기',
    '소재확인',
    '가출상담',
    '연락두절',
    '실종가족상담',
  ],
  cost: [
    '탐정비용',
    '탐정사무소비용',
    '외도조사비용',
    '증거수집비용',
    '탐정선택방법',
    '상간소송준비',
    '이혼소송증거',
  ],
  evidence: [
    '증거수집비용',
    '증거수집상담',
    '사실관계확인',
    '자료정리',
    '상간소송준비',
    '이혼소송증거',
  ],
  general: [
    '탐정선택방법',
    '탐정상담',
    '탐정보고서',
    '민간조사',
  ],
};

const LOCATION_TAGS = [
  '서울탐정',
  '경기탐정',
  '수원탐정',
  '의정부탐정',
  '고양탐정',
  '남양주탐정',
  '평택탐정',
  '용인탐정',
  '화성탐정',
  '부산탐정',
  '대구탐정',
  '대전탐정',
  '광주탐정',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function normalizeType(type) {
  const value = String(type || 'general').trim();
  return BLOG_TYPES[value] ? value : 'general';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('OpenAI output did not contain JSON.');
    return JSON.parse(match[0]);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function normalizeTag(tag) {
  return String(tag || '')
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .trim();
}

function keywordTags(keyword) {
  const clean = normalizeTag(keyword);
  if (!clean) return [];
  return [clean, `${clean}상담`];
}

function buildTags(aiTags, keyword, type) {
  const candidates = [
    ...keywordTags(keyword),
    ...(TYPE_TAGS[type] || TYPE_TAGS.general),
    ...BASE_TAGS,
    ...LOCATION_TAGS,
    ...asArray(aiTags),
  ];
  const seen = new Set();
  const tags = [];

  for (const candidate of candidates) {
    const tag = normalizeTag(candidate);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 30) break;
  }

  return tags;
}

function fallbackSections(keyword, typeInfo) {
  return typeInfo.sections.map((heading) => ({
    heading,
    paragraphs: [`${keyword}을(를) 준비할 때는 합법적인 범위와 현재 보유한 자료를 먼저 구분하는 것이 중요합니다.`],
  }));
}

function normalizePost(data, keyword, type, typeInfo) {
  const title = String(data.title || `${keyword} 전 확인할 것`).trim();
  const description = String(
    data.description || `${keyword}을(를) 준비하기 전 확인할 사항을 정리한 글입니다.`
  ).trim();
  const tags = buildTags(data.tags, keyword, type);
  const sections = asArray(data.sections).length
    ? data.sections.map((section) => ({
        heading: String(section.heading || '').trim(),
        paragraphs: asArray(section.paragraphs || section.body),
        bullets: asArray(section.bullets),
      }))
    : fallbackSections(keyword, typeInfo);

  const image = {
    points: asArray(data.image?.points || data.image_points).slice(0, 5),
    quote: String(data.image?.quote || data.image_quote || title).trim(),
    steps: asArray(data.image?.steps || data.image_steps).slice(0, 6),
  };

  if (!image.points.length) {
    image.points = ['상황 정리', '보유 자료 확인', '합법 범위 상담', '진행 여부 결정'];
  }
  if (!image.steps.length) {
    image.steps = ['상담', '자료 확인', '가능 범위 안내', '진행 여부 결정'];
  }

  return { title, keyword, type, description, tags, sections, image };
}

function postCharCount(post) {
  return post.sections
    .flatMap((section) => [section.heading, ...(section.paragraphs || []), ...(section.bullets || [])])
    .join('')
    .replace(/\s/g, '').length;
}

function ensureMinimumLength(post) {
  const extraSections = [
    {
      heading: '상담 전 마지막 점검',
      paragraphs: [
        `${post.keyword}을(를) 검토할 때는 의뢰 목적, 현재 확보한 자료, 원하는 확인 범위를 같은 기준으로 정리해야 합니다. 이 과정은 견적과 일정 안내를 더 분명하게 만드는 데 도움이 됩니다.`,
        '탐정법인 범랑은 합법적인 범위 안에서 진행 가능 여부를 확인하고, 무리한 요청은 사전에 설명합니다. 법률 판단이나 소송 전략은 변호사 상담을 통해 별도로 확인하는 방식이 바람직합니다.',
      ],
    },
    {
      heading: '무리한 요청을 피해야 하는 이유',
      paragraphs: [
        `${post.keyword} 상담에서는 빠른 결론보다 적법한 절차와 자료의 출처가 더 우선됩니다. 불법적인 방식으로 얻은 자료는 분쟁 과정에서 문제가 될 수 있어 처음부터 범위를 구분해야 합니다.`,
        '의뢰인이 가진 자료와 공개 정보, 현장에서 확인 가능한 사실을 중심으로 진행하면 이후 설명과 정리가 수월해집니다. 진행 전에는 비용, 기간, 가능 범위를 문서나 상담 기록으로 남겨 두는 편이 좋습니다.',
      ],
    },
  ];

  for (const section of extraSections) {
    if (postCharCount(post) >= 1500) break;
    post.sections.push(section);
  }

  return post;
}

function renderMarkdown(post) {
  const lines = [`# ${post.title}`, ''];
  const imageMarkers = ['thumbnail', 'infographic', 'quote-card', 'process'];
  const markerIndexes = new Map([
    [0, imageMarkers[0]],
    [1, imageMarkers[1]],
    [Math.max(2, Math.floor(post.sections.length / 2)), imageMarkers[2]],
    [Math.max(3, post.sections.length - 1), imageMarkers[3]],
  ]);

  for (const [index, section] of post.sections.entries()) {
    const marker = markerIndexes.get(index);
    if (marker) lines.push(`[IMAGE: ${marker}]`, '');
    if (section.heading) lines.push(`## ${section.heading}`, '');
    for (const p of section.paragraphs || []) lines.push(p, '');
    for (const bullet of section.bullets || []) lines.push(`- ${bullet}`);
    if (section.bullets?.length) lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function renderHtml(post) {
  const styles = {
    h1: 'font-size:26px;line-height:1.45;font-weight:800;margin:0 0 18px;color:#111827;',
    h2: 'font-size:21px;line-height:1.5;font-weight:800;margin:30px 0 14px;color:#111827;',
    p: 'font-size:16px;line-height:1.85;margin:0 0 14px;color:#1f2937;',
    ul: 'margin:0 0 18px 0;padding-left:22px;',
    li: 'font-size:16px;line-height:1.75;margin:0 0 8px;color:#1f2937;',
  };
  const parts = [`<h1 style="${styles.h1}">${escapeHtml(post.title)}</h1>`];
  for (const section of post.sections) {
    if (section.heading) parts.push(`<h2 style="${styles.h2}">${escapeHtml(section.heading)}</h2>`);
    for (const p of section.paragraphs || []) parts.push(`<p style="${styles.p}">${escapeHtml(p)}</p>`);
    if (section.bullets?.length) {
      parts.push(`<ul style="${styles.ul}">`);
      for (const bullet of section.bullets) parts.push(`<li style="${styles.li}">${escapeHtml(bullet)}</li>`);
      parts.push('</ul>');
    }
  }
  return `${parts.join('\n')}\n`;
}

function buildPrompt({ keyword, type, typeInfo }) {
  return `
키워드: ${keyword}
타입: ${type} (${typeInfo.label})
글 의도: ${typeInfo.intent}
권장 섹션: ${typeInfo.sections.join(' / ')}

탐정업 블로그 글 초안을 JSON으로만 작성하세요.
다음 스키마를 지키세요:
{
  "title": "문자열",
  "description": "문자열",
  "tags": ["태그1", "태그2"],
  "sections": [
    {"heading": "소제목", "paragraphs": ["문단1", "문단2"], "bullets": ["선택 bullet"]}
  ],
  "image": {
    "points": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
    "quote": "이미지 카드에 넣을 짧은 핵심 문장",
    "steps": ["상담", "자료 확인", "가능 범위 안내", "진행 여부 결정"]
  }
}

작성 조건:
- 한국어로 작성합니다.
- 네이버 블로그용 정보성 글입니다.
- 본문은 공백 제외 최소 1,500자 이상, 전체 2,400~3,200자 분량으로 작성합니다.
- sections는 6개 작성하고, 각 section에는 3문단을 넣습니다.
- 각 문단은 100~160자 정도의 2~3문장으로 작성합니다.
- 정확한 키워드 "${keyword}"를 본문 전체에 5~8회 자연스럽게 포함합니다.
- "또한", "중요한" 같은 상투적 표현은 피하고 문장 연결을 다양하게 씁니다.
- keyword를 자연스럽게 사용하되 과도하게 반복하지 않습니다.
- 법률대리처럼 보이는 표현을 피합니다.
- 불법 위치추적, 개인정보 불법 조회, 통신내역 조회, 해킹, 불법 촬영을 암시하지 않습니다.
- 승소 보장, 100% 증거 확보, 무조건 잡아드립니다 같은 표현을 쓰지 않습니다.
- 필요한 경우 "법률 판단은 변호사 상담이 필요합니다"라는 취지를 자연스럽게 포함합니다.
- 상담 유도 문구는 강요하지 않고 자연스럽게 작성합니다.
- JSON 외의 설명, markdown fence, 코드블록은 출력하지 마세요.
- tags는 10개 이상 제안하되, 실제 저장 시 브랜드/지역/업종 태그가 추가될 수 있습니다.
`.trim();
}

export async function generatePostPackage({ keyword, type, output }) {
  if (!keyword) throw new Error('--keyword is required.');

  const resolvedType = normalizeType(type || 'general');
  const typeInfo = BLOG_TYPES[resolvedType];
  const folder = output || outputFolderForKeyword(keyword);

  await mkdir(folder, { recursive: true });

  const system = '당신은 탐정업 블로그 콘텐츠를 작성하는 한국어 SEO 에디터입니다. 법률대리, 불법 정보조회, 해킹, 위치추적, 불법촬영, 결과보장 표현을 피하고 합법 범위 안내 중심으로 작성합니다.';
  const result = await generateText({
    system,
    prompt: buildPrompt({ keyword, type: resolvedType, typeInfo }),
    maxOutputTokens: 5000,
  });

  const raw = extractJson(result.text);
  const post = ensureMinimumLength(normalizePost(raw, keyword, resolvedType, typeInfo));
  const createdAt = new Date().toISOString();
  const metadata = {
    title: post.title,
    keyword,
    type: resolvedType,
    tags: post.tags,
    description: post.description,
    meta_description: post.description,
    createdAt,
    model: result.model,
    image: post.image,
  };

  await writeFile(join(folder, 'post.md'), renderMarkdown(post));
  await writeFile(join(folder, 'post.html'), renderHtml(post));
  await writeFile(join(folder, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  return { folder, metadata };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.keyword) {
    console.error('Usage: node scripts/generate-post.js --keyword "키워드" [--type general] [--output output/folder]');
    process.exit(2);
  }

  const result = await generatePostPackage({
    keyword: args.keyword,
    type: args.type || 'general',
    output: args.output,
  });

  console.log(`post.md/post.html/metadata.json 생성 완료: ${result.folder}`);
  console.log(`제목: ${result.metadata.title}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
