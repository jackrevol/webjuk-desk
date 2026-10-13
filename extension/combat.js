/* Source-aligned power and damage calculations; unknown inputs remain unknown. */
(function (root, factory) {
  const data =
    typeof module === "object" && module.exports
      ? require("./power-data.js")
      : root.WebJukPowerData;
  const api = factory(data);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WebJukCombat = api;
})(globalThis, function (Data) {
  "use strict";
  const wandSpells = {
    FLAME: "SPELL_THROW_FLAME",
    PARALYSIS: "SPELL_PARALYSE",
    DIGGING: "SPELL_DIG",
    ICEBLAST: "SPELL_ICEBLAST",
    POLYMORPH: "SPELL_POLYMORPH",
    CHARMING: "SPELL_CHARMING",
    ACID: "SPELL_CORROSIVE_BOLT",
    MINDBURST: "SPELL_MINDBURST",
    LIGHT: "SPELL_BOLT_OF_LIGHT",
    QUICKSILVER: "SPELL_QUICKSILVER_BOLT",
    ROOTS: "SPELL_FASTROOT",
    WARPING: "SPELL_WARP_SPACE",
  };
  const byName = new Map(
    Object.entries(Data.spells).map(([id, value]) => [
      value.name.toLowerCase(),
      id,
    ]),
  );
  function definition(item) {
    return (
      Data.spells[item.sourceId] ||
      Data.spells[
        byName.get((item.sourceName || item.name || "").toLowerCase())
      ] ||
      Data.spells[identifyWand(item)] ||
      null
    );
  }
  function identifySpell(item, gui) {
    const tile = item.tiles?.[0]?.t;
    const found =
      tile == null
        ? null
        : Object.entries(Data.spells).find(([, s]) => gui?.[s.tile] === tile);
    return found?.[0] || byName.get((item.name || "").toLowerCase()) || null;
  }
  function identifyWand(item, main) {
    const tiles = Array.isArray(item.tile) ? item.tile : [item.tile];
    for (const key of Object.keys(wandSpells))
      if (main?.["WAND_" + key] != null && tiles.includes(main["WAND_" + key]))
        return wandSpells[key];
    const name = (item.sourceName || item.name || "").toLowerCase();
    const aliases = {
      MINDBURST: "mindburst|정신[ ]?붕괴|정신[ ]?분괴",
      PARALYSIS: "paralysis|마비",
      POLYMORPH: "polymorph|변신",
      CHARMING: "charming|매혹",
      FLAME: "flame|불꽃",
      WARPING: "warping|워프",
      ICEBLAST: "iceblast|얼음폭발|얼음 폭발",
      ACID: "acid|산성",
      LIGHT: "of light|빛의",
      QUICKSILVER: "quicksilver|수은",
      ROOTS: "roots|뿌리",
      DIGGING: "digging|굴착",
    };
    if (!/wand|마법봉/.test(name)) return null;
    for (const [key, pattern] of Object.entries(aliases))
      if (new RegExp(pattern).test(name)) return wandSpells[key];
    return null;
  }
  // Rounded player descriptions are intervals, not the underlying exact values.
  function powerFromPercent(item) {
    const def = definition(item),
      match = String(item.power || "").match(/^(\d+)%$/);
    if (!def?.cap || !match) return null;
    const pct = +match[1];
    const range = [
      Math.ceil((pct * def.cap) / 100),
      Math.ceil(((pct + 1) * def.cap) / 100) - 1,
    ];
    return range[0] <= range[1] ? range : null;
  }
  function hexChance(will, power) {
    if (!Number.isFinite(will) || !Number.isFinite(power)) return null;
    if (will >= 5000) return 0;
    const stepped = Math.floor(35 * Math.log2(1 + power / 35) + 0.5),
      target = will + 100 - stepped,
      denom = 10100;
    if (target <= 0) return 100;
    if (target > 200) return 0;
    const triangle = (n) => (n * (n + 1)) / 2;
    return Math.floor(
      (100 *
        (target <= 100 ? denom - triangle(target) : triangle(200 - target))) /
        denom,
    );
  }
  function willpower(text) {
    const lines = String(text || "").split("\n");
    const parse = (value) => {
      value = value.trim();
      if (/^(?:∞|inf(?:inite)?|면역)/i.test(value)) return [5000, 5000];
      if (/^(?:none|없음|없다|0)(?:\s|$)/i.test(value)) return [0, 0];
      const bars = value.match(/^\++(?:\s+\++)*/)?.[0];
      if (bars) {
        const n = (bars.match(/\+/g) || []).length;
        return [(n - 1) * 40 + 1, n * 40];
      }
      const approx = value.match(/^~(\d+)/);
      if (approx) return [+approx[1] - 39, +approx[1]];
      const numeric = value.match(/^(\d+)(?:\s|$)/);
      return numeric ? [+numeric[1], +numeric[1]] : null;
    };
    for (let i = 0; i < lines.length; i++) {
      const inline = lines[i].match(
        /(?:\bWill(?:power)?\b|의지(?:력)?)[ \t]*[:：]?[ \t]*([^\n]*)/i,
      );
      if (!inline) continue;
      const value = parse(inline[1]);
      if (value) return value;
      const headers = lines[i].trim().split(/\s{2,}/),
        at = headers.findIndex((s) =>
          /^(?:Will(?:power)?|의지(?:력)?)$/i.test(s),
        );
      const values = lines[i + 1]?.trim().split(/\s{2,}/);
      if (at >= 0 && values?.[at]) {
        const below = parse(values[at]);
        if (below) return below;
      }
      const offset = lines[i].search(/\bWill(?:power)?\b|의지(?:력)?/i),
        below = lines[i + 1]?.slice(offset).trim();
      if (below) {
        const result = parse(below);
        if (result) return result;
      }
    }
    return null;
  }
  // The server's dice expressions already include skills, stats, equipment and god effects.
  function damage(expression) {
    if (typeof expression !== "string") return null;
    let source = expression.trim().replace(/−/g, "-");
    const conditional =
      /\*|\b(?:against|per|turn|foxfire|upheaval)\b|현재|대상/.test(source);
    source = source
      .replace(/\([^)]*(?:against|현재|대상)[^)]*\)/gi, "")
      .replace(/\*\s*$/, "")
      .replace(/\/(?:turn|foxfire|upheaval)\b/g, "")
      .trim();
    const tokens = [];
    source = source.replace(
      /(\d+|\(\d+-\d+\))d(\d+|\(\d+-\d+\))/gi,
      (_, n, s) => {
        const range = (v) =>
          v.startsWith("(") ? v.slice(1, -1).split("-").map(Number) : [+v, +v];
        const nr = range(n),
          sr = range(s),
          result = [(nr[0] * (sr[0] + 1)) / 2, (nr[1] * (sr[1] + 1)) / 2];
        tokens.push(result);
        return "@" + (tokens.length - 1);
      },
    );
    // Sum of numeric or dice terms, optionally multiplied/divided by a scalar.
    if (
      !/^(?:@\d+|\d+(?:\.\d+)?)(?:\s*[*/]\s*\d+(?:\.\d+)?)?(?:\s*[+-]\s*(?:@\d+|\d+(?:\.\d+)?)(?:\s*[*/]\s*\d+(?:\.\d+)?)?)*$/.test(
        source,
      )
    )
      return null;
    let total = [0, 0];
    for (const term of source.matchAll(
      /([+-]?)\s*(@\d+|\d+(?:\.\d+)?)(?:\s*([*/])\s*(\d+(?:\.\d+)?))?/g,
    )) {
      let value =
        term[2][0] === "@" ? tokens[+term[2].slice(1)] : [+term[2], +term[2]];
      const factor =
        (term[1] === "-" ? -1 : 1) *
        (term[3] === "/" ? 1 / +term[4] : term[3] === "*" ? +term[4] : 1);
      if (!Number.isFinite(factor)) return null;
      value = value.map((v) => v * factor);
      total = [total[0] + Math.min(...value), total[1] + Math.max(...value)];
    }
    return {
      low: Math.max(0, total[0]),
      high: Math.max(0, total[1]),
      conditional,
      expression,
    };
  }
  function description(text) {
    const raw = String(text || ""),
      dice = raw
        .match(
          /(?:^|\n)\s*(?:Damage|피해(?:량)?|대미지)\s*[:：]\s*([^\n]+)/i,
        )?.[1]
        ?.trim();
    const rating = raw.match(
      /(?:Damage rating|피해(?:량)? (?:등급|수치)|공격력)\s*[:：]\s*(\d+(?:\.\d+)?)/i,
    )?.[1];
    const delay = raw.match(
      /(?:Current attack delay|현재 공격 (?:속도|지연))\s*[:：]\s*(\d+(?:\.\d+)?)/i,
    )?.[1];
    const range = raw
      .match(/(?:^|\n)\s*(?:Range|사거리)\s*[:：]\s*([^\n]+)/i)?.[1]
      ?.trim();
    return {
      damage: dice || null,
      rating: rating == null ? null : +rating,
      delay: delay == null ? null : +delay,
      range: range || null,
    };
  }
  function mutationProfile(text) {
    const raw = String(text || "");
    // Full A menu, including the English source string on translated servers.
    const matches = raw.match(
      /(?:wands?|마법봉)[^\n]*(?:MP|마력)|[^\n]*(?:MP-powered wands|magic power \(3 MP\)|마법봉.*강화)/i,
    );
    return {
      mpWands: matches
        ? /3\s*MP|MP-powered wands|magic power/.test(raw)
          ? 3
          : null
        : 0,
    };
  }
  function wandPower(state, item) {
    const evo = state.skills?.evocations,
      def = definition(item);
    if (!Number.isFinite(evo) || !def?.cap) return null;
    const profile = state.combatProfile,
      mp = state.stats?.mp;
    const costs = profile?.mpWands == null ? [0, 3] : [profile.mpWands];
    const pool = /Djinn|지니/.test(state.species || "")
      ? Math.max(0, (state.stats?.hp || 1) - 1)
      : mp;
    if (!Number.isFinite(pool)) return null;
    // A 0.1-level skill display hides sub-decimal progress. Account for that rounding.
    const levels = [Math.floor(evo * 7 + 1e-8), Math.ceil((evo + 0.1) * 7) - 1];
    const gadgetOwned = state.items?.some((i) => i.gadgeteer);
    const values = [];
    for (const level of levels)
      for (const cost of costs)
        for (const boost of gadgetOwned ? [1, 1.3] : [1]) {
          let pow = Math.floor(
            ((15 + Math.floor(level / 2)) * (Math.min(cost, pool) + 9)) / 9,
          );
          pow = Math.floor(pow * boost);
          values.push(Math.min(pow, def.cap));
        }
    return [Math.min(...values), Math.max(...values)];
  }
  function chance(state, item, monster, kind) {
    const def = definition(item);
    if (!def?.flags.includes("WL_check")) return null;
    const power =
        kind === "item" ? wandPower(state, item) : powerFromPercent(item),
      will = monster.will;
    if (will?.[0] >= 5000) return [0, 0];
    if (!power || !will) return null;
    const [base, mult, div] = def.hex;
    const ench = (p) => Math.floor(base + (p * mult) / div);
    // Guile equipment is not fully exposed; if carried, include both equipped and unequipped cases.
    const evo = state.skills?.evocations ?? 27;
    const guile =
      20 +
      Math.floor(
        75 * Math.log2(1 + Math.floor((Math.floor(evo) * 7) / 2) / 75) + 0.5,
      );
    const bypass =
      (state.items?.some((i) => /guile|기만/i.test(i.name)) ? guile : 0) +
      (state.form ? 40 : 0);
    return [
      hexChance(will[1], ench(power[0])),
      hexChance(Math.max(0, will[0] - bypass), ench(power[1])),
    ];
  }
  function evaluate(state, item, monster, kind) {
    const def = definition(item),
      raw = item.combat || {},
      result = {
        power:
          kind === "item" && item.baseType === 3
            ? wandPower(state, item)
            : kind === "spell"
              ? powerFromPercent(item)
              : null,
        willChance: chance(state, item, monster, kind),
        damage: damage(item.damage || raw.damage),
        rating: raw.rating ?? null,
      };
    let value =
      result.damage?.low ?? (result.rating == null ? null : result.rating / 2);
    const factor =
      kind === "spell" || kind === "ability"
        ? Math.max(0, 1 - Number(item.fail ?? 100) / 100)
        : 1;
    if (result.willChance?.[1] === 0)
      return {
        ...result,
        excluded: true,
        score: 0,
        reason: "의지 면역 또는 돌파 불가능",
      };
    const wlFactor = result.willChance
      ? result.willChance[0] / 100
      : def?.flags.includes("WL_check")
        ? null
        : null;
    if (value != null) value *= factor * (wlFactor ?? 1);
    if (def?.flags.includes("WL_check") && !result.willChance) value = null;
    const flavour = def?.flavour,
      elementKey = {
        FIRE: "fire",
        LAVA: "fire",
        COLD: "cold",
        ICE: "cold",
        ELECTRICITY: "electricity",
        THUNDER: "electricity",
        STUN_BOLT: "electricity",
        NEG: "negative",
        PAIN: "negative",
        VAMPIRIC_DRAINING: "negative",
        ACID: "acid",
        POISON: "poison",
        POISON_ARROW: "poison",
        MERCURY: "poison",
      }[flavour];
    const resistance = elementKey ? monster.resists?.[elementKey] : undefined;
    if (value != null && resistance != null) {
      const fraction = ["ICE", "THUNDER", "LAVA", "WATER"].includes(flavour)
        ? 0.5
        : ["POISON_ARROW", "MERCURY"].includes(flavour)
          ? 0.7
          : 1;
      const boolean = ["electricity", "poison"].includes(elementKey) ? 1 : 0;
      const multiplier =
        resistance >= 3
          ? 0
          : resistance > 0
            ? 1 / (1 + boolean + resistance * resistance)
            : resistance < 0
              ? 1.5
              : 1;
      value *= 1 - fraction + fraction * multiplier;
    }
    const totalDamage = value;
    let score =
      value == null
        ? result.willChance
          ? ((65 * result.willChance[0]) / 100) * factor
          : null
        : Math.min(90, 20 + value * 2);
    const details = [];
    if (result.power) details.push(`위력 ${formatRange(result.power)}`);
    if (result.damage)
      details.push(
        `기본 평균 피해 ${formatRange([result.damage.low, result.damage.high])}${result.damage.conditional ? " (조건부)" : ""}`,
      );
    if (result.rating != null) details.push(`서버 공격력 ${result.rating}`);
    if (def?.flags.includes("WL_check"))
      details.push(
        result.willChance
          ? `의지 돌파 ${formatRange(result.willChance)}%`
          : "의지 돌파 미확인",
      );
    if (result.rating != null && !result.damage)
      details.push(
        `공격력 환산 지표 ${(result.rating / 2).toFixed(1)} (피해 예측 아님)`,
      );
    else if (
      value != null &&
      (!def?.flags.includes("WL_check") || result.willChance)
    )
      details.push(
        `성공률 반영 평균 지표 ${value.toFixed(1)} (AC·EV·속성·조건부 효과 보정 전)`,
      );
    if (elementKey)
      details.push(
        resistance == null
          ? "속성 저항 미확인"
          : `속성 저항 ${resistance} 반영`,
      );
    if (totalDamage != null)
      details.push(
        `예상 총 피해 지표 ≈${totalDamage.toFixed(1)} / 1회 (AC·EV 제외${result.rating != null ? ", 공격력 기반 근사" : ""})`,
      );
    if (def?.flags.includes("WL_check") && !result.willChance) score = 0;
    return { ...result, score, totalDamage, reason: details.join(" · ") };
  }
  function formatRange(range) {
    const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    return range[0] === range[1]
      ? f(range[0])
      : `${f(range[0])}–${f(range[1])}`;
  }
  function faith(god, rank, gold, penance) {
    if (!god) return { text: "무신앙", detail: "현재 섬기는 신이 없습니다." };
    if (/Gozag|고자그/i.test(god))
      return {
        text: `${god} · ${gold ?? "?"} G`,
        detail: "고자그는 일반 신앙 수치 대신 금화를 사용합니다.",
      };
    if (/Xom|좀$/i.test(god))
      return {
        text: `${god} · 기분 ${rank ?? "?"}`,
        detail: "좀의 호감 등급이며 일반 신앙 점수로 환산하지 않습니다.",
      };
    const intervals = [
        [0, 29],
        [30, 49],
        [50, 74],
        [75, 99],
        [100, 119],
        [120, 159],
        [160, 200],
      ],
      range = intervals[rank];
    return {
      text: `${god} · ${range ? range.join("–") : "?"}${penance ? " · 참회" : ""}`,
      detail: `${rank ?? "?"}성 · 신앙 범위. 서버는 정확한 내부 신앙 수치를 보내지 않습니다.${penance ? " 신의 참회 요구 상태입니다." : ""}`,
    };
  }
  return {
    definition,
    identifySpell,
    identifyWand,
    wandSpells,
    powerFromPercent,
    hexChance,
    willpower,
    damage,
    description,
    mutationProfile,
    wandPower,
    chance,
    evaluate,
    formatRange,
    faith,
  };
});
