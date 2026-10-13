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
    if (/poison|venom|sting|독\)|독성|독의|독 다트/i.test(name))
      return "poison";
    if (/lightning|shock|electric|번개|전격/i.test(name)) return "electricity";
    if (/acid|산성/i.test(name)) return "acid";
    if (/negative|draining|흡수|음에너지/i.test(name)) return "negative";
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
    const candidates = [];
    function add(kind, item, role, score, why, totalDamage = null) {
      candidates.push({
        kind,
        id: item.id,
        slot: item.slot,
        name: item.name,
        icon: item.icon,
        role,
        score,
        totalDamage,
        reason: why,
      });
    }
    function attackCandidate(kind, item, score, why) {
      const calculation = Combat.evaluate(state, item, monster, kind);
      if (calculation.excluded) return;
      if (calculation.score != null) score = calculation.score;
      else score = Math.min(score, 10);
      why += ` · ${calculation.reason || "위력 미조회"}`;
      const type = element(item.name),
        resistance = type ? res[type] : undefined;
      if (
        resistance >= 3 &&
        ![
          "ICE",
          "THUNDER",
          "LAVA",
          "WATER",
          "POISON_ARROW",
          "MERCURY",
        ].includes(Combat.definition(item)?.flavour)
      )
        return;
      if (resistance > 0) {
        score -= 25;
        why += " · 해당 속성 저항 있음";
      } else if (resistance < 0) {
        score += 20;
        why += " · 해당 속성 약점";
      } else if (type && resistance === undefined) why += " · 속성 저항 미확인";
      add(kind, item, "대응", score, why, calculation.totalDamage);
    }
    for (const item of state.items || []) {
      if (!item.action || item.useless) continue;
      const name = item.name;
      if (item.category === "potion") {
        if (hp < 0.8 && /heal wounds|상처 (?:치료|치유)/i.test(name))
          add("item", item, "회복", hp <= 0.35 ? 110 : 65, "현재 HP가 감소함");
        else if (
          (hp < 0.65 || /poison|중독/i.test(status)) &&
          /curing|치료의 물약|회복의 물약/i.test(name)
        )
          add("item", item, "치료", 85, "HP 감소 또는 중독 상태");
        else if (risk >= 2 && /haste|가속/i.test(name))
          add("item", item, "가속", 75, "위험한 적 대응·이탈 준비");
      } else if (item.category === "scroll") {
        if (risk >= 2 && /blinking|점멸/i.test(name))
          add("item", item, "이탈", 105, "점멸 위치는 직접 선택");
        else if (risk >= 2 && /teleportation|순간이동/i.test(name))
          add("item", item, "이탈", 90, "순간이동은 지연 후 발동");
      } else if (item.category === "missile") {
        const throwing = state.skills?.throwing;
        attackCandidate(
          "item",
          item,
          45 + Math.min(15, (throwing || 0) * 2),
          `투척 후보${throwing != null ? ` · 조회한 투척 기술 ${throwing}` : ""}`,
        );
      } else if (item.category === "evoke" && item.charges !== 0) {
        if (
          Combat.definition(item)?.flags.includes("obj") ||
          item.sourceId === "SPELL_DIG"
        )
          continue;
        const evo = state.skills?.evocations;
        attackCandidate(
          "item",
          item,
          50 + Math.min(15, (evo || 0) * 2),
          `발동 후보${evo != null ? ` · 조회한 발동 기술 ${evo}` : ""}`,
        );
      }
    }
    for (const spell of state.spells || []) {
      // A low failure rate does not make item retrieval an attack option.
      if (/^(?:Apportation|수집|마법의 수집)$/i.test(spell.name.trim()))
        continue;
      const def = Combat.definition(spell);
      if (def?.flags.includes("helpful") || def?.flags.includes("obj"))
        continue;
      const failure = Number(spell.fail);
      if (
        spell.fail == null ||
        failure > 35 ||
        spell.level == null ||
        spell.level > (p.mp || 0)
      )
        continue;
      if (/blink|swiftness|점멸|신속/i.test(spell.name)) {
        if (risk >= 2)
          add(
            "spell",
            spell,
            "이탈",
            80 - failure,
            "기본 MP 충족 · 실패율은 마지막 마법 목록 기준",
          );
      } else
        attackCandidate(
          "spell",
          spell,
          70 - failure,
          `시전 후보 · 기본 MP ${spell.level} · 마지막 실패율 ${failure}%`,
        );
    }
    for (const ability of state.abilities || []) {
      if (
        ability.colour === 8 ||
        ability.fail == null ||
        Number(ability.fail) > 35
      )
        continue;
      const cost = ability.text?.match(/(\d+)\s*MP/i);
      if (cost && Number(cost[1]) > (p.mp || 0)) continue;
      if (ability.combat?.damage) {
        attackCandidate(
          "ability",
          ability,
          60 - Number(ability.fail),
          "공격 능력 · 서버 계산 피해량 기준",
        );
      } else if (
        /breathe|breath|smite|destruction|heroism|finesse|숨결|징벌|파괴|영웅|기교/i.test(
          ability.name,
        )
      )
        add(
          "ability",
          ability,
          "능력",
          60 - Number(ability.fail),
          "마지막 능력 목록 기준 · 신앙·자원 비용은 게임 메뉴에서 확인",
        );
    }
    candidates.sort(
      (a, b) =>
        (b.totalDamage ?? -1) - (a.totalDamage ?? -1) || b.score - a.score,
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
