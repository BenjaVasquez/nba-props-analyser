// Motor de parlays (modelo v2).
//
// Para cada jugador disponible y cada prop calcula la probabilidad de llegar a cada
// línea alternativa "X+" (15+, 20+, 25+ puntos…). La probabilidad mezcla:
//   85% proyección: minutos esperados × producción por minuto en la temporada,
//       con una distribución normal según la variabilidad del jugador.
//   15% historial: % de veces que superó la línea (temporada, L10, L5, local/visita).
// Elegido con pruebas sobre partidos ya jugados (nov-2026): en días que el modelo no
// vio, este v2 acertó más y quedó mejor calibrado que contar frecuencias solamente.
// Defensa del rival, back-to-back y diferencia de nivel se probaron y no mejoraron.
import { STATS } from "./propchart.js";
import { injuryFor } from "./players.js";

export const MILESTONES = {
  pts: [10, 15, 20, 25, 30, 35, 40],
  reb: [4, 6, 8, 10, 12, 14],
  ast: [2, 4, 6, 8, 10, 12],
  tpm: [1, 2, 3, 4, 5, 6],
  pra: [15, 20, 25, 30, 35, 40, 45, 50],
  pts_reb: [15, 20, 25, 30, 35, 40],
  pts_ast: [15, 20, 25, 30, 35, 40],
  reb_ast: [5, 8, 10, 12, 15, 18],
};

const MIN_GP = 5;           // mínimo de partidos jugados para opinar
const MIN_MIN = 18;         // minutos promedio (últimos 5) para considerarlo de rotación
export const P_LIST = 0.70; // probabilidad mínima para la lista de "patas seguras"
export const P_AUTO = 0.76; // probabilidad mínima para los parlays automáticos
export const P_VALUE = 0.62; // "valor": línea igual o sobre su promedio con esta prob. mínima
const W_EMP = 0.15;          // peso del historial frente a la proyección
const MIN_W = [0.3, 0.3, 0.4]; // minutos esperados: últimos 5, últimos 10, temporada
const SD_FLOOR = 1.4;          // piso de variabilidad (× raíz de la proyección)

const smooth = (h, n) => (h + 1) / (n + 2);
const count = (vals, t) => vals.reduce((a, v) => a + (v >= t ? 1 : 0), 0);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Patas del partido.
 * Devuelve { legs, value }:
 *   legs  = por jugador y prop, la línea más alta con prob ≥ P_LIST (patas "seguras")
 *   value = por jugador y prop, la línea más alta en o sobre su promedio con prob ≥ P_VALUE
 */
export function buildLegs({ teams, game, injIdx, cutoffDay, isFinal }) {
  const legs = [], value = [];
  for (const abbr of [game.away, game.home]) {
    const data = teams[abbr];
    if (!data?.players) continue;
    const isHome = abbr === game.home;
    const opp = isHome ? game.away : game.home;
    for (const p of data.players) {
      const inj = injuryFor(p, injIdx);
      if (!isFinal && inj?.status === "red") continue;   // fuera: descartado
      const all = (p.games || []).filter((g) => g.min > 0 && g.date < cutoffDay); // recientes primero
      if (all.length < MIN_GP) continue;
      const mins = all.map((g) => g.min);
      const l5min = avg(mins.slice(0, 5));
      if (l5min < MIN_MIN) continue;
      const expMin = MIN_W[0] * l5min + MIN_W[1] * avg(mins.slice(0, 10)) + MIN_W[2] * avg(mins);
      const totMin = mins.reduce((a, b) => a + b, 0);
      const venueGames = all.filter((g) => g.home === isHome);
      const oppGames = all.filter((g) => g.opponent === opp);
      const actualGame = isFinal ? (p.games || []).find((g) => g.date === cutoffDay) : null;

      for (const [stat, ths] of Object.entries(MILESTONES)) {
        const get = STATS[stat].get;
        const vals = all.map(get);
        const v5 = vals.slice(0, 5), v10 = vals.slice(0, 10), vv = venueGames.map(get), vo = oppGames.map(get);
        const mean = avg(vals);
        const sd0 = Math.sqrt(vals.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, vals.length - 1));
        const proj = (vals.reduce((a, b) => a + b, 0) / totMin) * expMin;   // proyección del partido
        const sd = Math.max(sd0 * (proj / Math.max(0.5, mean)), Math.sqrt(Math.max(proj, 0.3)) * SD_FLOOR);
        let safe = null, val = null;
        for (const t of ths) {
          const hS = count(vals, t), h10 = count(v10, t), h5 = count(v5, t), hV = count(vv, t);
          const empP = 0.40 * smooth(hS, vals.length) + 0.30 * smooth(h10, v10.length)
                     + 0.15 * smooth(h5, v5.length) + 0.15 * smooth(hV, vv.length);
          const prob = W_EMP * empP + (1 - W_EMP) * Phi((proj - (t - 0.5)) / sd);
          if (prob < P_VALUE) break;               // las líneas siguientes son más altas: peor
          const leg = {
            id: `${p.id}:${stat}:${t}`, gameId: game.id, opp, player: p, team: abbr, stat, t, prob, avg: mean, proj,
            season: [hS, vals.length], l10: [h10, v10.length], l5: [h5, v5.length],
            venue: [hV, vv.length], vsOpp: vo.length ? [count(vo, t), vo.length] : null,
            isHome, doubt: inj?.status === "yellow" ? inj : null, out: inj?.status === "red" ? inj : null,
            actual: isFinal ? (actualGame && actualGame.min > 0 ? get(actualGame) : null) : undefined,
          };
          if (prob >= P_LIST) safe = leg;
          if (t >= mean) val = leg;
        }
        if (safe) legs.push(safe);
        if (val && val.prob < P_AUTO) value.push(val); // si ya es "segura", no es de valor
      }
    }
  }
  const order = (a, b) => b.prob - a.prob || b.t / Math.max(1, b.avg) - a.t / Math.max(1, a.avg);
  legs.sort(order);
  value.sort(order);
  return { legs, value };
}

// Mejor pata por jugador (en un parlay no conviene repetir jugador: están correlacionadas)
export function bestPerPlayer(legs, { allowDoubt = false } = {}) {
  const seen = new Set(), out = [];
  for (const l of legs) {
    if (seen.has(l.player.id) || (!allowDoubt && l.doubt) || l.out) continue;
    seen.add(l.player.id);
    out.push(l);
  }
  return out;
}

export function combine(legs) {
  const prob = legs.reduce((a, l) => a * l.prob, 1);
  let result;
  if (legs.length && legs.every((l) => l.actual !== undefined)) {
    if (legs.some((l) => l.actual !== null && l.actual < l.t)) result = "lose";
    else if (legs.every((l) => l.actual !== null)) result = "win";
    else result = "void"; // alguno no jugó
  }
  return { legs, prob, fair: prob > 0 ? 1 / prob : null, result };
}

// Parlays de un partido
export function suggestParlays({ legs, value }) {
  const pool = bestPerPlayer(legs).filter((l) => l.prob >= P_AUTO);
  const out = [];
  if (pool.length >= 2) out.push({ name: "Doble seguro", kind: "game", ...combine(pool.slice(0, 2)) });
  if (pool.length >= 3) out.push({ name: "Triple", kind: "game", ...combine(pool.slice(0, 3)) });
  if (pool.length >= 4) out.push({ name: "Cuádruple", kind: "game", ...combine(pool.slice(0, 4)) });
  const a = pool.find((l) => !l.isHome), h = pool.find((l) => l.isHome);
  if (a && h) {
    const mix = [a, h];
    const third = pool.find((l) => !mix.includes(l));
    if (third) mix.push(third);
    const key = mix.map((l) => l.id).sort().join();
    if (!out.some((p) => p.legs.map((l) => l.id).sort().join() === key)) {
      out.push({ name: "Ambos equipos", kind: "game", ...combine(mix) });
    }
  }
  const vpool = bestPerPlayer(value);
  if (vpool.length >= 2) out.push({ name: "Valor", kind: "value", ...combine(vpool.slice(0, 2)) });
  return out;
}

// Parlays del día: la mejor pata de cada partido (partidos distintos = menos correlación)
export function suggestDayParlays(perGame) {
  const tops = [];
  for (const { legs } of perGame) {
    const best = bestPerPlayer(legs).find((l) => l.prob >= P_AUTO);
    if (best) tops.push(best);
  }
  tops.sort((a, b) => b.prob - a.prob);
  const out = [];
  for (const k of [2, 3, 4]) if (tops.length >= k) out.push({ name: `Día ${k} patas`, kind: "day", ...combine(tops.slice(0, k)) });
  return { tops, parlays: out };
}
