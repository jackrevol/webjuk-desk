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
    if (pct > 100) return null;
    const range = [
      Math.ceil((pct * def.cap) / 100),
      Math.min(def.cap, Math.ceil(((pct + 1) * def.cap) / 100) - 1),
    ];
    return range[0] <= range[1] ? range : null;
  }
  function hexChance(will, power, rounded = true) {
    if (!Number.isFinite(will) || !Number.isFinite(power)) return null;
    if (will >= 5000) return 0;
    const stepped = Math.floor(35 * Math.log2(1 + power / 35) + 0.5),
      target = will + 100 - stepped,
      denom = 10100;
    if (target <= 0) return 100;
    if (target > 200) return 0;
    const triangle = (n) => (n * (n + 1)) / 2;
    const percent =
      (100 *
        (target <= 100 ? denom - triangle(target) : triangle(200 - target))) /
        denom;
    return rounded ? Math.floor(percent) : percent;
  }
  function statRange(text, label, scale, immune = false) {
    const lines = String(text || "").split("\n");
    const parse = (value) => {
      value = value.trim();
      if (immune && /^(?:∞|inf(?:inite)?|면역)/i.test(value)) return [5000, 5000];
      if (/^(?:none|없음|없다|0)(?:\s|$)/i.test(value)) return [0, 0];
      const bars = value.match(/^\++(?:\s+\++)*/)?.[0];
      if (bars) {
        const n = (bars.match(/\+/g) || []).length;
        return [(n - 1) * scale + 1, n * scale];
      }
      const approx = value.match(/^~(\d+)/);
      if (approx) return [Math.max(0, +approx[1] - scale + 1), +approx[1]];
      const numeric = value.match(/^(\d+)(?:\s|$)/);
      return numeric ? [+numeric[1], +numeric[1]] : null;
    };
    for (let i = 0; i < lines.length; i++) {
      const inline = lines[i].match(new RegExp(`(?:${label})[ \\t]*[:：]?[ \\t]*([^\\n]*)`, "i"));
      if (!inline) continue;
      const value = parse(inline[1]);
      if (value) return value;
      const headers = lines[i].trim().split(/\s{2,}/),
        at = headers.findIndex((s) =>
          new RegExp(`^(?:${label})$`, "i").test(s),
        );
      const values = lines[i + 1]?.trim().split(/\s{2,}/);
      if (at >= 0 && values?.[at]) {
        const below = parse(values[at]);
        if (below) return below;
      }
      const offset = lines[i].search(new RegExp(label, "i")),
        below = lines[i + 1]?.slice(offset).trim();
      if (below) {
        const result = parse(below);
        if (result) return result;
      }
    }
    return null;
  }
  function willpower(text) {
    return statRange(text, "\\bWill(?:power)?\\b|의지(?:력)?", 40, true);
  }
  function defences(text) {
    return {
      ac: statRange(text, "\\bAC\\b|방어력|방어도", 5),
      ev: statRange(text, "\\bEV\\b|회피력|회피도", 5),
      sh: statRange(text, "\\bSH\\b|방패", 5),
    };
  }
  const rollCache = new Map();
  function diceRolls(n, size) {
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(size) || n < 0 || size < 0 || n > 128 || n * size > 4096) return null;
    if (!n || !size) return [[0, 1]];
    const key = `${n}d${size}`;
    if (rollCache.has(key)) return rollCache.get(key);
    let probabilities = [1];
    for (let die = 0; die < n; die++) {
      const next = new Array(probabilities.length + size).fill(0);
      let sum = 0;
      for (let value = 1; value < next.length; value++) {
        sum += probabilities[value - 1] || 0;
        sum -= probabilities[value - size - 1] || 0;
        next[value] = Math.max(0, sum / size);
      }
      probabilities = next;
    }
    const rolls = probabilities.flatMap((p, value) => value >= n && p > 0 ? [[value, p]] : []);
    if (rollCache.size >= 128) rollCache.clear();
    rollCache.set(key, rolls);
    return rolls;
  }
  function combineRolls(a, b, factor) {
    if (!a || !b || a.length * b.length > 1000000) return null;
    const result = new Map();
    for (const [x, px] of a)
      for (const [y, py] of b) {
        const value = x + y * factor;
        if (Math.abs(value) > 4096) return null;
        result.set(value, (result.get(value) || 0) + px * py);
      }
    return [...result];
  }
  const clean = (n) => Math.round(n * 1e10) / 1e10;
  const mean = (rolls) => clean(rolls.reduce((sum, [value, p]) => sum + value * p, 0));
  // The server's dice expressions already include skills, stats, equipment and god effects.
  function damage(expression) {
    if (typeof expression !== "string") return null;
    let source = expression.trim().replace(/−/g, "-");
    const unit = source.match(/\/(turn|arc|foxfire|upheaval)\b/i)?.[1]?.toLowerCase() || null;
    const conditional = /\*\s*$|\b(?:against|per|turn|arc|foxfire|upheaval)\b|현재|대상/i.test(source);
    source = source
      .replace(/\([^)]*(?:against|현재|대상)[^)]*\)/gi, "")
      .replace(/\s*\(max [^)]*\)\s*$/i, "")
      .replace(/\*\s*$/, "")
      .replace(/\/(?:turn|arc|foxfire|upheaval)\b/gi, "")
      .trim();
    const multiple = source.match(/^(\d+)\s*[x×]\s*/i),
      hits = multiple ? +multiple[1] : 1;
    if (!Number.isSafeInteger(hits) || hits < 1 || hits > 128) return null;
    if (multiple) source = source.slice(multiple[0].length).trim();
    const tokens = [];
    source = source.replace(
      /(\d+|\(\d+-\d+\))d(\d+|\(\d+-\d+\))/gi,
      (_, n, s) => {
        const range = (v) =>
          v.startsWith("(") ? v.slice(1, -1).split("-").map(Number) : [+v, +v];
        const nr = range(n),
          sr = range(s),
          result = nr[0] <= nr[1] && sr[0] <= sr[1]
            ? [diceRolls(nr[0], sr[0]), diceRolls(nr[1], sr[1])]
            : [null, null];
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
    let total = [[[0, 1]], [[0, 1]]];
    for (const term of source.matchAll(
      /([+-]?)\s*(@\d+|\d+(?:\.\d+)?)(?:\s*([*/])\s*(\d+(?:\.\d+)?))?/g,
    )) {
      let value =
        term[2][0] === "@" ? tokens[+term[2].slice(1)] : [[[+term[2], 1]], [[+term[2], 1]]];
      const factor =
        (term[1] === "-" ? -1 : 1) *
        (term[3] === "/" ? 1 / +term[4] : term[3] === "*" ? +term[4] : 1);
      if (!Number.isFinite(factor)) return null;
      if (factor < 0) value = [value[1], value[0]];
      total = total.map((rolls, i) => combineRolls(rolls, value[i], factor));
      if (total.some((rolls) => !rolls)) return null;
    }
    total = total.map((rolls) => rolls.map(([v, p]) => [Math.max(0, v), p]));
    return {
      low: mean(total[0]) * hits,
      high: mean(total[1]) * hits,
      conditional,
      expression,
      hits,
      unit,
      rolls: total,
      approximate: total.some((rolls) => rolls.some(([v]) => !Number.isInteger(v))),
    };
  }
  const elementKeys = {
    FIRE: "fire", LAVA: "fire", COLD: "cold", ICE: "cold",
    ELECTRICITY: "electricity", THUNDER: "electricity", STUN_BOLT: "electricity",
    NEG: "negative", PAIN: "negative", MALIGN_OFFERING: "negative", VAMPIRIC_DRAINING: "negative",
    ACID: "acid", POISON: "poison", POISON_ARROW: "poison", MERCURY: "poison",
  };
  function resistDamage(raw, flavour, resistance) {
    if (!Number.isFinite(raw) || raw < 0) return null;
    if (!Number.isFinite(resistance) || resistance === 0) return raw;
    const fraction = ["ICE", "THUNDER", "LAVA", "WATER"].includes(flavour) ? 50
      : ["POISON_ARROW", "MERCURY"].includes(flavour) ? 70 : 100;
    let resistible = Math.floor(raw * fraction / 100);
    const irresistible = raw - resistible;
    if (resistance >= 3) resistible = 0;
    else if (resistance > 0) {
      const bonus = ["ELECTRICITY", "THUNDER", "STUN_BOLT", "POISON", "POISON_ARROW", "MERCURY", "WATER"].includes(flavour) ? 1 : 0;
      resistible = Math.floor(resistible / (1 + bonus + resistance * resistance));
    } else resistible = Math.floor(resistible * 15 / 10);
    return Math.max(0, irresistible + resistible);
  }
  function acRolls(ac, rule) {
    if (rule === "none") return [[0, 1]];
    if (!Number.isSafeInteger(ac) || ac < 0 || ac > 1000) return null;
    if (rule === "triple") return diceRolls(3, ac + 1)?.map(([v, p]) => [v - 3, p]);
    if (rule !== "normal" && rule !== "half") return null;
    return Array.from({ length: ac + 1 }, (_, i) => [rule === "half" ? Math.floor(i / 2) : i, 1 / (ac + 1)]);
  }
  function meanAfterDefences(rolls, ac, rule, flavour, resistance) {
    const saved = acRolls(ac, rule);
    if (!saved || !rolls || saved.length * rolls.length > 1000000) return null;
    let total = 0;
    for (const [raw, probability] of rolls)
      for (const [reduction, chance] of saved)
        total += probability * chance * resistDamage(Math.max(0, raw - reduction), flavour, resistance);
    return total;
  }
  function beamHitChance(accuracy, ev) {
    if (!Number.isSafeInteger(accuracy) || !Number.isSafeInteger(ev) || accuracy < 0 || ev < 0 || accuracy > 1000 || ev > 1000) return null;
    if (!ev) return 1;
    // _test_beam_hit: random2(EV) 이후 random2avg(k, 2)는 [0,k-1]과 [0,k]를 사용합니다.
    const triangle = (n) => n > 0 ? n * (n + 1) / 2 : 0;
    const count = Math.max(1, accuracy);
    let total = 0;
    for (let k = 0; k < ev; k++) {
      if (!k) { total++; continue; }
      let hits = 0;
      for (let attack = 0; attack < count; attack++) {
        const t = attack * 2 + 2;
        hits += triangle(t) - triangle(t - k) - triangle(t - k - 1) + triangle(t - 2 * k - 1);
      }
      total += hits / (count * k * (k + 1));
    }
    return Math.max(0, Math.min(1, total / ev));
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
  function chance(state, item, monster, kind, precise = false) {
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
      hexChance(will[1], ench(power[0]), !precise),
      hexChance(Math.max(0, will[0] - bypass), ench(power[1]), !precise),
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
        willChance: chance(state, item, monster, kind, true),
        damage: damage(item.damage || raw.damage),
        rating: raw.rating ?? null,
      };
    const failure = Number(item.fail ?? 100),
      factor = kind === "spell" || kind === "ability"
        ? Number.isFinite(failure) ? Math.max(0, Math.min(1, 1 - failure / 100)) : 0
        : 1;
    if (result.willChance?.[1] === 0)
      return {
        ...result,
        excluded: true,
        score: 0,
        reason: "의지 면역 또는 돌파 불가능",
      };
    const models = def?.components || [def?.defence || { flavour: def?.flavour }],
      partial = (flavour) => ["ICE", "THUNDER", "LAVA", "WATER", "POISON_ARROW", "MERCURY"].includes(flavour);
    if (models.every((m) => elementKeys[m.flavour] && monster.resists?.[elementKeys[m.flavour]] >= 3 && !partial(m.flavour)))
      return { ...result, excluded: true, totalDamage: 0, score: 0, reason: "속성 면역" };
    const details = [], limits = new Set();
    for (const model of models) {
      const key = elementKeys[model.flavour], resistance = key ? monster.resists?.[key] : undefined;
      if (!key) continue;
      if (!Number.isFinite(resistance)) limits.add(`${key} 저항 미확인`);
      else details.push(`${key} 저항 ${resistance} 반영${resistance < 0 ? " (약점)" : ""}`);
    }
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
    let damageRange = null, hitChance = null, hitsKnown = true;
    if (result.damage) {
      const ac = inputRange(monster.ac), ev = inputRange(monster.ev);
      let appliedAc = false;
      const separate = def?.components && result.damage.hits === models.length;
      if (def?.components && !separate) limits.add("복합 타격 횟수 미확인");
      else {
        damageRange = [0, 0];
        for (const model of models) {
          const key = elementKeys[model.flavour], resistance = key ? monster.resists?.[key] : undefined;
          let rule = model.ac || "none";
          if (!model.ac) limits.add("AC 규칙 미확인");
          if (rule !== "none" && !ac) {
            rule = "none";
            limits.add("AC 미확인·제외");
          }
          if (rule !== "none" && !["normal", "half", "triple"].includes(rule)) {
            rule = "none";
            limits.add("특수 AC 규칙 미반영");
          }
          if (rule !== "none") appliedAc = true;
          const accuracy = model.accuracy && result.power
            ? result.power.map((p) => Math.max(0, Math.floor(model.accuracy[0] + p * model.accuracy[1] / model.accuracy[2])))
            : null;
          let hit = [1, 1], knownHit = model.automatic === true;
          if (model.automatic === true) details.push("EV 판정 없음");
          else if (model.automatic === false && ev?.[1] === 0) knownHit = true;
          else if (model.automatic === false && accuracy && ev) {
            const probabilities = [beamHitChance(accuracy[0], ev[1]), beamHitChance(accuracy[1], ev[0])];
            if (probabilities.every((v) => v != null)) {
              hit = probabilities;
              knownHit = true;
              limits.add("명중 특수 상태 제외");
            } else limits.add("EV 계산 범위 초과·제외");
          } else limits.add("EV·명중 미확인·제외");
          if (!knownHit) hitsKnown = false;
          hitChance = hitChance
            ? [Math.min(hitChance[0], hit[0] * 100), Math.max(hitChance[1], hit[1] * 100)]
            : hit.map((p) => p * 100);
          if (model.shield !== false) limits.add("SH 미반영");
          const count = separate ? 1 : result.damage.hits;
          for (let i = 0; i < 2; i++) {
            const value = meanAfterDefences(result.damage.rolls[i], ac?.[1 - i] ?? 0, rule, model.flavour, resistance);
            if (value == null) {
              damageRange = null;
              limits.add("피해 계산 범위 초과");
              break;
            }
            damageRange[i] += value * hit[i] * count;
          }
          if (!damageRange) break;
        }
        if (appliedAc) details.push(`AC ${formatRange(ac)} 반영 (타격별)`);
        if (!hitsKnown) hitChance = null;
        if (hitChance) details.push(`기본 명중 ${formatRange(hitChance)}%`);
      }
      if (result.damage.hits > 1) details.push(`${result.damage.hits}회 타격 합산 (동일 대상에 도달할 때)`);
      if (result.damage.unit) limits.add(`/${result.damage.unit} 단위·총 횟수 미확인`);
      if (result.damage.conditional) limits.add("조건부 효과");
      if (result.damage.approximate) limits.add("분수식 근사");
    } else if (Number.isFinite(result.rating)) {
      damageRange = [Math.max(0, result.rating / 2), Math.max(0, result.rating / 2)];
      details.push(`공격력 환산 지표 ${(result.rating / 2).toFixed(1)} (피해 예측 아님)`);
      limits.add("공격력 기반 근사·AC·EV·SH 제외");
    }
    if (def?.flags.includes("WL_check") && !result.willChance) damageRange = null;
    if (damageRange) damageRange = damageRange.map((value, i) => clean(value * factor * (result.willChance?.[i] ?? 100) / 100));
    const unitDamageRange = result.damage?.unit ? damageRange : null;
    if (unitDamageRange) damageRange = null;
    const totalDamage = damageRange?.[0] ?? null;
    let score = totalDamage == null
      ? result.willChance ? 65 * result.willChance[0] / 100 * factor : null
      : Math.min(90, 20 + totalDamage * 2);
    if (unitDamageRange) details.push(`예상 직접 피해 지표 ≈${formatRange(unitDamageRange)} / ${result.damage.unit} (1회 총 피해 미확인)`);
    if (damageRange) details.push(`${result.damage ? "예상 직접 피해 지표" : "공격력 비교 지표"} ≈${formatRange(damageRange)} / 1회`);
    if (limits.size) details.push([...limits].join(", "));
    if (def?.flags.includes("WL_check") && !result.willChance) score = 0;
    return { ...result, score, totalDamage, damageRange, unitDamageRange, hitChance, reason: details.join(" · ") };
  }
  function inputRange(value) {
    const range = Number.isFinite(value) ? [value, value] : value;
    return Array.isArray(range) && range.length === 2 && range.every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 1000) && range[0] <= range[1] ? range : null;
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
    defences,
    damage,
    resistDamage,
    beamHitChance,
    description,
    mutationProfile,
    wandPower,
    chance,
    evaluate,
    formatRange,
    faith,
  };
});
