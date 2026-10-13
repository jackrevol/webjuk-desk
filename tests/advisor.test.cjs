const { test } = require("node:test");
const assert = require("node:assert/strict");
const Advisor = require("../extension/advisor.js");
const normal = {
  stats: {
    hp: 50,
    hpMax: 60,
    mp: 5,
    mpMax: 10,
    ac: 8,
    ev: 10,
    sh: 4,
    xl: 9,
    status: [],
  },
  monsters: [{ att: 0, count: 1 }],
  items: [],
  spells: [],
};
const monster = { att: 0, threat: 1, distance: 2, avgHp: 18 };
test("visible injury flags map to original HP percentage bands, never exact HP", () => {
  const names = [
    "MDAM_ADEAD",
    "MDAM_SEV",
    "MDAM_HEAVY",
    "MDAM_MOD",
    "MDAM_LIGHT",
  ];
  const flags = Object.fromEntries(names.map((key) => [key, false]));
  assert.deepEqual(Advisor.healthBand(flags), [100, 100]);
  names.forEach((key, index) =>
    assert.deepEqual(Advisor.healthBand({ ...flags, [key]: true }), [
      index * 20,
      (index + 1) * 20,
    ]),
  );
  assert.equal(Advisor.healthBand(null), null);
  assert.equal(Advisor.healthBand([6723, 0]), null);
  const report = Advisor.healthSummary({
    count: 1,
    healthBands: [[40, 60]],
    avgHp: 18,
  });
  assert.equal(report.percent, "40–60%");
  assert.equal(report.avg, 18);
  assert.match(report.title, /실제 최대 HP 아님/);
  assert.equal(
    Advisor.healthSummary({ count: 1, healthBands: [null] }).percent,
    "?",
  );
});
test("group health encloses individual injury bands without summing average HP", () => {
  const report = Advisor.healthSummary({
    count: 2,
    healthBands: [
      [0, 20],
      [80, 100],
    ],
    avgHp: 18,
  });
  assert.equal(report.percent, "0–100%");
  assert.equal(report.avg, 18);
  assert.match(report.title, /합산 HP가 아닙니다/);
  assert.equal(
    Advisor.healthSummary({ count: 2, healthBands: [[100, 100], null] })
      .percent,
    "?",
  );
  assert.equal(Advisor.healthSummary({ count: 0 }).percent, "?");
});
test("low health and groups escalate source threat while friendly monsters are excluded", () => {
  assert.equal(Advisor.advise(normal, monster).risk, 1);
  const low = {
    ...normal,
    stats: { ...normal.stats, hp: 8 },
    monsters: [{ att: 0, count: 3 }],
  };
  assert.equal(Advisor.advise(low, monster).risk, 3);
  assert.equal(
    Advisor.advise(low, { ...monster, att: 4 }).candidates.length,
    0,
  );
  assert.equal(Advisor.advise(low, { ...monster, att: 4 }).label, "우호");
});
test("spell candidates require known failure, sufficient MP and no known immunity", () => {
  const spells = [
    { id: "fire", name: "Fireball", fail: 5, level: 5 },
    { id: "cold", name: "Freeze", fail: 2, level: 1 },
    { id: "cost", name: "Shatter", fail: 1, level: 9 },
    { id: "fail", name: "Magic Dart", fail: 60, level: 1 },
    { id: "unknown", name: "Unknown", fail: null, level: 1 },
  ];
  const result = Advisor.advise(
    { ...normal, spells },
    { ...monster, resists: { cold: 3, fire: -1 } },
  );
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    ["fire"],
  );
  assert.match(result.candidates[0].reason, /약점/);
});
test("empty wands, unidentified potions and resisted poison are not promoted as effective", () => {
  const items = [
    { slot: 52, name: "a ruby potion", category: "potion", action: "Drink" },
    {
      slot: 3,
      name: "poisoned darts",
      category: "missile",
      action: "Activate",
    },
    {
      slot: 60,
      name: "a wand of flame",
      category: "evoke",
      action: "Zap",
      charges: 0,
    },
    {
      slot: 61,
      name: "a potion of heal wounds",
      category: "potion",
      action: "Drink",
    },
  ];
  const result = Advisor.advise(
    { ...normal, stats: { ...normal.stats, hp: 10 }, items },
    { ...monster, resists: { poison: 3 } },
  );
  assert.deepEqual(
    result.candidates.map((c) => c.slot),
    [61],
  );
  assert.equal(result.candidates[0].role, "회복");
});
test("skill snapshots parse English and Korean levels and influence available candidates", () => {
  const skills = Advisor.skillLevels([
    "a + Fighting       4.5  20%",
    "b - 투척           3.2   0%",
    "발동술 5.0",
    "c * Evocations 7.1",
  ]);
  assert.equal(skills.throwing, 3.2);
  assert.equal(skills.fighting, 4.5);
  assert.equal(skills.evocations, 7.1);
  const items = [
    {
      slot: 1,
      name: "javelins",
      category: "missile",
      action: "Activate",
      combat: { rating: 6 },
    },
    {
      slot: 2,
      name: "wand of flame",
      category: "evoke",
      action: "Zap",
      charges: 3,
      combat: { damage: "2d8" },
    },
  ];
  const result = Advisor.advise(
    { ...normal, skills, skillsLoaded: true, items },
    monster,
  );
  assert.equal(result.candidates[0].slot, 2);
  assert.match(result.candidates[0].reason, /7.1/);
});
test("resistance parser reads only explicit game symbols and never guesses zero", () => {
  assert.deepEqual(
    Advisor.resistances("rF: +..  rC: x..  rPois: ∞  rElec: +"),
    { fire: 1, cold: -1, poison: 3, electricity: 1 },
  );
  assert.deepEqual(Advisor.resistances("Untranslated monster description"), {});
});
test("Korean skill screen parses skill suffixes, zero levels and both columns", () => {
  const levels = Advisor.skillLevels([
    "a + 전투 기술        5.4    5.0    +1     k + 주문 시전술      0.0    1.4    -2",
    "f - 투척술           0.0    1.4    -2     o + 발동술           0.0    0.8    +1",
    "p - 기도술           3.2    1.0     0",
  ]);
  assert.deepEqual(levels, {
    fighting: 5.4,
    spellcasting: 0,
    throwing: 0,
    evocations: 0,
    invocations: 3.2,
  });
});
test("item retrieval spells are excluded from monster combat candidates", () => {
  for (const name of ["Apportation", "수집", "마법의 수집"]) {
    const report = Advisor.advise(
      { ...normal, spells: [{ id: name, name, fail: 1, level: 1 }] },
      monster,
    );
    assert.equal(report.candidates.length, 0);
  }
});
