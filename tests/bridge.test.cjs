const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const Core = require("../extension/core.js");
const Advisor = require("../extension/advisor.js");
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
function spellMenu(h, key = 97) {
  h.setMode(7);
  h.receive({ msg: "menu", tag: "spell", total_items: 1, items: [spell(key)] });
}

test("uses global game API and inventory slots over 51 without replacing native handling", () => {
  const h = harness();
  assert.equal(h.lastState().ready, true);
  assert.equal(h.lastState().items[0].slot, 52);
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
test("refresh captures a complete spell list then cancels without casting", () => {
  const h = harness();
  h.act({ type: "refreshSpells" });
  assert.deepEqual(h.sent, [{ type: "input", text: "I" }]);
  spellMenu(h);
  assert.equal(h.sent.at(-1).keycode, 27);
  assert.equal(h.lastState().spells[0].name, "Magic Dart");
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
