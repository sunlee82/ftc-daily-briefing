# 공정거래위원회 일일동향 브리핑 도구 & 아카이브

관심 키워드를 입력하면 공정거래위원회의 오늘 동향을 정리한 브리핑을 만들어 미리보고, '배포'하면 공개 아카이브에 카드로 쌓이는 도구.

- 설계 문서: [PRD.md](PRD.md) · [STRUCTURE.md](STRUCTURE.md) — ⚠️ 최초 계획 당시 "경쟁사 모니터링" 개념으로 작성됨. 현재 코드는 공정위 단일 감시 대상으로 전환됨(문서 미반영)
- **현재 단계**: 실제 외부 연동 완료 — 수집=**serper.dev**, 요약=**Claude API(claude-opus-4-8)**. (배포 git push만 아직 로컬 저장 stub)

## 구조 (모노레포)

```
tool/                 # Part A. 브리핑 생성 도구 (로컬 실행)
  server.js           #   Node 내장 모듈만 사용, 의존성 없음
  pipeline/
    collect.js        #   ▶ 수집 — serper.dev/news 호출 (SERPER_API_KEY)
    summarize.js      #   ▶ 요약 — Claude API claude-opus-4-8 (CLAUDE_API_KEY)
  public/             #   입력·미리보기·편집 UI
docs/                 # Part B. 공개 아카이브 (GitHub Pages 루트)
  index.html          #   카드 인덱스
  briefing.html       #   상세 (?date=YYYY-MM-DD)
  data/               #   배포된 브리핑 스냅샷 (도구가 기록)
```

## 실행

```bash
node tool/server.js      # 또는: npm start
```

- 도구:     http://localhost:4173/
- 아카이브: http://localhost:4173/archive/

## 사용 순서

1. 도구 접속 → 경쟁사·키워드 입력 → **브리핑 생성**
2. 미리보기에서 제목·요약·항목 편집 (불필요한 항목 삭제)
3. **배포하기** → `docs/data/`에 스냅샷 저장 + 카드 인덱스 갱신
4. 아카이브에서 오늘 카드 확인

## 외부 연동 상태

`.env.example`를 `.env`로 복사해 키를 채운다.

| seam | 파일 | 상태 |
|------|------|------|
| 수집 | `tool/pipeline/collect.js` | ✅ serper.dev/news (SERPER_API_KEY) |
| 요약 | `tool/pipeline/summarize.js` | ✅ Claude API claude-opus-4-8 (CLAUDE_API_KEY) |
| 배포 | `tool/server.js`의 `publishToGit()` | ⏳ 로컬 저장만 — git push 연결은 다음 단계 |
