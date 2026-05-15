# Claude Code Blog Builder

이 프로젝트는 탐정업 네이버 블로그 자동화를 위한 도구입니다.

Claude Code 기반 구조를 유지하면서, Codex와 일반 터미널에서도 유지보수할 수 있도록 `scripts/`와 `npm run ...` 명령을 제공합니다.

## 핵심 원칙

- `.claude/commands`와 `.claude/agents`는 가능한 한 보존합니다.
- Node scripts는 Codex/터미널에서 실행 가능한 보조 도구입니다.
- 자동 발행은 하지 않습니다.
- `naver:draft`는 네이버 글쓰기 화면에 발행 직전까지 자동 입력한 뒤 멈춥니다.
- 네이버 아이디/비밀번호는 요구하거나 저장하지 않습니다.
- API 키는 `.env`에서만 읽습니다.
- 실제 API 키를 코드, 문서, 커밋, 채팅에 남기지 않습니다.
- `.env`와 `output/`은 커밋하지 않습니다.

## 프로젝트 구조

```text
claude-code-blog-builder/
├── .claude/
│   ├── commands/              # Claude Code slash commands
│   └── agents/                # Claude Code agents
├── knowledge/
│   └── banned-words.template.json
├── scripts/
│   ├── blog-auto.js           # 전체 자동 생성 파이프라인
│   ├── dashboard-server.js    # 로컬 대시보드 서버
│   ├── generate-post.js       # OpenAI 글 생성
│   ├── generate-images.js     # OpenAI/Gemini 이미지 생성
│   ├── quality-check.js       # 품질/금칙어 검사
│   ├── preview.js             # 미리보기 HTML 생성
│   ├── naver-login.js         # 네이버 로그인 세션 생성
│   ├── naver-draft.js         # 네이버 글쓰기 화면 자동 입력
│   └── lib/
│       ├── env.js
│       ├── openai-text.js
│       ├── openai-images.js
│       ├── naver-browser.js
│       └── slug.js
├── dashboard/                 # 로컬 대시보드 정적 UI
├── output/                    # 생성 결과, gitignored
├── start-dashboard.bat        # Windows 대시보드 실행 파일
├── start-dashboard.command    # macOS 대시보드 실행 파일
├── README.md
├── INSTALL.md
└── package.json
```

## 주요 npm scripts

| script | 설명 |
|:---|:---|
| `npm run blog:auto` | 글, 이미지, 품질검사, 미리보기까지 생성 |
| `npm run post` | 글 패키지만 생성 |
| `npm run images` | 이미지 4종 생성 |
| `npm run quality` | 품질/금칙어 검사 |
| `npm run preview` | 미리보기 HTML 생성 |
| `npm run dashboard` | 로컬 대시보드 실행 |
| `npm run naver:login` | 네이버 로그인 세션 생성 |
| `npm run naver:draft` | 네이버 글쓰기 화면에 발행 직전까지 자동 입력 |

## 환경 변수

`.env.example`을 복사해 `.env`를 만듭니다.

```bash
cp .env.example .env
```

필수/권장 값:

```env
IMAGE_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-2

BRAND_NAME=탐정법인 범랑
BRAND_LOGO_MARK=BR
BRAND_PHONE=1660-2515
```

`GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`은 기존 Gemini 이미지 흐름 호환용 optional 값입니다.

## blog:auto

`blog:auto`는 하나의 키워드로 전체 패키지를 생성합니다.

```bash
npm run blog:auto -- --keyword "탐정 비용 산정 기준" --type cost
```

지원 type:

- `infidelity`: 외도, 상간, 배우자 문제
- `people-search`: 사람 찾기, 가출, 소재 확인
- `cost`: 탐정 비용, 견적, 추가 비용
- `evidence`: 증거수집, 자료 정리, 사실관계 확인
- `general`: 일반 탐정업 정보성 글

`--type`을 생략하면 `general`입니다.

생성 결과:

```text
output/<날짜>_<키워드>/
├── post.md
├── post.html
├── metadata.json
├── quality-report.json
├── preview.html
└── images/
    ├── thumbnail.png
    ├── infographic.png
    ├── quote-card.png
    └── process.png
```

## naver:login

```bash
npm run naver:login
```

사용자가 직접 네이버에 로그인합니다. 아이디/비밀번호를 스크립트에 입력하지 않습니다.

## naver:draft

```bash
npm run naver:draft -- --folder "output/2026-05-15_탐정비용산정기준"
```

동작:

- 네이버 글쓰기 화면 열기
- 작성 중 글 팝업 처리
- 제목 입력
- 본문 입력
- 이미지 첨부
- 태그를 본문 마지막 줄에 입력
- 브라우저를 닫지 않고 대기

발행 버튼은 클릭하지 않습니다.

## 탐정업 금지표현 기준

품질 검사는 `knowledge/banned-words.json`이 있으면 우선 사용하고, 없으면 `knowledge/banned-words.template.json`을 사용합니다.

주요 금지/주의 표현:

- 변호사법 위반 오인 표현
- 법률대리처럼 보이는 표현
- 승소/소송 결과 보장
- 불법 위치추적 암시
- 개인정보 불법 조회 암시
- 통신내역 조회 암시
- 불법 촬영 암시
- 해킹, 계정 접속, 사생활 침해 암시
- `100% 증거 확보`, `무조건 잡아드립니다` 같은 과장광고
- 자극적인 공포 마케팅

대체 방향:

- 합법적인 범위
- 의뢰인이 제공한 자료
- 공개 정보
- 사실관계 정리
- 법률 판단은 변호사 상담 필요

## 블로그 본문 작성 기준

- 글을 쓰기 전에 키워드의 검색 의도를 먼저 판단합니다.
- 제목과 도입부는 독자가 바로 이해할 수 있게 명확하게 씁니다.
- 핵심 답변은 초반에 빠르게 정리합니다.
- 본문 구조를 먼저 보여주고, 각 항목은 짧고 구체적으로 전개합니다.
- 불필요한 배경 설명이나 반복 문장으로 분량을 늘리지 않습니다.
- "도움이 될 수 있습니다", "확인해보는 것이 좋습니다" 같은 모호한 표현보다 구체적인 기준, 절차, 확인 항목을 제시합니다.
- 탐정업 금지표현 기준을 반드시 유지하며, 불법 위치추적·개인정보 조회·통신내역 조회·해킹·불법 촬영·결과 보장 표현은 사용하지 않습니다.

## AI 브리핑 대응 작성 방향

- 네이버 AI 브리핑에 발췌·요약되기 쉬운 답변형 구조로 작성합니다.
- 각 핵심 섹션은 설명보다 먼저 한 문장짜리 직접 답변을 배치합니다.
- 문단은 단독으로 발췌돼도 의미가 통하도록 사실 중심으로 씁니다.
- 정의, 조건, 절차, 체크리스트, 비교표처럼 요약 가능한 정보 단위를 우선합니다.
- 가능한 확인 범위, 불가능한 요청, 변호사 상담이 필요한 영역을 분리해서 씁니다.
- 검색 질의에 답하지 않는 홍보성 문장과 추상적인 표현은 줄입니다.
- 일반 기준과 사건별 판단을 구분하고, 확정적으로 말할 수 없는 내용은 조건을 명시합니다.
- 이미지 주변 문맥과 캡션은 해당 섹션 주제와 일치시켜 AI가 잘못 연결하지 않게 합니다.

## Claude Code 사용

기존 slash command와 agent 파일은 유지됩니다.

다만 현재 검증된 터미널 흐름은 다음입니다.

```bash
npm run blog:auto -- --keyword "외도 증거수집 전 확인할 것" --type infidelity
npm run naver:draft -- --folder "output/<생성폴더>"
```

Claude Code 작업 중에도 기존 `.claude` 구조를 삭제하거나 대규모로 바꾸지 않습니다.
