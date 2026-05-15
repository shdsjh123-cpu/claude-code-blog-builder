# Claude Code Blog Builder

탐정업 네이버 블로그 글을 생성하고, 네이버 블로그 글쓰기 화면에 발행 직전까지 자동 입력하는 도구입니다.

Claude Code 기반의 `.claude/commands`, `.claude/agents` 구조는 보존합니다. 동시에 Codex나 일반 터미널에서도 `npm run ...` 명령으로 실행할 수 있게 보조 스크립트를 제공합니다.

이 프로젝트는 자동 발행 도구가 아닙니다. `naver:draft`는 제목, 본문, 이미지, 태그를 네이버 글쓰기 화면에 입력한 뒤 멈추며, 발행 버튼은 사용자가 직접 눌러야 합니다.

## 현재 목적

- 탐정업 정보성 네이버 블로그 글 생성
- OpenAI 텍스트 API로 초안 생성
- OpenAI `gpt-image-2`로 이미지 4종 생성
- 탐정업 금지표현 품질 검사
- 복사하기 쉬운 `preview.html` 생성
- 네이버 블로그 글쓰기 화면에 발행 직전까지 자동 입력

## 요구 사항

- Node.js 20+
- npm
- OpenAI Platform API 키
- 네이버 로그인 가능한 브라우저 세션
- 선택: Claude Code

Playwright는 네이버 글쓰기 화면 자동 입력에 사용됩니다.

## 설치

```bash
npm install
cp .env.example .env
```

`.env`에 실제 API 키를 입력합니다. 실제 키는 문서, 커밋, 채팅에 쓰지 않습니다.

```env
IMAGE_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_TEXT_MODEL=gpt-4.1-mini

BRAND_NAME=탐정법인 범랑
BRAND_LOGO_MARK=BR
BRAND_LOGO_PATH=assets/brand-logo.png
BRAND_PHONE=1660-2515
```

`.env`와 `output/`은 Git에 커밋하지 않습니다.

## 전체 자동 생성

`blog:auto`는 글 생성부터 미리보기까지 실행합니다. 네이버 입력은 자동 실행하지 않습니다.

```bash
npm run blog:auto -- --keyword "외도 증거수집 전 확인할 것" --type infidelity
npm run blog:auto -- --keyword "사람 찾기 의뢰 전 주의사항" --type people-search
npm run blog:auto -- --keyword "탐정 비용 산정 기준" --type cost
npm run blog:auto -- --keyword "상간소송 전 확인해야 할 자료" --type evidence
```

`--keyword`는 필수입니다. `--type`은 선택이며 기본값은 `general`입니다.

지원 type:

| type | 용도 |
|:---|:---|
| `infidelity` | 외도, 상간, 배우자 문제 |
| `people-search` | 사람 찾기, 가출, 소재 확인 |
| `cost` | 탐정 비용, 견적, 추가 비용 |
| `evidence` | 증거수집, 자료 정리, 사실관계 확인 |
| `general` | 일반 탐정업 정보성 글 |

## 로컬 대시보드

브라우저에서 키워드 추천, 글 생성, 결과 폴더 확인, 네이버 글쓰기 입력을 실행할 수 있습니다.

```bash
npm run dashboard
```

Windows PowerShell에서 실행 정책 때문에 `npm`이 막히면 다음처럼 실행합니다.

```powershell
npm.cmd run dashboard
```

기본 주소는 `http://127.0.0.1:3000/`입니다. 포트를 바꾸려면:

```powershell
$env:PORT='3002'
npm.cmd run dashboard
```

또는 실행 파일을 사용할 수 있습니다.

- Windows: `start-dashboard.bat`
- macOS: `start-dashboard.command`

대시보드는 로컬 전용으로 동작하며 발행 버튼을 자동으로 누르지 않습니다.

## 생성되는 폴더

```text
output/2026-05-15_탐정비용산정기준/
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

## 네이버 로그인

처음 한 번 네이버에 직접 로그인합니다.

```bash
npm run naver:login
```

브라우저가 열리면 사용자가 직접 네이버에 로그인합니다. 이 프로젝트는 네이버 아이디와 비밀번호를 요구하거나 저장하지 않습니다. 로그인 세션은 로컬 Playwright user-data-dir에 저장됩니다.

## 네이버 초안 입력

생성된 output 폴더를 지정합니다.

```bash
npm run naver:draft -- --folder "output/2026-05-15_탐정비용산정기준"
```

동작:

- 네이버 블로그 글쓰기 화면 열기
- 작성 중 글 팝업 처리
- 제목 입력
- 썸네일 상단 삽입
- 나머지 이미지 본문 중간 삽입
- 본문 입력
- 태그를 본문 마지막 줄에 해시태그 형태로 입력
- 발행 전 단계에서 멈춤

발행 버튼은 절대 클릭하지 않습니다. 최종 확인과 발행은 사용자가 직접 합니다.

## 개별 명령

글만 생성:

```bash
npm run post -- --keyword "탐정 비용 산정 기준" --type cost --output "output/test-post"
```

이미지만 생성:

```bash
npm run images -- \
  --title "탐정 비용 산정 기준" \
  --keyword "탐정 비용 산정 기준" \
  --provider openai \
  --output "output/test-post/images"
```

품질 검사:

```bash
npm run quality -- --file "output/test-post/post.md" --keyword "탐정 비용 산정 기준"
```

미리보기 생성:

```bash
npm run preview -- --folder "output/test-post" --no-open
```

## 보안 원칙

- 실제 API 키는 `.env`에만 둡니다.
- API 키를 README, 문서, 커밋, 채팅에 쓰지 않습니다.
- `.env`, `output/`, `PROGRESS_SUMMARY.txt`는 커밋하지 않습니다.
- 네이버 아이디/비밀번호는 스크립트가 요구하지 않습니다.
- 자동 발행은 하지 않습니다.

## Claude Code 구조

기존 Claude Code slash command와 agent 구조는 유지합니다.

```text
.claude/
├── commands/
└── agents/
```

Codex/터미널 작업에서는 `scripts/`와 `npm run ...` 명령을 보조 도구로 사용합니다.

## 라이선스

MIT
