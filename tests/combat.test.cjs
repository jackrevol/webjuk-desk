const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../extension/combat");
const Advisor = require("../extension/advisor");
const Data = require("../extension/power-data");
const state = {
  stats: { hp: 50, hpMax: 50, mp: 20, mpMax: 20 },
  skills: { evocations: 10 },
  combatProfile: { mpWands: 0 },
  items: [],
  spells: [],
  monsters: [{ att: 0, count: 1 }],
};
const mind = {
  name: "정신붕괴의 마법봉",
  sourceId: "SPELL_MINDBURST",
  baseType: 3,
  category: "evoke",
  charges: 3,
  action: "Zap",
  combat: { damage: "3d17" },
};
test("all source spell definitions are keyed independently of translated names", () => {
  assert.ok(Object.keys(Data.spells).length > 400);
  assert.equal(
    C.identifySpell({ name: "수집", tiles: [{ t: 10 }] }, { APPORTATION: 10 }),
    "SPELL_APPORTATION",
  );
  assert.equal(C.definition(mind).cap, 200);
  assert.deepEqual(C.definition(mind).hex, [0, 5, 2]);
  assert.equal(
    C.identifyWand({ name: "arbitrary", tile: [123] }, { WAND_MINDBURST: 123 }),
    "SPELL_MINDBURST",
  );
});
test("source hex probability agrees with exhaustive independent dice rolls", () => {
  for (const [power, stepped] of [
    [0, 0],
    [35, 35],
    [105, 70],
  ])
    for (const will of [0, 40, 100, 200]) {
      let successes = 0;
      for (let a = 0; a < 100; a++)
        for (let b = 0; b < 101; b++)
          if (a + b >= will + 100 - stepped) successes++;
      assert.equal(
        C.hexChance(will, power),
        Math.floor((successes * 100) / 10100),
      );
    }
  assert.equal(C.hexChance(5000, 1000), 0);
});
test("rounded skill and mutation MP cost produce bounded source wand power", () => {
  assert.deepEqual(C.wandPower(state, mind), [50, 50]);
  assert.deepEqual(
    C.wandPower({ ...state, combatProfile: { mpWands: 3 } }, mind),
    [66, 66],
  );
  assert.deepEqual(
    C.wandPower({ ...state, skills: { evocations: 0 } }, mind),
    [15, 15],
  );
  assert.equal(C.wandPower({ ...state, skills: {} }, mind), null);
  assert.deepEqual(
    C.wandPower({ ...state, combatProfile: null }, mind),
    [50, 66],
  );
  assert.deepEqual(
    C.wandPower({ ...state, items: [{ gadgeteer: true }] }, mind),
    [50, 65],
  );
});
test("monster Will parses inline and table pips without replacing them by exact values", () => {
  assert.deepEqual(
    C.willpower("Max HP    Will    AC    EV\n20        ++      +     ++"),
    [41, 80],
  );
  assert.deepEqual(C.willpower("의지: ∞"), [5000, 5000]);
  assert.deepEqual(C.willpower("Will none"), [0, 0]);
  assert.deepEqual(C.willpower("Will ++++ +"), [161, 200]);
  assert.equal(C.willpower("Will: unknown"), null);
});
test("server damage expressions handle dice ranges, sums and division; unknown effects stay unknown", () => {
  assert.equal(C.damage("3d8").low, 13.5);
  assert.equal(C.damage("6 + 3d4").low, 13.5);
  assert.equal(C.damage("12d3 / 2 (against normal-speed enemies)").low, 12);
  assert.deepEqual(
    [C.damage("(4-8)d10").low, C.damage("(4-8)d10").high],
    [22, 44],
  );
  assert.deepEqual(
    [C.damage("2d(3-24)").low, C.damage("2d(3-24)").high],
    [4, 25],
  );
  assert.equal(C.damage("death"), null);
  assert.equal(C.damage("3d8 + 1/6 of current HP"), null);
  assert.equal(C.damage("N/A"), null);
  assert.equal(C.damage("2d15*").conditional, true);
});
test("server description reads throwing damage rating and evocable/ability dice", () => {
  assert.deepEqual(C.description("Damage: 3d8\nRange: 7"), {
    damage: "3d8",
    rating: null,
    delay: null,
    range: "7",
  });
  assert.equal(C.description("피해: 3d8").damage, "3d8");
  assert.equal(
    C.description(
      "Damage rating: 14 [10 + 4 (Thrw)]\nCurrent attack delay: 1.2.",
    ).rating,
    14,
  );
  assert.equal(
    C.description("Damage rating: 14\nCurrent attack delay: 1.2.").delay,
    1.2,
  );
});
test("power, success and Will resistance change ranking, with immunity excluded", () => {
  const weak = { ...mind, slot: 1 },
    strong = {
      name: "flame",
      category: "evoke",
      baseType: 3,
      sourceId: "SPELL_THROW_FLAME",
      slot: 2,
      charges: 5,
      action: "Zap",
      combat: { damage: "2d8" },
    };
  const calculate = (will) =>
    Advisor.advise(
      { ...state, items: [weak, strong] },
      { att: 0, count: 1, threat: 0, will },
    );
  assert.equal(calculate([0, 0]).candidates[0].slot, 1);
  assert.equal(calculate([160, 160]).candidates[0].slot, 2);
  assert.deepEqual(
    calculate([5000, 5000]).candidates.map((x) => x.slot),
    [2],
  );
  assert.equal(C.evaluate(state, weak, {}, "item").score, 0);
  const spell = {
    name: "Fireball",
    sourceId: "SPELL_FIREBALL",
    power: "20%",
    damage: "3d10",
    fail: "10",
    level: 5,
  };
  assert.ok(
    C.evaluate(state, spell, {}, "spell").score >
      C.evaluate(state, { ...spell, damage: "3d3" }, {}, "spell").score,
  );
});
test("standard faith ranks yield intervals; Xom and Gozag use their own display", () => {
  assert.match(C.faith("Okawaru", 0, 100, false).text, /0–29/);
  assert.match(C.faith("Okawaru", 6, 100, false).text, /160–200/);
  assert.match(C.faith("Xom", 3, 100, false).text, /기분/);
  assert.match(C.faith("Gozag", 6, 1234, false).text, /1234 G/);
  assert.equal(C.faith("", 0, 0, false).text, "무신앙");
});

test("all eligible candidates remain available for the wrapped monster list", () => {
  const spells = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    name: "Fireball",
    sourceId: "SPELL_FIREBALL",
    power: "20%",
    damage: "3d8",
    fail: 2,
    level: 5,
  }));
  assert.equal(
    Advisor.advise({ ...state, spells }, { att: 0, count: 1, threat: 0 })
      .candidates.length,
    12,
  );
  assert.equal(C.powerFromPercent({ name: "Magic Dart", power: "18%" }), null); // impossible after integer power rounding
});

test("candidate order uses total expected damage per use, not speed or utility priority", () => {
  const items = [
    {
      slot: 1,
      name: "heavy evoker",
      category: "evoke",
      action: "Zap",
      combat: { damage: "10d10", delay: 3 },
    },
    {
      slot: 2,
      name: "quick evoker",
      category: "evoke",
      action: "Zap",
      combat: { damage: "2d6", delay: 0.1 },
    },
    {
      slot: 3,
      name: "a potion of heal wounds",
      category: "potion",
      action: "Drink",
    },
  ];
  const result = Advisor.advise(
    { ...state, stats: { ...state.stats, hp: 5 }, items },
    { att: 0, count: 1, threat: 3 },
  );
  assert.deepEqual(
    result.candidates.map((x) => x.slot),
    [1, 2, 3],
  );
  assert.equal(result.candidates[0].totalDamage, 55);
  assert.equal(result.candidates[1].totalDamage, 7);
});
