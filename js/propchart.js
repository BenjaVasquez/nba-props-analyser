// Gráfico interactivo de props (sin librerías): barras por partido, línea de Vegas
// arrastrable, tooltip con el detalle y logos del rival + fecha bajo cada barra.
import { logoHTML } from "./teams.js";

export const STATS = {
  pts: { label: "Puntos", short: "PTS", get: (g) => g.pts },
  ast: { label: "Asistencias", short: "AST", get: (g) => g.ast },
  reb: { label: "Rebotes", short: "REB", get: (g) => g.reb },
  tpm: { label: "Triples", short: "3PM", get: (g) => g.tpm },
  pts_ast: { label: "Pts + Ast", short: "P+A", get: (g) => g.pts + g.ast },
  pts_reb: { label: "Pts + Reb", short: "P+R", get: (g) => g.pts + g.reb },
  reb_ast: { label: "Reb + Ast", short: "R+A", get: (g) => g.reb + g.ast },
  pra: { label: "Pts + Reb + Ast", short: "PRA", get: (g) => g.pts + g.reb + g.ast },
  stl: { label: "Robos", short: "ROB", get: (g) => g.stl },
  blk: { label: "Tapones", short: "TAP", get: (g) => g.blk },
  dd2: { label: "Doble-doble", short: "DD", get: (g) => g.dd2, binary: true },
  dd3: { label: "Triple-doble", short: "TD", get: (g) => g.dd3, binary: true },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (iso) => { const [, m, d] = iso.split("-"); return `${+d}/${+m}`; };
const dLong = (iso) => { const [, m, d] = iso.split("-"); return `${+d} ${MESES[+m - 1]}`; };
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(".", ",");

// % de acierto al "over": gana si supera la línea; igual a la línea = push (no cuenta)
export function hitRate(values, line) {
  let hits = 0, pushes = 0;
  for (const v of values) { if (v > line) hits++; else if (v === line) pushes++; }
  const n = values.length - pushes;
  return { hits, n, pushes, pct: pct(hits, n), total: values.length };
}

export function defaultLine(values, binary) {
  if (binary || !values.length) return 0.5;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  let l = Math.round(avg * 2) / 2;
  if (Number.isInteger(l)) l -= 0.5;
  return Math.max(0.5, l);
}

function niceStep(max) {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/**
 * Crea el gráfico dentro de `root`.
 * opts: { games (cronológicos), stat, line, onLineChange(line) }
 */
export class PropChart {
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.height = 300;
    this.pad = { l: 34, r: 50, t: 24, b: 64 };
    root.classList.add("pc");
    root.innerHTML = `<svg class="pc-svg"></svg><div class="pc-x"></div><div class="pc-tip" hidden></div>`;
    this.svg = root.querySelector("svg");
    this.xRow = root.querySelector(".pc-x");
    this.tip = root.querySelector(".pc-tip");
    // tocar fuera de una barra cierra el detalle (útil en el celular)
    root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".pc-bar, .pc-xi")) this.hideTip(); });
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(root);
    this.render();
  }

  destroy() { this.ro.disconnect(); }

  set(opts) { Object.assign(this.opts, opts); this.render(); }

  get values() { return this.opts.games.map(STATS[this.opts.stat].get); }

  render() {
    const W = Math.max(280, this.root.clientWidth);
    const H = this.height, { l, r, t, b } = this.pad;
    const games = this.opts.games, vals = this.values, n = games.length;
    const stat = STATS[this.opts.stat];
    this.W = W; this.plotW = W - l - r; this.plotH = H - t - b;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("width", W);
    this.svg.setAttribute("height", H);

    if (!n) {
      this.svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" class="pc-empty" text-anchor="middle">Sin partidos con este filtro</text>`;
      this.xRow.innerHTML = "";
      return;
    }

    const maxV = Math.max(...vals, this.opts.line, stat.binary ? 1 : 5);
    const step = stat.binary ? 1 : niceStep(maxV * 1.15);
    this.yMax = stat.binary ? 1.4 : Math.ceil((maxV * 1.15) / step) * step;
    const y = (v) => t + this.plotH - (v / this.yMax) * this.plotH;
    this.y = y;
    const band = this.plotW / n;
    const bw = Math.max(3, Math.min(46, band * 0.68));
    this.band = band;

    let s = "";
    // rejilla + eje Y
    for (let v = 0; v <= this.yMax + 1e-9; v += step) {
      const yy = y(v).toFixed(1);
      s += `<line class="pc-grid" x1="${l}" x2="${W - r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="pc-ytick" x="${l - 8}" y="${+yy + 4}" text-anchor="end">${stat.binary ? (v ? "Sí" : "No") : fmt(v)}</text>`;
    }
    // barras
    const showVals = band >= 15;
    games.forEach((g, i) => {
      const v = vals[i];
      const cx = l + band * (i + 0.5);
      const top = y(Math.max(v, 0));
      const h = Math.max(v > 0 ? 2 : 0, y(0) - top);
      s += `<g class="pc-bar" data-i="${i}">
        <rect class="pc-hit" x="${(cx - band / 2).toFixed(1)}" y="${t}" width="${band.toFixed(1)}" height="${this.plotH}"/>
        <rect class="pc-col" x="${(cx - bw / 2).toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, bw / 4).toFixed(1)}"/>
        ${showVals ? `<text class="pc-val" x="${cx.toFixed(1)}" y="${(y(0) - h - 6).toFixed(1)}" text-anchor="middle">${stat.binary ? (v ? "✓" : "✗") : v}</text>` : ""}
      </g>`;
    });
    // línea de Vegas (arrastrable)
    s += `<g class="pc-line">
      <line class="pc-line-l" x1="${l}" x2="${W - r + 4}"/>
      <rect class="pc-line-tag" x="${W - r + 4}" width="${r - 6}" height="20" rx="4"/>
      <text class="pc-line-t" x="${W - r + 4 + (r - 6) / 2}" text-anchor="middle"></text>
      <rect class="pc-line-grab" x="${l}" width="${W - l}" height="22"/>
    </g>`;
    this.svg.innerHTML = s;

    // logos + fecha bajo cada barra
    const logo = Math.max(0, Math.min(26, band - 6));
    const showDate = band >= 30, showLogo = band >= 13;
    this.xRow.style.top = `${H - b + 6}px`;
    this.xRow.innerHTML = games.map((g, i) => {
      const cx = l + band * (i + 0.5);
      return `<div class="pc-xi" style="left:${cx.toFixed(1)}px" data-i="${i}">
        ${showLogo ? logoHTML(g.opponent, logo) : ""}
        ${showDate ? `<span class="pc-ha">${g.home ? "vs" : "@"}</span><span class="pc-d">${dm(g.date)}</span>` : ""}
      </div>`;
    }).join("");

    this.paintLine();
    this.bind();
  }

  // colores de barras + posición de la línea (también se usa al arrastrar)
  paintLine() {
    const line = this.opts.line, vals = this.values;
    this.svg.querySelectorAll(".pc-bar").forEach((g) => {
      const v = vals[+g.dataset.i];
      g.classList.toggle("over", v > line);
      g.classList.toggle("push", v === line);
      g.classList.toggle("under", v < line);
    });
    const yy = this.y(line);
    const ln = this.svg.querySelector(".pc-line-l");
    if (!ln) return;
    ln.setAttribute("y1", yy); ln.setAttribute("y2", yy);
    this.svg.querySelector(".pc-line-tag").setAttribute("y", yy - 10);
    const tx = this.svg.querySelector(".pc-line-t");
    tx.setAttribute("y", yy + 4); tx.textContent = fmt(line);
    this.svg.querySelector(".pc-line-grab").setAttribute("y", yy - 11);
  }

  setLine(v, notify = true) {
    const stat = STATS[this.opts.stat];
    const dragging = this.root.classList.contains("dragging");
    v = Math.max(stat.binary ? 0.5 : 0, Math.min(v, dragging ? this.yMax : 999));
    v = stat.binary ? 0.5 : Math.round(v * 2) / 2;
    if (v === this.opts.line) return;
    this.opts.line = v;
    // si la línea (escrita a mano) se sale del eje, redibujamos con más espacio
    if (!dragging && v > this.yMax * 0.92) this.render(); else this.paintLine();
    if (notify) this.opts.onLineChange?.(v);
  }

  bind() {
    const svg = this.svg;
    // arrastrar la línea
    const grab = svg.querySelector(".pc-line-grab");
    if (grab && !STATS[this.opts.stat].binary) {
      const toVal = (ev) => {
        const r = svg.getBoundingClientRect();
        const py = (ev.clientY - r.top) * (this.height / r.height);
        return ((this.pad.t + this.plotH - py) / this.plotH) * this.yMax;
      };
      grab.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        grab.setPointerCapture(e.pointerId);
        this.root.classList.add("dragging");
        this.hideTip();
        const move = (ev) => this.setLine(toVal(ev));
        const up = () => {
          this.root.classList.remove("dragging");
          grab.removeEventListener("pointermove", move);
          grab.removeEventListener("pointerup", up);
          grab.removeEventListener("pointercancel", up);
        };
        grab.addEventListener("pointermove", move);
        grab.addEventListener("pointerup", up);
        grab.addEventListener("pointercancel", up);
      });
    }
    // tooltip por barra (mouse y toque)
    svg.querySelectorAll(".pc-bar").forEach((g) => {
      const i = +g.dataset.i;
      g.addEventListener("pointerenter", () => this.showTip(i));
      g.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") this.hideTip(); });
      g.addEventListener("click", () => this.showTip(i));
    });
    this.xRow.querySelectorAll(".pc-xi").forEach((el) => {
      el.addEventListener("pointerenter", () => this.showTip(+el.dataset.i));
      el.addEventListener("pointerleave", () => this.hideTip());
    });
  }

  showTip(i) {
    if (this.root.classList.contains("dragging")) return;
    const g = this.opts.games[i];
    const v = this.values[i];
    const line = this.opts.line;
    const st = STATS[this.opts.stat];
    const tri = g.tpa ? ` (${pct(g.tpm, g.tpa)}%)` : "";
    const ft = g.ft_a ? ` (${pct(g.ft_m, g.ft_a)}%)` : "";
    const res = v > line ? `<b class="ok">OVER ${fmt(line)}</b>` : v === line ? `<b class="push">PUSH</b>` : `<b class="ko">UNDER ${fmt(line)}</b>`;
    this.tip.innerHTML = `
      <div class="pt-h">${logoHTML(g.opponent, 22)}<div><div class="pt-t">${g.home ? "vs" : "@"} ${g.opponent} · ${dLong(g.date)}</div>
        <div class="pt-r ${g.result === "W" ? "w" : "l"}">${g.result === "W" ? "Ganó" : "Perdió"} (${g.margin > 0 ? "+" : ""}${g.margin} pts)</div></div></div>
      <div class="pt-main">${st.label}: <b>${st.binary ? (v ? "Sí" : "No") : v}</b> ${res}</div>
      <div class="pt-row">Puntos: ${g.pts}</div>
      <div class="pt-row">Asistencias: ${g.ast} | Rebotes: ${g.reb}</div>
      <div class="pt-row">Triples: ${g.tpm}/${g.tpa}${tri}</div>
      <div class="pt-row">Libres: ${g.ft_m}/${g.ft_a}${ft}</div>
      <div class="pt-row">Minutos: ${g.min}'${g.starter ? " · Titular" : " · Suplente"}</div>`;
    this.tip.hidden = false;
    // posición: sobre la barra, dentro del contenedor
    const cx = this.pad.l + this.band * (i + 0.5);
    const tw = this.tip.offsetWidth, W = this.root.clientWidth;
    let left = cx + 14;
    if (left + tw > W) left = cx - tw - 14;
    this.tip.style.left = `${Math.max(0, left)}px`;
    this.tip.style.top = `${this.pad.t}px`;
    this.svg.querySelectorAll(".pc-bar.hover").forEach((x) => x.classList.remove("hover"));
    this.svg.querySelector(`.pc-bar[data-i="${i}"]`)?.classList.add("hover");
  }

  hideTip() {
    this.tip.hidden = true;
    this.svg.querySelectorAll(".pc-bar.hover").forEach((x) => x.classList.remove("hover"));
  }
}
