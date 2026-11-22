// Prueba del modelo (v3) con partidos ya jugados: para cada partido usa solo la
// información anterior a ese día, genera los mismos parlays que muestra la web
// (15 por partido y 10 del día) y revisa si se cumplieron.
// Escribe data/model.json, que la web muestra como "Prueba: X%".
// Uso: node scripts/backtest.mjs   (lo corre solo scripts/update_data.py)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCandidates, generateParlays } from "../js/engine.js";
import { LEVELS } from "../js/parlayview.js";
import { indexInjuries } from "../js/players.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = path.join(ROOT, "data");
const FROM = "2026-11-01"; // antes de esto los jugadores tienen muy pocos partidos

const fx = JSON.parse(fs.readFileSync(path.join(D, "fixture.json"), "utf8"));
const teams = {};
for (const f of fs.readdirSync(path.join(D, "players"))) {
  teams[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(D, "players", f), "utf8"));
}
const noInj = indexInjuries({});
const etDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const BUCKETS = [[0.90, "90%+"], [0.85, "85-90%"], [0.80, "80-85%"], [0, "78-80%"]];
const legs = Object.fromEntries(BUCKETS.map(([, k]) => [k, { hit: 0, n: 0, est: 0 }]));
const parlays = {};
const add = (name, p) => {
  const r = (parlays[name] ||= { win: 0, lose: 0, void: 0, est: 0, n: 0 });
  r[p.result]++; r.est += p.prob; r.n++;
};
let games = 0;
const byDay = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, new Map()]));

for (const g of fx.games) {
  if (g.hs == null || g.home === "TBD" || g.away === "TBD") continue;
  const day = etDay(g.date);
  if (day < FROM) continue;
  games++;
  // jugadores que no jugaron fuera (en la web real los descarta el reporte de lesionados)
  for (const [lk, L] of Object.entries(LEVELS)) {
    const cand = buildCandidates({ teams, game: { ...g, day }, injIdx: noInj, cutoffDay: day, isFinal: true, ...L.cand })
      .filter((l) => l.actual !== null);
    for (const p of generateParlays(cand, L.game)) add(`${L.prefix}Partido · ${p.legs.length} patas`, p);
    (byDay[lk].get(day) || byDay[lk].set(day, []).get(day)).push(...cand);
  }
  const cand = buildCandidates({ teams, game: { ...g, day }, injIdx: noInj, cutoffDay: day, isFinal: true })
    .filter((l) => l.actual !== null);
  for (const l of cand) {
    if (l.prob > 0.95) continue;
    const k = BUCKETS.find(([min]) => l.prob >= min)[1];
    legs[k].n++; legs[k].est += l.prob; legs[k].hit += l.actual > l.line ? 1 : 0;
  }
}
for (const [lk, L] of Object.entries(LEVELS)) {
  for (const [, pool] of byDay[lk]) for (const p of generateParlays(pool, L.day)) add(`${L.prefix}Día · ${p.legs.length} patas`, p);
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const out = {
  updated: new Date().toISOString().slice(0, 19) + "Z",
  model: "v3", from: FROM, games, days: byDay.segura.size,
  note: "Jugadores que no jugaron se excluyen (en vivo los filtra el reporte de lesionados).",
  legs: BUCKETS.map(([, k]) => ({ range: k, n: legs[k].n, real: pct(legs[k].hit, legs[k].n), est: pct(legs[k].est, legs[k].n) })),
  parlays: Object.entries(parlays).sort().map(([name, r]) => ({
    name, win: r.win, lose: r.lose, void: r.void, real: pct(r.win, r.win + r.lose), est: pct(r.est, r.n),
  })),
};
fs.writeFileSync(path.join(D, "model.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`Backtest v3: ${games} partidos, ${byDay.segura.size} días`);
for (const l of out.legs) console.log(`  patas ${l.range}: real ${l.real}% (est ${l.est}%) n=${l.n}`);
for (const p of out.parlays) console.log(`  ${p.name}: ${p.real}% (${p.win}/${p.win + p.lose}, est ${p.est}%)`);
