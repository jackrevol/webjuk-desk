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
  tracker.receive({ msg: "update_menu_items", chunk_start: 0, items: [{ text: "Blink", level: 2 }] });
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
});
