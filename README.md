# Claude Code Blog Builder

> ⚠️ **이 도구는 1개 블로그를 직접 운영하는 경우에 최적화되어 있습니다.**
> 멀티 카테고리 운영 / 저품질 복구 / 발행 스케줄링 / 외주팀 워크플로우는 상위 솔루션이 필요합니다.

Claude Code 위에서 동작하는 한국어 블로그 자동화 시스템입니다.
키워드 하나만 던지면 리서치 → 글 작성 → 이미지 생성 → 품질 검증 → 발행 어시스턴트까지 한 번에 돌아갑니다.

```
/blog-new "병원 마케팅"
```

이 한 줄로 블로그 글 1편이 (사람 검수만 남긴 채) 완성됩니다.

---

## ✨ 특징

- 🎯 **외부 의존성 0** — `npm install` 안 함. Node 20+ 내장 fetch만 사용.
- 🔒 **단일 진실 공급원** — 회사 사실을 한 파일에 박아 AI 추측/거짓말 차단.
- 📊 **결정론적 검증** — "잘 썼어요" (LLM) 대신 "키워드 11회 / 금칙어 0개 / 유사도 1.3%" (스크립트).
- 🤖 **5명의 서브에이전트** — 리서처 / 라이터 / 품질 리뷰어 / 의료법 검사관 / 셋업 인터뷰어.
- 🚀 **30분 발행 → 30초로** — 발행 어시스턴트가 복붙 마찰을 0으로 줄임.
- 🌏 **한국 시장 특화** — 네이버 블로그 저품질 트리거 회피, 한국어 톤 학습.

---

## 🚀 빠른 시작

### 1. 설치 (30초)

```bash
git clone https://github.com/shdsjh123-cpu/claude-code-blog-builder.git
cd claude-code-blog-builder
cp .env.example .env
# .env 파일 열어서 GEMINI_API_KEY 채우기
```

자세한 설치는 [INSTALL.md](INSTALL.md) 참조.

### 2. Claude Code 실행

```bash
claude
```

### 3. 셋업 (5분)

```
/setup
```

7개 질문에 답하면 여러분 회사 정보가 자동으로 시스템에 주입됩니다.

### 4. 첫 글 쓰기

```
/blog-new "여러분 카테고리 키워드"
```

5~10분 후 `output/<날짜>_<키워드>/` 폴더에 풀세트가 생성됩니다.

### 5. 발행 어시스턴트

```
/blog-preview output/<폴더>
```

브라우저가 자동으로 열리고, 섹션별 복사 버튼으로 네이버 에디터에 빠르게 옮길 수 있습니다.

---

## 📁 폴더 구조

```
claude-code-blog-builder/
├── knowledge/        # 회사 사실의 유일한 출처 (/setup이 채움)
├── scripts/          # 외부 의존성 0 도구들
├── templates/        # 이미지 폴백 골격
├── .claude/
│   ├── commands/     # 슬래시 커맨드 8종
│   └── agents/       # 서브에이전트 5명
├── keyword-bank/     # 카테고리별 시드 키워드 (예시)
├── output/           # 결과물 (gitignored)
└── docs/             # 사용법/트러블슈팅
```

전체 구조 설명: [CLAUDE.md](CLAUDE.md)

---

## 🎓 어떻게 만들어졌는가

이 시스템은 어느 디자인 에이전시가 자체 블로그 운영을 위해 2주 동안 만든 도구입니다.
처음부터 완벽하게 설계되지 않았어요. 문제를 발견할 때마다 한 단계씩 보완했습니다.

진화 6단계 + 5가지 빌드 교훈: [docs/build-history.md](docs/build-history.md)

핵심 설계 원칙 + 동작 흐름: [docs/explainer.md](docs/explainer.md)

---

## 🛠 주요 명령어

| 명령 | 설명 |
|:---|:---|
| `/setup` | 5분 인터뷰로 회사 정보 입력 (Phase 1) |
| `/setup-tone` | 회사 블로그 URL에서 톤 자동 학습 (Phase 2) |
| `/setup-domain` | 카테고리별 키워드뱅크 + 산업 금칙어 (Phase 3) |
| `/blog-new "키워드"` | 풀 파이프라인 실행 (리서치→글→이미지→품질→메타) |
| `/blog-research "키워드"` | 키워드 리서치만 |
| `/blog-quality <폴더>` | 품질 재검사 |
| `/blog-publish-ready <폴더>` | 8개 게이트 발행 가능 여부 점검 |
| `/blog-preview <폴더>` | 발행 어시스턴트 (브라우저 오픈) |

---

## 📋 요구 사항

- **Node.js 20+** (내장 fetch 필요)
- **Claude Code** ([설치](https://docs.claude.com/en/docs/claude-code))
- **Gemini API 키** ([무료 발급](https://aistudio.google.com))
- **네이버 Search API** (선택, 없으면 웹 검색 대체)

---

## 🔐 보안

- `.env`, `knowledge/brand-facts.md`, `output/`는 `.gitignore`에 등록되어 git에 올라가지 않습니다.
- push 전 자동 검증: `npm run sanitize-check`
- 회사 데이터를 실수로 공개 레포에 올리지 않도록 설계되어 있습니다.

---

## 📜 라이선스

MIT — 자유롭게 사용/수정/배포 가능.

---

## 🙏 만든 이

이 레포는 한 디자인 에이전시 사장님의 자체 블로그 자동화 도구를 외부 공개용으로 일반화한 것입니다.
"1개 블로그 운영"은 이 도구로 충분합니다.

멀티 카테고리 운영 / 저품질 복구 / 발행 스케줄링 / 외주팀 워크플로우 등 상위 운영이 필요하시면 별도 문의 채널을 참고하세요.
