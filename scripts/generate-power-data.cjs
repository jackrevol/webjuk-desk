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
const spells = {};
for (const block of read("spl-data.h").matchAll(/\{([^{}]+)\}/g)) {
  const b = block[1],
    id = b.match(/(SPELL_\w+)\s*,\s*"([^"]+)"/),
    nums = b.match(/,\s*(\d+)\s*,\s*(\d+)\s*,/),
    tile = b.match(/TILEG_(\w+)/);
  if (!id || !nums || !tile) continue;
  const flags = [...b.matchAll(/spflag::(\w+)/g)].map((m) => m[1]);
  const zap = mapping[id[1]];
  const zb =
    zap &&
    [...zaps.matchAll(/\{([^{}]+)\}/g)].find((m) =>
      new RegExp("^\\s*" + zap + "\\s*,").test(m[1]),
    );
  const hit = zb?.[1]
    .split(",")
    .slice(0)
    .join(",")
    .match(
      /(?:nullptr|new \w+_calculator<[^>]+>)\s*,\s*new tohit_calculator<([^>]+)>/,
    );
  const factor = hit ? hit[1].split(",").map(Number) : null;
  spells[id[1]] = {
    name: id[2],
    tile: tile[1],
    level: +nums[1],
    cap: +nums[2],
    flags,
    flavour: zb?.[1].match(/\bBEAM_(\w+)/)?.[1] || null,
    hex:
      factor?.length === 3 && factor.every(Number.isFinite)
        ? factor
        : [0, 1, 1],
  };
  if (["SPELL_CAUSE_FEAR", "SPELL_ANGUISH", "SPELL_DISCORD"].includes(id[1]))
    spells[id[1]].hex = [0, 3, 2];
}
const data = { revision: "0a046544fd", spells };
fs.writeFileSync(
  path.join(__dirname, "../extension/power-data.js"),
  `/* Factual metadata from crawl/crawl 0a046544fd: spl-data.h, spl-zap.cc, zap-data.h.\n * Regenerate with scripts/generate-power-data.cjs; calculations use server descriptions. */\n(function(root){const data=${JSON.stringify(data)};if(typeof module==='object'&&module.exports)module.exports=data;else root.WebJukPowerData=data;})(globalThis);\n`,
);
console.log(Object.keys(spells).length + " spell definitions generated");
