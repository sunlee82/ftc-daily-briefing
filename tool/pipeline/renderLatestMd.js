#!/usr/bin/env node
// docs/data/latest.json → docs/data/latest.md
//
// 사내 AI 툴의 오토메이션이 .json을 내려받지 못해(500) 완성된 회람문을 .md로 미리 만들어 둔다.
// 툴은 이 파일을 열어 그대로 메일 본문에 넣기만 하면 되므로, 날마다 형식이 흔들리지 않는다.
// 순수 Node, 의존성 없음. 배포 워크플로우가 브리핑을 쓴 직후에 실행한다.
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join("docs", "data", "latest.json");
const OUT = path.join("docs", "data", "latest.md");
const ARCHIVE = "https://sunlee82.github.io/ftc-daily-briefing/";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

// 2026-09-07 → "2026. 9. 7. (월)"
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const [, y, mo, d] = m;
  const wd = WEEKDAY[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  return `${y}. ${+mo}. ${+d}. (${wd})`;
}

// 위원회 소식 본문의 ##[주요일정]## 같은 구분자를 읽기 좋은 소제목으로 바꾼다.
// 메일에 붙여넣었을 때 어색하지 않도록 마크다운 헤딩 대신 【 】를 쓴다.
function normalizeBody(text) {
  return String(text || "")
    .replace(/##\[([^\]]+)\]##/g, (_, label) => `【${label}】`)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SECTIONS = [
  { key: "press", title: "공정위 보도자료" },
  { key: "committee", title: "위원회 소식" },
  { key: "news", title: "언론 보도" },
];

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`${SRC}이 없습니다. latest.md를 만들지 않고 넘어갑니다.`);
    process.exit(0);
  }

  const brief = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const items = Array.isArray(brief.items) ? brief.items : [];

  const out = [];
  out.push(`# [공정위 일일동향] ${formatDate(brief.date || brief.id)}`);
  out.push("");
  out.push(`## ${String(brief.title || "").trim()}`);
  out.push("");

  if (brief.summary) {
    // 전체 요약은 그날 항목 전체를 아우르는 핵심 3줄로 온다(줄바꿈 구분).
    // 회람문에서도 불릿으로 세운다. 예전처럼 한 문단이면 그대로 싣는다.
    const lines = normalizeBody(brief.summary).split("\n").map((l) => l.trim()).filter(Boolean);
    out.push("### 오늘의 핵심");
    out.push("");
    if (lines.length > 1) {
      for (const l of lines) out.push(`- ${l.replace(/^[-·]\s*/, "")}`);
    } else {
      out.push(lines[0] || "");
    }
    out.push("");
  }

  for (const sec of SECTIONS) {
    // items는 이미 중요도 순으로 정렬돼 있다. 분류 안에서 그 순서를 그대로 지킨다.
    const list = items.filter((it) => it.category === sec.key);
    if (!list.length) continue;

    out.push(`### ${sec.title} (${list.length}건)`);
    out.push("");
    for (const it of list) {
      out.push(`**${String(it.headline || "").trim()}**`);
      out.push("");
      const body = normalizeBody(it.summary);
      if (body) {
        out.push(body);
        out.push("");
      }
      if (it.source_url) {
        out.push(`출처: ${it.source_url}`);
        out.push("");
      }
    }
  }

  out.push("---");
  out.push("");
  out.push("본 자료는 공정거래위원회 보도자료·위원회 소식 및 언론 보도를 정리한 것입니다.");
  out.push(`전체 아카이브: ${ARCHIVE}`);
  out.push("");

  const md = out.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, "utf8");
  console.log(`${OUT} 작성 완료 — ${brief.date || brief.id}, 항목 ${items.length}건, ${Buffer.byteLength(md, "utf8")}바이트`);
}

main();
