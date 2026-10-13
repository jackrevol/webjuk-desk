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

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const spellDamage = (sourceId, damage, monster = {}, extra = {}) => C.evaluate(state, {
  sourceId, damage, power: "40%", fail: 0, ...extra,
}, monster, "spell");

test("monster defence pips retain the source five-point intervals in both languages", () => {
  assert.deepEqual(C.defences("Max HP    Will    AC    EV    SH\n20        ++      +     ++    none"), {
    ac: [1, 5], ev: [6, 10], sh: [0, 0],
  });
  assert.deepEqual(C.defences("방어력: ++++ +\n회피력: ~45\n방패: 7"), {
    ac: [21, 25], ev: [41, 45], sh: [7, 7],
  });
  assert.deepEqual(C.defences("AC: unknown\nEV: ?"), { ac: null, ev: null, sh: null });
  assert.deepEqual(C.powerFromPercent({ sourceId: "SPELL_FIREBALL", power: "100%" }), [200, 200]);
  assert.equal(C.powerFromPercent({ sourceId: "SPELL_FIREBALL", power: "101%" }), null);
});

test("beam hit probability matches independent enumeration including ties and random2avg asymmetry", () => {
  // beam.cc::_test_beam_hit / random.cc::defer_rand::random2avg
  for (const accuracy of [0, 1, 2, 5, 12])
    for (const ev of [0, 1, 2, 5, 10]) {
      let probability = 0;
      for (let outer = 0; outer < Math.max(1, ev); outer++) {
        let hits = 0, rolls = 0;
        for (let attack = 0; attack < Math.max(1, accuracy); attack++)
          for (let a = 0; a < Math.max(1, outer); a++)
            for (let b = 0; b <= outer; b++) {
              rolls++;
              if (attack >= Math.floor((a + b) / 2)) hits++;
            }
        probability += hits / rolls / Math.max(1, ev);
      }
      near(C.beamHitChance(accuracy, ev), probability);
    }
  assert.equal(C.beamHitChance(NaN, 10), null);
});

test("AC expectation averages individual rolls with zero clipping before integer resistance", () => {
  // actor.cc::apply_ac와 fight.cc::resist_adjust_damage를 독립적으로 전수 열거합니다.
  const cases = [
    ["SPELL_MAGIC_DART", "normal", null, 0, 2],
    ["SPELL_THROW_FLAME", "normal", "fire", 1, 2],
    ["SPELL_SHOCK", "half", "electricity", 1, 3],
    ["SPELL_TREMORSTONE", "triple", null, 0, 1],
  ];
  for (const [id, rule, key, resistance, ac] of cases) {
    let total = 0, count = 0;
    for (let raw = 1; raw <= 4; raw++)
      for (let a = 0; a <= ac; a++)
        for (let b = 0; b <= (rule === "triple" ? ac : 0); b++)
          for (let c = 0; c <= (rule === "triple" ? ac : 0); c++) {
            const saved = rule === "half" ? Math.floor(a / 2) : a + b + c;
            const afterAc = Math.max(0, raw - saved);
            total += resistance ? Math.floor(afterAc / (key === "electricity" ? 3 : 2)) : afterAc;
            count++;
          }
    const result = spellDamage(id, "1d4", { ac, ev: 0, resists: key ? { [key]: resistance } : {} });
    near(result.totalDamage, total / count);
  }
  near(spellDamage("SPELL_MAGIC_DART", "1d4", { ac: 2 }).totalDamage, 19 / 12);
  assert.equal(C.damage("1d4 - 3").low, 0.25);
});

test("resistance uses integer partial damage, vulnerability and source immunity", () => {
  assert.deepEqual([1, 2, 3].map((n) => C.resistDamage(n, "ICE", 3)), [1, 1, 2]);
  assert.deepEqual([1, 2, 3].map((n) => C.resistDamage(n, "POISON_ARROW", 3)), [1, 1, 1]);
  assert.deepEqual([1, 2, 3].map((n) => C.resistDamage(n, "FIRE", -1)), [1, 3, 4]);
  near(spellDamage("SPELL_ICEBLAST", "1d3", { resists: { cold: 3 } }).totalDamage, 4 / 3);
  near(spellDamage("SPELL_THROW_FLAME", "1d3", { resists: { fire: 1 } }).totalDamage, 2 / 3);
  assert.equal(spellDamage("SPELL_FIREBALL", "3d8", { resists: { fire: 3 } }).excluded, true);
});

test("automatic, explosive and AC-bypassing spells use different defences", () => {
  const freeze = spellDamage("SPELL_FREEZE", "1d4", { ac: 100, ev: 100 });
  assert.equal(freeze.totalDamage, 2.5);
  assert.deepEqual(freeze.hitChance, [100, 100]);
  const fireball = spellDamage("SPELL_FIREBALL", "3d8", { ac: 0, ev: 100 });
  assert.equal(fireball.totalDamage, 13.5);
  const flame = spellDamage("SPELL_THROW_FLAME", "1d4", { ac: 0, ev: 20 });
  assert.ok(flame.totalDamage < 2.5);
  assert.ok(flame.hitChance[0] < 100);
  const mindburst = C.evaluate(state, mind, { ac: 100, ev: 100, will: [0, 0] }, "item");
  near(mindburst.totalDamage, 27 * C.chance(state, mind, { will: [0, 0] }, "item", true)[0] / 100);
});

test("sub-percent Will chances retain positive expected damage instead of becoming immunity", () => {
  const rounded = C.chance(state, mind, { will: [168, 168] }, "item"),
    result = C.evaluate(state, mind, { will: [168, 168] }, "item");
  assert.deepEqual(rounded, [0, 0]);
  assert.ok(result.willChance[0] > 0 && result.willChance[0] < 1);
  assert.ok(result.totalDamage > 0 && !result.excluded);
  assert.equal(C.evaluate(state, mind, { will: [200, 200] }, "item").excluded, true);
});

test("damage intervals include AC, EV, failure and Will uncertainty without inventing missing stats", () => {
  const monster = { ac: [1, 5], ev: [6, 10], resists: { fire: 1 } },
    result = spellDamage("SPELL_THROW_FLAME", "2d8", monster, { fail: 20 });
  near(result.damageRange[0], spellDamage("SPELL_THROW_FLAME", "2d8", { ...monster, ac: 5, ev: 10 }, { fail: 20 }).totalDamage);
  near(result.damageRange[1], spellDamage("SPELL_THROW_FLAME", "2d8", { ...monster, ac: 1, ev: 6 }, { fail: 20 }).damageRange[1]);
  assert.ok(result.damageRange[0] < result.damageRange[1]);
  const unknown = spellDamage("SPELL_THROW_FLAME", "2d8");
  assert.equal(unknown.totalDamage, 9);
  assert.equal(unknown.hitChance, null);
  assert.match(unknown.reason, /AC 미확인/);
  assert.match(unknown.reason, /EV·명중 미확인/);
  const will = C.evaluate(state, mind, { will: [1, 40] }, "item");
  assert.ok(will.damageRange[0] < will.damageRange[1]);
});

test("repeated hits apply AC separately and mixed attacks retain unresisted components", () => {
  const repeated = spellDamage("SPELL_MAGIC_DART", "2x1d4", { ac: 2 });
  near(repeated.totalDamage, 2 * 19 / 12);
  assert.equal(repeated.damage.hits, 2);
  const plasma = spellDamage("SPELL_PLASMA_BEAM", "2x1d4", { ac: 0, ev: 0, resists: { fire: 3, electricity: 0 } });
  assert.equal(plasma.totalDamage, 2.5);
  assert.ok(!plasma.excluded);
  const permafrost = spellDamage("SPELL_PERMAFROST_ERUPTION", "2x1d4", { ac: 2, resists: { cold: 3 } });
  near(permafrost.totalDamage, 19 / 12);
  assert.equal(spellDamage("SPELL_PLASMA_BEAM", "1d4").totalDamage, null);
});

test("per-unit and unsupported expressions cannot masquerade as per-use total damage", () => {
  const cloud = spellDamage("SPELL_FREEZING_CLOUD", "2d4/turn");
  assert.equal(cloud.totalDamage, null);
  assert.deepEqual(cloud.unitDamageRange, [5, 5]);
  assert.match(cloud.reason, /1회 총 피해 미확인/);
  assert.equal(C.damage("1000000d1000000"), null);
  assert.equal(C.damage("(8-4)d10"), null);
  assert.equal(C.damage("3d8 / 0"), null);
  assert.equal(C.damage("0d8").low, 0);
  assert.equal(C.damage("3d0").low, 0);
  assert.equal(C.damage("2d4 * 2").conditional, false);
});

test("candidate order responds to target AC and preserves mixed damage against elemental immunity", () => {
  const spells = [
    { id: "dart", name: "Magic Dart", sourceId: "SPELL_MAGIC_DART", damage: "1d6", fail: 0, level: 1 },
    { id: "freeze", name: "Freeze", sourceId: "SPELL_FREEZE", damage: "1d4", fail: 0, level: 1 },
    { id: "plasma", name: "Plasma Beam", sourceId: "SPELL_PLASMA_BEAM", damage: "2x1d4", fail: 0, level: 6 },
  ];
  const advise = (ac) => Advisor.advise({ ...state, spells: spells.slice(0, 2) }, { att: 0, count: 1, ac, ev: 0, resists: { cold: 0 } });
  assert.equal(advise(0).candidates[0].id, "dart");
  assert.equal(advise(10).candidates[0].id, "freeze");
  const mixed = Advisor.advise({ ...state, spells: spells.slice(2) }, { att: 0, count: 1, ac: 0, ev: 0, resists: { fire: 3, electricity: 0 } });
  assert.equal(mixed.candidates.length, 1);
  assert.equal(mixed.candidates[0].totalDamage, 2.5);
});
