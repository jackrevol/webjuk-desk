/* Shared pure helpers; runs independently in the MAIN and ISOLATED worlds. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WebJukCore = api;
})(globalThis, function () {
  "use strict";
  const DEFAULTS = Object.freeze({
    enabled: true,
    collapsed: false,
    focus: false,
    quickSlots: [],
    shortcuts: {
      inventory: "Alt+KeyI",
      spells: "Alt+KeyM",
      missiles: "Alt+KeyT",
      toggle: "Alt+Backquote",
    },
  });
  function plain(value) {
    return String(value ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"');
  }
  function letterForSlot(slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < 52
      ? String.fromCharCode(slot < 26 ? 97 + slot : 65 + slot - 26)
      : "";
  }
  function category(item) {
    if (item.base_type === 1) return "missile";
    if ([0, 2, 6, 10].includes(item.base_type)) return "equipment";
    if (item.base_type === 7) return "potion";
    if (item.base_type === 5) return "scroll";
    if ([3, 13].includes(item.base_type)) return "evoke";
    const text = `${item.name} ${item.action_verb || ""}`.toLowerCase();
    if (/potion|quaff|물약|마시/.test(text)) return "potion";
    if (/scroll|read|두루마리|읽/.test(text)) return "scroll";
    if (/wand|evoke|evocable|마법봉|발동/.test(text)) return "evoke";
    if (/wield|wear|put on|장착|착용|휘두/.test(text)) return "equipment";
    return "other";
  }
  function inventory(inv = {}, player = {}) {
    return Object.entries(inv)
      .filter(
        ([slot, item]) =>
          /^\d+$/.test(slot) &&
          Number.isSafeInteger(Number(slot)) &&
          item &&
          item.quantity > 0,
      )
      .map(([slot, item]) => {
        slot = Number(slot);
        const letter =
          typeof item.letter === "number"
            ? String.fromCharCode(item.letter)
            : letterForSlot(slot);
        return {
          slot,
          letter,
          name: plain(item.name || "이름 없는 아이템"),
          quantity: item.quantity,
          charges: item.qty_field === "plus" ? item.plus : null,
          action: plain(item.action_verb),
          category: category(item),
          baseType: item.base_type,
          useless: !!item.useless,
          tile: item.tile,
          equipped:
            slot === player.weapon_index ||
            slot === player.offhand_index ||
            /\((?:worn|on|weapon|in hand)\)/i.test(item.name || ""),
        };
      })
      .sort((a, b) => a.slot - b.slot);
  }
  function spellIdentity(item) {
    if (item.tiles?.length)
      return item.tiles.map((t) => `${t.tex}:${t.t}`).join("|");
    return plain(item.text)
      .replace(/^\s*[a-zA-Z]\s*[-+)]\s*/, "")
      .trim()
      .split(/\s{2,}/)[0];
  }
  function spells(menu) {
    if (!menu || menu.tag !== "spell") return [];
    return Object.values(menu.items || {})
      .filter((item) => item?.level === 2 && item.hotkeys?.length)
      .map((item) => {
        const text = plain(item.text).trim();
        const body = text.replace(/^[a-zA-Z]\s*[-+)]\s*/, "");
        const columns = body.split(/\s{2,}/);
        return {
          id: spellIdentity(item),
          letter: String.fromCharCode(item.hotkeys[0]),
          name: columns[0],
          detail: columns.slice(1).join(" · "),
          text,
          tiles: item.tiles,
          fail: text.match(/(\d+)%/)?.[1] ?? null,
          level: Number(body.match(/\s(\d+)\s*$/)?.[1]) || null,
          colour: item.colour,
        };
      });
  }
  class MenuTracker {
    constructor() {
      this.stack = [];
      this.lastSpells = [];
      this.spellsLoaded = false;
      this.lastAbilities = [];
      this.abilitiesLoaded = false;
    }
    get top() {
      return this.stack.at(-1);
    }
    reset() {
      this.stack = [];
      this.lastSpells = [];
      this.spellsLoaded = false;
      this.lastAbilities = [];
      this.abilitiesLoaded = false;
    }
    receive(data) {
      if (data.msg === "menu") {
        if (data.replace) this.stack.pop();
        const menu = {
          tag: data.tag,
          title: plain(data.title?.text ?? data.title),
          total: data.total_items ?? data.items?.length ?? 0,
          items: {},
        };
        this.stack.push(menu);
        this.merge(data);
      } else if (data.msg === "update_menu_items") this.merge(data);
      else if (data.msg === "update_menu" && this.top) {
        if (data.total_items !== undefined) {
          this.top.total = data.total_items;
          for (const index of Object.keys(this.top.items))
            if (+index >= data.total_items) delete this.top.items[index];
        }
        if (data.title !== undefined)
          this.top.title = plain(data.title?.text ?? data.title);
        this.capture();
      } else if (data.msg === "close_menu") this.stack.pop();
      else if (data.msg === "close_all_menus") this.stack = [];
    }
    merge(data) {
      if (!this.top || !Array.isArray(data.items)) return;
      const start = data.chunk_start || 0;
      data.items.forEach((item, i) => {
        this.top.items[start + i] = {
          ...this.top.items[start + i],
          ...structuredClone(item),
        };
        // WebTiles treats a missing hotkeys field as removal, not a partial
        // update. Do not keep an action that the server made unselectable.
        if (item.hotkeys === undefined)
          delete this.top.items[start + i].hotkeys;
      });
      this.capture();
    }
    complete() {
      return !!this.top && Object.keys(this.top.items).length >= this.top.total;
    }
    capture() {
      if (this.top?.tag === "spell" && this.complete()) {
        this.lastSpells = spells(this.top);
        this.spellsLoaded = true;
      } else if (this.top?.tag === "ability" && this.complete()) {
        this.lastAbilities = spells({ ...this.top, tag: "spell" });
        this.abilitiesLoaded = true;
      }
    }
  }
  function chord(event) {
    if (
      event.isComposing ||
      ["Alt", "Control", "Meta", "Shift"].includes(event.key)
    )
      return "";
    return [
      event.ctrlKey && "Ctrl",
      event.altKey && "Alt",
      event.shiftKey && "Shift",
      event.metaKey && "Meta",
      event.code,
    ]
      .filter(Boolean)
      .join("+");
  }
  function editable(path) {
    return path.some((el) =>
      el?.matches?.(
        "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
      ),
    );
  }
  function settings(value = {}) {
    return {
      ...DEFAULTS,
      enabled: value.enabled !== false,
      collapsed: !!value.collapsed,
      focus: !!value.focus,
      quickSlots: Array.isArray(value.quickSlots)
        ? value.quickSlots
            .filter(
              (slot) =>
                slot &&
                ["spell", "item"].includes(slot.kind) &&
                typeof slot.id === "string",
            )
            .slice(0, 6)
        : [],
      shortcuts: Object.fromEntries(
        Object.entries(DEFAULTS.shortcuts).map(([key, fallback]) => [
          key,
          typeof value.shortcuts?.[key] === "string"
            ? value.shortcuts[key]
            : fallback,
        ]),
      ),
    };
  }
  return {
    DEFAULTS,
    plain,
    letterForSlot,
    inventory,
    spells,
    spellIdentity,
    MenuTracker,
    chord,
    editable,
    settings,
  };
});
