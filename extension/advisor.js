/* Conservative, inspectable rules. Never a win probability or hidden-state lookup. */
(function (root, factory) {
  const combat =
    typeof module === "object" && module.exports
      ? require("./combat.js")
      : root.WebJukCombat;
  const api = factory(combat);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WebJukAdvisor = api;
})(globalThis, function (Combat) {
  "use strict";
  const labels = ["낮음", "보통", "위험", "매우 위험"];
  // Original mons_get_damage_level thresholds. No exact HP is transmitted.
  function healthBand(fg) {
    const flags = [
      "MDAM_ADEAD",
      "MDAM_SEV",
      "MDAM_HEAVY",
      "MDAM_MOD",
      "MDAM_LIGHT",
    ];
    if (!fg || !flags.every((key) => typeof fg[key] === "boolean")) return null;
    const index = flags.findIndex((key) => fg[key]);
    return index < 0 ? [100, 100] : [index * 20, (index + 1) * 20];
  }
  function healthSummary(monster) {
    const bands = monster.healthBands || [];
    const known =
      bands.length > 0 &&
      bands.length === monster.count &&
      bands.every(
        (band) =>
          Array.isArray(band) &&
          band.length === 2 &&
          band.every(Number.isFinite),
      );
    const low = known ? Math.min(...bands.map((band) => band[0])) : null;
    const high = known ? Math.max(...bands.map((band) => band[1])) : null;
    const percent =
      low == null ? "?" : low === 100 ? "100%" : `${low}–${high}%`;
    const avg =
      Number.isFinite(monster.avgHp) && monster.avgHp > 0
        ? monster.avgHp
        : null;
    const detail = known
      ? bands
          .map(
            ([low, high], i) =>
              `${bands.length > 1 ? `${i + 1}번: ` : ""}${low === 100 ? "부상 없음 (100%)" : `남은 체력 ${low}% 초과·${high}% ${high === 100 ? "미만" : "이하"}`}`,
          )
          .join("\n")
      : "남은 체력 정보 미확인";
    return {
      percent,
      avg,
      title: `${detail}\n${avg == null ? "종별 평균 HP 미확인" : `종별 평균 HP ${avg} (실제 최대 HP 아님)`}\n정확한 현재 HP는 서버에서 제공하지 않습니다.${bands.length > 1 ? "\n범위는 그룹 내 개별 몬스터의 부상 단계를 포괄하며 합산 HP가 아닙니다." : ""}`,
    };
  }
  function skillLevels(lines) {
    const aliases = {
      throwing: "Throwing|투척술|투척",
      evocations: "Evocations|발동술|발동",
      invocations: "Invocations|기도술|기도",
      fighting: "Fighting|전투 기술|전투",
      armour: "Armour|갑옷술|갑옷",
      dodging: "Dodging|회피술|회피",
      shields: "Shields|방패술|방패",
      spellcasting: "Spellcasting|주문 시전술|주문 시전",
      conjurations: "Conjurations|파괴술",
    };
    const result = {};
    for (const [key, names] of Object.entries(aliases)) {
      for (const line of lines) {
        const match = line.match(
          new RegExp(`(?:${names})\\s+(?:[+*\\-]\\s*)?(\\d+(?:\\.\\d+)?)`, "i"),
        );
        if (match) result[key] = Number(match[1]);
      }
    }
    return result;
  }
  function resistances(text) {
    const result = {},
      keys = {
        rF: "fire",
        rC: "cold",
        rPois: "poison",
        rNeg: "negative",
        rElec: "electricity",
        rCorr: "acid",
      };
    const lines = String(text || "").split("\n");
    const value = (raw) =>
      /∞|inf/.test(raw)
        ? 3
        : raw.includes("x")
          ? -1
          : (raw.match(/\+/g) || []).length;
    for (let i = 0; i < lines.length; i++) {
      const matches = [
        ...lines[i].matchAll(/\br(?:Pois|Elec|Corr|Neg|F|C)\b/g),
      ];
      for (let j = 0; j < matches.length; j++) {
        const match = matches[j],
          end = matches[j + 1]?.index ?? lines[i].length;
        const inline = lines[i]
          .slice(match.index + match[0].length, end)
          .trim();
        if (/^[ :]*[+.x∞]|^inf/.test(inline))
          result[keys[match[0]]] = value(inline);
        else if (lines[i + 1]) {
          const below = lines[i + 1]
            .slice(match.index, matches[j + 1]?.index)
            .trim();
          if (/^[+.x∞]|^inf/.test(below)) result[keys[match[0]]] = value(below);
        }
      }
    }
    return result;
  }
  function element(name) {
    if (
      /fireball|flame|fire bolt|bolt of fire|scorch|불꽃|화염|불덩이|화구|작열/i.test(
        name,
      )
    )
      return "fire";
    if (
      /freeze|frozen|freezing|iceblast|bolt of cold|throw frost|얼음|냉기|동결|얼어붙/i.test(
        name,
      )
    )
      return "cold";
    if (/poison|venom|sting|curare|쿠라레|독\)|독성|독의|독\s*다트|독침/i.test(name))
      return "poison";
    if (/lightning|shock|electric|번개|전격/i.test(name)) return "electricity";
    if (/acid|산성/i.test(name)) return "acid";
    if (/negative|draining|흡수|음에너지/i.test(name)) return "negative";
    return null;
  }
  function failureRate(value) {
    if (value == null || String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 35 ? n : null;
  }
  function currentRange(value) {
    const text = String(value ?? "").trim().replace(/[–−]/g, "-"),
      match = text.match(/^(\d+)(?:\s*([/-])\s*(\d+))?$/);
    if (!match) return null;
    const min = match[2] === "-" ? +match[1] : 0,
      max = match[2] === "-" ? +match[3] : +match[1];
    // current/max 표기에서 분모는 잠재적 사거리이며 현재 도달 거리가 아닙니다.
    return max > 0 && min <= max ? { min, max, text } : null;
  }
  function reach(item, monster) {
    const range = currentRange(item.range ?? item.combat?.range),
      distances = Array.isArray(monster.distances) && monster.distances.length
        ? monster.distances : [monster.distance];
    if (!range) return { known: false, reason: "사거리 미확인" };
    if (!distances.every((d) => Number.isFinite(d) && d >= 0))
      return { known: false, reason: `사거리 ${range.text} · 대상 거리 미확인` };
    const count = distances.filter((d) => d >= range.min && d <= range.max).length;
    return {
      excluded: count === 0,
      known: true,
      reason: `현재 사거리 ${range.text} 충족${distances.length > 1 ? ` · 그룹 ${count}/${distances.length}마리` : ""}`,
    };
  }
  function costs(item) {
    const text = String(item.cost ?? item.text ?? ""), result = {};
    for (const [key, names] of Object.entries({ mp: "MP|마력", hp: "HP|체력", gold: "Gold|gold|G|금화|골드" })) {
      const values = [...text.matchAll(new RegExp(`(\\d+)\\s*(?:${names})(?![A-Za-z])|(?:${names})\\s*[:：]?\\s*(\\d+)`, "gi"))]
        .map((m) => +(m[1] ?? m[2]));
      if (values.length) result[key] = Math.max(...values);
    }
    return result;
  }
  function resources(state, item, kind) {
    const cost = kind === "spell" ? { mp: item.level } : costs(item), p = state.stats || {};
    if (cost.mp != null && (!Number.isFinite(p.mp) || cost.mp > p.mp)) return null;
    if (cost.hp != null && (!Number.isFinite(p.hp) || cost.hp >= p.hp)) return null;
    if (cost.gold != null && (!Number.isFinite(state.gold) || cost.gold > state.gold)) return null;
    return cost;
  }
  function statusProfile(status) {
    return {
      blocked: /\b(?:paralys(?:ed|is)?|petrified|berserk)\b|마비|완전히\s*석화|광폭화(?!\s*불가)/i.test(status),
      confused: /\b(?:conf|confused|confusion)\b|혼란/i.test(status),
      silenced: /\b(?:sil|silence|silenced)\b|침묵/i.test(status),
      noCasting: /\b(?:nocast|no\s+cast|no\s+spells)\b|마법\s*(?:사용|시전)\s*불가/i.test(status),
    };
  }
  function canonicalName(item) {
    return Combat.definition(item)?.name || item.combat?.sourceName || item.name || "";
  }
  function poisonDart(item) {
    const name = `${item.name || ""} ${item.combat?.sourceName || ""}`;
    return item.category === "missile" &&
      /darts?|다트|바늘|독침/i.test(name) && /poison|venom|curare|쿠라레|독/i.test(name);
  }
  function combatRole(item, kind) {
    const def = Combat.definition(item), flags = def?.flags || [], name = canonicalName(item),
      damage = item.damage || item.combat?.damage,
      damaging = typeof damage === "string" && damage.trim() && !/^(?:N\/A|—|0)$/i.test(damage.trim());
    if (/^(?:Renounce Religion|신앙\s*포기)$/i.test(name.trim())) return null;
    if (flags.includes("obj") || def?.flavour === "DIGGING") return null;
    if (flags.includes("escape") || /^(?:Blink|Swiftness|Passwall|Passage of Golubria|점멸|신속|벽 통과)$/i.test(name)) return "이탈";
    if (/^(?:Draw Escape|탈출 카드 뽑기)$/i.test(name)) return "이탈";
    if (/heroism|finesse|berserk|trog.s hand|영웅|기교|광폭화|트로그의 손/i.test(name)) return "강화";
    if (kind === "ability" && /^(?:Purification|Heal Wounds|정화|상처 치유)$/i.test(name)) return "치료";
    if (/^(?:Summon\b|Call Canine Familiar|Animate Dead|소환|얼음 짐승 소환)/i.test(name) || /phantom mirror|유령.*거울/i.test(name)) return "소환";
    if (kind === "spell" && (flags.includes("helpful") || flags.includes("selfench"))) return null;
    if (item.category === "missile" && /throwing net|투척\s*그물/i.test(name)) return "제어";
    if (item.category === "missile" && /darts?|다트|바늘|독침/i.test(name)) return "제어";
    if (flags.includes("WL_check") && !damaging) return "제어";
    if (def?.flavour === "MEPHITIC") return "제어";
    if (damaging || item.combat?.rating > 0 || def?.defence || def?.components || flags.includes("destructive") || flags.includes("direct_damage_only")) return "공격";
    if (kind === "item" && ["missile", "evoke"].includes(item.category)) return "공격";
    if (def?.flavour && !["VISUAL", "HEALING"].includes(def.flavour)) return "공격";
    if (kind === "ability" && /breathe|breath|smite|destruction|숨결|징벌|파괴/i.test(name)) return "공격";
    return null;
  }
  function advise(state, monster) {
    const p = state.stats || {},
      hp = p.hpMax > 0 ? p.hp / p.hpMax : 1;
    const hostile = monster.att === 0;
    const reasons = [
      `원본 위협: ${labels[monster.threat] || "미확인"}`,
      `HP ${p.hp ?? "?"} / ${p.hpMax ?? "?"}, MP ${p.mp ?? "?"} / ${p.mpMax ?? "?"}`,
      `AC ${p.ac ?? "?"} EV ${p.ev ?? "?"} SH ${p.sh ?? "?"}, XL ${p.xl ?? "?"}`,
    ];
    if (!hostile)
      return {
        risk: -1,
        label: monster.att === 4 ? "우호" : "중립",
        reasons: ["공격 대상에서 제외"],
        candidates: [],
      };
    let risk =
      Number.isInteger(monster.threat) &&
      monster.threat >= 0 &&
      monster.threat < 4
        ? monster.threat
        : 2;
    if (hp <= 0.35) {
      risk = Math.min(3, risk + 1);
      reasons.push("현재 HP 35% 이하");
    }
    if (hp <= 0.15) {
      risk = 3;
      reasons.push("현재 HP 15% 이하");
    }
    const foes = (state.monsters || [])
      .filter((m) => m.att === 0)
      .reduce((n, m) => n + (m.count || 1), 0);
    if (foes >= 3) {
      risk = Math.min(3, risk + 1);
      reasons.push(`시야 내 적 ${foes}마리: 다수 보정`);
    }
    const status = (p.status || [])
      .map((s) => `${s.text || ""} ${s.light || ""}`)
      .join(" ");
    const conditions = statusProfile(status);
    if (conditions.confused) reasons.push("혼란: 마법·두루마리·표적 투척·발동 수단 제외");
    if (conditions.silenced) reasons.push("침묵: 마법·두루마리 제외");
    if (/paralys|confus|petrif|held|마비|혼란|석화|구속/i.test(status)) {
      risk = 3;
      reasons.push("행동을 제한하는 상태 이상");
    }
    if (
      /poison|중독/i.test(status) &&
      p.poisonSurvival != null &&
      p.poisonSurvival <= 0
    ) {
      risk = 3;
      reasons.push("현재 중독으로 치명적 피해 예상");
    }
    if (monster.distance != null) reasons.push(`거리 ${monster.distance}칸`);
    if (monster.avgHp)
      reasons.push(`종별 평균 HP ${monster.avgHp} (현재 HP 아님)`);
    const res = monster.resists || {};
    reasons.push(
      Object.keys(res).length
        ? "저항: 마지막으로 연 몬스터 설명 기준"
        : "저항 미확인: 후보의 효과 보장 없음",
    );
    if (!state.skillsLoaded)
      reasons.push("기술 수치 미조회: ⚙에서 기술 정보 갱신");
    else
      reasons.push(
        `조회한 기술: 투척 ${state.skills?.throwing ?? "?"} / 발동 ${state.skills?.evocations ?? "?"} / 기도 ${state.skills?.invocations ?? "?"}`,
      );
    if (conditions.blocked)
      return { risk, label: labels[risk], reasons: [...reasons, "현재 상태로 대응 수단을 실행할 수 없음"], candidates: [] };
    const candidates = [];
    function add(kind, item, role, score, why, totalDamage = null, known = true) {
      candidates.push({
        kind,
        id: item.id,
        slot: item.slot,
        name: item.name,
        icon: item.icon,
        role,
        score,
        totalDamage,
        known,
        mpCost: kind === "spell" ? item.level : costs(item).mp ?? 0,
        reason: why,
      });
    }
    function attackCandidate(kind, item, role, score, why) {
      // 독다트는 물리 공격력으로 독 저항을 우회하지 않습니다. 저항이 없다고
      // 확인한 대상에만 추천하며, 저항 중에도 간헐적으로 통하는 독은 제외합니다.
      if (poisonDart(item) && (!Number.isFinite(res.poison) || res.poison > 0)) return;
      const distance = reach(item, monster);
      if (distance.excluded) return;
      const calculation = role === "제어" && item.category === "missile"
        ? { reason: "투척물 부가 효과 · 직접 피해로 환산하지 않음" }
        : Combat.evaluate(state, item, monster, kind);
      if (calculation.excluded) return;
      if (role === "공격" && calculation.damageRange?.[1] === 0) return;
      if (calculation.score != null) score = calculation.score;
      else score = Math.min(score, 10);
      why += ` · ${distance.reason} · ${calculation.reason || "위력 미조회"}`;
      const definition = Combat.definition(item),
        type = definition ? null : element(canonicalName(item)),
        resistance = type ? res[type] : undefined;
      // 원본 정의가 있는 공격의 저항·부분 면역은 Combat에서 타격별로 판정합니다.
      const physical = role === "공격" && item.category === "missile" && item.combat?.rating > 0;
      if (resistance >= 3 && !physical) return;
      if (resistance > 0) {
        score -= 25;
        why += " · 해당 속성 저항 있음";
      } else if (resistance < 0) {
        score += 20;
        why += " · 해당 속성 약점";
      } else if (type && resistance === undefined) why += " · 속성 저항 미확인";
      if (physical && resistance > 0) why += " · 물리 피해는 유지, 속성 부가 효과는 제한";
      if (role === "제어" && !calculation.willChance) {
        score = Math.min(score, 10);
        why += " · 제어 성공률·대상 조건 미확인";
      }
      const polymorph = /polymorph|변신/i.test(canonicalName(item));
      if (polymorph) {
        why += " · 변신이 대상의 약화를 보장하지 않음";
        score = Math.min(score, 10);
      }
      const stateUnknown = kind === "ability" && (conditions.confused || item.invocation && conditions.silenced);
      if (stateUnknown) score = Math.min(score, 10);
      const known = !polymorph && !stateUnknown && distance.known && (calculation.totalDamage != null || !!calculation.willChance);
      add(kind, item, role, score, why, role === "공격" && !stateUnknown ? calculation.totalDamage : null, known);
    }
    for (const item of state.items || []) {
      if (!item.action || item.useless || Number.isFinite(item.quantity) && item.quantity <= 0) continue;
      const role = combatRole(item, "item");
      if (!["공격", "제어"].includes(role)) continue;
      if (item.category === "missile") {
        if (conditions.confused) continue;
        const throwing = state.skills?.throwing;
        attackCandidate(
          "item",
          item,
          role,
          45 + Math.min(15, (throwing || 0) * 2),
          `투척 후보${throwing != null ? ` · 조회한 투척 기술 ${throwing}` : ""}`,
        );
      } else if (item.category === "evoke") {
        if (conditions.confused || Number.isFinite(item.charges) && item.charges <= 0) continue;
        const evo = state.skills?.evocations;
        attackCandidate(
          "item",
          item,
          role,
          50 + Math.min(15, (evo || 0) * 2),
          `발동 후보${evo != null ? ` · 조회한 발동 기술 ${evo}` : ""}`,
        );
      }
    }
    for (const spell of state.spells || []) {
      const failure = failureRate(spell.fail), role = combatRole(spell, "spell");
      if (
        !["공격", "제어"].includes(role) || failure == null || spell.colour === 8 ||
        !Number.isInteger(spell.level) || spell.level < 1 ||
        !resources(state, spell, "spell") ||
        conditions.confused || conditions.silenced || conditions.noCasting
      )
        continue;
      attackCandidate(
        "spell",
        spell,
        role,
        70 - failure,
        `시전 후보 · 기본 MP ${spell.level} · 마지막 실패율 ${failure}%`,
      );
    }
    for (const ability of state.abilities || []) {
      const failure = failureRate(ability.fail), role = combatRole(ability, "ability");
      if (
        ability.colour === 8 || failure == null || !["공격", "제어"].includes(role) ||
        !resources(state, ability, "ability")
      )
        continue;
      let why = "기본 자원 충족 · 마지막 능력 목록 기준 · 신앙·기타 비용은 원본 메뉴에서 확인";
      if (conditions.confused || ability.invocation && conditions.silenced)
        why += " · 현재 상태에서 능력 사용 가능 여부 미확인";
      attackCandidate(
        "ability",
        ability,
        role,
        60 - failure,
        why,
      );
    }
    candidates.sort(
      (a, b) =>
        (b.totalDamage ?? -1) - (a.totalDamage ?? -1) ||
        Number(b.known) - Number(a.known) ||
        (a.totalDamage != null && b.totalDamage != null
          ? a.mpCost - b.mpCost : 0) ||
        b.score - a.score,
    );
    return {
      risk,
      label: labels[risk],
      reasons,
      candidates,
    };
  }
  return {
    advise,
    skillLevels,
    resistances,
    element,
    healthBand,
    healthSummary,
  };
});
