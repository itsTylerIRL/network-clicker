"""The network is growing: saves kept on the account, and the leaderboards.

Loaded by the cancel game's service (server.py), which already does sign-in with RemiliaNET and Urbit ID: the
same signed session works here, so a player is the same person in both games. Routes, all under /api/net/:

  GET  /api/net/health     which sign-ins are on offer
  POST /api/net/load       {session}                 -> the account's save, and its revision
  POST /api/net/save       {session, rev, gz|json}   -> the new revision, or 409 (another device saved since: here's
                                                         theirs) or 422 (that doesn't add up: here's the last good one)
  GET  /api/net/board      ?b=fastest|grass|network|online|uptime [&limit=] [&player=]
  GET  /api/net/summary    ?player=                  -> a few numbers about the account's network, and who they play as, for the cancel game's card
  GET  /api/net/recent     [?limit=]                 -> what's happened lately: runs finished, challenges beaten, the new internet turned on, epochs
  GET  /api/net/profile    ?h=handle                 -> a player's card: their network, where they stand on every board, their last runs

The game runs in the browser, so a save can't be proven. Each one is held against the last one this service
accepted: time played can't grow faster than time passes, counters only go up, a run has to take a plausible
while and make plausible grass, and grass can't be spent that wasn't earned. The boards only count what happened
while the account was syncing, so a save edited before it was linked can't put anything on them.
"""
import base64, json, math, os, time, zlib

H = {}  # the host service's helpers: db, read_session, verified_player, rate_ok, clean_text, rn_on, ur_on

MAX_RAW = 400_000          # a request body, as sent (a gzipped save is far smaller; plain JSON is the fallback)
MAX_SAVE = 2_000_000       # a save, unpacked
GRACE = 600                # seconds of slack for clocks that disagree a little
CLOCK_SLACK = 3600         # one sync may run ahead of the clock by this much (a device whose clock is off), but no more
TOTAL_SLACK = 1800         # and since the account was linked, time played never gets further ahead than this
CLICKS_PER_SEC = 30
RUN_MIN = 60               # no run reaches the infinite garden in under a minute
GRASS_PER_MIN = 60         # the most grass a run can plausibly make per minute of it, after a fixed allowance
GRASS_FREE = 200
STAGES_PER_10MIN = 1       # stages of the new internet, at most, per ten minutes between syncs (plus one)
EPOCHS_PER_10MIN = 10      # and epochs past the ending (each asks for half again the last, so a quick one is a cheap one)
PERK_COST = {}             # perk id -> grass, from net_spec.json
CHALLENGE_IDS = set()      # each challenge has a board of its own (ch_<id>), from net_spec.json too
RECENT_KEEP = 300          # the feed keeps this many things that happened

BOARDS = {  # id: (lower is better?, what the value is)
    "fastest": (True, "seconds"),   # the quickest run to the garden (challenges don't count: their rules are bent)
    "grass":   (False, "grass"),    # grass earned while synced
    "network": (False, "miladys"),  # the most miladys at once in a run
    "online":  (True, "when"),      # who turned the new internet on first
    "uptime":  (False, "epochs"),   # how far past the ending the new internet has grown
}


def board_kind(b):
    """(lower is better?, what the value is) for a board, or None. Each challenge's board is its fastest clear."""
    if b in BOARDS:
        return BOARDS[b]
    if b.startswith("ch_") and b[3:] in CHALLENGE_IDS:
        return (True, "seconds")
    return None

SCHEMA = """
CREATE TABLE IF NOT EXISTS net_saves (
  player TEXT PRIMARY KEY, handle TEXT NOT NULL, data BLOB NOT NULL, rev INTEGER NOT NULL,
  saved INTEGER NOT NULL, linked INTEGER NOT NULL, linked_n INTEGER NOT NULL DEFAULT 0, linked_played REAL NOT NULL DEFAULT 0,
  grass_total REAL NOT NULL DEFAULT 0, linked_e INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS net_board (
  board TEXT NOT NULL, player TEXT NOT NULL, handle TEXT NOT NULL, value REAL NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY(board, player)
);
CREATE INDEX IF NOT EXISTS net_board_rank ON net_board(board, value, at);
CREATE TABLE IF NOT EXISTS net_recent (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, handle TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL
);
"""


def setup(helpers):
    H.update(helpers)
    try:  # what each perk costs, from the game's own data (build.py writes it)
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "net_spec.json"), encoding="utf8") as f:
            spec = json.load(f)
            PERK_COST.update(spec["perks"])
            CHALLENGE_IDS.update(spec.get("challenges", []))
    except (OSError, ValueError, KeyError):
        print("network_api: no net_spec.json, so grass spent on perks isn't checked", flush=True)
    with H["db"]() as con:
        con.executescript(SCHEMA)
        if "linked_e" not in [r[1] for r in con.execute("PRAGMA table_info(net_saves)")]:  # epochs came later: nobody had any yet
            con.execute("ALTER TABLE net_saves ADD COLUMN linked_e INTEGER NOT NULL DEFAULT 0")


class Refused(Exception):
    pass


# ---------- reading a save ----------

def num(v, lo=0.0, hi=1e300):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise Refused("a number is out of shape")
    return v


def unpack(d):
    """The save from a request: gzipped and base64'd ("gz"), or plain JSON ("json") for a browser that can't gzip."""
    if isinstance(d.get("gz"), str):
        try:
            raw = base64.b64decode(d["gz"], validate=True)
            z = zlib.decompressobj(31)
            text = z.decompress(raw, MAX_SAVE)
            if z.unconsumed_tail:
                raise Refused("too big")
            s = json.loads(text)
        except (ValueError, zlib.error):
            raise Refused("didn't unpack")
    else:
        s = d.get("json")
    if not isinstance(s, dict):
        raise Refused("not a save")
    return s


def pack(s):
    return zlib.compress(json.dumps(s, separators=(",", ":")).encode(), 9)


def unpack_stored(blob):
    return json.loads(zlib.decompress(blob))


def to_b64_gzip(blob):
    """What's stored is zlib; the game reads gzip. Re-wrap it."""
    s = zlib.decompress(blob)
    c = zlib.compressobj(9, zlib.DEFLATED, 31)
    return base64.b64encode(c.compress(s) + c.flush()).decode()


def shape(s):
    """Enough of the shape to reason about. Anything the checks read is checked here first."""
    for k in ("res", "stats", "perks", "relics", "ach", "run", "nn"):
        if not isinstance(s.get(k), dict):
            raise Refused("missing " + k)
    for k in ("miladys", "history"):
        if not isinstance(s.get(k), list):
            raise Refused("missing " + k)
    if len(s["miladys"]) > 5000 or len(s["history"]) > 60:
        raise Refused("too many")
    for v in s["res"].values():
        num(v, -1e-6, 1e60)
    st = s["stats"]
    for k in ("played", "clicks", "resets", "cycles"):
        num(st.get(k, 0), 0, 1e15)
    num(s.get("runT", 0), 0, 1e12)
    num(s.get("grass", 0), 0, 1e15)
    num(s.get("nextId", 1), 0, 1e12)
    num(s["nn"].get("i", 0), 0, 7)
    num(s["nn"].get("e", 0), 0, 1e6)
    for r in s["history"]:
        if not isinstance(r, dict):
            raise Refused("a run is out of shape")
        num(r.get("t", 0), 0, 1e12); num(r.get("grass", 0), 0, 1e15); num(r.get("peak", 0), 0, 1e6); num(r.get("end", 0), 0, 1e14)
        num(r.get("cycles", 0), 0, 1e9)
    for v in s["relics"].values():
        num(v, 0, 99)
    return s


def g(s, *path, default=0):
    for p in path:
        s = s.get(p) if isinstance(s, dict) else None
    return default if s is None else s


# ---------- does it add up? ----------

def new_runs(prev_resets, s):
    """Runs finished since: told apart by their number (resets so far, plus one), never by a device's clock."""
    return sorted([r for r in s["history"] if g(r, "n") > prev_resets], key=lambda r: g(r, "n"))


def check(prev, cur, dt, since_link, linked_played):
    """cur, held against prev (the last accepted save), dt (seconds since it was accepted) and since_link (seconds since
    the account's first save, when it had linked_played played). Time played is held to the clock over the whole life
    of the account, so a device whose clock is a few minutes out is absorbed once and not refused over and over."""
    P, N = prev["stats"], cur["stats"]
    grace = GRACE + dt * 0.05
    played = g(N, "played") - g(P, "played")
    if played < -1:
        raise Refused("time played went backwards")
    if played > dt + CLOCK_SLACK or g(N, "played") - linked_played > since_link + TOTAL_SLACK:
        raise Refused("more time played than has passed")
    for k in ("clicks", "resets", "cycles", "sparkles", "rituals", "raids"):
        if g(N, k) < g(P, k):
            raise Refused(k + " went down")
    if g(cur, "nextId", default=1) < g(prev, "nextId", default=1):
        raise Refused("miladys went backwards")
    if g(N, "clicks") - g(P, "clicks") > dt * CLICKS_PER_SEC + 200:
        raise Refused("posted faster than anyone can")
    if not set(prev["perks"]) <= set(k for k, v in cur["perks"].items() if v):
        raise Refused("a perk went away")
    if not set(prev["ach"]) <= set(cur["ach"]):
        raise Refused("an achievement went away")
    for k, v in prev["relics"].items():
        if g(cur["relics"], k) < v:
            raise Refused("a relic lost a level")
    if g(cur, "nn", "i") < g(prev, "nn", "i"):
        raise Refused("the new internet went backwards")
    if g(cur, "nn", "i") - g(prev, "nn", "i") > 1 + STAGES_PER_10MIN * dt / 600:
        raise Refused("the new internet went up too fast")
    if prev.get("ended") and cur.get("ended") != prev.get("ended"):
        raise Refused("the ending changed")
    if g(cur, "nn", "e") < g(prev, "nn", "e"):
        raise Refused("the new internet went backwards")
    if g(cur, "nn", "e") and not cur.get("ended"):
        raise Refused("epochs before the ending")
    if g(cur, "nn", "e") - g(prev, "nn", "e") > 1 + EPOCHS_PER_10MIN * dt / 600:
        raise Refused("the new internet went up too fast")
    runs = new_runs(g(P, "resets"), cur)
    resets = g(N, "resets") - g(P, "resets")
    if len(runs) != resets:
        raise Refused("runs and resets don't match")
    # every run that ended since, and the one going now, fit inside the time played (plus what the last run already had)
    if sum(g(r, "t") for r in runs) + (g(cur, "runT") if resets else g(cur, "runT") - g(prev, "runT")) > played + (g(prev, "runT") if resets else 0) + grace:
        raise Refused("runs took longer than was played")
    earned = 0
    for r in runs:
        if g(r, "t") < RUN_MIN:
            raise Refused("a run was too quick")
        if g(r, "grass") > GRASS_FREE + GRASS_PER_MIN * g(r, "t") / 60:
            raise Refused("a run made too much grass")
        earned += g(r, "grass")
    spent = sum(PERK_COST.get(k, 0) for k, v in cur["perks"].items() if v and k not in prev["perks"])
    if g(cur, "grass") + spent > g(prev, "grass") + earned + 1:
        raise Refused("grass from nowhere")
    return runs, earned


def check_first(s, now):
    """A save the account has never had. It can't be checked against anything, so it's only held to the possible;
    nothing in it counts on a board."""
    played = g(s, "stats", "played")
    born = g(s, "born", default=now * 1000) / 1000
    if born > now + GRACE or played > max(0, now - born) + GRACE * 4:
        raise Refused("more time played than there's been")
    if g(s, "grass") > 100 + 2000 * played / 3600:
        raise Refused("more grass than there's been time for")
    if g(s, "stats", "clicks") > played * CLICKS_PER_SEC + 1000:
        raise Refused("posted faster than anyone can")


# ---------- the boards ----------

def put_board(con, board, player, handle, value, detail, now):
    lower, _ = board_kind(board)
    better = "excluded.value < net_board.value" if lower else "excluded.value > net_board.value"
    con.execute("""INSERT INTO net_board (board, player, handle, value, detail, at) VALUES (?,?,?,?,?,?)
                   ON CONFLICT(board, player) DO UPDATE SET value=excluded.value, detail=excluded.detail, at=excluded.at, handle=excluded.handle
                   WHERE """ + better, (board, player, handle, value, json.dumps(detail, separators=(",", ":")), now))


def put_recent(con, player, handle, kind, detail, now):
    con.execute("INSERT INTO net_recent (player, handle, kind, detail, at) VALUES (?,?,?,?,?)", (player, handle, kind, json.dumps(detail, separators=(",", ":")), now))
    con.execute("DELETE FROM net_recent WHERE id <= (SELECT MAX(id) FROM net_recent) - ?", (RECENT_KEEP,))


def score_boards(con, player, handle, prev, cur, runs, earned, linked_n, grass_total, now, linked_e=0):
    for r in runs:
        if g(r, "n") <= linked_n + 1:  # begun before the account was syncing (the run going when it was linked): it can't be vouched for
            continue
        detail = {"n": g(r, "n"), "cycles": g(r, "cycles"), "peak": g(r, "peak"), "grass": g(r, "grass")}
        ch = r.get("challenge") if r.get("challenge") in CHALLENGE_IDS else None
        if not r.get("challenge"):
            put_board(con, "fastest", player, handle, round(g(r, "t"), 1), detail, now)
        elif ch and r.get("beaten"):
            put_board(con, "ch_" + ch, player, handle, round(g(r, "t"), 1), detail, now)
        put_board(con, "network", player, handle, g(r, "peak"), detail, now)
        put_recent(con, player, handle, "run", dict(detail, t=round(g(r, "t"), 1), ch=ch, beaten=bool(ch and r.get("beaten"))), now)
    if earned:
        put_board(con, "grass", player, handle, grass_total, {"runs": g(cur, "stats", "resets")}, now)
    if cur.get("ended") and prev is not None and not prev.get("ended"):  # turned on while syncing
        born = g(cur, "born", default=now * 1000) / 1000
        put_board(con, "online", player, handle, now, {"days": max(1, round((now - born) / 86400)), "runs": g(cur, "stats", "resets") + 1}, now)
        put_recent(con, player, handle, "online", {"days": max(1, round((now - born) / 86400))}, now)
    if prev is not None and g(cur, "nn", "e") > g(prev, "nn", "e"):  # only the epochs grown while syncing count
        put_board(con, "uptime", player, handle, g(cur, "nn", "e") - linked_e, {"e": g(cur, "nn", "e"), "days": max(1, round((now - g(cur, "ended") / 1000) / 86400))}, now)
        put_recent(con, player, handle, "epoch", {"e": g(cur, "nn", "e")}, now)


def ranks(con, player):
    out = {}
    for row in con.execute("SELECT board, value, at FROM net_board WHERE player=?", (player,)).fetchall():
        b, k = row["board"], board_kind(row["board"])
        if not k:
            continue
        op = "<" if k[0] else ">"
        ahead = con.execute("SELECT COUNT(*) FROM net_board WHERE board=? AND (value " + op + " ? OR (value = ? AND at < ?))",
                            (b, row["value"], row["value"], row["at"])).fetchone()[0]
        out[b] = {"rank": ahead + 1, "value": row["value"]}
    return out


LOOKS = {}  # player -> (rev, look): a save is only unpacked again when it changes


def look_of(con, player):
    row = con.execute("SELECT data, rev FROM net_saves WHERE player=?", (player,)).fetchone()
    if not row:
        return None
    hit = LOOKS.get(player)
    if not hit or hit[0] != row["rev"]:
        hit = LOOKS[player] = (row["rev"], look(unpack_stored(row["data"])))
    return hit[1]


def board(b, limit, player):
    lower, _ = board_kind(b)
    order = " ORDER BY value " + ("ASC" if lower else "DESC") + ", at ASC"
    with H["db"]() as con:
        rows = con.execute("SELECT player, handle, value, detail, at FROM net_board WHERE board=?" + order + " LIMIT ?", (b, limit)).fetchall()
        total = con.execute("SELECT COUNT(*) FROM net_board WHERE board=?", (b,)).fetchone()[0]
        me = ranks(con, player).get(b) if player else None
        if me:  # where they stand: their face, and what the one just ahead of them has
            me["look"] = look_of(con, player)
            if me["rank"] > 1:
                ahead = con.execute("SELECT value FROM net_board WHERE board=?" + order + " LIMIT 1 OFFSET ?", (b, me["rank"] - 2)).fetchone()
                me["ahead"] = ahead["value"] if ahead else None
        out = [{"rank": i + 1, "handle": r["handle"], "value": r["value"], "detail": json.loads(r["detail"]), "at": r["at"],
                "me": r["player"] == player, "look": look_of(con, r["player"])} for i, r in enumerate(rows)]
    return {"board": b, "total": total, "me": me, "rows": out}


def summary(player):
    """What the cancel game shows on a player's card: how big the network is, and how far along. Nothing a board doesn't."""
    with H["db"]() as con:
        row = con.execute("SELECT data, saved FROM net_saves WHERE player=?", (player,)).fetchone()
        r = ranks(con, player)
    if not row:
        return {"ok": True, "started": False}
    s = unpack_stored(row["data"])
    return {"ok": True, "started": True, "saved": row["saved"], "miladys": len(s.get("miladys") or []),
            "runs": int(g(s, "stats", "resets")), "stage": int(g(s, "nn", "i")), "online": bool(s.get("ended")),
            "played": round(g(s, "stats", "played")), "look": look(s), "ranks": r}


def recent(limit):
    with H["db"]() as con:
        rows = con.execute("SELECT player, handle, kind, detail, at FROM net_recent ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return {"rows": [{"handle": r["handle"], "kind": r["kind"], "detail": json.loads(r["detail"]), "at": r["at"], "look": look_of(con, r["player"])} for r in rows]}


def profile(handle):
    """A player's card, by the name they show: nothing a board or the summary doesn't already show, plus their last runs."""
    with H["db"]() as con:
        row = con.execute("SELECT player, data, saved, grass_total FROM net_saves WHERE handle=? ORDER BY saved DESC LIMIT 1", (handle,)).fetchone()
        if not row:
            return None
        r = ranks(con, row["player"])
        totals = {b: con.execute("SELECT COUNT(*) FROM net_board WHERE board=?", (b,)).fetchone()[0] for b in r}
    s = unpack_stored(row["data"])
    runs = [{k: x.get(k) for k in ("n", "t", "peak", "cycles", "grass", "challenge", "beaten", "end")} for x in s["history"][-8:]][::-1]
    return {"ok": True, "handle": handle, "look": look(s), "saved": row["saved"], "born": g(s, "born"),
            "miladys": len(s.get("miladys") or []), "runs": int(g(s, "stats", "resets")), "played": round(g(s, "stats", "played")),
            "stage": int(g(s, "nn", "i")), "epochs": int(g(s, "nn", "e")), "online": g(s, "ended") or None,
            "grass": round(row["grass_total"]), "ach": len(s.get("ach") or {}), "relics": {k: v for k, v in s["relics"].items() if v},
            "wonder": int(g(s, "wonder")), "challenges": sorted(k for k, v in (s.get("chDone") or {}).items() if v),
            "ranks": {b: dict(v, total=totals[b]) for b, v in r.items()}, "last": runs}


def look(s):
    """Who they play as there, as the cancel game reads a character: the collection, its trait layers and eye color."""
    you, who = s.get("you"), s.get("who") if isinstance(s.get("who"), dict) else {}
    if not isinstance(you, dict) or not you:
        return None
    layers = {k: v for k, v in you.items() if isinstance(k, str) and isinstance(v, str) and len(k) <= 40 and len(v) <= 80 and not k.startswith("_")}
    return {"cfg": "Remilio" if who.get("kind") == "remilio" else "Milady", "layers": dict(list(layers.items())[:20]),
            "eye": who.get("eye") if isinstance(who.get("eye"), str) else ""}


# ---------- the routes ----------

def body(h, limit):
    try:
        length = int(h.headers.get("Content-Length") or 0)
        return json.loads(h.rfile.read(length)) if 0 < length <= limit else None
    except (ValueError, UnicodeDecodeError):
        return None


def who(h, d):
    handle = H["read_session"](d.get("session")) if isinstance(d, dict) else None
    return (handle, H["verified_player"](handle)) if handle else (None, None)


def load_post(h):
    d = body(h, 4000)
    handle, player = who(h, d)
    if not handle:
        return h.send(401, {"error": "sign in first"})
    if not H["rate_ok"]("netload:" + h.client_key(), 240):
        return h.send(429, {"error": "slow down"})
    with H["db"]() as con:
        row = con.execute("SELECT data, rev, saved FROM net_saves WHERE player=?", (player,)).fetchone()
        r = ranks(con, player)
    if not row:
        return h.send(200, {"ok": True, "player": player, "rev": 0, "gz": None, "ranks": r})
    h.send(200, {"ok": True, "player": player, "rev": row["rev"], "saved": row["saved"], "gz": to_b64_gzip(row["data"]), "ranks": r})


def save_post(h):
    d = body(h, MAX_RAW)
    if not isinstance(d, dict):
        return h.send(400, {"error": "bad json"})
    handle, player = who(h, d)
    if not handle:
        return h.send(401, {"error": "sign in first"})
    if not H["rate_ok"]("netsave:" + player, 360):
        return h.send(429, {"error": "slow down"})
    try:
        cur = shape(unpack(d))
    except Refused as e:
        return h.send(400, {"error": str(e)})
    code, reply = store(player, handle, cur, d.get("rev"), int(time.time()))
    h.send(code, reply)


def store(player, handle, cur, base, now):
    """Check a save against the last good one and keep it. Returns (status, reply)."""
    with H["db"]() as con:
        con.execute("BEGIN IMMEDIATE")  # one save at a time, so two devices can't both win
        row = con.execute("SELECT data, rev, saved, linked, linked_n, linked_played, grass_total, linked_e FROM net_saves WHERE player=?", (player,)).fetchone()
        if row and base != row["rev"]:
            return 409, {"error": "saved from somewhere else since", "rev": row["rev"], "gz": to_b64_gzip(row["data"])}
        if not row and base not in (0, None):
            return 409, {"error": "this account has no save", "rev": 0, "gz": None}
        try:
            if row:
                prev = unpack_stored(row["data"])
                runs, earned = check(prev, cur, max(0, now - row["saved"]), max(0, now - row["linked"]), row["linked_played"])
            else:
                prev, runs, earned = None, [], 0
                check_first(cur, now)
        except Refused as e:
            print("net save refused for %s: %s" % (player[:8], e), flush=True)
            return 422, {"error": str(e), "rev": row["rev"] if row else 0, "gz": to_b64_gzip(row["data"]) if row else None}
        linked = row["linked"] if row else now
        linked_n = row["linked_n"] if row else int(g(cur, "stats", "resets"))
        linked_played = row["linked_played"] if row else g(cur, "stats", "played")
        grass_total = (row["grass_total"] if row else 0) + earned
        linked_e = row["linked_e"] if row else int(g(cur, "nn", "e"))
        rev = (row["rev"] if row else 0) + 1
        con.execute("""INSERT INTO net_saves (player, handle, data, rev, saved, linked, linked_n, linked_played, grass_total, linked_e) VALUES (?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(player) DO UPDATE SET handle=excluded.handle, data=excluded.data, rev=excluded.rev, saved=excluded.saved,
                       grass_total=excluded.grass_total""",
                    (player, handle, pack(cur), rev, now, linked, linked_n, linked_played, grass_total, linked_e))
        score_boards(con, player, handle, prev, cur, runs, earned, linked_n, grass_total, now, linked_e)
        return 200, {"ok": True, "rev": rev, "ranks": ranks(con, player), "linked": linked}


def handle_get(h, path, one):
    if path == "/api/net/health":
        return h.send(200, {"ok": True, "rn": H["rn_on"], "ur": H["ur_on"]})
    if path == "/api/net/summary":
        player = one("player")
        if not (player and len(player) <= 32 and player.isalnum()):
            return h.send(400, {"error": "which player?"})
        return h.send(200, summary(player))
    if path == "/api/net/recent":
        try:
            limit = max(1, min(100, int(one("limit") or 40)))
        except ValueError:
            limit = 40
        return h.send(200, recent(limit))
    if path == "/api/net/profile":
        handle = one("h")
        if not (handle and len(handle) <= 64):
            return h.send(400, {"error": "who?"})
        p = profile(handle)
        return h.send(200, p) if p else h.send(404, {"error": "nobody by that name"})
    if path == "/api/net/board":
        b = one("b") or "fastest"
        if not board_kind(b):
            return h.send(400, {"error": "no such board"})
        try:
            limit = max(1, min(100, int(one("limit") or 50)))
        except ValueError:
            limit = 50
        player = one("player")
        return h.send(200, board(b, limit, player if player and len(player) <= 32 and player.isalnum() else None))
    return h.send(404, {"error": "not found"})


def handle_post(h, path):
    if not h.allowed_origin():
        return h.send(403, {"error": "origin not allowed"})
    if path == "/api/net/load":
        return load_post(h)
    if path == "/api/net/save":
        return save_post(h)
    return h.send(404, {"error": "not found"})
