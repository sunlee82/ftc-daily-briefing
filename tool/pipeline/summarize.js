// ┌─────────────────────────────────────────────────────────────────────┐
// │  요약 단계 — Claude API(claude-opus-4-8) 실제 연동.                   │
// │  카테고리별로 서로 다른 전략을 쓴다:                                  │
// │   - 뉴스 보도내용(news): 수집 원문을 Claude로 요약(제목·항목요약)     │
// │   - 공정위 보도자료(press): 공식 제목을 그대로 쓰므로 Claude 호출 없음│
// │   - 위원회 소식(committee): 첨부 PDF를 Claude에 직접 읽혀             │
// │     [주요일정]/[인사발령] 섹션만 구조화 추출                          │
// │  구조화 출력(json_schema)으로 형식을 강제한다.                        │
// │  환경변수 CLAUDE_API_KEY 필요.                                        │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// 사용자가 CLAUDE_MODEL을 지정하지 않으면 기본은 claude-opus-4-8
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const CATEGORY_LABELS = {
  press: "공정위 보도자료",
  committee: "위원회 소식",
  news: "뉴스 보도내용",
};

// Claude가 반드시 이 형태의 JSON을 내도록 강제하는 스키마
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "브리핑 전체 제목 (한국어, 30자 내외)" },
    summary: { type: "string", description: "카드에 노출될 핵심 요약 (한국어, 2~3문장)" },
    items: {
      type: "array",
      description: "최종적으로 브리핑에 포함할 항목만 담습니다. 기존 항목과 중복·유사해 제외하는 항목은 여기 넣지 않습니다.",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "입력 항목의 index 값 그대로" },
          headline: { type: "string", description: "다듬은 항목 제목 (한국어)" },
          summary: { type: "string", description: "항목 핵심 요약 (한국어, 1~2문장)" },
        },
        required: ["index", "headline", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "summary", "items"],
  additionalProperties: false,
};

function buildPrompt(numbered, ctx) {
  const lines = [
    "당신은 공정거래위원회(공정위)의 일일동향을 정리하는 애널리스트입니다.",
    `모니터링 대상 기관: ${ctx.competitors.join(", ")}`,
    `관심 키워드: ${ctx.keywords.join(", ")}`,
    "",
    "아래 수집 항목들을 바탕으로 오늘의 공정위 동향 브리핑을 만들어 주세요.",
    "규칙:",
    "- 모든 출력은 한국어로 작성합니다.",
    "- 각 항목마다 간결한 제목(headline)과 1~2문장 핵심 요약(summary)을 작성합니다.",
    "- 추측이나 과장 없이 수집된 내용에 근거해 사실 위주로 씁니다.",
    "- index는 입력에 주어진 값을 그대로 유지합니다(항목을 원문과 연결하는 키).",
    "- 전체 제목(title)과 카드용 핵심 요약(summary, 2~3문장)도 작성합니다.",
  ];
  if (ctx.existingHeadlines && ctx.existingHeadlines.length) {
    lines.push(
      "- 아래 '이미 브리핑에 포함된 항목' 목록과 실질적으로 같은 사건·소식을 다루는 항목(다른 매체가 같은 사건을 보도한 경우 포함)은 결과에서 제외하세요. 즉 items 배열에 그 항목의 index를 아예 포함하지 마세요.",
      "",
      "이미 브리핑에 포함된 항목(제외 대상 판단용):",
      ctx.existingHeadlines.map((h) => `- ${h}`).join("\n")
    );
  }
  lines.push("", "수집 항목(JSON):", JSON.stringify(numbered, null, 2));
  return lines.join("\n");
}

/**
 * raw 항목들을 Claude로 요약해 브리핑으로 정리한다.
 * ctx.existingHeadlines가 있으면 그 목록과 중복·유사한 항목은 결과에서 제외한다
 * (추가 검색 시 이미 브리핑에 담긴 소식과 겹치지 않게 하는 용도).
 * @param {Array} rawItems  collect()의 결과 (dedupe 완료본)
 * @param {{competitors:string[], keywords:string[], date:string, existingHeadlines?:string[]}} ctx
 * @returns {{title:string, summary:string, items:Array}}
 */
async function summarize(rawItems, ctx) {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("CLAUDE_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요.");
  }
  const compLabel = ctx.competitors.join("·");

  if (!rawItems.length) {
    return {
      title: `${compLabel} 일일동향 — 신규 소식 없음`,
      summary: `${compLabel}에 대한 신규 동향이 포착되지 않았습니다.`,
      items: [],
    };
  }

  const numbered = rawItems.map((r, i) => ({
    index: i,
    competitor: r.competitor,
    keyword: r.keyword,
    title: r.title,
    snippet: r.snippet,
    published_at: r.published_at,
  }));

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: buildPrompt(numbered, ctx) }],
  });

  const text = res.content.find((b) => b.type === "text")?.text || "{}";
  const parsed = JSON.parse(text);

  // Claude가 낸 요약을 index로 원문(source_url 등)과 다시 결합.
  // Claude가 items에 포함하지 않은 index(=중복·유사 판단으로 제외한 항목)는 결과에서도 뺀다.
  const byIndex = new Map((parsed.items || []).map((it) => [it.index, it]));
  const items = rawItems
    .map((r, i) => {
      const s = byIndex.get(i);
      if (!s) return null;
      return {
        category: "news",
        category_label: CATEGORY_LABELS.news,
        competitor: r.competitor,
        keyword: r.keyword,
        headline: s.headline || r.title,
        summary: s.summary || r.snippet,
        source_url: r.url,
        published_at: r.published_at,
      };
    })
    .filter(Boolean);

  return {
    title: parsed.title || `${compLabel} 일일동향 — 핵심 ${items.length}건`,
    summary: parsed.summary || `${compLabel}에 대해 총 ${items.length}건의 동향이 포착됐습니다.`,
    items,
  };
}

/**
 * 공정위 보도자료 원문을 그대로 항목으로 변환한다. 공식 제목을 그대로 쓰므로
 * Claude 호출이 필요 없다(비용 없음, 파싱 오류로 인한 왜곡도 없음).
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

const COMMITTEE_SCHEMA = {
  type: "object",
  properties: {
    schedule: { type: "array", items: { type: "string" }, description: "[주요일정] 섹션 항목 목록. 직함·성명은 **볼드**로 감쌈. 없으면 빈 배열." },
    personnel: { type: "array", items: { type: "string" }, description: "[인사발령] 섹션 항목 목록. 직함·성명은 **볼드**로 감쌈. 없으면 빈 배열." },
  },
  required: ["schedule", "personnel"],
  additionalProperties: false,
};

/**
 * 위원회 소식 첨부 PDF를 Claude에 직접 읽혀 [주요일정]/[인사발령] 섹션을 추출한다.
 * @param {Array} rawItems  collectFtcBoard.fetchCommitteeNews()의 결과 (각 항목에 pdfBase64 포함)
 */
async function summarizeCommittee(rawItems) {
  if (!rawItems.length) return [];
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("CLAUDE_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요.");
  }
  const client = new Anthropic({ apiKey });

  const settled = await Promise.allSettled(
    rawItems.map(async (r) => {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: COMMITTEE_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: r.pdfBase64 } },
              {
                type: "text",
                text: [
                  "이 PDF는 공정거래위원회 위원회 소식 문서입니다.",
                  "[주요일정] 섹션과 [인사발령] 섹션의 내용을 각각 목록으로 추출해주세요.",
                  "규칙:",
                  "- 각 배열 항목은 실제 일정·인사 내용만 담습니다.",
                  "- 인사발령 항목 맨 앞에 붙는 문서관리번호(예: '운영지원과-8889 (4181) 2026. 7. 13. -' 같은 부서명-접수번호 (일련번호) 날짜. - 형식)는 내용이 아니라 문서 관리용 식별자이므로 반드시 제외하고, 그 뒤의 실제 인사 내용부터 담습니다.",
                  "- 사람을 가리키는 표현(위원장·부위원장·상임위원 등 직함, 실제 성명)은 마크다운 볼드(**이름**)로 감싸주세요. 예: '**위원장**: 10:00 국무회의', '**신경화** 행정사무관 - ...'.",
                  "- 해당 섹션이 없으면 빈 배열로 응답하세요.",
                ].join("\n"),
              },
            ],
          },
        ],
      });
      const text = res.content.find((b) => b.type === "text")?.text || "{}";
      const { schedule = [], personnel = [] } = JSON.parse(text);
      // 문서관리번호 접두어(예: "운영지원과-8889 (4181) 2026. 7. 13. - ")가 남아있으면 방어적으로 한 번 더 제거
      const stripDocRef = (s) => s.replace(/^\S+-\d+\s*\(\d+\)\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*-\s*/, "");
      const parts = [];
      if (schedule.length) parts.push(`##[주요일정]##\n${schedule.map((s) => `· ${stripDocRef(s)}`).join("\n")}`);
      if (personnel.length) parts.push(`##[인사발령]##\n${personnel.map((s) => `· ${stripDocRef(s)}`).join("\n")}`);
      return {
        category: "committee",
        category_label: CATEGORY_LABELS.committee,
        headline: r.headline,
        summary: parts.join("\n\n") || "주요일정·인사발령 내용 없음",
        source_url: r.source_url,
        published_at: r.published_at,
      };
    })
  );

  const items = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") items.push(res.value);
    else console.warn(`[summarize] 위원회 소식 PDF 요약 실패 (${rawItems[i].headline}): ${res.reason.message}`);
  });
  return items;
}

const OVERVIEW_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "브리핑 전체 제목 (한국어, 30자 내외)" },
    summary: { type: "string", description: "카드에 노출될 핵심 요약 (한국어, 2~3문장)" },
  },
  required: ["title", "summary"],
  additionalProperties: false,
};

/**
 * 사용자가 최종적으로 취사선택·추가검색·순서조정을 마친 항목 목록을 바탕으로
 * 브리핑 전체 제목과 핵심 요약만 다시 만든다. (항목별 요약은 건드리지 않음)
 * @param {Array<{headline:string, summary:string, category_label?:string}>} items  현재 미리보기의 최종 항목들
 * @returns {{title:string, summary:string}}
 */
async function regenerateOverview(items) {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("CLAUDE_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요.");
  }
  if (!items.length) {
    return { title: "공정거래위원회 일일동향 — 항목 없음", summary: "선택된 항목이 없습니다." };
  }

  const listed = items.map((it) => ({
    category: it.category_label || CATEGORY_LABELS[it.category] || it.category,
    headline: it.headline,
    summary: it.summary,
  }));

  const prompt = [
    "당신은 공정거래위원회(공정위)의 일일동향을 정리하는 애널리스트입니다.",
    "아래는 사용자가 검색 결과 중 취사선택하고, 필요하면 추가 검색도 거치고, 순서까지 직접 배치한",
    "오늘 브리핑의 '최종' 항목 목록입니다. 이 목록에 실제로 포함된 내용만 근거로",
    "브리핑 전체 제목과 카드에 노출될 핵심 요약(2~3문장)을 새로 작성해주세요.",
    "규칙:",
    "- 한국어로 작성합니다.",
    "- 목록에 없는 내용을 추측해서 넣지 않습니다.",
    "- 제목은 30자 내외로, 가장 대표성 있는 항목 위주로 작성합니다.",
    "- 요약은 목록 순서(=사용자가 배치한 중요도 순)를 고려해 앞쪽 항목을 우선 반영합니다.",
    "",
    "최종 항목 목록(순서대로, JSON):",
    JSON.stringify(listed, null, 2),
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: OVERVIEW_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content.find((b) => b.type === "text")?.text || "{}";
  const parsed = JSON.parse(text);
  return {
    title: parsed.title || `공정거래위원회 일일동향 — 핵심 ${items.length}건`,
    summary: parsed.summary || `총 ${items.length}건의 동향이 포함됐습니다.`,
  };
}

module.exports = { summarize, buildPressItems, summarizeCommittee, regenerateOverview, CATEGORY_LABELS };
