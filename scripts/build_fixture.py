"""
Convierte el calendario Excel (formato fixturedownload: Match Number, Round Number,
Date [UTC, serial Excel], Location, Home Team, Away Team, Result "local - visita")
en data/fixture.json, que es lo que lee la web.

Uso:
    python scripts/build_fixture.py ruta/al/calendario.xlsx [data/fixture.json]

Requiere: pip install openpyxl
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

TEAMS = {
    "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
    "LA Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
    "To be announced": "TBD",
}
EXCEL_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)


def to_utc(value):
    if isinstance(value, datetime):
        dt = value.replace(tzinfo=timezone.utc)
    else:
        dt = EXCEL_EPOCH + timedelta(days=float(value))
    # el Excel trae ruido de punto flotante (…:59.9999): redondeamos al minuto
    dt = (dt + timedelta(seconds=30)).replace(second=0, microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_result(text):
    if not text or "-" not in str(text):
        return None, None
    home, away = (int(x.strip()) for x in str(text).split("-"))
    return home, away


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "data/fixture.json")
    ws = openpyxl.load_workbook(src, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}

    games, unknown = [], set()
    for r in rows[1:]:
        if not r or r[idx["Match Number"]] is None:
            continue
        home_name, away_name = r[idx["Home Team"]], r[idx["Away Team"]]
        for n in (home_name, away_name):
            if n not in TEAMS:
                unknown.add(n)
        hs, as_ = parse_result(r[idx["Result"]])
        games.append({
            "id": int(r[idx["Match Number"]]),
            "round": int(r[idx["Round Number"]]),
            "date": to_utc(r[idx["Date"]]),
            "venue": r[idx["Location"]] or "",
            "home": TEAMS.get(home_name, "TBD"),
            "away": TEAMS.get(away_name, "TBD"),
            "hs": hs,
            "as": as_,
        })
    if unknown:
        print("AVISO: equipos no reconocidos ->", unknown)

    games.sort(key=lambda g: (g["date"], g["id"]))
    payload = {
        "season": "2026-27",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    # un partido por línea: liviano y fácil de ver en los diffs de git
    lines = ",\n".join(json.dumps(g, ensure_ascii=False, separators=(",", ":")) for g in games)
    out.write_text(
        '{"season":"%s","updated":"%s","games":[\n%s\n]}\n'
        % (payload["season"], payload["updated"], lines),
        encoding="utf-8",
    )
    played = sum(1 for g in games if g["hs"] is not None)
    print(f"{len(games)} partidos ({played} con resultado) -> {out}")


if __name__ == "__main__":
    main()
