// Panel de análisis de la prop: hit rate, línea de Vegas, filtros y gráfico.
import { PropChart, STATS, hitRate, defaultLine } from "./propchart.js";

// preferencias que se mantienen al cambiar de jugador
export const view = { stat: "pts", range: 15, venue: "all" };
const RANGES = [[5, "L5"], [10, "L10"], [15, "L15"], [20, "L20"], [0, "Temp."]];

const fmt = (v) => (v == null || Number.isNaN(v) ? "—" : (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(".", ","));
const tone = (p, n) => (!n ? "" : p >= 60 ? "good" : p >= 45 ? "mid" : "bad");

// líneas guardadas por jugador + prop (en este navegador)
const lineKey = (pid, stat) => `nba-line:${pid}:${stat}`;
function loadLine(pid, stat) {
  try { const v = localStorage.getItem(lineKey(pid, stat)); return v == null ? null : +v; } catch { return null; }
}
function saveLine(pid, stat, v) { try { localStorage.setItem(lineKey(pid, stat), String(v)); } catch { /* sin almacenamiento */ } }

let current = null; // { el, player, opp, chart, line }

export function unmountPropView() {
  current?.chart?.destroy();
  current = null;
}

export function setStat(stat) {
  if (!STATS[stat]) return;
  view.stat = stat;
  if (current) {
    current.line = null;
    draw();
  }
}

/** Monta el panel en `el` para `player`. `opp` = rival del partido seleccionado. */
export function mountPropView(el, player, opp) {
  unmountPropView();
  const played = (player.games || []).filter((g) => g.min > 0).slice().reverse(); // cronológico
  current = { el, player, opp, played, chart: null, line: null };
  el.innerHTML = `
    <div class="pp-top">
      <div class="pp-box pp-hit"><span class="lbl" data-ref="hitLbl"></span><b class="big" data-ref="hitPct"></b><small data-ref="hitN"></small></div>
      <div class="pp-box pp-line">
        <span class="lbl" data-ref="lineLbl"></span>
        <div class="ln-ctrl">
          <button type="button" data-step="-0.5" aria-label="Bajar línea">−</button>
          <input type="number" step="0.5" min="0" inputmode="decimal" data-ref="lineIn" aria-label="Línea">
          <button type="button" data-step="0.5" aria-label="Subir línea">+</button>
        </div>
        <small>Arrastra la línea amarilla del gráfico</small>
      </div>
      <div class="pp-box pp-avg"><span class="lbl">Promedio</span><b class="big" data-ref="avg"></b><small data-ref="avgSub"></small></div>
    </div>
    <div class="card pp-card">
      <div class="pp-bar">
        <h3 data-ref="title"></h3>
        <div class="chips" data-ref="ranges">${RANGES.map(([n, t]) => `<button type="button" data-range="${n}">${t}</button>`).join("")}</div>
        <div class="chips" data-ref="venues">
          <button type="button" data-venue="all">Todos</button><button type="button" data-venue="home">Local</button>
          <button type="button" data-venue="away">Visita</button>${opp ? `<button type="button" data-venue="opp">vs ${opp}</button>` : ""}
        </div>
      </div>
      <div class="pp-chart" data-ref="chart"></div>
      <div class="pp-legend"><span><i class="o"></i>Over</span><span><i class="u"></i>Under</span><span><i class="l"></i>Línea</span></div>
    </div>
    <div class="card"><h3>Hit rate a esta línea</h3><div class="splits" data-ref="splits"></div></div>`;

  el.addEventListener("click", onClick);
  el.querySelector('[data-ref="lineIn"]').addEventListener("change", (e) => setLine(parseFloat(String(e.target.value).replace(",", "."))));
  if (view.venue === "opp" && !opp) view.venue = "all";
  draw();
}

function ref(name) { return current.el.querySelector(`[data-ref="${name}"]`); }

function subset(venue = view.venue, range = view.range) {
  let g = current.played;
  if (venue === "home") g = g.filter((x) => x.home);
  else if (venue === "away") g = g.filter((x) => !x.home);
  else if (venue === "opp") g = g.filter((x) => x.opponent === current.opp);
  return range ? g.slice(-range) : g;
}

function draw() {
  const { player } = current;
  const st = STATS[view.stat];
  const allVals = current.played.map(st.get);
  if (current.line == null) {
    current.line = loadLine(player.id, view.stat) ?? defaultLine(allVals, st.binary);
  }
  const games = subset();
  if (!current.chart) {
    current.chart = new PropChart(ref("chart"), {
      games, stat: view.stat, line: current.line,
      onLineChange: (v) => { current.line = v; saveLine(player.id, view.stat, v); updateNumbers(); },
    });
  } else {
    current.chart.set({ games, stat: view.stat, line: current.line });
  }
  current.el.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("on", +b.dataset.range === view.range));
  current.el.querySelectorAll("[data-venue]").forEach((b) => b.classList.toggle("on", b.dataset.venue === view.venue));
  const rLabel = RANGES.find(([n]) => n === view.range)?.[1] || "";
  const vLabel = { all: "", home: " · Local", away: " · Visita", opp: ` · vs ${current.opp}` }[view.venue];
  ref("title").textContent = `${st.label} · ${view.range ? `últimos ${view.range}` : "temporada"}${vLabel}`;
  ref("hitLbl").textContent = `Hit rate · ${rLabel}${vLabel}`;
  ref("lineLbl").textContent = `Línea Vegas · ${st.short}`;
  ref("lineIn").disabled = !!st.binary;
  current.el.querySelectorAll("[data-step]").forEach((b) => (b.disabled = !!st.binary));
  updateNumbers();
}

function updateNumbers() {
  const st = STATS[view.stat];
  const line = current.line;
  const vals = subset().map(st.get);
  const hr = hitRate(vals, line);
  const hit = ref("hitPct");
  hit.textContent = vals.length ? `${hr.pct}%` : "—";
  hit.className = `big ${tone(hr.pct, hr.n)}`;
  ref("hitN").textContent = `(${hr.hits}/${hr.n} partidos${hr.pushes ? ` · ${hr.pushes} push` : ""})`;
  const inp = ref("lineIn");
  if (document.activeElement !== inp) inp.value = line;

  const sorted = [...vals].sort((a, b) => a - b);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const med = !sorted.length ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  ref("avg").textContent = st.binary ? `${hr.pct}%` : fmt(avg == null ? null : Math.round(avg * 10) / 10);
  ref("avgSub").textContent = vals.length && !st.binary ? `Mediana ${fmt(med)} · Máx ${Math.max(...vals)} · Mín ${Math.min(...vals)}` : "";

  // tabla de cortes: misma línea, distintas muestras
  const cuts = [
    ["L5", "all", 5], ["L10", "all", 10], ["L20", "all", 20], ["Temporada", "all", 0],
    ["Local", "home", 0], ["Visita", "away", 0],
  ];
  if (current.opp) cuts.push([`vs ${current.opp}`, "opp", 0]);
  ref("splits").innerHTML = cuts.map(([label, venue, range]) => {
    const v = subset(venue, range).map(st.get);
    const h = hitRate(v, line);
    return `<button type="button" class="split ${tone(h.pct, h.n)}" data-venue-set="${venue}" data-range-set="${range}">
      <span>${label}</span><b>${v.length ? `${h.pct}%` : "—"}</b><small>${h.hits}/${h.n}</small></button>`;
  }).join("");
}

function setLine(v) {
  if (!Number.isFinite(v)) { updateNumbers(); return; }
  current.chart.setLine(v);
}

function onClick(e) {
  const t = e.target.closest("button");
  if (!t || !current) return;
  if (t.dataset.step) setLine(current.line + parseFloat(t.dataset.step));
  else if (t.dataset.range != null) { view.range = +t.dataset.range; draw(); }
  else if (t.dataset.venue) { view.venue = t.dataset.venue; draw(); }
  else if (t.dataset.venueSet) { view.venue = t.dataset.venueSet; view.range = +t.dataset.rangeSet; draw(); }
}
