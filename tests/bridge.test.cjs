const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const Core = require("../extension/core.js");
const Advisor = require("../extension/advisor.js");
const Combat = require("../extension/combat.js");
const KNOWN_SPELL_FLAGS = 0x40a52;
const LIBRARY_FLAGS = 0xc0342;
const bridge = fs.readFileSync(
  require.resolve("../extension/bridge.js"),
  "utf8",
);

function harness() {
  const listeners = {},
    sent = [],
    posted = [],
    tasks = [];
  let time = 10000,
    mode = 1,
    watching = false,
    playing = true,
    popup = false;
  const player = {
    name: "Tester",
    inv: {
      52: {
        name: "a potion",
        quantity: 1,
        letter: 109,
        base_type: 7,
        action_verb: "Drink",
      },
    },
    hp: 10,
    hp_max: 10,
  };
  const comm = {
    handle_message(data) {
      if (data.msg === "player") {
        Object.entries(data.inv || {}).forEach(([slot, item]) => {
          player.inv[slot] = { ...player.inv[slot], ...item };
        });
        delete data.inv;
      }
      if (data.items) data.items.length = 0; // emulate WebTiles' mutation
    },
    send_message(type, data) {
      sent.push({ type, ...data });
    },
  };
  const game = { get_input_mode: () => mode, get_ui_state: () => 0 };
  const win = {
    WebJukCore: Core,
    WebJukAdvisor: Advisor,
    WebJukCombat: Combat,
    game,
    socket: { readyState: 1 },
    current_layer: "normal",
    requirejs: {
      s: {
        contexts: {
          _: {
            defined: {
              comm,
              client: { in_game: () => playing, is_watching: () => watching },
              "game-test/game": {},
              "game-test/player": player,
              "game-test/monster_list": {
                get: () => [
                  {
                    monsters: [
                      {
                        mon: { id: 1, name: "Adder", att: 0, threat: 1, typedata: { avghp: 11 } },
                        loc: { x: 1, y: 1 },
                      },
                    ],
                  },
                ],
              },
              "game-test/map_knowledge": {
                get: () => ({
                  t: {
                    fg: {
                      MDAM_LIGHT: false,
                      MDAM_MOD: false,
                      MDAM_HEAVY: true,
                      MDAM_SEV: false,
                      MDAM_ADEAD: false,
                    },
                  },
                }),
              },
            },
          },
        },
      },
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    postMessage(data) {
      posted.push(data);
    },
  };
  const context = {
    window: win,
    location: { origin: "https://crawl.nemelex.cards" },
    document: { querySelector: () => (popup ? {} : null) },
    console,
    structuredClone,
    Map,
    WeakSet,
    Date: { now: () => time },
    setInterval(fn) {
      tasks.push(fn);
      return 1;
    },
    clearInterval() {},
    queueMicrotask(fn) {
      tasks.push(fn);
    },
  };
  vm.runInNewContext(bridge, context);
  function tick() {
    const queued = tasks.splice(1);
    queued.forEach((fn) => fn());
    tasks[0]?.();
  }
  function act(action) {
    listeners.message.forEach((fn) =>
      fn({
        source: win,
        origin: context.location.origin,
        data: {
          channel: "webjuk-desk-v1",
          from: "panel",
          type: "action",
          action,
        },
      }),
    );
  }
  function receive(data) {
    comm.handle_message(structuredClone(data));
    tick();
  }
  return {
    sent,
    posted,
    player,
    act,
    receive,
    tick,
    win,
    setMode: (v) => {
      mode = v;
    },
    watch: (v) => {
      watching = v;
    },
    play: (v) => {
      playing = v;
    },
    popup: (v) => {
      popup = v;
    },
    advance: (v) => {
      time += v;
      tick();
    },
    lastState: () => posted.filter((d) => d.type === "state").at(-1).state,
    trustedKey: () =>
      listeners.keydown.forEach((fn) => fn({ isTrusted: true })),
  };
}
const spell = (key = 97) => ({
  level: 2,
  text: `${String.fromCharCode(key)} - Magic Dart    Conj    1%    1`,
  hotkeys: [key],
  tiles: [{ tex: 5, t: 101 }],
});
test("monster descriptions feed bounded AC and EV into state without sending game actions", () => {
  const h = harness();
  assert.equal(h.lastState().monsters[0].ac, null);
  h.receive({ msg: "ui-push", type: "describe-monster", title: "Adder", body:
    "Max HP    Will    AC    EV    SH\n11        none    +     ++    none\nrF: +..  rC: ..." });
  const monster = h.lastState().monsters[0];
  assert.deepEqual(Array.from(monster.ac), [1, 5]);
  assert.deepEqual(Array.from(monster.ev), [6, 10]);
  assert.deepEqual(Array.from(monster.sh), [0, 0]);
  assert.deepEqual(Array.from(monster.will), [0, 0]);
  assert.equal(monster.resists.fire, 1);
  assert.equal(monster.resists.cold, 0);
  assert.equal(h.sent.length, 0);
  h.receive({ msg: "game_client", version: "test" });
  assert.equal(h.lastState().monsters[0].ac, null);
  assert.equal(h.lastState().monsters[0].ev, null);
});
test("observed poison resistance removes Korean darts while escape scrolls never become target candidates", () => {
  const h = harness();
  h.player.inv = {
    0: { name: "자벨린", quantity: 3, base_type: 1, action_verb: "Fire" },
    1: { name: "독다트", quantity: 3, base_type: 1, action_verb: "Fire" },
    2: { name: "쿠라레다트", quantity: 3, base_type: 1, action_verb: "Fire" },
    3: { name: "점멸의 두루마리", quantity: 3, base_type: 5, action_verb: "Read" },
  };
  h.receive({ msg: "player" });
  const candidates = () => Advisor.advise(h.lastState(), h.lastState().monsters[0]).candidates.map((entry) => entry.slot);
  assert.deepEqual(candidates(), [0]);
  h.receive({ msg: "ui-push", type: "describe-monster", title: "Adder", body: "rF: ...  rPois: +  rElec: ." });
  assert.equal(h.lastState().monsters[0].resists.poison, 1);
  assert.deepEqual(candidates(), [0]);
  h.receive({ msg: "ui-push", type: "describe-monster", title: "Adder", body: "rF: +..  rPois: .  rElec: ." });
  assert.deepEqual(candidates(), [0, 1, 2]);
  assert.equal(h.sent.length, 0);
});
test("gold and faith changes refresh advice state and changing god invalidates old abilities", () => {
  const h = harness();
  h.player.god = "Okawaru";
  h.player.gold = 100;
  h.tick();
  h.setMode(7);
  h.receive({ msg: "menu", tag: "ability", total_items: 2, items: [
    { level: 2, text: "권능 -" },
    { ...spell(), text: "a - Heroism    2 MP, Piety    3%" },
  ] });
  assert.equal(h.lastState().abilities.length, 1);
  h.player.gold = 200;
  h.player.piety_rank = 4;
  h.player.penance = true;
  h.tick();
  assert.equal(h.lastState().gold, 200);
  assert.equal(h.lastState().pietyRank, 4);
  assert.equal(h.lastState().penance, true);
  assert.equal(h.lastState().abilitiesLoaded, false);
  assert.equal(h.lastState().abilities.length, 0);
  h.player.god = "Gozag";
  h.tick();
  assert.equal(h.lastState().abilitiesLoaded, false);
  assert.equal(h.lastState().abilities.length, 0);
  assert.equal(h.sent.length, 0);
});
function spellMenu(h, key = 97) {
  h.setMode(7);
  h.receive({ msg: "menu", tag: "spell", flags: KNOWN_SPELL_FLAGS, total_items: 1, items: [spell(key)] });
}

test("uses global game API and inventory slots over 51 without replacing native handling", () => {
  const h = harness();
  assert.equal(h.lastState().ready, true);
  assert.equal(h.lastState().items[0].slot, 52);
  assert.deepEqual(
    Array.from(h.lastState().monsters[0].healthBands[0]),
    [40, 60],
  );
  h.act({ type: "describe", slot: 52, name: "a potion" });
  assert.deepEqual(h.sent, [{ type: "inv_item_describe", slot: 52 }]);
  h.receive({ msg: "player", inv: { 52: { quantity: 0 } } });
  assert.equal(h.lastState().items.length, 0);
});
test("disconnected, watching, menu, target mode and stale items never send actions", () => {
  for (const block of [
    (h) => h.watch(true),
    (h) => h.play(false),
    (h) => h.popup(true),
    (h) => h.setMode(2),
    (h) => {
      h.win.socket.readyState = 3;
    },
    (h) => {
      h.player.inv[52].name = "different";
    },
  ]) {
    const h = harness();
    block(h);
    h.act({ type: "item", slot: 52, name: "a potion" });
    assert.equal(h.sent.length, 0);
  }
});
test("refresh reads failure and power views then escapes without casting", () => {
  const h = harness();
  h.act({ type: "refreshSpells" });
  assert.deepEqual(h.sent, [{ type: "input", text: "I" }]);
  spellMenu(h);
  assert.equal(h.sent.at(-1).text, "!");
  h.tick();
  assert.equal(h.sent.length, 2);
  h.receive({
    msg: "update_menu_items",
    items: [{ ...spell(), text: "a - Magic Dart    0%    1d4    7    Silent" }],
  });
  assert.equal(h.sent.at(-1).keycode, 27);
  assert.equal(h.lastState().spells[0].name, "Magic Dart");
  assert.equal(h.lastState().spells[0].fail, "1");
  assert.equal(h.lastState().spells[0].power, "0%");
});
test("refresh also supports a power view arriving first", () => {
  const h = harness();
  h.act({ type: "refreshSpells" });
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "spell",
    flags: KNOWN_SPELL_FLAGS,
    total_items: 1,
    items: [
      { ...spell(), text: "a - Magic Dart    32%    1d6    7    Silent" },
    ],
  });
  assert.equal(h.sent.at(-1).text, "!");
  h.receive({ msg: "update_menu_items", items: [spell()] });
  assert.equal(h.sent.at(-1).keycode, 27);
  assert.equal(h.lastState().spells[0].fail, "1");
  assert.equal(h.lastState().spells[0].power, "32%");
});
test("casting waits for prompt and live menu and resolves a changed spell letter", () => {
  const h = harness();
  spellMenu(h);
  h.receive({ msg: "close_all_menus" });
  h.setMode(1);
  h.act({ type: "cast", id: "5:101" });
  assert.deepEqual(h.sent, [{ type: "input", text: "z" }]);
  h.setMode(7);
  h.tick();
  assert.equal(h.sent.at(-1).text, "?");
  h.tick();
  assert.equal(h.sent.length, 2);
  spellMenu(h, 98);
  assert.equal(h.sent.at(-1).text, "b");
});
test("manual learning menus preserve the learned spell panel and the next cast uses its live server letter", () => {
  const h = harness();
  spellMenu(h, 122);
  const before = Array.from(h.lastState().spells, (entry) => ({ ...entry }));
  h.receive({ msg: "close_all_menus" });
  h.receive({ msg: "menu", tag: "spell", flags: LIBRARY_FLAGS, title: "마법 (배우기)", total_items: 1,
    items: [{ ...spell(), text: "a - Fireball    Conj/Fire    99%    5" }] });
  h.receive({ msg: "update_menu", title: "마법 (설명)" });
  h.receive({ msg: "update_menu_items", items: [spell(65)] });
  assert.deepEqual(Array.from(h.lastState().spells, (entry) => ({ ...entry })), before);
  assert.equal(h.sent.length, 0);
  h.receive({ msg: "close_all_menus" });
  h.setMode(1);
  h.act({ type: "cast", id: "5:101" });
  spellMenu(h, 66);
  assert.deepEqual(h.sent, [{ type: "input", text: "z" }, { type: "input", text: "B" }]);
});

test("spell refresh, cast and description never toggle or select a same-tag library or unidentified menu", () => {
  for (const type of ["refreshSpells", "cast", "describeSpell"])
    for (const flags of [LIBRARY_FLAGS, undefined]) {
      const h = harness();
      spellMenu(h);
      h.receive({ msg: "close_all_menus" });
      h.setMode(1);
      h.act({ type, id: "5:101" });
      h.setMode(7);
      h.receive({ msg: "menu", tag: "spell", flags, title: "Your spells (cast)", total_items: 1, items: [spell(98)] });
      h.receive({ msg: "update_menu_items", items: [spell(99)] });
      h.tick();
      assert.equal(h.lastState().busy, false);
      assert.equal(h.lastState().spells[0].letter, "a");
      assert.deepEqual(h.sent, [{ type: "input", text: type === "cast" ? "z" : "I" }]);
      assert.match(h.posted.filter((data) => data.type === "notice").at(-1).text, /단축키 목록/);
    }
});
test("spell_menu enabled skips prompt and right click uses description menu", () => {
  const h = harness();
  spellMenu(h);
  h.receive({ msg: "close_all_menus" });
  h.setMode(1);
  h.act({ type: "describeSpell", id: "5:101" });
  assert.equal(h.sent[0].text, "I");
  spellMenu(h, 99);
  assert.equal(h.sent.at(-1).text, "c");
  assert.equal(h.sent.length, 2);
});
test("trusted keyboard input and timeout abort pending selection", () => {
  const h = harness();
  spellMenu(h);
  h.receive({ msg: "close_all_menus" });
  h.setMode(1);
  h.act({ type: "cast", id: "5:101" });
  h.trustedKey();
  spellMenu(h, 98);
  assert.equal(h.sent.length, 1);
  const noSpells = harness();
  noSpells.act({ type: "refreshSpells" });
  noSpells.advance(1500);
  assert.equal(noSpells.lastState().busy, false);
  assert.equal(noSpells.sent.length, 1);
});
test("reconnection invalidates cached spells; repeated clicks are throttled", () => {
  const h = harness();
  spellMenu(h);
  h.receive({ msg: "game_client", version: "test" });
  h.setMode(1);
  assert.equal(h.lastState().spellsLoaded, false);
  h.act({ type: "item", slot: 52, name: "a potion" });
  h.act({ type: "item", slot: 52, name: "a potion" });
  assert.equal(h.sent.length, 1);
});
test("skill refresh only reads text and escapes; it never toggles training", () => {
  const h = harness();
  h.act({ type: "refreshSkills" });
  assert.deepEqual(h.sent, [{ type: "input", text: "m" }]);
  h.receive({ msg: "menu", type: "crt", tag: "skills" });
  h.receive({
    msg: "txt",
    lines: { 0: "a - Throwing 3.2", 1: "b * Evocations 5.1" },
  });
  h.advance(200);
  assert.deepEqual(h.sent, [
    { type: "input", text: "m" },
    { type: "key", keycode: 27 },
  ]);
  assert.equal(h.lastState().skills.evocations, 5.1);
});
test("ability refresh and activation resolve the latest server hotkey", () => {
  const h = harness();
  h.act({ type: "refreshAbilities" });
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "ability",
    total_items: 1,
    items: [{ ...spell(), text: "a - Breathe Fire    3%" }],
  });
  assert.equal(h.sent.at(-1).keycode, 27);
  assert.equal(h.lastState().abilities[0].fail, "3");
  h.receive({ msg: "close_all_menus" });
  h.setMode(1);
  h.act({ type: "castAbility", id: "5:101" });
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "ability",
    total_items: 1,
    items: [{ ...spell(99), text: "c - Breathe Fire    3%" }],
  });
  assert.deepEqual(h.sent.at(-1), { type: "input", text: "c" });
});

test("ability description waits for fresh server examination mode before sending a selection", () => {
  const h = harness();
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "ability",
    total_items: 1,
    items: [{ ...spell(), text: "a - Heroism    2 MP, Piety    3%" }],
  });
  h.receive({ msg: "close_all_menus" });
  h.setMode(1);
  h.act({ type: "describeAbility", id: "5:101" });
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "ability",
    title: "Ability - do what?",
    total_items: 1,
    items: [{ ...spell(), text: "a - Heroism    2 MP, Piety    3%" }],
  });
  assert.equal(h.sent.at(-1).text, "!");
  const sent = h.sent.length;
  h.tick();
  assert.equal(h.sent.length, sent);
  h.receive({ msg: "update_menu", title: "Ability - do what?" });
  assert.equal(h.sent.length, sent);
  h.receive({ msg: "update_menu", title: "Ability - describe what?" });
  assert.equal(h.sent.at(-1).text, "a");
  h.receive({
    msg: "ui-push",
    type: "describe-generic",
    title: "Heroism",
    body: "Damage: 3d8\nRange: 7",
  });
  assert.equal(h.lastState().abilities[0].combat.damage, "3d8");
  assert.equal(h.sent.at(-1).text, "a"); // manual description stays open
});
test("power refresh proceeds from read-only skills to profile, and keyboard input cancels the whole queue", () => {
  const h = harness();
  h.act({ type: "refreshCombat" });
  assert.equal(h.sent.at(-1).text, "m");
  h.setMode(7);
  h.receive({ msg: "menu", tag: "skills", type: "crt" });
  h.receive({ msg: "txt", lines: { 0: "Evocations 10.0" } });
  h.advance(200);
  assert.equal(h.sent.at(-1).keycode, 27);
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  assert.equal(h.sent.at(-1).text, "A");
  h.setMode(7);
  h.receive({
    msg: "menu",
    title: "Innate Abilities and Mutations",
    total_items: 0,
    items: [],
  });
  assert.equal(h.lastState().combatProfile.mpWands, 0);
  assert.equal(h.sent.at(-1).keycode, 27);
  h.trustedKey();
  const sent = h.sent.length;
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  h.advance(500);
  assert.equal(h.sent.length, sent);
  assert.equal(h.lastState().busy, false);
  assert.equal(
    h.sent.some((x) => x.type === "inv_item_use" || x.text === "z"),
    false,
  );
});

test("ability scan closes the child description and parent menu separately", () => {
  const h = harness();
  h.act({ type: "refreshCombat" });
  h.setMode(7);
  h.receive({ msg: "menu", tag: "skills", type: "crt" });
  h.receive({ msg: "txt", lines: { 0: "Evocations 1.0" } });
  h.advance(200);
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  h.setMode(7);
  h.receive({
    msg: "menu",
    title: "Innate Abilities and Mutations",
    total_items: 0,
    items: [],
  });
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  spellMenu(h);
  h.receive({
    msg: "update_menu_items",
    items: [
      { ...spell(), text: "a - Magic Dart    20%    1d4    7    Silent" },
    ],
  });
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  // The harness inventory has only a potion, so ability lookup is next.
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "ability",
    title: "Ability - do what?",
    total_items: 1,
    items: [{ ...spell(), text: "a - Heroism    2 MP    3%" }],
  });
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  h.setMode(7);
  h.receive({
    msg: "menu",
    tag: "ability",
    title: "Ability - do what?",
    total_items: 1,
    items: [{ ...spell(), text: "a - Heroism    2 MP    3%" }],
  });
  h.receive({ msg: "update_menu", title: "Ability - describe what?" });
  h.popup(true);
  h.receive({
    msg: "ui-push",
    type: "describe-generic",
    title: "Heroism",
    body: "Range: N/A",
  });
  assert.equal(h.sent.at(-1).keycode, 27);
  const before = h.sent.length;
  // The parent ability popup still exists when the child ui-pop arrives.
  h.receive({ msg: "ui-pop" });
  assert.equal(h.sent.length, before + 1);
  assert.equal(h.sent.at(-1).keycode, 27);
  h.popup(false);
  h.setMode(1);
  h.receive({ msg: "close_all_menus" });
  assert.equal(h.lastState().busy, false);
  assert.equal(h.lastState().ready, true);
});
