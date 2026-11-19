// Motor de parlays: busca, para cada jugador del partido, las líneas "X+" que más
// se cumplen (como las líneas alternativas de las casas: 15+, 20+, 25+ puntos…),
// estima su probabilidad y arma combinaciones. Para partidos ya jugados usa solo los
// partidos anteriores y muestra si el parlay se habría cumplido.
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

const MIN_GP = 5;          // mínimo de partidos jugados para opinar
const MIN_MIN = 18;        // minutos promedio (últimos 5) para considerarlo de rotación
export const P_LIST = 0.70; // probabilidad mínima para aparecer en la lista
export const P_AUTO = 0.76; // probabilidad mínima para entrar a los parlays automáticos

// suavizado de Laplace: 5/5 no es 100% seguro
const smooth = (h, n) => (h + 1) / (n + 2);
// Calibración: al elegir la línea más alta que "parece segura" la frecuencia
// histórica sobreestima (sesgo de selección). En la prueba con partidos ya jugados
// (nov-2026) encoger hacia 50% con este factor dejó las probabilidades cerca de lo real.
export const CALIBRATION = 0.88;
const calibrate = (p) => 0.5 + (p - 0.5) * CALIBRATION;
const count = (vals, t) => vals.reduce((a, v) => a + (v >= t ? 1 : 0), 0);

/**
 * Patas candidatas del partido.
 * teams: { [abbr]: teamData }, game: partido del calendario, injIdx: índice de lesiones
 */
export function buildLegs({ teams, game, injIdx, cutoffDay, isFinal }) {
  const legs = [];
  for (const abbr of [game.away, game.home]) {
    const data = teams[abbr];
    if (!data?.players) continue;
    const isHome = abbr === game.home;
    const opp = isHome ? game.away : game.home;
    for (const p of data.players) {
      const inj = injuryFor(p, injIdx);
      // en partidos futuros descartamos a los que están fuera
      if (!isFinal && inj?.status === "red") continue;
      const all = (p.games || []).filter((g) => g.min > 0 && g.date < cutoffDay); // recientes primero
      if (all.length < MIN_GP) continue;
      const l5min = all.slice(0, 5).reduce((a, g) => a + g.min, 0) / Math.min(5, all.length);
      if (l5min < MIN_MIN) continue;
      const venueGames = all.filter((g) => g.home === isHome);
      const oppGames = all.filter((g) => g.opponent === opp);
      const actualGame = isFinal ? (p.games || []).find((g) => g.date === cutoffDay) : null;

      for (const [stat, ths] of Object.entries(MILESTONES)) {
        const get = STATS[stat].get;
        const vals = all.map(get);
        const v5 = vals.slice(0, 5), v10 = vals.slice(0, 10), vv = venueGames.map(get), vo = oppGames.map(get);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        let best = null;
        for (const t of ths) {
          const hS = count(vals, t), h10 = count(v10, t), h5 = count(v5, t), hV = count(vv, t);
          const prob = calibrate(0.40 * smooth(hS, vals.length) + 0.30 * smooth(h10, v10.length)
                     + 0.15 * smooth(h5, v5.length) + 0.15 * smooth(hV, vv.length));
          if (prob < P_LIST) break;              // las líneas siguientes son más altas: peor
          best = {
            id: `${p.id}:${stat}:${t}`, player: p, team: abbr, stat, t, prob, avg,
            season: [hS, vals.length], l10: [h10, v10.length], l5: [h5, v5.length],
            venue: [hV, vv.length], vsOpp: vo.length ? [count(vo, t), vo.length] : null,
            isHome, doubt: inj?.status === "yellow" ? inj : null,
            out: inj?.status === "red" ? inj : null,
            actual: isFinal ? (actualGame && actualGame.min > 0 ? get(actualGame) : null) : undefined,
          };
        }
        if (best) legs.push(best);              // por prop: la línea más alta que aún es "segura"
      }
    }
  }
  legs.sort((a, b) => b.prob - a.prob || b.t / Math.max(1, b.avg) - a.t / Math.max(1, a.avg));
  return legs;
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

// Parlays automáticos: 2, 3 y 4 patas con las más probables (una por jugador)
export function suggestParlays(legs) {
  const pool = bestPerPlayer(legs).filter((l) => l.prob >= P_AUTO);
  const out = [];
  if (pool.length >= 2) out.push({ name: "Doble seguro", ...combine(pool.slice(0, 2)) });
  if (pool.length >= 3) out.push({ name: "Triple", ...combine(pool.slice(0, 3)) });
  if (pool.length >= 4) out.push({ name: "Cuádruple", ...combine(pool.slice(0, 4)) });
  // un parlay mezclando ambos equipos (para no depender de un solo lado)
  const a = pool.find((l) => !l.isHome), h = pool.find((l) => l.isHome);
  if (a && h) {
    const mix = [a, h];
    const third = pool.find((l) => !mix.includes(l));
    if (third) mix.push(third);
    const key = mix.map((l) => l.id).sort().join();
    if (!out.some((p) => p.legs.map((l) => l.id).sort().join() === key)) {
      out.push({ name: "Ambos equipos", ...combine(mix) });
    }
  }
  return out;
}
