/* Deterministic WebTiles protocol fixture. Contains no accounts or credentials. */
(() => {
  const listeners = [];
  let saved = {},
    mode = 1,
    watching = false,
    connected = true,
    menu = false;
  let powerView = false;
  let abilityExamine = false;
  window.chrome = {
    runtime: { getURL: (file) => `/extension/${file}` },
    storage: {
      local: {
        async get() {
          return { webjuk: saved };
        },
        async set(value) {
          const oldValue = saved;
          saved = value.webjuk;
          listeners.forEach((fn) =>
            fn({ webjuk: { oldValue, newValue: saved } }, "local"),
          );
        },
      },
      onChanged: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
  };
  window.socket = {
    get readyState() {
      return connected ? 1 : 3;
    },
  };
  window.current_layer = "normal";
  const player = {
    name: "Adventurer",
    place: "Dungeon:7",
    hp: 52,
    hp_max: 64,
    mp: 24,
    mp_max: 32,
    weapon_index: 0,
    ac: 8,
    ev: 14,
    sh: 0,
    xl: 12,
    god: "Vehumet",
    piety_rank: 5,
    gold: 250,
    status: [],
    pos: { x: 0, y: 0 },
    inv: {
      0: {
        name: "+2 short sword (weapon)",
        quantity: 1,
        letter: 97,
        action_verb: "Wield",
      },
      1: {
        name: "a +1 robe (worn)",
        quantity: 1,
        letter: 98,
        action_verb: "Wear",
      },
      2: {
        name: "3 potions of curing",
        quantity: 3,
        letter: 99,
        action_verb: "Quaff",
      },
      3: {
        name: "2 scrolls of blinking",
        quantity: 2,
        letter: 100,
        action_verb: "Read",
      },
      4: {
        base_type: 3,
        name: "a wand of flame (18)",
        quantity: 1,
        plus: 18,
        qty_field: "plus",
        letter: 101,
        action_verb: "Evoke",
      },
      5: {
        name: "a ring of magical power (on hand)",
        quantity: 1,
        letter: 102,
        action_verb: "Put on",
      },
      6: {
        name: "5 potions of heal wounds",
        quantity: 5,
        letter: 103,
        action_verb: "Quaff",
      },
      7: {
        name: "a scroll of teleportation",
        quantity: 1,
        letter: 104,
        action_verb: "Read",
      },
      8: {
        name: "8 javelins",
        quantity: 8,
        letter: 105,
        base_type: 1,
        action_verb: "Activate",
      },
      9: {
        name: "12 poisoned darts",
        quantity: 12,
        letter: 106,
        base_type: 1,
        action_verb: "Activate",
      },
      52: {
        name: "a blue potion",
        quantity: 1,
        letter: 107,
        base_type: 7,
        action_verb: "Drink",
      },
    },
  };
  const spellItems = [
    ["Magic Dart", "Conj", "1%", "1"],
    ["Searing Ray", "Conj", "2%", "2"],
    ["Fulminant Prism", "Conj/Alch", "5%", "4"],
    ["Iskenderun's Mystic Blast", "Conj/Tloc", "7%", "4"],
    ["Blink", "Tloc", "3%", "2"],
    ["Fireball", "Conj/Fire", "16%", "5"],
  ].map(([name, schools, fail, level], i) => ({
    level: 2,
    hotkeys: [97 + i],
    text: `${String.fromCharCode(97 + i)} - ${name.padEnd(30)}  ${schools.padEnd(14)}  ${fail}  ${level}`,
    colour: 7,
  }));
  const rawReceive = (data) => {
    if (data.msg === "player")
      Object.entries(data.inv || {}).forEach(([slot, item]) => {
        player.inv[slot] = { ...player.inv[slot], ...item };
      });
  };
  const comm = {
    handle_message: rawReceive,
    send_message(type, data) {
      if (type === "input") {
        type = "key";
        data = { keycode: data.text.charCodeAt(0) };
      }
      const log = document.querySelector(".latest");
      if (type === "key") {
        if (data.keycode === 27) {
          mode = 1;
          menu = false;
          document.querySelector(".demo-popup")?.remove();
          receive({ msg: "close_all_menus" });
          return;
        }
        const key = String.fromCharCode(data.keycode);
        if (key === "A") {
          mode = 7;
          menu = "profile";
          receive({
            msg: "menu",
            title: "Innate Abilities and Mutations",
            total_items: 0,
            items: [],
          });
          return;
        }
        if (key === "a" && !menu) {
          openAbilities();
          return;
        }
        if (key === "!" && menu) {
          if (menu === "ability") {
            abilityExamine = !abilityExamine;
            receive({
              msg: "update_menu",
              title: abilityExamine
                ? "Ability - describe what?"
                : "Ability - do what?",
            });
            return;
          }
          powerView = !powerView;
          receive({
            msg: "update_menu_items",
            items: powerView
              ? spellItems.map((item, i) => ({
                  ...item,
                  text: `${String.fromCharCode(97 + i)} - ${item.text
                    .slice(4)
                    .split(/\s{2,}/)[0]
                    .padEnd(
                      30,
                    )}  ${[20, 24, 32, 39, 46, 53][i]}%  2d6  7  Quiet`,
                }))
              : spellItems,
          });
          return;
        }
        if (key === "I" || key === "z") {
          mode = 7;
          if (key === "z") {
            setTimeout(() => receive({ msg: "input_mode", mode: 7 }), 35);
            return;
          }
          openSpells();
          return;
        }
        if (key === "?" && mode === 7) {
          openSpells();
          return;
        }
        if (key === "m") {
          mode = 7;
          receive({ msg: "menu", tag: "skills", type: "crt" });
          receive({
            msg: "txt",
            lines: {
              0: "a - Fighting 4.5",
              1: "b + Throwing 3.2",
              2: "c + Evocations 7.1",
            },
          });
          return;
        }
        if (menu === "ability" && /[ab]/.test(key)) {
          if (!abilityExamine) {
            log.textContent = "능력 사용 요청";
            return;
          }
          const name = key === "a" ? "Heroism" : "Divine fire",
            body = key === "a" ? "Range: 0" : "Damage: 3d12\nRange: 7";
          popup(name, body);
          receive({
            msg: "ui-push",
            type: "describe-generic",
            title: name,
            body,
          });
          return;
        }
        if (menu && /[a-f]/.test(key)) {
          log.textContent = `${spellItems[key.charCodeAt(0) - 97].text.trim()} → 시전 요청. 데모에서는 턴을 소비하지 않습니다.`;
          mode = 1;
          menu = false;
          receive({ msg: "close_menu" });
          return;
        }
        popup(`게임 명령: ${key}`, "실제 게임에서는 해당 메뉴가 열립니다.");
      } else if (type.startsWith("inv_item_")) {
        const item = player.inv[data.slot];
        if (type === "inv_item_describe") {
          const body =
            item.base_type === 1
              ? "Damage rating: 14\nCurrent attack delay: 1.2."
              : item.qty_field === "plus"
                ? "Damage: 2d8"
                : "Damage rating: 9";
          popup(item.name, body);
          receive({
            msg: "ui-push",
            type: "describe-item",
            title: item.name,
            body,
          });
        } else {
          log.textContent = `${item.action_verb}: ${item.name} → 서버의 아이템 사용 명령`;
          receive({ msg: "player", inv: {} });
        }
      }
    },
  };
  function receive(data) {
    comm.handle_message(data);
  }
  function openSpells() {
    menu = true;
    powerView = false;
    mode = 7;
    setTimeout(
      () =>
        receive({
          msg: "menu",
          tag: "spell",
          title: "Your spells",
          total_items: spellItems.length,
          chunk_start: 0,
          items: spellItems,
        }),
      50,
    );
  }
  function openAbilities() {
    menu = "ability";
    abilityExamine = false;
    mode = 7;
    receive({
      msg: "menu",
      tag: "ability",
      title: "Ability - do what?",
      total_items: 3,
      items: [
        { level: 2, text: "권능 -" },
        { level: 2, text: "a - Heroism    2 MP, Piety    3%", hotkeys: [97] },
        {
          level: 2,
          text: "b - Divine fire    3 MP, Piety    5%",
          hotkeys: [98],
        },
      ],
    });
  }
  function popup(title, description) {
    mode = 7;
    const node = document.createElement("div");
    node.className = "ui-popup demo-popup";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const text = document.createElement("p");
    text.textContent = description;
    const button = document.createElement("button");
    button.textContent = "닫기 (Esc)";
    button.onclick = () => comm.send_message("key", { keycode: 27 });
    node.append(heading, text, button);
    document.getElementById("ui-stack").replaceChildren(node);
    receive({ msg: "input_mode", mode });
  }
  const modules = {
    comm,
    client: { in_game: () => true, is_watching: () => watching },
    "game-demo/game": { get_input_mode: () => mode, get_ui_state: () => 0 },
    "game-demo/player": player,
  };
  const monsterList = document.createElement("div");
  monsterList.id = "monster_list";
  for (const name of ["Adder", "Orc wizard"]) {
    const group = document.createElement("span");
    group.className = "group";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name;
    group.append(label);
    monsterList.append(group);
  }
  document.getElementById("right_column").append(monsterList);
  modules["game-demo/monster_list"] = {
    get: () => [
      {
        monsters: [
          {
            mon: {
              id: 1,
              name: "Adder",
              att: 0,
              threat: 1,
              typedata: { avghp: 11 },
            },
            loc: { x: 2, y: 1 },
          },
        ],
      },
      {
        monsters: [
          {
            mon: {
              id: 2,
              name: "Orc wizard",
              att: 0,
              threat: 2,
              typedata: { avghp: 20 },
            },
            loc: { x: 4, y: 2 },
          },
        ],
      },
    ],
  };
  window.requirejs = { s: { contexts: { _: { defined: modules } } } };
  modules["game-demo/map_knowledge"] = {
    get: (x) => ({
      t: {
        fg: {
          MDAM_LIGHT: false,
          MDAM_MOD: false,
          MDAM_HEAVY: x === 2,
          MDAM_SEV: false,
          MDAM_ADEAD: false,
        },
      },
    }),
  };
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") comm.send_message("key", { keycode: 27 });
  });
  document.getElementById("simulate-change").onclick = () =>
    receive({
      msg: "player",
      inv: { 2: { quantity: Math.max(0, player.inv[2].quantity - 1) } },
    });
  document.getElementById("simulate-watch").onclick = () => {
    watching = !watching;
    receive({ msg: "watching_started" });
  };
  document.getElementById("simulate-disconnect").onclick = () => {
    connected = !connected;
  };
  const canvas = document.getElementById("dungeon"),
    ctx = canvas.getContext("2d"),
    size = 32;
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 25; x++) {
      const room =
        (x > 3 && x < 13 && y > 3 && y < 15) ||
        (x > 10 && x < 21 && y > 7 && y < 12);
      const boundary =
        (x > 2 && x < 14 && y > 2 && y < 16) ||
        (x > 9 && x < 22 && y > 6 && y < 13);
      ctx.fillStyle = room
        ? (x + y) % 3
          ? "#343a2b"
          : "#3a4030"
        : boundary
          ? "#5c6243"
          : "#111810";
      ctx.fillRect(x * size, y * size, size - 1, size - 1);
      if (boundary && !room) {
        ctx.fillStyle = "#707653";
        ctx.fillRect(x * size + 2, y * size + 2, size - 5, 4);
        ctx.fillStyle = "#41472f";
        ctx.fillRect(x * size + 4, y * size + 14, size - 7, 3);
      }
      if (room) {
        ctx.fillStyle = "#464d38";
        ctx.fillRect(x * size + 7, y * size + 23, 7, 2);
        ctx.fillRect(x * size + 23, y * size + 7, 2, 3);
      }
    }
  ctx.fillStyle = "#788c60";
  ctx.fillRect(8 * size + 9, 9 * size + 11, 14, 16);
  ctx.fillStyle = "#d3bea0";
  ctx.fillRect(8 * size + 11, 9 * size + 4, 10, 10);
  ctx.fillStyle = "#8e78a3";
  ctx.fillRect(8 * size + 7, 9 * size + 15, 18, 12);
  ctx.strokeStyle = "#d4e5a1";
  ctx.strokeRect(8 * size, 9 * size, size, size);
})();
