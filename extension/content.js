(() => {
  "use strict";
  if (document.getElementById("webjuk-desk")) return;
  const Core = globalThis.WebJukCore,
    Advisor = globalThis.WebJukAdvisor,
    CHANNEL = "webjuk-desk-v1";
  let prefs = Core.settings(),
    state = { items: [], spells: [], ready: false };
  let tab = "items",
    filter = "all",
    search = "",
    recording = null,
    listSignature = "";
  let showSettings = false,
    noticeTimer,
    adviceSignature = "";
  const host = document.createElement("div");
  host.id = "webjuk-desk";
  const shadow = host.attachShadow({ mode: "open" });
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = chrome.runtime.getURL("ui.css");
  shadow.append(sheet);
  const app = document.createElement("section");
  app.className = "native-panel";
  app.setAttribute("aria-label", "마법·소지품·투척물");
  app.innerHTML = `
    <nav class="tabs" role="tablist" aria-label="게임 패널">
      <button role="tab" id="items-tab" data-tab="items" aria-controls="panel-content" title="인벤토리 (Alt I)">소지품</button>
      <button role="tab" id="spells-tab" data-tab="spells" aria-controls="panel-content" title="마법 (Alt M)">마법</button>
      <button role="tab" id="missiles-tab" data-tab="missiles" aria-controls="panel-content" title="투척물 (Alt T)">투척</button>
      <span class="tab-spacer"></span><button class="tool" data-ui="settings" title="확장 설정" aria-label="확장 설정">⚙</button>
      <button class="tool" data-ui="refresh" title="마법 목록 갱신" aria-label="마법 목록 불러오기" hidden>↻</button>
      <button class="tool" data-ui="collapse" title="접기·펼치기 (Alt &#96;)" aria-label="패널 접기·펼치기">−</button>
    </nav>
    <div class="body"><div class="quick-slots" aria-label="빠른 슬롯" hidden></div>
      <section id="panel-content" role="tabpanel" aria-labelledby="items-tab">
        <div class="tiles" aria-label="소지품 목록"></div>
      </section>
      <section class="settings" hidden aria-label="확장 설정">
        <label><span>집중 화면 (채팅 숨김)</span><input type="checkbox" data-pref="focus"></label>
        <button class="text-button" data-ui="skills" title="기술 수치 갱신 · 훈련 설정은 바꾸지 않음">기술 ↻</button><button class="text-button" data-ui="abilities" title="능력 목록 갱신">능력 ↻</button>
        <div class="shortcut-settings"></div>
        <div class="slot-settings"></div><button data-ui="reset" class="text-button">기본 설정 복원</button>
      </section>
      <div class="notice" role="status" aria-live="polite" hidden></div>
    </div>`;
  shadow.append(app);
  const $ = (selector) => shadow.querySelector(selector),
    $$ = (selector) => [...shadow.querySelectorAll(selector)];
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(value) {
    window.postMessage(
      { channel: CHANNEL, from: "panel", type: "action", action: value },
      location.origin,
    );
  }
  function notify(text, error = false) {
    const node = $(".notice");
    node.textContent = text;
    host.title = text;
  }
  async function persist() {
    try {
      await chrome.storage.local.set({ webjuk: prefs });
    } catch {
      notify("설정을 저장하지 못했습니다. 웹죽 탭을 새로고침해 주세요.", true);
    }
  }
  function setPrefs(patch) {
    prefs = Core.settings({ ...prefs, ...patch });
    persist();
    listSignature = "";
    render();
  }
  function itemId(item) {
    return `${item.baseType ?? ""}:${item.name
      .replace(/^(?:a |an |the |\d+ )/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/\s*\d+(?:개|장|병)$/, "")
      .trim()}`;
  }
  function pinned(kind, item) {
    return prefs.quickSlots.findIndex(
      (slot) =>
        slot.kind === kind &&
        slot.id === (kind === "spell" ? item.id : itemId(item)),
    );
  }
  function pin(kind, item) {
    const index = pinned(kind, item),
      slots = [...prefs.quickSlots];
    if (index >= 0) slots.splice(index, 1);
    else if (slots.length >= 6) {
      notify("슬롯이 가득 찼습니다. ☆ 또는 Shift+클릭으로 먼저 해제하세요.");
      return;
    } else
      slots.push({
        kind,
        id: kind === "spell" ? item.id : itemId(item),
        name: item.name,
      });
    setPrefs({ quickSlots: slots });
  }
  function perform(kind, item, describe = false) {
    if (!state.ready || state.busy) {
      notify("게임의 메뉴·대상 지정을 마친 후 사용하세요.", true);
      return;
    }
    if (kind === "ability") action({ type: "castAbility", id: item.id });
    else if (kind === "spell")
      action({ type: describe ? "describeSpell" : "cast", id: item.id });
    else
      action({
        type: describe || !item.action ? "describe" : "item",
        slot: item.slot,
        name: item.name,
      });
    shadow.activeElement?.blur();
  }
  function imageFor(item, kind) {
    if (item.icon?.startsWith("data:image/png;base64,")) {
      const img = el("img", "tile");
      img.src = item.icon;
      img.alt = "";
      return img;
    }
    return el(
      "span",
      `tile fallback ${item.category || "spell"}`,
      kind === "spell"
        ? "✦"
        : {
            missile: "➶",
            potion: "!",
            scroll: "?",
            evoke: "/",
            equipment: ")",
          }[item.category] || "%",
    );
  }
  function resolveSlot(slot) {
    return slot.kind === "spell"
      ? state.spells.find((item) => item.id === slot.id)
      : state.items.find((item) => itemId(item) === slot.id);
  }
  function renderSlots() {
    const node = $(".quick-slots");
    node.replaceChildren();
    node.hidden = !prefs.quickSlots.length;
    prefs.quickSlots.forEach((slot, i) => {
      const item = resolveSlot(slot),
        button = el("button", "quick-slot");
      button.title = `${slot.name} · Alt ${i + 1} · 우클릭: 해제`;
      button.setAttribute("aria-label", `${i + 1}번 빠른 슬롯: ${slot.name}`);
      button.append(
        item ? imageFor(item, slot.kind) : el("span", "unavailable", "·"),
        el("kbd", "", i + 1),
      );
      button.classList.toggle(
        "unavailable",
        !item || !state.ready || state.busy,
      );
      button.addEventListener("click", () =>
        item
          ? perform(slot.kind, item)
          : notify("현재 목록에 없는 빠른 슬롯입니다."),
      );
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        setPrefs({
          quickSlots: prefs.quickSlots.filter((_, index) => index !== i),
        });
      });
      node.append(button);
    });
  }
  function empty(title, description, refresh = false) {
    const node = el("div", "empty");
    node.title = `${title} · ${description}`;
    if (refresh) {
      const button = el("button", "tool", "↻");
      button.title = "마법 목록 불러오기";
      button.setAttribute("aria-label", "마법 목록 불러오기");
      button.disabled = !state.ready || state.busy;
      button.addEventListener("click", () => action({ type: "refreshSpells" }));
      node.append(button);
    }
    $(".tiles").append(node);
  }
  function renderList() {
    const signature = JSON.stringify([
      state.items,
      state.spells,
      state.ready,
      state.busy,
      state.connected,
      state.inGame,
      state.watching,
      state.spellsLoaded,
      prefs.quickSlots,
      tab,
      filter,
      search,
    ]);
    if (signature === listSignature) return;
    listSignature = signature;
    const list = $(".tiles");
    list.replaceChildren();
    list.setAttribute(
      "aria-label",
      tab === "spells"
        ? "마법 목록"
        : tab === "missiles"
          ? "투척물 목록"
          : "소지품 목록",
    );
    if (!state.connected || !state.inGame) {
      empty("게임 연결을 기다리는 중", "게임을 시작하면 소지품이 표시됩니다.");
      return;
    }
    if (tab === "spells" && !state.spellsLoaded) {
      empty(
        "마법 목록을 불러오세요",
        "마법을 배운 뒤 ↻로 갱신하세요. 실패율은 마지막 갱신 시점 기준입니다.",
        !state.watching,
      );
      return;
    }
    const items = (tab === "spells" ? state.spells : state.items).filter(
      (item) =>
        item.name.toLowerCase().includes(search.toLowerCase()) &&
        (tab !== "missiles" || item.category === "missile") &&
        (tab !== "items" || filter === "all" || item.category === filter),
    );
    if (!items.length) {
      empty(
        tab === "missiles" ? "투척물이 없습니다" : "표시할 항목이 없습니다",
        "현재 소지품·검색 조건을 확인하세요.",
      );
      return;
    }
    const kind = tab === "spells" ? "spell" : "item";
    for (const item of items) {
      const cell = el(
        "div",
        `cell${item.equipped ? " equipped" : ""}${item.useless ? " useless" : ""}`,
      );
      const info = `${item.letter}) ${item.name}${item.detail ? ` · ${item.detail}` : ""}${item.quantity > 1 ? ` · 수량 ${item.quantity}` : ""}${item.charges != null ? ` · 충전 ${item.charges}` : ""}`;
      const button = el("button", "tile-button");
      button.title = `${info}\n좌클릭: ${kind === "spell" ? "시전" : item.action || "상세 설명"} · 우클릭: 설명 · Shift+클릭: 슬롯 등록`;
      button.setAttribute(
        "aria-label",
        `${item.name} ${kind === "spell" ? "시전" : item.category === "missile" ? "투척" : item.action ? "사용" : "상세 설명"}`,
      );
      button.setAttribute(
        "aria-disabled",
        String(!state.ready || !!state.busy),
      );
      button.append(imageFor(item, kind), el("kbd", "letter", item.letter));
      if (item.quantity > 1 || item.charges != null)
        button.append(el("span", "quantity", item.charges ?? item.quantity));
      button.addEventListener("click", (event) =>
        event.shiftKey ? pin(kind, item) : perform(kind, item),
      );
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        perform(kind, item, true);
      });
      cell.append(button);
      const index = pinned(kind, item),
        star = el(
          "button",
          `pin${index >= 0 ? " pinned" : ""}`,
          index >= 0 ? "★" : "☆",
        );
      star.title =
        index >= 0 ? `${index + 1}번 빠른 슬롯 해제` : "빠른 슬롯 등록";
      star.setAttribute(
        "aria-label",
        `${item.name} 빠른 슬롯 ${index >= 0 ? "해제" : "등록"}`,
      );
      star.setAttribute("aria-pressed", String(index >= 0));
      star.addEventListener("click", () => pin(kind, item));
      cell.append(star);
      list.append(cell);
    }
  }
  function mount() {
    const column = document.querySelector("#right_column");
    const stats = column?.querySelector("#stats");
    const width =
      stats?.getBoundingClientRect().width || column?.clientWidth || 300;
    host.style.width = `${width}px`;
    host.style.maxWidth = `${width}px`;
    if (column && host.parentNode !== column) {
      column.append(host);
      listSignature = "";
    }
    host.hidden = !prefs.enabled || !column || !state.inGame;
    document.documentElement.classList.toggle(
      "webjuk-enabled",
      !!(prefs.enabled && state.inGame),
    );
    document.documentElement.classList.toggle(
      "webjuk-focus",
      !!(prefs.enabled && prefs.focus && state.inGame),
    );
    if (host.hidden) return;
    const top = host.getBoundingClientRect().top;
    host.style.setProperty(
      "--panel-height",
      `${Math.max(26, Math.min(220, window.innerHeight - top - 6))}px`,
    );
  }
  function renderSettings() {
    $("[data-pref=focus]").checked = prefs.focus;
    const node = $(".shortcut-settings");
    node.replaceChildren();
    for (const [key, name] of [
      ["spells", "마법"],
      ["inventory", "소지품"],
      ["missiles", "투척"],
      ["toggle", "접기·펼치기"],
    ]) {
      const row = el("label");
      row.append(el("span", "", name));
      const button = el(
        "button",
        "text-button",
        recording === key
          ? "키 입력…"
          : prefs.shortcuts[key].replace(/Key|Digit/g, ""),
      );
      button.addEventListener("click", () => {
        recording = key;
        renderSettings();
      });
      row.append(button);
      node.append(row);
    }
    const slots = $(".slot-settings");
    slots.replaceChildren();
    prefs.quickSlots.forEach((slot, i) => {
      const button = el("button", "text-button", `${i + 1}. ${slot.name} ×`);
      button.addEventListener("click", () => {
        setPrefs({
          quickSlots: prefs.quickSlots.filter((_, index) => index !== i),
        });
        renderSettings();
      });
      slots.append(button);
    });
  }
  function renderAdvice() {
    const list = document.getElementById("monster_list");
    if (!list) return;
    const signature = JSON.stringify([
      state.monsters,
      state.stats,
      state.items,
      state.spells,
      state.abilities,
      state.skills,
      prefs.enabled,
      state.ready,
      state.busy,
    ]);
    if (
      signature === adviceSignature &&
      [...list.querySelectorAll(".group")].every(
        (row, i) =>
          !state.monsters?.some((mon) => mon.row === i) ||
          row.querySelector(".webjuk-monster-advice"),
      )
    )
      return;
    adviceSignature = signature;
    list
      .querySelectorAll(".webjuk-monster-advice")
      .forEach((node) => node.remove());
    if (!prefs.enabled || !Advisor) return;
    for (const mon of state.monsters || []) {
      const row = list.querySelectorAll(".group")[mon.row];
      if (!row) continue;
      const report = Advisor.advise(state, mon),
        box = el("span", "webjuk-monster-advice");
      const badge = el("span", `webjuk-risk risk-${report.risk}`, report.label);
      badge.tabIndex = 0;
      badge.title = `위험도 추정\n${report.reasons.join("\n")}\n저항·기술·실패율은 마지막 조회 기준입니다.`;
      badge.setAttribute(
        "aria-label",
        `${mon.name}: ${report.label}. ${report.reasons.join(". ")}`,
      );
      box.append(badge);
      for (const candidate of report.candidates.slice(0, 2)) {
        const button = el("button", "webjuk-candidate");
        button.title = `${candidate.role}: ${candidate.name}\n${candidate.reason}\n클릭: 사용·시전. 저항 미확인 시 효과를 보장하지 않습니다.`;
        button.setAttribute(
          "aria-label",
          `${mon.name} 대응 후보: ${candidate.name}`,
        );
        const item =
          candidate.kind === "ability"
            ? (state.abilities || []).find((item) => item.id === candidate.id)
            : candidate.kind === "spell"
              ? state.spells.find((item) => item.id === candidate.id)
              : state.items.find((item) => item.slot === candidate.slot);
        if (!item) continue;
        button.append(imageFor(item, candidate.kind));
        button.disabled = !state.ready || state.busy;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          perform(candidate.kind, item);
          button.blur();
        });
        for (const type of ["keydown", "keypress", "keyup"])
          button.addEventListener(type, (event) => event.stopPropagation());
        box.append(button);
      }
      row.append(box);
    }
  }
  function render() {
    mount();
    $(".body").hidden = prefs.collapsed;
    $("[data-ui=collapse]").textContent = prefs.collapsed ? "+" : "−";
    for (const button of $$("[data-tab]")) {
      const active = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    $("#panel-content").hidden = showSettings;
    $(".settings").hidden = !showSettings;
    $("#panel-content").setAttribute("aria-labelledby", `${tab}-tab`);
    $("[data-ui=refresh]").hidden = tab !== "spells";
    $("[data-ui=refresh]").disabled = !state.ready || state.busy;
    renderSlots();
    renderList();
    renderAdvice();
  }
  function switchTab(next) {
    tab = next;
    showSettings = false;
    if (prefs.collapsed) setPrefs({ collapsed: false });
    render();
  }
  app.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.tab) {
      switchTab(button.dataset.tab);
      return;
    }
    if (button.dataset.command) {
      action({ type: "command", command: button.dataset.command });
      shadow.activeElement?.blur();
      return;
    }
    switch (button.dataset.ui) {
      case "collapse":
        setPrefs({ collapsed: !prefs.collapsed });
        break;
      case "settings":
        showSettings = !showSettings;
        recording = null;
        renderSettings();
        if (prefs.collapsed) setPrefs({ collapsed: false });
        render();
        break;
      case "refresh":
        action({ type: "refreshSpells" });
        shadow.activeElement?.blur();
        break;
      case "skills":
        action({ type: "refreshSkills" });
        shadow.activeElement?.blur();
        break;
      case "abilities":
        action({ type: "refreshAbilities" });
        shadow.activeElement?.blur();
        break;
      case "cancel":
        action({ type: "cancel" });
        shadow.activeElement?.blur();
        break;
      case "reset":
        prefs = Core.settings();
        persist();
        renderSettings();
        listSignature = "";
        render();
        break;
      case "fullscreen":
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
        } catch {
          notify("브라우저 메뉴에서 전체화면을 선택해 주세요.");
        }
        break;
    }
  });
  $("[data-pref=focus]").addEventListener("change", (event) =>
    setPrefs({ focus: event.target.checked }),
  );
  for (const type of ["keydown", "keypress", "keyup"])
    shadow.addEventListener(type, (event) => event.stopPropagation());
  // The native popup handler closes dialogs on mousedown anywhere inside
  // #game. A click on our tabs must not dismiss a server dialog.
  window.addEventListener(
    "mousedown",
    (event) => {
      if (
        event.composedPath().includes(host) ||
        event.target.closest?.(".webjuk-monster-advice")
      )
        event.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      const path = event.composedPath();
      if (recording) {
        if (!path.includes(host)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") {
          recording = null;
          renderSettings();
          return;
        }
        const value = Core.chord(event);
        if (!value) return;
        if (!(event.altKey || event.ctrlKey) || event.metaKey || event.repeat) {
          notify("Alt 또는 Ctrl을 함께 눌러 주세요.");
          return;
        }
        if (
          /^Alt\+Digit[1-6]$/.test(value) ||
          Object.entries(prefs.shortcuts).some(
            ([key, chord]) => key !== recording && chord === value,
          )
        ) {
          notify("이미 사용 중인 단축키입니다.");
          return;
        }
        setPrefs({ shortcuts: { ...prefs.shortcuts, [recording]: value } });
        recording = null;
        renderSettings();
        return;
      }
      if (
        !prefs.enabled ||
        !state.inGame ||
        event.isComposing ||
        event.repeat ||
        Core.editable(path)
      )
        return;
      const value = Core.chord(event),
        name = Object.keys(prefs.shortcuts).find(
          (key) => prefs.shortcuts[key] === value,
        ),
        quick = value.match(/^Alt\+Digit([1-6])$/);
      if (!name && !quick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (name === "toggle") setPrefs({ collapsed: !prefs.collapsed });
      else if (name) switchTab(name === "inventory" ? "items" : name);
      else {
        const slot = prefs.quickSlots[Number(quick[1]) - 1];
        if (!slot) {
          notify("빈 빠른 슬롯입니다.");
          return;
        }
        const item = resolveSlot(slot);
        if (item) perform(slot.kind, item);
        else notify("현재 목록에 없는 빠른 슬롯입니다.");
      }
    },
    true,
  );
  $(".tabs").addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const tabs = ["items", "spells", "missiles"];
      switchTab(
        tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3],
      );
      $(`[data-tab=${tab}]`).focus();
    }
  });
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== CHANNEL ||
      event.data.from !== "bridge"
    )
      return;
    if (event.data.type === "notice" && typeof event.data.text === "string")
      notify(event.data.text, event.data.error);
    if (
      event.data.type === "state" &&
      event.data.state &&
      Array.isArray(event.data.state.items) &&
      Array.isArray(event.data.state.spells)
    ) {
      state = event.data.state;
      render();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.webjuk) {
      prefs = Core.settings(changes.webjuk.newValue);
      listSignature = "";
      renderSettings();
      render();
    }
  });
  window.addEventListener("resize", mount);
  const observer = new MutationObserver(() => {
    if (
      !host.isConnected ||
      host.parentNode !== document.querySelector("#right_column")
    )
      mount();
  });
  observer.observe(document.getElementById("game") || document.body, {
    childList: true,
    subtree: true,
  });
  chrome.storage.local
    .get("webjuk")
    .then((result) => {
      prefs = Core.settings(result.webjuk);
      renderSettings();
      render();
      action({ type: "snapshot" });
    })
    .catch(() => {
      renderSettings();
      render();
      action({ type: "snapshot" });
    });
  render();
})();
