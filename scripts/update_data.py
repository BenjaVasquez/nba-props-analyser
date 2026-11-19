"""
Actualiza los datos de la temporada NBA desde ESPN y los deja en data/:

  data/fixture.json         calendario + resultados (se completan solos)
  data/injuries.json        lesionados, mismo formato que la web anterior:
                            { "Nombre": {"status": "red"|"yellow", "description": "Nov 20", ...} }
  data/players/<EQUIPO>.json  plantilla de cada equipo con bio, promedios y
                            TODOS los partidos de la temporada de cada jugador
  data/meta.json            fecha de actualización y contadores
  data/cache/boxscores.json box scores ya descargados (para no bajarlos de nuevo)

Solo usa la librería estándar de Python. Se ejecuta a mano o desde GitHub Actions:
    python scripts/update_data.py
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # Windows sin el paquete tzdata
    ET = timezone(timedelta(hours=-5))

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
SEASON_START = date(2026, 10, 20)

# id de equipo en ESPN -> nuestra abreviatura
ESPN_TEAMS = {
    1: "ATL", 2: "BOS", 17: "BKN", 30: "CHA", 4: "CHI", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GSW", 10: "HOU", 11: "IND", 12: "LAC", 13: "LAL", 29: "MEM", 14: "MIA",
    15: "MIL", 16: "MIN", 3: "NOP", 18: "NYK", 25: "OKC", 19: "ORL", 20: "PHI", 21: "PHX",
    22: "POR", 23: "SAC", 24: "SAS", 28: "TOR", 26: "UTA", 27: "WAS",
}
ESPN_ABBR = {"NY": "NYK", "GS": "GSW", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS"}

# Estados de ESPN -> color de la web (rojo = no juega, amarillo = en duda)
RED_STATUSES = {"out", "suspension", "suspended", "inactive"}


def team_abbr(team):
    """Abreviatura propia a partir del objeto 'team' de ESPN."""
    try:
        tid = int(team.get("id"))
        if tid in ESPN_TEAMS:
            return ESPN_TEAMS[tid]
    except (TypeError, ValueError):
        pass
    a = (team.get("abbreviation") or "").upper()
    return ESPN_ABBR.get(a, a)


# ---------------------------------------------------------------- HTTP
def fetch_json(url, tries=4):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (nba-props-analyser data bot)",
        "Accept": "application/json",
    })
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if i == tries - 1:
                raise
            wait = 2 ** i
            print(f"  reintento en {wait}s ({e}) -> {url}")
            time.sleep(wait)


# Se puede reemplazar en las pruebas por una función que lea archivos locales
GET = fetch_json


# ---------------------------------------------------------------- utilidades
def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, obj, one_per_line_key=None):
    """Escribe JSON compacto. Con one_per_line_key, deja un elemento por línea
    (diffs de git pequeños y legibles)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    if one_per_line_key and isinstance(obj.get(one_per_line_key), (list, dict)):
        head = {k: v for k, v in obj.items() if k != one_per_line_key}
        items = obj[one_per_line_key]
        if isinstance(items, dict):
            body = ",\n".join(f"{dump(k)}:{dump(v)}" for k, v in items.items())
            inner = "{\n" + body + "\n}"
        else:
            inner = "[\n" + ",\n".join(dump(x) for x in items) + "\n]"
        txt = dump(head)[:-1] + ("," if head else "") + f'"{one_per_line_key}":' + inner + "}\n"
    else:
        txt = dump(obj) + "\n"
    path.write_text(txt, encoding="utf-8")


def to_int(v, default=0):
    try:
        return int(str(v).replace("+", ""))
    except (TypeError, ValueError):
        return default


def split_made(v):
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(v or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def parse_iso(s):
    s = s.replace("Z", "+00:00")
    if re.search(r"T\d\d:\d\d\+", s):  # ESPN a veces omite los segundos
        s = s.replace("+", ":00+", 1)
    return datetime.fromisoformat(s)


def et_day(iso):
    return parse_iso(iso).astimezone(ET).date().isoformat()


def athlete_id_from_links(athlete):
    for src in [athlete.get("id")] + [l.get("href", "") for l in athlete.get("links", [])] + \
               [(athlete.get("headshot") or {}).get("href", "")]:
        if not src:
            continue
        if str(src).isdigit():
            return str(src)
        m = re.search(r"/id/(\d+)|/full/(\d+)\.png", str(src))
        if m:
            return m.group(1) or m.group(2)
    return None


# ---------------------------------------------------------------- parseo ESPN
STAT_MAP = {
    "minutes": "min", "points": "pts", "rebounds": "reb", "assists": "ast",
    "turnovers": "tov", "steals": "stl", "blocks": "blk", "offensiveRebounds": "oreb",
    "defensiveRebounds": "dreb", "fouls": "pf", "plusMinus": "pm",
}
PAIR_MAP = {
    "fieldGoalsMade-fieldGoalsAttempted": ("fgm", "fga"),
    "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("tpm", "tpa"),
    "freeThrowsMade-freeThrowsAttempted": ("ft_m", "ft_a"),
}


def parse_event(ev):
    comp = (ev.get("competitions") or [{}])[0]
    out = {
        "id": str(ev["id"]),
        "date": ev["date"],
        "completed": bool(((ev.get("status") or {}).get("type") or {}).get("completed")),
        "season_type": (ev.get("season") or {}).get("type"),
        "venue": (comp.get("venue") or {}).get("fullName", ""),
    }
    for c in comp.get("competitors", []):
        side = c.get("homeAway")
        if side in ("home", "away"):
            out[side] = team_abbr(c.get("team") or {})
            out["hs" if side == "home" else "as"] = to_int(c.get("score"), None)
    return out


def parse_boxscore(summary):
    """Devuelve las líneas de cada jugador del box score."""
    lines = []
    for block in (summary.get("boxscore") or {}).get("players", []):
        team = team_abbr(block.get("team") or {})
        for st in block.get("statistics", []):
            keys = st.get("keys") or []
            for a in st.get("athletes", []):
                ath = a.get("athlete") or {}
                base = {
                    "id": str(ath.get("id")),
                    "name": ath.get("displayName"),
                    "num": ath.get("jersey"),
                    "pos": (ath.get("position") or {}).get("abbreviation"),
                    "team": team,
                }
                stats = a.get("stats") or []
                if a.get("didNotPlay") or not stats:
                    base["dnp"] = a.get("reason") or "DNP"
                    lines.append(base)
                    continue
                line = dict(base, starter=bool(a.get("starter")))
                for k, v in zip(keys, stats):
                    if k in STAT_MAP:
                        line[STAT_MAP[k]] = to_int(v)
                    elif k in PAIR_MAP:
                        m, t = split_made(v)
                        line[PAIR_MAP[k][0]], line[PAIR_MAP[k][1]] = m, t
                lines.append(line)
    return lines


def parse_roster(roster, team):
    players = []
    for a in roster.get("athletes", []):
        # algunas respuestas agrupan por posición: {"items": [...]}
        group = a.get("items") if isinstance(a, dict) and "items" in a else [a]
        for p in group:
            pos = p.get("position") or {}
            salary = (p.get("contract") or {}).get("salary")
            players.append({
                "id": str(p.get("id")),
                "name": p.get("displayName") or p.get("fullName"),
                "team": team,
                "num": p.get("jersey"),
                "bio": {
                    "pos": pos.get("abbreviation"),
                    "pos_name": pos.get("displayName"),
                    "height_in": p.get("height"),
                    "weight_lb": p.get("weight"),
                    "age": p.get("age"),
                    "born": (p.get("dateOfBirth") or "")[:10] or None,
                    "salary": salary,
                    "exp": (p.get("experience") or {}).get("years"),
                },
                "roster_injury": ((p.get("injuries") or [{}])[0] or {}).get("status"),
            })
    return players


def parse_injuries(payload):
    """Formato heredado de la web anterior, con datos extra."""
    out = {}
    for team_block in payload.get("injuries", []):
        for i in team_block.get("injuries", []):
            ath = i.get("athlete") or {}
            name = ath.get("displayName")
            if not name:
                continue
            status_txt = i.get("status") or (i.get("type") or {}).get("description") or ""
            details = i.get("details") or {}
            ret = details.get("returnDate")
            desc = ""
            if ret:
                try:
                    desc = date.fromisoformat(ret[:10]).strftime("%b %-d") if sys.platform != "win32" \
                        else date.fromisoformat(ret[:10]).strftime("%b %#d")
                except ValueError:
                    desc = ret
            out[name] = {
                "id": athlete_id_from_links(ath),
                "team": team_abbr(ath.get("team") or {}) or None,
                "status": "red" if status_txt.lower() in RED_STATUSES else "yellow",
                "type": status_txt,                 # Out, Day-To-Day, ...
                "description": desc or status_txt,  # como antes: fecha estimada de regreso
                "injury": details.get("type"),
                "return": ret,
                "comment": i.get("shortComment"),
                "date": i.get("date"),
            }
    return out


# ---------------------------------------------------------------- fixture
def update_fixture(fixture, ev):
    """Pone el resultado (y los equipos, si eran 'por definir') en el calendario."""
    if not ev.get("home") or not ev.get("away"):
        return False
    t = parse_iso(ev["date"])
    best = None
    for g in fixture["games"]:
        diff = abs((parse_iso(g["date"]) - t).total_seconds())
        if g["home"] == ev["home"] and g["away"] == ev["away"] and diff < 20 * 3600:
            best = g
            break
    if best is None:  # partidos de Copa NBA anunciados después ("TBD")
        cands = [g for g in fixture["games"] if "TBD" in (g["home"], g["away"])
                 and abs((parse_iso(g["date"]) - t).total_seconds()) < 3600]
        if len(cands) == 1:
            best = cands[0]
            best["home"], best["away"] = ev["home"], ev["away"]
            if ev.get("venue"):
                best["venue"] = ev["venue"]
    if best is None:
        return False
    best["espn_id"] = ev["id"]
    if ev["completed"] and ev.get("hs") is not None:
        best["hs"], best["as"] = ev["hs"], ev["as"]
    return True


# ---------------------------------------------------------------- jugadores
def double_flags(line):
    tens = sum(1 for k in ("pts", "reb", "ast", "stl", "blk") if line.get(k, 0) >= 10)
    return int(tens >= 2), int(tens >= 3)


def build_game_logs(events):
    logs = {}
    for ev in sorted(events.values(), key=lambda e: e["date"]):
        if ev.get("hs") is None:
            continue
        for ln in ev.get("lines", []):
            if "dnp" in ln:
                continue
            home = ln["team"] == ev["home"]
            own, opp = (ev["hs"], ev["as"]) if home else (ev["as"], ev["hs"])
            dd2, dd3 = double_flags(ln)
            g = {
                "date": et_day(ev["date"]),
                "game_id": ev["id"],
                "team": ln["team"],
                "opponent": ev["away"] if home else ev["home"],
                "home": home,
                "result": "W" if own > opp else "L",
                "margin": own - opp,
                "starter": ln.get("starter", False),
            }
            for k in ("min", "pts", "reb", "ast", "stl", "blk", "tov", "tpm", "tpa",
                      "fgm", "fga", "ft_m", "ft_a", "oreb", "dreb", "pf", "pm"):
                g[k] = ln.get(k, 0)
            g["dd2"], g["dd3"] = dd2, dd3
            logs.setdefault(ln["id"], {"meta": ln, "games": []})["games"].append(g)
            logs[ln["id"]]["meta"] = ln  # nos quedamos con el dato más reciente
    for v in logs.values():
        v["games"].reverse()  # más reciente primero, como en la web anterior
    return logs


def season_averages(games):
    played = [g for g in games if g["min"] > 0]
    n = len(played)
    avg = lambda k: round(sum(g[k] for g in played) / n, 1) if n else 0.0
    return {
        "gp": n, "min": avg("min"), "pts": avg("pts"), "reb": avg("reb"), "ast": avg("ast"),
        "tpm": avg("tpm"), "stl": avg("stl"), "blk": avg("blk"), "tov": avg("tov"),
        "dd2": sum(g["dd2"] for g in played), "td3": sum(g["dd3"] for g in played),
    }


# ---------------------------------------------------------------- principal
def main():
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    today_et = now.astimezone(ET).date()

    fixture = read_json(DATA / "fixture.json", None)
    if not fixture:
        sys.exit("Falta data/fixture.json (créalo con scripts/build_fixture.py)")
    cache = read_json(DATA / "cache" / "boxscores.json", {"last_scan": None, "events": {}})
    events = cache["events"]

    # 1) Resultados y box scores: desde el último día revisado (menos 2 por seguridad)
    start = SEASON_START
    if cache.get("last_scan"):
        start = max(SEASON_START, date.fromisoformat(cache["last_scan"]) - timedelta(days=2))
    day, new_box, matched = start, 0, 0
    print(f"Revisando partidos del {start} al {today_et}…")
    while day <= today_et:
        sb = GET(f"{ESPN}/scoreboard?dates={day.strftime('%Y%m%d')}")
        for raw in sb.get("events", []):
            ev = parse_event(raw)
            if ev.get("season_type") not in (2, 6, None):  # 2 = temporada regular, 6 = Copa NBA
                continue
            matched += update_fixture(fixture, ev)
            if ev["completed"] and (ev["id"] not in events or not events[ev["id"]].get("lines")):
                summary = GET(f"{ESPN}/summary?event={ev['id']}")
                ev["lines"] = parse_boxscore(summary)
                ev.pop("completed", None)
                ev.pop("season_type", None)
                events[ev["id"]] = ev
                new_box += 1
                time.sleep(0.15)
        day += timedelta(days=1)
        time.sleep(0.1)
    cache["last_scan"] = today_et.isoformat()
    print(f"  {new_box} box scores nuevos · {len(events)} en total · {matched} partidos cruzados con el calendario")

    # 2) Plantillas actuales
    rosters = {}
    for tid, abbr in ESPN_TEAMS.items():
        rosters[abbr] = parse_roster(GET(f"{ESPN}/teams/{tid}/roster"), abbr)
        time.sleep(0.1)
    print(f"  plantillas: {sum(len(v) for v in rosters.values())} jugadores")

    # 3) Lesionados
    injuries = parse_injuries(GET(f"{ESPN}/injuries"))
    # si la plantilla marca a alguien como lesionado y no está en el reporte, lo sumamos
    for plist in rosters.values():
        for p in plist:
            st = p.get("roster_injury")
            if st and p["name"] not in injuries:
                injuries[p["name"]] = {
                    "id": p["id"], "team": p["team"],
                    "status": "red" if st.lower() in RED_STATUSES else "yellow",
                    "type": st, "description": st, "injury": None, "return": None,
                    "comment": None, "date": None,
                }
    print(f"  lesionados: {len(injuries)}")

    # 4) Un archivo por equipo con bio, promedios y partidos de la temporada
    logs = build_game_logs(events)
    for abbr, plist in rosters.items():
        players = []
        for p in plist:
            games = logs.get(p["id"], {}).get("games", [])
            p = dict(p)
            p.pop("roster_injury", None)
            p["season_averages"] = season_averages(games)
            p["games"] = games
            players.append(p)
        players.sort(key=lambda x: (-x["season_averages"]["min"], x["name"] or ""))
        write_json(DATA / "players" / f"{abbr}.json",
                   {"team": abbr, "updated": stamp, "players": players}, one_per_line_key="players")

    fixture["updated"] = stamp
    write_json(DATA / "fixture.json", fixture, one_per_line_key="games")
    write_json(DATA / "injuries.json", injuries)
    write_json(DATA / "cache" / "boxscores.json", cache, one_per_line_key="events")
    played = sum(1 for g in fixture["games"] if g.get("hs") is not None)
    write_json(DATA / "meta.json", {
        "updated": stamp, "season": fixture.get("season"), "games_played": played,
        "boxscores": len(events), "injured": len(injuries),
    })
    print(f"Listo · {played} partidos con resultado · {stamp}")


if __name__ == "__main__":
    main()
