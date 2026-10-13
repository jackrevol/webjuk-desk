/* Page-world adapter. Observe the existing client, never create another socket. */
(() => {
  "use strict";
  if (window.__webJukBridge) return;
  window.__webJukBridge = true;
  const Core = window.WebJukCore;
  const Advisor = window.WebJukAdvisor;
  const Combat = window.WebJukCombat;
  const tracker = new Core.MenuTracker();
  const CHANNEL = "webjuk-desk-v1";
  const iconCache = new Map();
  const monsterDetails = new Map();
  const itemDetails = new Map(),
    abilityDetails = new Map();
  let combatJob = null,
    combatProfile = null,
    describedItem = null;
  let skills = {},
    skillsLoaded = false,
    skillsChangedAt = 0,
    skillsRevision = 0;
  let activeVersion = null,
    lastSignature = "",
    operation = null,
    sequence = 0;
  let inventoryRevision = 0,
    spellRevision = 0,
    stopped = false,
    actionLockUntil = 0;
  const observed = new WeakSet();
  function defined() {
    return window.requirejs?.s?.contexts?._?.defined || {};
  }
  function modules() {
    const all = defined();
    const gameId =
      activeVersion && all[`game-${activeVersion}/game`]
        ? `game-${activeVersion}/game`
        : Object.keys(all)
            .filter((id) => /^game-.*\/game$/.test(id))
            .at(-1);
    const prefix = gameId?.slice(0, -4);
    return {
      client: all.client,
      comm: all.comm,
      jquery: all.jquery,
      game:
        typeof all[gameId]?.get_input_mode === "function"
          ? all[gameId]
          : window.game,
      player: all[`${prefix}player`],
      cr: all[`${prefix}cell_renderer`],
      main: all[`${prefix}tileinfo-main`],
      gui: all[`${prefix}tileinfo-gui`],
      util: all[`${prefix}util`],
      monsterList: all[`${prefix}monster_list`],
      mapKnowledge: all[`${prefix}map_knowledge`],
    };
  }
  function monsterSnapshot(m) {
    return (m.monsterList?.get?.() || []).flatMap((group, row) => {
      const entries = group.monsters;
      if (!entries?.length) return [];
      const mon = entries[0].mon;
      const distance = Math.min(
        ...entries.map((entry) =>
          Math.max(
            Math.abs(entry.loc.x - (m.player?.pos?.x || 0)),
            Math.abs(entry.loc.y - (m.player?.pos?.y || 0)),
          ),
        ),
      );
      return [
        {
          row,
          id: mon.id,
          name: Core.plain(mon.name),
          count: entries.length,
          att: mon.att,
          threat: mon.threat,
          avgHp: mon.typedata?.avghp,
          healthBands: entries.map((entry) => {
            const fg = m.mapKnowledge?.get?.(entry.loc.x, entry.loc.y)?.t?.fg;
            return Advisor.healthBand(fg);
          }),
          distance,
          resists: monsterDetails.get(mon.id)?.resists || {},
          will: monsterDetails.get(mon.id)?.will || null,
          ac: monsterDetails.get(mon.id)?.ac || null,
          ev: monsterDetails.get(mon.id)?.ev || null,
          sh: monsterDetails.get(mon.id)?.sh || null,
        },
      ];
    });
  }
  function post(type, data) {
    window.postMessage(
      { channel: CHANNEL, from: "bridge", type, ...data },
      location.origin,
    );
  }
  function notice(text, error = false) {
    post("notice", { text, error });
  }
  function connected() {
    return window.socket?.readyState === 1;
  }
  function inGame(m) {
    return !!(m.client?.in_game?.() && m.player?.name);
  }
  function commandReady(m) {
    return (
      Date.now() >= actionLockUntil &&
      connected() &&
      inGame(m) &&
      !m.client.is_watching() &&
      !operation &&
      m.game?.get_input_mode?.() === 1 &&
      m.game?.get_ui_state?.() === 0 &&
      !tracker.top &&
      !document.querySelector("#ui-stack > .ui-popup")
    );
  }
  function send(type, data = {}) {
    modules().comm.send_message(type, data);
  }
  // Match client.js: printable commands use the terminal input stream;
  // special keys use the control channel.
  function key(char) {
    if (typeof char === "number") send("key", { keycode: char });
    else send("input", { text: char });
  }
  function reset() {
    tracker.reset();
    operation = null;
    combatJob = null;
    combatProfile = null;
    itemDetails.clear();
    abilityDetails.clear();
    actionLockUntil = 0;
    iconCache.clear();
    sequence++;
    skills = {};
    skillsLoaded = false;
    skillsRevision++;
    monsterDetails.clear();
    inventoryRevision++;
    spellRevision++;
    lastSignature = "";
  }
  function observe(data) {
    if (!data || typeof data !== "object") return;
    if (
      data.msg === "ui-pop" &&
      operation?.kind === "abilityDetail" &&
      operation.closed
    )
      operation.descriptionPopped = true;
    if (data.msg === "game_client") {
      activeVersion = data.version;
      reset();
    }
    if (["game_ended", "go_lobby"].includes(data.msg)) reset();
    if (data.msg === "player") inventoryRevision++;
    if (data.msg === "txt" && tracker.top?.tag === "skills" && Advisor) {
      const parsed = Advisor.skillLevels(
        Object.values(data.lines || {}).map(Core.plain),
      );
      if (Object.keys(parsed).length) {
        skills = { ...skills, ...parsed };
        skillsLoaded = true;
        skillsChangedAt = Date.now();
        skillsRevision++;
      }
    }
    if (data.msg === "ui-push" && data.type === "describe-monster" && Advisor) {
      const title = Core.plain(data.title).toLowerCase();
      for (const mon of monsterSnapshot(modules()))
        if (title.includes(mon.name.toLowerCase())) {
          monsterDetails.set(mon.id, {
            ...Combat.defences(Core.plain(data.body)),
            resists: Advisor.resistances(Core.plain(data.body)),
            will: Combat.willpower(Core.plain(data.body)),
            title,
          });
        }
    }
    if (
      data.msg === "ui-push" &&
      data.type === "describe-item" &&
      (operation?.kind === "itemDetail" || describedItem)
    ) {
      const item =
        operation?.kind === "itemDetail" ? operation.item : describedItem;
      const current = Core.inventory(modules().player?.inv).find(
        (i) => i.slot === item.slot && i.name === item.name,
      );
      if (current)
        itemDetails.set(`${item.slot}:${item.name}`, {
          ...Combat.description(Core.plain(data.body)),
          sourceName: Core.plain(data.title)
            .replace(/^\s*[a-zA-Z]\s*[-+)]\s*/, "")
            .replace(/\.$/, ""),
          updated: Date.now(),
        });
      if (operation?.kind === "itemDetail") operation.received = true;
      describedItem = null;
      inventoryRevision++;
    }
    if (
      data.msg === "ui-push" &&
      data.type === "describe-generic" &&
      operation?.kind === "abilityDetail" &&
      operation.selected
    ) {
      abilityDetails.set(operation.id, {
        ...Combat.description(Core.plain(data.body)),
        updated: Date.now(),
      });
      operation.received = true;
      spellRevision++;
    }
    if (
      [
        "menu",
        "update_menu",
        "update_menu_items",
        "close_menu",
        "close_all_menus",
      ].includes(data.msg)
    ) {
      tracker.receive(data);
      spellRevision++;
    }
  }
  function hook(m) {
    if (!m.comm || observed.has(m.comm)) return;
    const original = m.comm.handle_message;
    m.comm.handle_message = function (data) {
      // Copy the menu before the client mutates items and attaches DOM nodes.
      try {
        observe(data);
      } catch (error) {
        console.warn("WebJuk: message unavailable", error.message);
      }
      const result = original.apply(this, arguments);
      queueMicrotask(tick);
      return result;
    };
    observed.add(m.comm);
  }
  function icon(item, spell = false) {
    const m = modules();
    const tiles = spell ? item.tiles : item.tile;
    if (!tiles || !m.cr || !m.main || !m.util) return "";
    const id = `${activeVersion}:${spell}:${JSON.stringify(tiles)}`;
    if (iconCache.has(id)) return iconCache.get(id);
    try {
      const canvas = document.createElement("canvas");
      const renderer = new m.cr.DungeonCellRenderer();
      m.util.init_canvas(canvas, 32, 32);
      renderer.init(canvas);
      if (spell)
        tiles.forEach((t) =>
          renderer.draw_from_texture(t.t, 0, 0, t.tex, 0, 0, t.ymax, false),
        );
      else
        (Array.isArray(tiles) ? tiles : [tiles]).forEach((t) =>
          renderer.draw_tile(t, 0, 0, m.main),
        );
      const url = canvas.toDataURL("image/png");
      if (iconCache.size > 512) iconCache.clear();
      iconCache.set(id, url);
      return url;
    } catch {
      return "";
    }
  }
  function pump(m) {
    if (!operation) return;
    if (
      !connected() ||
      !inGame(m) ||
      m.client.is_watching() ||
      Date.now() - operation.started > 8000
    ) {
      operation = null;
      combatJob = null;
      notice(
        "요청을 중단했습니다. 게임 화면을 확인한 뒤 다시 시도하세요.",
        true,
      );
      return;
    }
    const menu = tracker.top;
    if (operation.kind === "profile") {
      if (
        menu &&
        tracker.complete() &&
        /mutations|돌연변이|선천적/i.test(menu.title)
      ) {
        combatProfile = Combat.mutationProfile(
          Object.values(menu.items)
            .map((i) => Core.plain(i.text))
            .join("\n"),
        );
        operation = null;
        key(27);
      } else if (menu && !/mutations|돌연변이|선천적/i.test(menu.title)) {
        operation = null;
        combatJob = null;
        notice("특성 조회를 중단했습니다.", true);
      }
      return;
    }
    if (operation.kind === "itemDetail") {
      if (operation.received) {
        operation = null;
        key(27);
      }
      return;
    }
    if (operation.kind === "abilityDetail") {
      if (operation.received && operation.keepOpen) {
        operation = null;
        return;
      }
      if (operation.received && !operation.closed) {
        operation.closed = true;
        key(27);
        return;
      }
      if (
        operation.closed &&
        (operation.descriptionPopped ||
          !document.querySelector("#ui-stack > .ui-popup"))
      ) {
        operation = null;
        key(27);
        return;
      }
      if (
        menu?.tag === "ability" &&
        tracker.complete() &&
        !operation.selected
      ) {
        if (!operation.toggled) {
          operation.toggled = true;
          operation.toggleRevision = spellRevision;
          key("!");
          return;
        }
        // Never select an ability unless the server confirms examination mode.
        if (
          spellRevision <= operation.toggleRevision ||
          !/describe|설명/i.test(menu.title)
        )
          return;
        const current = Core.spells({ ...menu, tag: "spell" }).find(
          (a) => a.id === operation.id,
        );
        if (!current) {
          operation = null;
          combatJob = null;
          key(27);
          return;
        }
        operation.selected = true;
        key(current.letter);
      }
      return;
    }
    if (operation.kind === "skills") {
      if (
        menu?.tag === "skills" &&
        skillsRevision > operation.skillsRevision &&
        Date.now() - skillsChangedAt > 150
      ) {
        operation = null;
        key(27);
        notice("기술 정보를 갱신했습니다. 수치는 마지막 조회 시점 기준입니다.");
      } else if (menu && menu.tag !== "skills") {
        operation = null;
        combatJob = null;
        notice("다른 메뉴가 열려 기술 조회를 중단했습니다.", true);
      } else if (
        !menu &&
        m.game.get_input_mode() === 1 &&
        Date.now() - operation.started > 1200
      ) {
        operation = null;
        combatJob = null;
        notice("기술 화면을 열 수 없습니다.", true);
      }
      return;
    }
    const abilityOperation =
      operation.kind === "ability" || operation.kind === "refreshAbilities";
    const expectedTag = abilityOperation ? "ability" : "spell";
    if (menu && menu.tag !== expectedTag) {
      operation = null;
      combatJob = null;
      notice("다른 메뉴가 열렸습니다. 게임 화면에서 확인하세요.", true);
      return;
    }
    if (menu?.tag === expectedTag && tracker.complete()) {
      if (operation.kind === "refresh") {
        const entries = Core.spells(menu);
        const view = entries[0]?.view;
        if (entries.length && entries.every((entry) => entry.view === view)) {
          operation.views ||= [];
          if (operation.views.includes(view)) return;
          operation.views.push(view);
          if (operation.views.length < 2) {
            key("!");
            return;
          }
        } else if (entries.length) return;
      }
      const pending = operation;
      operation = null;
      if (pending.kind === "refresh" || pending.kind === "refreshAbilities") {
        key(27);
        notice(
          `${pending.kind === "refresh" ? "마법" : "능력"} 목록을 불러왔습니다. 수치는 마지막 조회 시점 기준입니다.`,
        );
      } else {
        const match = Core.spells({ ...menu, tag: "spell" }).find(
          (spell) => spell.id === pending.id,
        );
        if (match) {
          key(match.letter);
          notice(
            `${match.name}: ${pending.kind === "describe" ? "게임 화면에 설명을 엽니다." : "게임 화면에서 대상·확인을 이어가세요."}`,
          );
        } else {
          key(27);
          notice("해당 마법을 찾을 수 없습니다. 목록을 새로 불러오세요.", true);
        }
      }
    } else if (
      !menu &&
      operation.kind === "cast" &&
      !operation.askedForList &&
      m.game.get_input_mode() === 7
    ) {
      // z can open a prompt or a menu depending on the player's spell_menu rc.
      // Wait for the server's PROMPT mode, then ask for the list once.
      operation.askedForList = true;
      key("?");
    } else if (
      !menu &&
      m.game.get_input_mode() === 1 &&
      Date.now() - operation.started > 1200
    ) {
      operation = null;
      notice(
        `${abilityOperation ? "능력" : "마법"} 목록이 열리지 않았습니다. 게임 메시지를 확인하세요.`,
        true,
      );
    }
  }
  function nextCombatStep(m) {
    if (!combatJob || operation || !commandReady(m)) return;
    if (!combatJob.length) {
      combatJob = null;
      notice("마법·아이템·능력 위력을 갱신했습니다.");
      return;
    }
    const step = combatJob.shift();
    if (step.kind === "expandAbilities") {
      combatJob.unshift(
        ...tracker.lastAbilities.map((a) => ({
          kind: "abilityDetail",
          id: a.id,
        })),
      );
      nextCombatStep(m);
      return;
    }
    operation = { ...step, started: Date.now(), skillsRevision };
    if (step.kind === "skills") key("m");
    else if (step.kind === "profile") key("A");
    else if (step.kind === "refresh") key("I");
    else if (step.kind === "refreshAbilities" || step.kind === "abilityDetail")
      key("a");
    else if (step.kind === "itemDetail") {
      const current = Core.inventory(m.player.inv).find(
        (i) => i.slot === step.item.slot && i.name === step.item.name,
      );
      if (!current) {
        operation = null;
        return;
      }
      send("inv_item_describe", { slot: current.slot });
    }
  }
  function tick() {
    if (stopped) return;
    const m = modules();
    hook(m);
    if (
      !operation &&
      m.game?.get_input_mode?.() === 1 &&
      m.game?.get_ui_state?.() === 0 &&
      !document.querySelector("#ui-stack > .ui-popup")
    )
      tracker.stack = [];
    try {
      pump(m);
      nextCombatStep(m);
    } catch {
      operation = null;
      combatJob = null;
      notice("서버와 연결되지 않았습니다.", true);
    }
    const live = inGame(m);
    const isConnected = connected();
    const watching = !!m.client?.is_watching?.();
    const monsters = live ? monsterSnapshot(m) : [];
    const signature = JSON.stringify([
      isConnected,
      live,
      watching,
      sequence,
      inventoryRevision,
      spellRevision,
      operation?.kind,
      !!combatJob,
      combatProfile,
      m.game?.get_input_mode?.(),
      m.game?.get_ui_state?.(),
      m.player?.hp,
      m.player?.mp,
      m.player?.name,
      window.current_layer,
      !!document.querySelector("#ui-stack > .ui-popup"),
      Date.now() < actionLockUntil,
      monsters,
      skillsRevision,
      m.player?.status,
      m.player?.ac,
      m.player?.ev,
      m.player?.sh,
      m.player?.xl,
    ]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const items = live
      ? Core.inventory(m.player.inv, m.player).map((item) => ({
          ...item,
          sourceId:
            item.baseType === 3 ? Combat.identifyWand(item, m.main) : null,
          combat: itemDetails.get(`${item.slot}:${item.name}`) || null,
          gadgeteer: (Array.isArray(item.tile)
            ? item.tile
            : [item.tile]
          ).includes(m.main?.UNRAND_GADGETEER),
          icon: icon(item),
        }))
      : [];
    post("state", {
      state: {
        connected: isConnected,
        inGame: live,
        watching,
        ready: commandReady(m) && !operation && !combatJob,
        busy: !!(operation || combatJob),
        session: sequence,
        name: live ? m.player.name : "",
        place: live
          ? `${m.player.place}${m.player.depth ? `:${m.player.depth}` : ""}`
          : "",
        hp: m.player?.hp || 0,
        hpMax: m.player?.hp_max || 0,
        mp: m.player?.mp || 0,
        mpMax: m.player?.mp_max || 0,
        species: m.player?.species,
        form: m.player?.form,
        god: m.player?.god || "",
        pietyRank: m.player?.piety_rank,
        penance: !!m.player?.penance,
        gold: m.player?.gold,
        combatProfile,
        stats: {
          hp: m.player?.hp,
          hpMax: m.player?.hp_max,
          mp: m.player?.mp,
          mpMax: m.player?.mp_max,
          ac: m.player?.ac,
          ev: m.player?.ev,
          sh: m.player?.sh,
          xl: m.player?.xl,
          poisonSurvival: m.player?.poison_survival,
          status: m.player?.status || [],
        },
        monsters,
        skills,
        skillsLoaded,
        items,
        spellsLoaded: live && tracker.spellsLoaded,
        spells: live
          ? tracker.lastSpells.map((spell) => ({
              ...spell,
              sourceId: Combat.identifySpell(spell, m.gui),
              icon: icon(spell, true),
            }))
          : [],
        abilities: live
          ? tracker.lastAbilities.map((ability) => ({
              ...ability,
              combat: abilityDetails.get(ability.id) || null,
              icon: icon(ability, true),
            }))
          : [],
        abilitiesLoaded: live && tracker.abilitiesLoaded,
        menu: tracker.top?.tag || "",
        updated: Date.now(),
      },
    });
  }
  function handleAction(action) {
    const m = modules();
    if (!action || typeof action.type !== "string") return;
    if (action.type === "snapshot") {
      lastSignature = "";
      tick();
      return;
    }
    if (action.type === "cancel") {
      if (!connected() || !inGame(m) || m.client.is_watching()) return;
      operation = null;
      combatJob = null;
      key(27);
      return;
    }
    if (operation || combatJob) {
      notice("앞선 요청을 처리 중입니다.", true);
      return;
    }
    if (!commandReady(m)) {
      notice(
        "메뉴·대상 지정을 Esc로 마친 후 사용하세요. 관전 중에는 조작할 수 없습니다.",
        true,
      );
      return;
    }
    if (action.type === "refreshCombat") {
      const items = Core.inventory(m.player.inv).filter(
        (i) => ["missile", "evoke"].includes(i.category) || i.baseType === 0,
      );
      combatJob = [
        { kind: "skills" },
        { kind: "profile" },
        { kind: "refresh" },
        ...items.map((item) => ({ kind: "itemDetail", item })),
        { kind: "refreshAbilities" },
        { kind: "expandAbilities" },
      ];
      tick();
      return;
    }
    if (action.type === "item" || action.type === "describe") {
      if (!Number.isSafeInteger(action.slot) || action.slot < 0) return;
      const current = Core.inventory(m.player.inv, m.player).find(
        (item) => item.slot === action.slot,
      );
      // A picked-up/relettered item must never receive an action intended for an older row.
      if (!current || current.name !== action.name) {
        notice("소지품이 바뀌었습니다. 현재 목록에서 다시 선택하세요.", true);
        return;
      }
      if (action.type === "item" && !current.action) {
        notice("이 아이템은 상세 화면에서 사용할 수 있습니다.", true);
        return;
      }
      if (action.type === "describe") describedItem = current;
      actionLockUntil = Date.now() + 500;
      send(action.type === "item" ? "inv_item_action" : "inv_item_describe", {
        slot: action.slot,
      });
    } else if (
      ["refreshAbilities", "castAbility", "describeAbility"].includes(
        action.type,
      )
    ) {
      if (
        action.type !== "refreshAbilities" &&
        !tracker.lastAbilities.some((ability) => ability.id === action.id)
      )
        return;
      operation = {
        kind:
          action.type === "castAbility"
            ? "ability"
            : action.type === "describeAbility"
              ? "abilityDetail"
              : "refreshAbilities",
        keepOpen: action.type === "describeAbility",
        id: action.id,
        started: Date.now(),
      };
      key("a");
    } else if (action.type === "refreshSkills") {
      operation = { kind: "skills", started: Date.now(), skillsRevision };
      key("m");
    } else if (
      ["refreshSpells", "cast", "describeSpell"].includes(action.type)
    ) {
      if (
        action.type !== "refreshSpells" &&
        !tracker.lastSpells.some((spell) => spell.id === action.id)
      )
        return;
      operation = {
        kind:
          action.type === "cast"
            ? "cast"
            : action.type === "describeSpell"
              ? "describe"
              : "refresh",
        id: action.id,
        started: Date.now(),
        askedForList: false,
      };
      key(action.type === "cast" ? "z" : "I");
    } else if (action.type === "command") {
      const keys = {
        inventory: "i",
        memorise: "M",
        abilities: "a",
        skills: "m",
        religion: "^",
      };
      if (keys[action.command]) {
        actionLockUntil = Date.now() + 500;
        key(keys[action.command]);
      }
    }
    lastSignature = "";
    tick();
  }
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== CHANNEL ||
      event.data.from !== "panel" ||
      event.data.type !== "action"
    )
      return;
    try {
      handleAction(event.data.action);
    } catch {
      operation = null;
      notice("요청을 보내지 못했습니다. 연결 상태를 확인하세요.", true);
    }
  });
  // Stop a pending selection if the player starts doing something else.
  window.addEventListener(
    "mousedown",
    (event) => {
      if (
        event.isTrusted &&
        (operation || combatJob) &&
        !event.composedPath().some((node) => node?.id === "webjuk-desk")
      ) {
        operation = null;
        combatJob = null;
        notice("마우스 입력으로 위력 조회를 중단했습니다.");
      }
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted && (operation || combatJob)) {
        operation = null;
        combatJob = null;
        notice("키보드 입력으로 빠른 시전을 중단했습니다.");
      }
    },
    true,
  );
  const timer = setInterval(tick, 350);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    stopped = true;
  });
  tick();
})();
