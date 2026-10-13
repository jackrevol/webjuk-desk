const { test } = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../extension/core.js");

test("inventory includes trunk consumables beyond slot 51 and uses server letters", () => {
  const items = Core.inventory(
    {
      0: {
        name: "<white>+0 도끼</white>",
        quantity: 1,
        letter: 97,
        base_type: 0,
      },
      3: {
        name: "다트 8개 (독)",
        quantity: 8,
        letter: 100,
        base_type: 1,
        action_verb: "Activate",
      },
      52: {
        name: "힘의 물약 2병",
        quantity: 2,
        letter: 109,
        base_type: 7,
        action_verb: "Drink",
      },
      60: { name: "unused", quantity: 0 },
      bad: { name: "bad", quantity: 1 },
    },
    { weapon_index: 0 },
  );
  assert.deepEqual(
    items.map((i) => [i.slot, i.letter, i.category]),
    [
      [0, "a", "equipment"],
      [3, "d", "missile"],
      [52, "m", "potion"],
    ],
  );
  assert.equal(items[0].name, "+0 도끼");
  assert.equal(items[0].equipped, true);
  assert.equal(Core.letterForSlot(26), "A");
  assert.equal(Core.letterForSlot(52), "");
});
test("partial menu chunks are merged without sharing mutable client data", () => {
  const tracker = new Core.MenuTracker();
  const first = {
    level: 2,
    text: "<white>a - Magic Dart</white>    Conj    1%    1",
    hotkeys: [97],
    tiles: [{ tex: 5, t: 100 }],
  };
  tracker.receive({
    msg: "menu",
    tag: "spell",
    total_items: 2,
    items: [first],
  });
  first.hotkeys[0] = 120;
  assert.equal(tracker.spellsLoaded, false);
  tracker.receive({
    msg: "update_menu_items",
    chunk_start: 1,
    items: [{ level: 2, text: "b - Blink    Tloc    4%    2", hotkeys: [98] }],
  });
  assert.equal(tracker.lastSpells[0].letter, "a");
  assert.equal(tracker.lastSpells[0].name, "Magic Dart");
  assert.equal(tracker.lastSpells[0].fail, "1");
  assert.equal(tracker.lastSpells.length, 2);
  tracker.receive({ msg: "close_menu" });
  assert.equal(tracker.lastSpells.length, 2);
  tracker.reset();
  assert.equal(tracker.spellsLoaded, false);
});
test("nested and replacing menus preserve the parent and item updates", () => {
  const tracker = new Core.MenuTracker();
  tracker.receive({ msg: "menu", tag: "inventory", total_items: 0, items: [] });
  tracker.receive({
    msg: "menu",
    tag: "spell",
    total_items: 1,
    items: [{ level: 2, text: "a - Blink", hotkeys: [97] }],
  });
  tracker.receive({
    msg: "update_menu_items",
    chunk_start: 0,
    items: [{ text: "a - Blink    2%", hotkeys: [97] }],
  });
  assert.equal(tracker.lastSpells[0].letter, "a");
  tracker.receive({
    msg: "update_menu_items",
    chunk_start: 0,
    items: [{ text: "Blink", level: 2 }],
  });
  assert.equal(tracker.lastSpells.length, 0);
  tracker.receive({
    msg: "menu",
    replace: true,
    tag: "help",
    total_items: 0,
    items: [],
  });
  tracker.receive({ msg: "close_menu" });
  assert.equal(tracker.top.tag, "inventory");
  tracker.receive({ msg: "close_all_menus" });
  assert.equal(tracker.top, undefined);
});
test("shortcut normalization and composition guards", () => {
  assert.equal(
    Core.chord({ key: "i", code: "KeyI", altKey: true }),
    "Alt+KeyI",
  );
  assert.equal(
    Core.chord({
      key: "Process",
      code: "KeyI",
      altKey: true,
      isComposing: true,
    }),
    "",
  );
  assert.equal(Core.chord({ key: "Alt", code: "AltLeft", altKey: true }), "");
  assert.equal(Core.editable([{ matches: () => true }]), true);
  assert.equal(
    Core.settings({ quickSlots: [null, { kind: "invalid", id: "x" }] })
      .quickSlots.length,
    0,
  );
  assert.equal(Core.settings().shortcuts.missiles, "Alt+KeyT");
  assert.equal(
    Core.settings({ shortcuts: { spells: "Ctrl+KeyM" } }).shortcuts.evokes,
    "Alt+KeyE",
  );
});
test("spell power is kept separate from failure across Korean partial updates", () => {
  const tracker = new Core.MenuTracker();
  const rows = [
    {
      level: 2,
      hotkeys: [97],
      tiles: [{ tex: 5, t: 9386 }],
      text: " a - <lightgrey>죽음의 입맞춤                   파괴/강령                  56%       1</lightgrey>",
    },
    {
      level: 2,
      hotkeys: [98],
      tiles: [{ tex: 5, t: 9425 }],
      text: " b + 수집                            전이                       56%       1",
    },
  ];
  tracker.receive({ msg: "menu", tag: "spell", total_items: 2, items: rows });
  tracker.receive({
    msg: "update_menu_items",
    items: [
      {
        ...rows[0],
        text: " a - 죽음의 입맞춤                   0%        2d5       1       거의 없음",
      },
    ],
  });
  assert.equal(tracker.lastSpells[0].fail, "56");
  assert.equal(tracker.lastSpells[0].power, "0%");
  assert.equal(tracker.lastSpells[1].power, null);
  tracker.receive({
    msg: "update_menu_items",
    chunk_start: 1,
    items: [
      {
        ...rows[1],
        text: " b + 수집                            N/A        N/A       7       거의 없음",
      },
    ],
  });
  assert.equal(tracker.lastSpells[1].power, "N/A");
  assert.equal(tracker.lastSpells[1].level, 1);
  tracker.receive({ msg: "update_menu_items", items: [rows[0]] });
  assert.equal(tracker.lastSpells[0].power, "0%");
});
test("evocable inventory includes wands and miscellaneous devices", () => {
  assert.deepEqual(
    Core.inventory({
      0: { base_type: 3, name: "wand", quantity: 1 },
      1: { base_type: 13, name: "phial", quantity: 1 },
      2: { base_type: 7, name: "potion", quantity: 1 },
    }).map((item) => item.category),
    ["evoke", "evoke", "potion"],
  );
});

test("ability menus preserve the invocation section and costs", () => {
  const t = new Core.MenuTracker();
  t.receive({
    msg: "menu",
    tag: "ability",
    total_items: 3,
    items: [
      { level: 2, text: "a - Breathe Fire    Hunger    5%", hotkeys: [97] },
      { level: 1, text: "Invocations -" },
      { level: 2, text: "b - Heroism    2 MP, Piety    3%", hotkeys: [98] },
    ],
  });
  assert.equal(t.lastAbilities[0].invocation, false);
  assert.equal(t.lastAbilities[1].invocation, true);
  assert.equal(t.lastAbilities[1].cost, "2 MP, Piety");
});

test("Korean and tiled invocation headers classify god powers without becoming abilities", () => {
  for (const header of ["<blue> 권능 -    </blue>", "Invocations -", "신의 능력:"])
    for (const level of [1, 2]) {
      const tracker = new Core.MenuTracker();
      tracker.receive({
        msg: "menu", tag: "ability", total_items: 5,
        items: [
          { level: 2, text: "b - Breathe Fire    None    0%", hotkeys: [98] },
          { level, text: header },
          { level: 2, text: "a - Heroism    2 MP, Piety-    8%", hotkeys: [97] },
          { level: 1, text: "Abilities -" },
          { level: 2, text: "c - Blink    2 MP    5%", hotkeys: [99] },
        ],
      });
      assert.equal(tracker.abilitiesLoaded, true);
      assert.deepEqual(tracker.lastAbilities.map((ability) => [ability.name, ability.invocation]), [
        ["Breathe Fire", false], ["Heroism", true], ["Blink", false],
      ]);
      assert.equal(tracker.lastAbilities[1].cost, "2 MP, Piety-");
      assert.equal(tracker.lastAbilities[1].fail, "8");
    }
});

test("renouncing religion is excluded from extension ability lists in both languages", () => {
  const tracker = new Core.MenuTracker();
  tracker.receive({
    msg: "menu",
    tag: "ability",
    total_items: 4,
    items: [
      { level: 2, text: "권능 -" },
      { level: 2, text: "X - 신앙 포기    없음    0%", hotkeys: [88] },
      { level: 2, text: "Y - Renounce Religion    None    0%", hotkeys: [89] },
      { level: 2, text: "a - Heroism    2 MP, Piety-    8%", hotkeys: [97] },
    ],
  });
  assert.deepEqual(tracker.lastAbilities.map((ability) => ability.name), ["Heroism"]);
  assert.equal(tracker.abilitiesLoaded, true);
});
