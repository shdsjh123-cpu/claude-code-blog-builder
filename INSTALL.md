# 설치 가이드 (30초)

## 1. 요구 사항 점검

```bash
node --version    # v20.0.0 이상
claude --version  # Claude Code 설치 확인
```

Node 20 미만이면 https://nodejs.org 에서 LTS 설치.
Claude Code 미설치면 https://docs.claude.com/en/docs/claude-code 참조.

## 2. 레포 clone

```bash
git clone https://github.com/shdsjh123-cpu/claude-code-blog-builder.git
cd claude-code-blog-builder
```

## 3. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 다음을 채웁니다:

| 키 | 필수 | 발급처 |
|:---|:---:|:---|
| `GEMINI_API_KEY` | ✅ | https://aistudio.google.com (무료) |
| `NAVER_CLIENT_ID` | ⚪ | https://developers.naver.com (없으면 웹 검색 대체) |
| `NAVER_CLIENT_SECRET` | ⚪ | 위와 동일 |
| `BRAND_NAME` | ⚪ | `/setup-domain`이 자동 설정 |

## 4. Claude Code 실행

```bash
claude
```

## 5. 셋업

```
/setup
```

5분 인터뷰가 시작됩니다. 7개 질문에 답하면 끝.

## 6. 첫 글 쓰기

```
/blog-new "여러분 키워드"
```

`output/<날짜>_<키워드>/` 폴더에 풀세트가 생성됩니다.

## 7. 발행

```
/blog-preview output/<폴더>
```

브라우저가 열리면 섹션별 복사 버튼으로 네이버 스마트에디터에 옮기세요.

---

## 문제 해결

설치/실행 중 문제가 발생하면 [docs/troubleshooting.md](docs/troubleshooting.md) 참조.

자주 발생하는 5가지 문제:
1. `claude command not found` → Claude Code 설치 안 됨
2. `Node version too old` → Node 20+ 필요
3. `GEMINI_API_KEY is not set` → `.env` 파일 미생성/미입력
4. `훅이 자동 실행 안 됨` → `.claude/settings.json` 권한 확인
5. `preview.html이 안 열림` → `--no-open` 플래그 빼고 재실행
