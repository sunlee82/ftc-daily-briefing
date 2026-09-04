// ┌─────────────────────────────────────────────────────────────────────┐
// │  항목 구성 단계 — Claude API를 전혀 사용하지 않는다.                   │
// │  카테고리별 전략:                                                     │
// │   - 공정위 보도자료(press): 공식 제목을 그대로 사용                    │
// │   - 위원회 소식(committee): PDF를 파일로 저장(pdfPath)하고, pdf-parse  │
// │     로 텍스트만 그대로 뽑아 pdfText에 담는다(요약·구조화는 안 함) —    │
// │     PDF를 직접 열 수 없는 AI 툴도 pdfText만 읽으면 원문을 볼 수 있다   │
// │   - 뉴스 보도내용(news): 검색 결과 제목·스니펫을 그대로 사용            │
// │  화면에서는 사용자가 원문을 보고 취사선택·순서조정만 하면 되고,        │
// │  제목/요약 다듬기·[주요일정]/[인사발령] 구조화·최종 배포(git push)는   │
// │  이 결과를 Claude Code(구독 세션)가 이어받아 수행한다.                 │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const path = require("path");
const fs = require("fs");
const { PDFParse } = require("pdf-parse");

const CATEGORY_LABELS = {
  press: "공정위 보도자료",
  committee: "위원회 소식",
  news: "뉴스 보도내용",
};

/**
 * 공정위 보도자료 원문을 그대로 항목으로 변환한다. 공식 제목을 그대로 쓴다.
 * @param {Array} rawItems  collectFtcBoard.fetchPressReleases()의 결과
 */
function buildPressItems(rawItems) {
  return rawItems.map((r) => ({
    category: "press",
    category_label: CATEGORY_LABELS.press,
    headline: r.headline,
    summary: `담당부서: ${r.dept} (${r.boardLabel})`,
    source_url: r.source_url,
    published_at: r.published_at,
  }));
}

/**
 * 뉴스 원문을 다듬지 않고 그대로 항목으로 변환한다. 제목/요약은 검색 결과
 * 원문(title/snippet)을 그대로 쓰고, 사용자가 화면에서 원문을 확인해
 * 취사선택·순서조정만 하도록 한다. 최종 다듬기는 이후 Claude Code가 맡는다.
 * @param {Array} rawItems  collect()의 결과 (dedupe 완료본)
 */
function buildRawNewsItems(rawItems) {
  return rawItems.map((r) => ({
    category: "news",
    category_label: CATEGORY_LABELS.news,
    competitor: r.competitor,
    keyword: r.keyword,
    headline: r.title,
    summary: r.snippet || "(요약 없음 — 원문 확인 필요)",
    source_url: r.url,
    published_at: r.published_at,
  }));
}

// tool/.raw-pdfs/ — .gitignore에 이미 등록된 임시 폴더. 위원회 소식 PDF를 저장해두면
// 나중에 Claude Code가 Read 도구로 직접 열어 요약할 수 있다.
const PDF_DIR = path.join(__dirname, "..", ".raw-pdfs");

// pdf-parse가 뽑아낸 텍스트는 글자 사이에 탭 문자가 잔뜩 끼어 나온다(PDF 내부 글자
// 배치 방식 때문). 줄 단위로 탭·중복 공백을 정리하고, 페이지 구분자("-- 1 of 2 --")는 뺀다.
function cleanPdfText(raw) {
  return raw
    .split("\n")
    .map((line) => line.replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim())
    .filter((line) => line && !/^-- \d+ of \d+ --$/.test(line))
    .join("\n");
}

/**
 * 위원회 소식 PDF를 파일로 저장(pdfPath)하고, pdf-parse로 텍스트만 그대로 뽑아
 * pdfText에 담는다(요약이나 [주요일정]/[인사발령] 구조화는 하지 않음 — 원문 텍스트
 * 그대로). PDF를 직접 열 수 없는 AI 툴도 pdfText만 읽으면 원문을 확인할 수 있다.
 * 실제 [주요일정]/[인사발령] 구조화·정리는 이후 Claude Code가 수행한다. pdfPath·
 * pdfText는 로컬 전용 필드로, 실제 배포 시에는 docs/data에 포함되지 않는다
 * (Claude Code가 최종 정리하며 제거).
 * @param {Array} rawItems  collectFtcBoard.fetchCommitteeNews()의 결과 (각 항목에 pdfBase64 포함)
 * @param {string} [pdfDir]  PDF 저장 경로 (기본값: tool/.raw-pdfs/, 자동화 스크립트는
 *   git에 커밋되는 tool/pending/ 하위 경로를 넘겨 Cowork가 저장소에서 바로 읽게 한다)
 */
async function buildRawCommitteeItems(rawItems, pdfDir = PDF_DIR) {
  if (!rawItems.length) return [];
  fs.mkdirSync(pdfDir, { recursive: true });
  return Promise.all(
    rawItems.map(async (r) => {
      let pdfPath = null;
      let pdfText = null;
      if (r.pdfBase64) {
        const buf = Buffer.from(r.pdfBase64, "base64");
        const safeName = r.headline.replace(/[^\w가-힣.-]/g, "_").slice(0, 60);
        pdfPath = path.join(pdfDir, `${r.published_at}_${safeName}.pdf`);
        fs.writeFileSync(pdfPath, buf);
        try {
          const parser = new PDFParse({ data: buf });
          const result = await parser.getText();
          pdfText = cleanPdfText(result.text);
        } catch (err) {
          console.warn(`[summarize] PDF 텍스트 추출 실패 (${r.headline}): ${err.message}`);
        }
      }
      return {
        category: "committee",
        category_label: CATEGORY_LABELS.committee,
        headline: r.headline,
        summary: "(PDF 원문 확인 필요 — 배포 전 Claude Code가 요약)",
        source_url: r.source_url,
        published_at: r.published_at,
        pdfPath,
        pdfText,
      };
    })
  );
}

/**
 * 전체 제목/요약도 Claude 호출 없이 일반화된 자리표시자로 채운다. 실제 제목/요약은
 * 사용자가 화면에서 취사선택을 마친 뒤 Claude Code가 다시 작성한다.
 */
function buildRawOverview(items, compLabel) {
  if (!items.length) {
    return { title: `${compLabel} 일일동향 — 신규 소식 없음`, summary: `${compLabel}에 대한 신규 동향이 포착되지 않았습니다.` };
  }
  return {
    title: `${compLabel} 일일동향 (초안 — ${items.length}건, 제목 다듬기 필요)`,
    summary: "항목을 취사선택·순서조정한 뒤 저장하면 Claude Code가 제목/요약을 다듬어 배포합니다.",
  };
}

module.exports = { buildPressItems, buildRawNewsItems, buildRawCommitteeItems, buildRawOverview, CATEGORY_LABELS };
