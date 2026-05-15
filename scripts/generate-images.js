#!/usr/bin/env node
/**
 * 블로그 이미지 생성기
 * Nano Banana Pro (Gemini 3 Pro Image) REST API 직접 호출.
 * 외부 의존성 없음 — Node 20+ 내장 fetch 사용.
 *
 * 브랜드 시스템은 환경 변수로 주입 (/setup-domain이 .env에 자동 작성):
 *   BRAND_NAME      — 이미지에 박힐 브랜드명 (정확한 표기, 대소문자 그대로)
 *   BRAND_BG_COLOR  — 배경색 hex (기본 #F7F6F2)
 *   BRAND_FG_COLOR  — 본문 텍스트 hex (기본 #1A1A1A)
 *   BRAND_ACCENT    — 포인트 색 hex (기본 #D97A3A)
 *
 * Usage:
 *   node scripts/generate-images.js \
 *     --title "..." --keyword "..." \
 *     --points "p1|||p2|||p3" \
 *     --quote "..." \
 *     --steps "s1|||s2|||s3" \
 *     --output "output/folder/images" \
 *     --provider openai
 */

import './lib/env.js';
import { generateOpenAIImage } from './lib/openai-images.js';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ────────────────────────────────────────────────
// CLI 파싱
// ────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const splitList = (s) =>
  (s || '')
    .split('|||')
    .map((x) => x.trim())
    .filter(Boolean);

// ────────────────────────────────────────────────
// 브랜드 시스템 (환경 변수 기반 — /setup-domain이 설정)
// ────────────────────────────────────────────────
const BRAND_NAME = process.env.BRAND_NAME || '탐정법인 범랑';
const BRAND_LOGO_MARK = process.env.BRAND_LOGO_MARK || 'BR';
const BRAND_PHONE = process.env.BRAND_PHONE || '1660-2515';
const BG_COLOR   = process.env.BRAND_BG_COLOR || '#F7F6F2';
const FG_COLOR   = process.env.BRAND_FG_COLOR || '#1A1A1A';
const ACCENT     = process.env.BRAND_ACCENT   || '#D97A3A';

const BRAND_STYLE = [
  'Korean corporate detective-agency editorial infographic design',
  `white or off-white background (${BG_COLOR}), deep navy/charcoal text (${FG_COLOR}), strong royal-blue accent (${ACCENT})`,
  'visual reference: formal Korean agency guide poster with a thick blue outer frame, thin inner border, rounded blue label badges, pale-blue information cards, dark navy CTA-style footer bar, and clean arrow connectors',
  'premium clean sans-serif typography (Pretendard-like)',
  'large bold Korean headline, strong numeric hierarchy, generous whitespace, crisp grid alignment',
  'Keep the main headline size as requested, but make all body copy, checklist text, card descriptions, table labels, and process node labels noticeably larger than a typical infographic',
  'Minimum body text size target: about 28-34 px on 1536 px wide images and about 24-30 px on 1024 px wide images; never use tiny caption text',
  'Use fewer words per card if needed so every Korean body line remains large, sharp, and readable on a mobile screen',
  'information-diagram first: prefer cards, tables, flow nodes, price/criteria boxes, check bars, and comparison layouts over decorative illustration',
  `create the brand lockup inside the generated design only: a simple royal-blue monogram mark similar in feeling to "${BRAND_LOGO_MARK}" paired with the exact Korean brand name "${BRAND_NAME}"`,
  `bottom footer must include phone number "${BRAND_PHONE}" fully visible and legible`,
  'NO people, NO stock-photo aesthetic, NO random clutter, NO fake logos beyond the specified brand mark, NO watermark, NO heavy gradient or glow',
  'Never render placeholder text such as "YOUR BRAND", "Your Brand", "your brand", "brand name", "logo here", "company name", or any English substitute for the brand',
  'NO legal-result guarantees, NO lawsuit outcome promises, NO illegal tracking or privacy-invasive claims',
  'Korean text must render perfectly legible and sharp',
  `The only brand name shown is exactly "${BRAND_NAME}" — do not translate it and do not replace it with placeholder text`,
].join('. ');

function thumbnailPrompt({ title, keyword }) {
  return [
    `Create a 16:9 Korean blog thumbnail — editorial infographic style, not an illustration.`,
    `Large bold Korean headline (must be perfectly legible): "${title}"`,
    `Small rounded blue label badge in top-right corner with text: "${keyword}"`,
    `Top-left compact brand lockup generated as part of the image: small "${BRAND_LOGO_MARK}"-style monogram mark plus exact text "${BRAND_NAME}". Keep it smaller than the headline but easy to notice.`,
    `Add a simple information-card row or arrow diagram that hints at checklist/evidence review — not a photo. Card body text must be large and readable, not caption-sized.`,
    `Bottom dark navy footer bar: show "${BRAND_NAME}" on the left and phone number "${BRAND_PHONE}" on the right, fully visible.`,
    BRAND_STYLE,
    `Layout: headline left-aligned, bordered poster frame, diagram element lower half, balanced negative space.`,
  ].join('\n');
}

function infographicPrompt({ keyword, points }) {
  const numbered = points
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n');
  return [
    `Create a 2:3 vertical Korean infographic poster — pure information diagram, no decorative art.`,
    `Top title in Korean: "${keyword} 핵심 포인트"`,
    `Below the title, render these items as a vertical stack of pale-blue numbered cards with royal-blue labels and large readable body text:`,
    numbered,
    `Use no more than 2 short body lines per card. Enlarge the card text instead of adding small explanatory captions.`,
    `Top-left compact brand lockup generated as part of the image: "${BRAND_LOGO_MARK}"-style mark + exact text "${BRAND_NAME}".`,
    `Bottom dark navy footer bar: "${BRAND_NAME}" and "${BRAND_PHONE}" fully visible.`,
    BRAND_STYLE,
    `Consistent spacing between cards, clear numeric hierarchy, no icons of people.`,
  ].join('\n');
}

function quoteCardPrompt({ quote, keyword }) {
  return [
    `Create a 1:1 square Korean quote card — clean editorial typography focus.`,
    `Small royal-blue rounded label at top: "${keyword}"`,
    `Center the large Korean quote in bold sans-serif (not serif), perfectly legible: "${quote}"`,
    `Top-left compact brand lockup generated as part of the image: small "${BRAND_LOGO_MARK}"-style monogram mark plus exact text "${BRAND_NAME}".`,
    `Any supporting labels under the quote must be large enough to read clearly on a phone screen.`,
    `Use a thin blue border frame and one dark navy footer strip containing phone number "${BRAND_PHONE}" fully visible.`,
    BRAND_STYLE,
    `No people, no photographic elements.`,
  ].join('\n');
}

function processPrompt({ keyword, steps }) {
  const numberedSteps = steps
    .slice(0, 6)
    .map((s, i) => `${i + 1}) ${s}`)
    .join('   →   ');
  return [
    `Create a 4:3 Korean horizontal process flow diagram — clean schematic, not an illustration.`,
    `Top title in Korean: "${keyword} 진행 프로세스"`,
    `Render this as a horizontal row of numbered pill-shaped nodes connected by arrows, each node containing its Korean label clearly:`,
    numberedSteps,
    `Each node: pale-blue rounded rectangle with royal-blue number badge + Korean label. Node labels must be large and bold, with no tiny subtext. Arrows between nodes in royal blue.`,
    `Top-left compact brand lockup generated as part of the image: "${BRAND_LOGO_MARK}"-style mark + exact text "${BRAND_NAME}".`,
    `Bottom dark navy footer bar: "${BRAND_NAME}" and "${BRAND_PHONE}" fully visible.`,
    BRAND_STYLE,
    `Pure schematic diagram, no background imagery, no people.`,
  ].join('\n');
}

// ────────────────────────────────────────────────
// Gemini 호출
// ────────────────────────────────────────────────
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';

async function generateGeminiImage(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart) {
    throw new Error(
      `No image in response: ${JSON.stringify(json).slice(0, 500)}`
    );
  }
  return Buffer.from(imgPart.inlineData.data, 'base64');
}

function localDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function keywordSlug(keyword) {
  return keyword
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\\/:"*?<>|]+/g, '-');
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'openai' || value === 'gemini') return value;
  throw new Error(`Unknown image provider "${provider}". Use "openai" or "gemini".`);
}

// ────────────────────────────────────────────────
// 메인
// ────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const { title, keyword, quote } = args;
  const points = splitList(args.points);
  const steps = splitList(args.steps);
  const provider = normalizeProvider(args.provider || process.env.IMAGE_PROVIDER || 'openai');

  if (!title || !keyword) {
    console.error(
      'Usage: --title <t> --keyword <k> [--output <dir>] [--provider openai|gemini] [--points a|||b] [--quote q] [--steps a|||b]'
    );
    process.exit(2);
  }
  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY environment variable is required.');
    process.exit(1);
  }
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is required.');
    process.exit(1);
  }

  const output = args.output || join('output', `${localDate()}_${keywordSlug(keyword)}`, 'images');
  await mkdir(output, { recursive: true });

  const allJobs = [
    { name: 'thumbnail', size: '1536x1024', prompt: thumbnailPrompt({ title, keyword }) },
    {
      name: 'infographic',
      size: '1024x1536',
      prompt: infographicPrompt({
        keyword,
        points: points.length ? points : [keyword],
      }),
    },
    {
      name: 'quote-card',
      size: '1024x1024',
      prompt: quoteCardPrompt({
        quote: quote || title,
        keyword,
      }),
    },
    {
      name: 'process',
      size: '1536x1024',
      prompt: processPrompt({
        keyword,
        steps: steps.length ? steps : ['상담', '자료 확인', '가능 범위 안내', '진행 여부 결정'],
      }),
    },
  ];
  const jobs = args['all-images'] ? allJobs : allJobs.slice(0, 1);

  let okCount = 0;
  const errors = [];

  for (const job of jobs) {
    try {
      const path = join(output, `${job.name}.png`);
      console.log(`[generate:${provider}] ${job.name} ...`);
      if (provider === 'openai') {
        const result = await generateOpenAIImage({
          prompt: job.prompt,
          outputPath: path,
          size: job.size,
        });
        console.log(`  ✓ ${result.outputPath} (${result.bytes} bytes, model: ${result.model})`);
      } else {
        const buf = await generateGeminiImage(job.prompt);
        await writeFile(path, buf);
        console.log(`  ✓ ${path} (${buf.length} bytes)`);
      }
      okCount++;
    } catch (e) {
      console.error(`  ✗ ${job.name}: ${e.message}`);
      errors.push({ name: job.name, error: e.message });
    }
  }

  console.log(`\nDone: ${okCount}/${jobs.length} images saved to ${output}`);
  if (errors.length === jobs.length) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
