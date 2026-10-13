/* Rebuild factual spell metadata from a local checkout of the pinned DCSS source. */
const fs = require("node:fs");
const path = require("node:path");
const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: node scripts/generate-power-data.cjs /path/to/crawl-ref/source",
  );
const read = (name) =>
  fs
    .readFileSync(path.join(source, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
const zaps = read("zap-data.h"),
  mapping = Object.fromEntries(
    [
      ...read("spl-zap.cc").matchAll(/\{\s*(SPELL_\w+)\s*,\s*(ZAP_\w+)\s*\}/g),
    ].map((m) => [m[1], m[2]]),
  );
// 템플릿 인자의 쉼표와 문자열 내부의 쉼표를 필드 구분자로 취급하지 않습니다.
function fields(block) {
  const values = [];
  let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < block.length; i++) {
    if (block[i] === '"' && block[i - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (block[i] === "<") depth++;
    if (block[i] === ">") depth--;
    if (block[i] === "," && depth === 0) {
      values.push(block.slice(start, i).trim());
      start = i + 1;
    }
  }
  return values;
}
function hitFactors(value) {
  const match = value?.match(/^new tohit_calculator<([^>]+)>$/);
  if (!match || match[1] === "AUTOMATIC_HIT") return null;
  const args = match[1].split(",").map(Number);
  return args.every(Number.isFinite)
    ? [args[0], args[1] ?? 0, args[2] ?? 1]
    : null;
}
const zapDefinitions = new Map(
  [...zaps.matchAll(/\{([^{}]+)\}/g)]
    .map((m) => fields(m[1]))
    .filter((f) => /^ZAP_\w+$/.test(f[0]))
    .map((f) => [f[0], f]),
);
function zapDefence(zap) {
  const f = zapDefinitions.get(zap);
  if (!f || f[2] === "nullptr") return null;
  const flavour = f[8].replace(/^BEAM_/, ""),
    enchantment = f[7] === "true",
    automatic = enchantment || f[11] === "true" || f[3].includes("AUTOMATIC_HIT");
  return {
    flavour,
    ac: enchantment || flavour === "DAMNATION" ? "none"
      : ["ELECTRICITY", "THUNDER", "STUN_BOLT"].includes(flavour) ? "half"
      : flavour === "FRAG" ? "triple" : "normal",
    automatic,
    accuracy: automatic ? null : hitFactors(f[3]),
    shield: !automatic && f[10] !== "true" && flavour !== "ELECTRICITY",
  };
}
const defenceSource = read("spl-cast.cc"),
  defenceTable = defenceSource.match(/_spell_defences\s*=\s*\{([\s\S]*?)\n\};/)?.[1] || "",
  directDefences = new Map();
for (const m of defenceTable.matchAll(/\{\s*(SPELL_\w+)\s*,\s*(?:_ac_only|\{\s*ac_type::(\w+),\s*(true|false),\s*(true|false),\s*(true|false),\s*\{([^}]*)\}([^}]*)\})\s*\}/g)) {
  // 복합 속성·지형 조건이 있는 예외는 아래의 명시적 구성 요소 외에는 추측하지 않습니다.
  if (m[7]?.includes('"')) continue;
  directDefences.set(m[1], {
    flavour: m[6]?.match(/BEAM_(\w+)/)?.[1] || null,
    ac: m[2] || "normal",
    automatic: m[3] !== "true",
    accuracy: null,
    shield: m[4] === "true",
  });
}
const spells = {};
for (const block of read("spl-data.h").matchAll(/\{([^{}]+)\}/g)) {
  const b = block[1],
    id = b.match(/(SPELL_\w+)\s*,\s*"([^"]+)"/),
    nums = b.match(/,\s*(\d+)\s*,\s*(\d+)\s*,/),
    tile = b.match(/TILEG_(\w+)/);
  if (!id || !nums || !tile) continue;
  const flags = [...b.matchAll(/spflag::(\w+)/g)].map((m) => m[1]);
  const zap = mapping[id[1]];
  const zb = zapDefinitions.get(zap),
    factor = hitFactors(zb?.[3]),
    defence = directDefences.get(id[1]) || zapDefence(zap);
  spells[id[1]] = {
    name: id[2],
    tile: tile[1],
    level: +nums[1],
    cap: +nums[2],
    flags,
    flavour: defence?.flavour || zb?.[8]?.replace(/^BEAM_/, "") || null,
    hex: flags.includes("WL_check") && factor ? factor : [0, 1, 1],
    defence,
  };
  if (["SPELL_CAUSE_FEAR", "SPELL_ANGUISH", "SPELL_DISCORD"].includes(id[1]))
    spells[id[1]].hex = [0, 3, 2];
}
// zap의 기본 규칙과 실제 시전 경로가 다른 경우입니다 (spl-damage.cc).
spells.SPELL_FREEZE.defence.ac = "none";
for (const [id, components] of [
  ["SPELL_PLASMA_BEAM", [zapDefence("ZAP_PLASMA"), zapDefence("ZAP_PLASMA_LIGHTNING")]],
  ["SPELL_PERMAFROST_ERUPTION", [zapDefence("ZAP_PERMAFROST_ERUPTION_EARTH"),
    { ...zapDefence("ZAP_PERMAFROST_ERUPTION_COLD"), ac: "none", automatic: true, accuracy: null, shield: false }]],
]) {
  spells[id].defence = null;
  spells[id].components = components;
}
// 설명에 조건에 따른 별도 방어 규칙이 표시되는 주문입니다.
for (const id of ["SPELL_LRD", "SPELL_FULSOME_FUSILLADE", "SPELL_SHATTER"])
  spells[id].defence = null;
const data = { revision: "0a046544fd", spells };
function format(value, indent = 2) {
  const pad = " ".repeat(indent), childPad = " ".repeat(indent + 2);
  if (Array.isArray(value)) {
    const inline = JSON.stringify(value).replace(/,/g, ", ");
    if (value.every((v) => v === null || typeof v !== "object") && inline.length + indent <= 76) return inline;
    return `[\n${value.map((v) => childPad + format(v, indent + 2) + ",").join("\n")}\n${pad}]`;
  }
  if (value && typeof value === "object")
    return `{\n${Object.entries(value).map(([key, v]) => `${childPad}${key}: ${format(v, indent + 2)},`).join("\n")}\n${pad}}`;
  return JSON.stringify(value);
}
fs.writeFileSync(
  path.join(__dirname, "../extension/power-data.js"),
  `/* Factual metadata from crawl/crawl 0a046544fd: spl-data.h, spl-zap.cc, zap-data.h, spl-cast.cc.\n * Regenerate with scripts/generate-power-data.cjs; calculations use server descriptions. */\n(function (root) {\n  const data = ${format(data)};\n  if (typeof module === "object" && module.exports) module.exports = data;\n  else root.WebJukPowerData = data;\n})(globalThis);\n`,
  "utf8",
);
console.log(Object.keys(spells).length + " spell definitions generated");
