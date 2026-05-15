# 설치 가이드

## 1. 요구 사항

```bash
node --version
npm --version
```

Node.js 20 이상을 사용합니다.

네이버 초안 입력 기능을 쓰려면 Playwright 브라우저가 필요합니다.

```bash
npx playwright install chromium
```

## 2. 의존성 설치

```bash
npm install
```

## 3. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 필요한 값만 채웁니다.

| 키 | 필수 | 용도 |
|:---|:---:|:---|
| `IMAGE_PROVIDER` | 권장 | 기본값 `openai` |
| `OPENAI_API_KEY` | 필수 | 글 생성과 이미지 생성 |
| `OPENAI_TEXT_MODEL` | 선택 | 글 생성 모델, 예: `gpt-4.1-mini` |
| `OPENAI_IMAGE_MODEL` | 필수 | 이미지 생성 모델, 기본 목표 `gpt-image-2` |
| `BRAND_NAME` | 권장 | 이미지에 표시할 브랜드명 |
| `BRAND_LOGO_MARK` | 권장 | 이미지에 표시할 짧은 로고 마크 |
| `BRAND_PHONE` | 권장 | 이미지 하단 전화번호 |
| `GEMINI_API_KEY` | 선택 | 기존 Gemini 이미지 생성 호환용 |
| `GEMINI_IMAGE_MODEL` | 선택 | 기존 Gemini 이미지 생성 호환용 |
| `NAVER_CLIENT_ID` | 선택 | 리서치 보조 기능 호환용 |
| `NAVER_CLIENT_SECRET` | 선택 | 리서치 보조 기능 호환용 |
| `NAVER_SEARCHAD_API_KEY` | 선택 | 대시보드 키워드 추천용 |
| `NAVER_SEARCHAD_SECRET_KEY` | 선택 | 대시보드 키워드 추천용 |
| `NAVER_SEARCHAD_CUSTOMER_ID` | 선택 | 대시보드 키워드 추천용 |

예시:

```env
IMAGE_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-2

BRAND_NAME=탐정법인 범랑
BRAND_LOGO_MARK=BR
BRAND_PHONE=1660-2515
```

실제 API 키는 문서, Git, 채팅에 남기지 않습니다.

## 4. 네이버 로그인 세션 만들기

```bash
npm run naver:login
```

브라우저가 열리면 사용자가 직접 네이버에 로그인합니다.

주의:

- 네이버 아이디와 비밀번호는 스크립트가 요구하지 않습니다.
- 로그인 세션만 로컬 user-data-dir에 저장됩니다.
- 캡차, 2FA, 보안 인증은 사용자가 직접 처리합니다.

## 5. 첫 글 생성

```bash
npm run blog:auto -- --keyword "탐정 비용 산정 기준" --type cost
```

생성 결과는 `output/<날짜>_<키워드>/`에 저장됩니다.

## 6. 로컬 대시보드 실행

대시보드는 글 생성, 키워드 추천, 결과 폴더 확인, 네이버 글쓰기 입력을 브라우저에서 실행하는 로컬 도구입니다.

```bash
npm run dashboard
```

Windows PowerShell에서 `npm.ps1` 실행 정책 오류가 나면:

```powershell
npm.cmd run dashboard
```

기본 주소:

```text
http://127.0.0.1:3000/
```

포트가 이미 사용 중이면 다른 포트로 실행합니다.

```powershell
$env:PORT='3002'
npm.cmd run dashboard
```

더블클릭 실행 파일:

- Windows: `start-dashboard.bat`
- macOS: `start-dashboard.command`

## 7. 네이버 글쓰기 화면에 입력

```bash
npm run naver:draft -- --folder "output/2026-05-15_탐정비용산정기준"
```

이 명령은 발행 직전까지 자동 입력합니다.

자동 입력 범위:

- 제목
- 본문
- 이미지
- 태그

발행 버튼은 클릭하지 않습니다. 최종 확인과 발행은 사용자가 직접 합니다.

## 문제 해결

브라우저 프로필 잠금:

```text
기존 브라우저 세션에서 여는 중입니다.
```

열려 있는 Chrome for Testing 창을 닫고 다시 실행합니다.

API 키 오류:

```text
OPENAI_API_KEY is not set
```

`.env`에 `OPENAI_API_KEY`가 있는지 확인합니다.

이미지 결제/한도 오류:

OpenAI ChatGPT Plus와 OpenAI Platform API 결제는 별도입니다. Platform Billing에서 크레딧과 사용 한도를 확인합니다.

네이버 팝업/selector 오류:

네이버 글쓰기 UI가 바뀐 경우 `scripts/naver-draft.js`의 selector 조정이 필요할 수 있습니다.
