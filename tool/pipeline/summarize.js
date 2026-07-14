// ┌─────────────────────────────────────────────────────────────────────┐
// │  요약 단계 — Claude API(claude-opus-4-8) 실제 연동.                   │
// │  수집된 원문 항목을 Claude로 요약해 브리핑(제목·핵심요약·항목요약)을  │
// │  생성한다. 구조화 출력(json_schema)으로 형식을 강제한다.             │
// │  환경변수 CLAUDE_API_KEY 필요.                                        │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// 사용자가 CLAUDE_MODEL을 지정하지 않으면 기본은 claude-opus-4-8
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// Claude가 반드시 이 형태의 JSON을 내도록 강제하는 스키마
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "브리핑 전체 제목 (한국어, 30자 내외)" },
    summary: { type: "string", description: "카드에 노출될 핵심 요약 (한국어, 2~3문장)" },
    items: {
      type: "array",
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
  return [
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
    "",
    "수집 항목(JSON):",
    JSON.stringify(numbered, null, 2),
  ].join("\n");
}

/**
 * raw 항목들을 Claude로 요약해 브리핑으로 정리한다.
 * @param {Array} rawItems  collect()의 결과 (dedupe 완료본)
 * @param {{competitors:string[], keywords:string[], date:string}} ctx
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

  // Claude가 낸 요약을 index로 원문(source_url 등)과 다시 결합
  const byIndex = new Map((parsed.items || []).map((it) => [it.index, it]));
  const items = rawItems.map((r, i) => {
    const s = byIndex.get(i) || {};
    return {
      competitor: r.competitor,
      keyword: r.keyword,
      headline: s.headline || r.title,
      summary: s.summary || r.snippet,
      source_url: r.url,
      published_at: r.published_at,
    };
  });

  return {
    title: parsed.title || `${compLabel} 일일동향 — 핵심 ${items.length}건`,
    summary: parsed.summary || `${compLabel}에 대해 총 ${items.length}건의 동향이 포착됐습니다.`,
    items,
  };
}

module.exports = { summarize };
