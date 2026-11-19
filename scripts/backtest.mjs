// Prueba del modelo de parlays con partidos ya jugados: para cada partido usa solo
// la información anterior a ese día y revisa si las patas/parlays se cumplieron.
// Escribe data/model.json, que la web muestra como "acierto real del modelo".
// Uso: node scripts/backtest.mjs   (lo corre solo scripts/update_data.py)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildLegs, suggestParlays, suggestDayParlays, bestPerPlayer } from "../js/parlay.js";
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

const BUCKETS = [[0.90, "90%+"], [0.85, "85-90%"], [0.80, "80-85%"], [0.76, "76-80%"], [0.70, "70-76%"], [0, "Valor 62-76%"]];
const legs = Object.fromEntries(BUCKETS.map(([, k]) => [k, { hit: 0, n: 0, est: 0 }]));
const parlays = {};
const addLeg = (k, l) => { legs[k].n++; legs[k].est += l.prob; legs[k].hit += l.actual >= l.t ? 1 : 0; };
const addParlay = (p) => {
  const r = (parlays[p.name] ||= { win: 0, lose: 0, void: 0, est: 0, n: 0 });
  r[p.result]++; r.est += p.prob; r.n++;
};
let games = 0;
const byDay = {};

for (const g of fx.games) {
  if (g.hs == null || g.home === "TBD" || g.away === "TBD") continue;
  const day = etDay(g.date);
  if (day < FROM) continue;
  games++;
  const res = buildLegs({ teams, game: g, injIdx: noInj, cutoffDay: day, isFinal: true });
  for (const l of bestPerPlayer(res.legs, { allowDoubt: true })) {
    if (l.actual === null) continue; // no jugó
    addLeg(BUCKETS.find(([min]) => l.prob >= min)[1], l);
  }
  for (const l of bestPerPlayer(res.value, { allowDoubt: true })) if (l.actual !== null) addLeg("Valor 62-76%", l);
  for (const p of suggestParlays(res)) addParlay(p);
  (byDay[day] ||= []).push(res);
}
let days = 0;
for (const list of Object.values(byDay)) { days++; for (const p of suggestDayParlays(list).parlays) addParlay(p); }

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const out = {
  updated: new Date().toISOString().slice(0, 19) + "Z",
  model: "v2", from: FROM, games, days,
  legs: BUCKETS.map(([, k]) => ({ range: k, n: legs[k].n, real: pct(legs[k].hit, legs[k].n), est: pct(legs[k].est, legs[k].n) })),
  parlays: Object.entries(parlays).map(([name, r]) => ({
    name, win: r.win, lose: r.lose, void: r.void, real: pct(r.win, r.win + r.lose), est: pct(r.est, r.n),
  })),
};
fs.writeFileSync(path.join(D, "model.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`Backtest: ${games} partidos, ${days} días`);
for (const l of out.legs) console.log(`  patas ${l.range}: real ${l.real}% (est ${l.est}%) n=${l.n}`);
for (const p of out.parlays) console.log(`  ${p.name}: ganó ${p.real}% (${p.win}/${p.win + p.lose}, est ${p.est}%) nulos ${p.void}`);
