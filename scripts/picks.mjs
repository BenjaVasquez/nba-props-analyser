// Registro de picks: la prueba REAL del modelo (no hacia atrás).
//
// 1) Congela: para cada partido que todavía no empieza, guarda los parlays y las mejores
//    patas que la web recomienda AHORA (con lesionados al día). Se re-guardan en cada
//    pasada del robot hasta que el partido empieza; desde ahí quedan fijos.
//    Los "parlays del día" se fijan cuando empieza el primer partido de la jornada.
// 2) Evalúa: cuando el partido ya tiene box score, marca cada pata y parlay como
//    ganado / perdido / nulo (jugador no jugó).
// 3) Resume todo en data/tracking.json (lo muestra la web en "📈 Registro").
//
// Archivos: data/picks/AAAA-MM-DD.json (fecha NBA, hora EE.UU. Este)
// Uso: node scripts/picks.mjs   (lo corre solo scripts/update_data.py)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildLegs, suggestParlays, suggestDayParlays, bestPerPlayer } from "../js/parlay.js";
import { indexInjuries } from "../js/players.js";
import { STATS } from "../js/propchart.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = path.join(ROOT, "data");
const PICKS = path.join(D, "picks");
const TOP_LEGS = 6; // mejores patas por partido que también se registran

const read = (f, def) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } };
const etDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const now = process.env.PICKS_NOW ? new Date(process.env.PICKS_NOW) : new Date(); // PICKS_NOW: solo para pruebas
const stamp = now.toISOString().slice(0, 19) + "Z";

const fx = read(path.join(D, "fixture.json"), { games: [] });
const injIdx = indexInjuries(read(path.join(D, "injuries.json"), {}));
const teams = {};
const playerById = new Map();
for (const f of fs.readdirSync(path.join(D, "players"))) {
  const t = read(path.join(D, "players", f), null);
  if (!t) continue;
  teams[f.replace(".json", "")] = t;
  for (const p of t.players) playerById.set(String(p.id), p);
}
fs.mkdirSync(PICKS, { recursive: true });

const games = fx.games
  .filter((g) => g.home !== "TBD" && g.away !== "TBD")
  .map((g) => ({ ...g, start: new Date(g.date), day: etDay(g.date) }));

// ---------- 1) congelar picks de los partidos que aún no empiezan ----------
const legOut = (l) => ({
  pid: String(l.player.id), name: l.player.name, team: l.team, opp: l.opp,
  stat: l.stat, t: l.t, prob: Math.round(l.prob * 1000) / 1000, proj: Math.round(l.proj * 10) / 10,
});
const parlayOut = (p) => ({ name: p.name, kind: p.kind, prob: Math.round(p.prob * 1000) / 1000, legs: p.legs.map(legOut) });

const upcomingDays = [...new Set(games.filter((g) => g.start > now).map((g) => g.day))].sort().slice(0, 2);
let frozen = 0;
for (const day of upcomingDays) {
  const file = path.join(PICKS, `${day}.json`);
  const rec = read(file, { day, created: stamp, games: {}, day_parlays: null });
  const slate = games.filter((g) => g.day === day);
  const perGame = [];
  for (const g of slate) {
    const res = buildLegs({ teams, game: g, injIdx, cutoffDay: day, isFinal: false });
    perGame.push(res);
    if (g.start <= now) continue; // ya empezó: lo guardado queda fijo
    rec.games[g.id] = {
      id: g.id, matchup: `${g.away} @ ${g.home}`, start: g.date, saved: stamp,
      parlays: suggestParlays(res).map(parlayOut),
      legs: bestPerPlayer(res.legs).slice(0, TOP_LEGS).map(legOut),
    };
    frozen++;
  }
  const firstStart = Math.min(...slate.map((g) => +g.start));
  if (firstStart > +now) {
    const { parlays } = suggestDayParlays(perGame);
    rec.day_parlays = { saved: stamp, parlays: parlays.map(parlayOut) };
  }
  rec.updated = stamp;
  fs.writeFileSync(file, JSON.stringify(rec) + "\n");
}

// ---------- 2) evaluar picks con resultados ----------
const gameById = new Map(games.map((g) => [g.id, g]));
function evalLeg(l, day) {
  const p = playerById.get(l.pid);
  const g = p?.games?.find((x) => x.date === day);
  if (!g) return null;                       // aún sin datos de ese partido
  if (!(g.min > 0)) return { ...l, actual: null, result: "void" };
  const v = STATS[l.stat].get(g);
  return { ...l, actual: v, result: v >= l.t ? "win" : "lose" };
}
function evalParlay(p, day) {
  const legs = p.legs.map((l) => evalLeg(l, day));
  if (legs.some((x) => x === null)) return null;
  const result = legs.some((x) => x.result === "lose") ? "lose" : legs.every((x) => x.result === "win") ? "win" : "void";
  return { ...p, legs, result };
}

const files = fs.readdirSync(PICKS).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
const byName = {}, buckets = {}, days = [];
const BK = [[0.85, "85%+"], [0.80, "80-85%"], [0.76, "76-80%"], [0.70, "70-76%"], [0, "<70%"]];
const add = (p) => {
  const r = (byName[p.name] ||= { name: p.name, kind: p.kind, win: 0, lose: 0, void: 0, est: 0, n: 0 });
  r[p.result]++; r.est += p.prob; r.n++;
};
let evaluated = 0;
for (const f of files) {
  const file = path.join(PICKS, f);
  const rec = read(file, null);
  if (!rec) continue;
  let changed = false;
  const dayRow = { day: rec.day, parlays: [] };
  for (const gp of Object.values(rec.games || {})) {
    const g = gameById.get(gp.id);
    if (!gp.result && g?.hs != null) {
      const parlays = gp.parlays.map((p) => evalParlay(p, rec.day));
      const legs = gp.legs.map((l) => evalLeg(l, rec.day));
      if (parlays.every(Boolean) && legs.every(Boolean)) {
        gp.parlays = parlays; gp.legs = legs; gp.result = { evaluated: stamp, score: `${g.away} ${g.as} – ${g.hs} ${g.home}` };
        changed = true; evaluated++;
      }
    }
    if (gp.result) {
      gp.parlays.forEach((p) => { add(p); dayRow.parlays.push({ name: p.name, matchup: gp.matchup, result: p.result, prob: p.prob }); });
      for (const l of gp.legs) {
        if (l.result === "void") continue;
        const k = BK.find(([m]) => l.prob >= m)[1];
        const b = (buckets[k] ||= { range: k, hit: 0, n: 0, est: 0 });
        b.n++; b.est += l.prob; b.hit += l.result === "win" ? 1 : 0;
      }
    }
  }
  const dp = rec.day_parlays;
  if (dp && !dp.evaluated) {
    const dayGames = games.filter((g) => g.day === rec.day);
    if (dayGames.length && dayGames.every((g) => g.hs != null)) {
      const parlays = dp.parlays.map((p) => evalParlay(p, rec.day));
      if (parlays.every(Boolean)) { dp.parlays = parlays; dp.evaluated = stamp; changed = true; evaluated++; }
    }
  }
  if (dp?.evaluated) dp.parlays.forEach((p) => { add(p); dayRow.parlays.push({ name: p.name, matchup: "Día", result: p.result, prob: p.prob }); });
  if (changed) fs.writeFileSync(file, JSON.stringify(rec) + "\n");
  if (dayRow.parlays.length) days.push(dayRow);
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const tracking = {
  updated: stamp,
  since: files[0]?.slice(0, 10) || null,
  parlays: Object.values(byName).map((r) => ({
    name: r.name, kind: r.kind, win: r.win, lose: r.lose, void: r.void,
    real: pct(r.win, r.win + r.lose), est: pct(r.est, r.n),
  })),
  legs: BK.map(([, k]) => buckets[k]).filter(Boolean).map((b) => ({ range: b.range, n: b.n, real: pct(b.hit, b.n), est: pct(b.est, b.n) })),
  days: days.reverse(),
};
fs.writeFileSync(path.join(D, "tracking.json"), JSON.stringify(tracking, null, 1) + "\n");
console.log(`Registro de picks: ${frozen} partidos guardados (${upcomingDays.join(", ") || "sin partidos próximos"}), ${evaluated} evaluados ahora, ${days.length} días con resultados.`);
