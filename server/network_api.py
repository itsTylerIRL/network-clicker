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
  POST /api/net/card       {session, kind, n?, b?}   -> a share card of your network (net), a run (run, n), your place on a board (board, b)
                                                         or the ending (online)
  GET  /api/net/card/ID.png                          -> the card's picture, drawn here (net_card.py), never uploaded
  GET  /api/net/s/ID                                 -> its share link: link previews get the card, people are sent to the game
Shared, they're games.tylerirl.com/n/ID and /n/ID.png: a short name of their own that nginx sends here
(nginx-games.conf), so a link in a post doesn't read "cancel-api".

Cards are kept small and few. A card is a few hundred bytes of what it shows, made here from the save and boards this
service already holds (nothing on it comes from the player), and named by a hash of that, so sharing the same thing
twice is the same card. A player keeps their newest CARD_KEEP; past that, and past CARD_DAYS, the oldest go. Pictures
are a cache on disk: drawn the first time they're asked for, at most CARD_FILES of them, the longest unused let go
first and drawn again if their link is ever opened again.

The game runs in the browser, so a save can't be proven. Each one is held against the last one this service
accepted: time played can't grow faster than time passes, counters only go up, a run has to take a plausible
while and make plausible grass, and grass can't be spent that wasn't earned. The boards only count what happened
while the account was syncing, so a save edited before it was linked can't put anything on them.
"""
import base64, hashlib, json, math, os, re, threading, time, zlib
from datetime import datetime, timedelta, timezone

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
CHEESE_PER_HOUR = 3        # cheese patron levels, at most, per hour between syncs (plus one): the badge and $CULT it means are in the other game
try:  # cheese levels are a week's worth, the cancel's week: it turns over as Sunday night ends in New York
    from zoneinfo import ZoneInfo
    WEEK_TZ = ZoneInfo("America/New_York")
except Exception:
    WEEK_TZ = timezone.utc


def cheese_week(at=None):
    """The week a cheese level counts in: the Monday it began on, as the cancel keys its hill (server.py, hill_week)."""
    d = datetime.fromtimestamp(at if at is not None else time.time(), WEEK_TZ).date()
    return (d - timedelta(days=d.weekday())).isoformat()
PERK_COST = {}             # perk id -> grass, from net_spec.json
CHALLENGE_IDS = set()      # each challenge has a board of its own (ch_<id>), from net_spec.json too
RECENT_KEEP = 300          # the feed keeps this many things that happened
CHALLENGE_NAMES = {}       # challenge id -> its name, for cards
ACH_TOTAL = [0]            # how many achievements there are, for cards
CARD_KEEP = 8              # share cards a player keeps: the newest
CARD_DAYS = 90             # and none older than this
CARD_FILES = 1500          # pictures kept on disk at once (about 300 KB each)
CARDS_PER_HOUR = 30        # cards a player can make in an hour
CARD_DIR = os.environ.get("NET_CARDS", os.path.join(os.path.dirname(os.environ.get("CANCEL_DB", "/var/lib/cancel-api/scores.db")), "netcards"))
SHARE = os.environ.get("NET_SHARE", "https://games.tylerirl.com")  # where share links and their pictures live, as the world sees them
SITE = os.environ.get("NET_SITE", "https://clicker.tylerirl.com/")
RE_NETCARD = re.compile(r"^[0-9a-f]{10}$")
BOARD_NAMES = {"fastest": "fastest run", "grass": "most grass", "network": "biggest network", "online": "first online", "uptime": "uptime"}

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
  grass_total REAL NOT NULL DEFAULT 0, linked_e INTEGER NOT NULL DEFAULT 0, cheese INTEGER NOT NULL DEFAULT 0,
  cheese_week TEXT NOT NULL DEFAULT '', beetles INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS net_board (
  board TEXT NOT NULL, player TEXT NOT NULL, handle TEXT NOT NULL, value REAL NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY(board, player)
);
CREATE INDEX IF NOT EXISTS net_board_rank ON net_board(board, value, at);
CREATE TABLE IF NOT EXISTS net_cards (
  id TEXT PRIMARY KEY, player TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS net_cards_player ON net_cards(player, created);
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
            CHALLENGE_NAMES.update(spec.get("challenge_names", {}))
            ACH_TOTAL[0] = spec.get("achievements", 0)
    except (OSError, ValueError, KeyError):
        print("network_api: no net_spec.json, so grass spent on perks isn't checked", flush=True)
    with H["db"]() as con:
        con.executescript(SCHEMA)
        cols = [r[1] for r in con.execute("PRAGMA table_info(net_saves)")]
        if "linked_e" not in cols:  # epochs came later: nobody had any yet
            con.execute("ALTER TABLE net_saves ADD COLUMN linked_e INTEGER NOT NULL DEFAULT 0")
        if "cheese" not in cols:  # and cheese later still
            con.execute("ALTER TABLE net_saves ADD COLUMN cheese INTEGER NOT NULL DEFAULT 0")
        if "beetles" not in cols:  # and then cheese by the week, and beetles for the weeks gone
            con.execute("ALTER TABLE net_saves ADD COLUMN cheese_week TEXT NOT NULL DEFAULT ''")
            con.execute("ALTER TABLE net_saves ADD COLUMN beetles INTEGER NOT NULL DEFAULT 0")


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
    if not isinstance(s.get("garden", {}), dict) or (s.get("t2") is not None and not isinstance(s.get("t2"), dict)):
        raise Refused("missing garden")
    num(g(s, "garden", "away"), 0, 1e15)
    for k in ("uplink", "seedbank"):
        num(g(s, "t2", "b", k), 0, 1e4)
    num(g(s, "t2", "cheeseLv"), 0, 1e5)
    num(g(s, "t2", "beetles"), 0, 1e7)
    wk = g(s, "t2", "cheeseWeek", default="")
    if not isinstance(wk, str) or (wk and not re.match(r"^\d{4}-\d{2}-\d{2}$", wk)):
        raise Refused("a week out of shape")
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

def grass_scale(s):
    """How much more grass a minute a run can fairly make than at the start: the second tier and the epochs past the
    ending speed up the first tier and add to every touch of grass. Read from the save; held to fifty times."""
    t2 = s.get("t2") if isinstance(s.get("t2"), dict) else {}
    b, tech = t2.get("b") or {}, t2.get("tech") or {}
    more = 1 + 0.1 * g(b, "uplink") + (0.5 if tech.get("seedvault") else 0)
    faster = math.sqrt(1 + 0.25 * g(b, "seedbank") + (1 if tech.get("fastlane") else 0))  # grass grows as the root of $CULT
    return min(50, (1 + 0.5 * g(s, "nn", "e")) * more * faster)


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
    # cheese: a week's worth of levels. Within a week they only go up, and not too fast; when the week turns, every
    # level of the last becomes a beetle, exactly, and the levels start again
    pw, cw = g(prev, "t2", "cheeseWeek", default=""), g(cur, "t2", "cheeseWeek", default="")
    lv_p, lv_c, bt_p, bt_c = g(prev, "t2", "cheeseLv"), g(cur, "t2", "cheeseLv"), g(prev, "t2", "beetles"), g(cur, "t2", "beetles")
    if cw and cw > cheese_week(time.time() + CLOCK_SLACK):
        raise Refused("a week that hasn't come")
    if pw and cw != pw:
        if cw < pw:
            raise Refused("the week went backwards")
        if bt_c != bt_p + lv_p:
            raise Refused("beetles don't add up")
        lv_p = 0  # a fresh week: the levels start again
    elif bt_c != bt_p:
        raise Refused("beetles don't add up")
    if lv_c < lv_p:
        raise Refused("cheese went backwards")
    if lv_c - lv_p > 1 + CHEESE_PER_HOUR * dt / 3600:
        raise Refused("cheese given too fast")
    runs = new_runs(g(P, "resets"), cur)
    resets = g(N, "resets") - g(P, "resets")
    # more runs than the history keeps (the gardener, a long while between syncs): the ones it no longer lists still
    # had to fit in the time, and what grass they made is held to the same rate below
    unlisted = resets - len(runs)
    if unlisted < 0 or (unlisted > 0 and len(cur["history"]) < 50):
        raise Refused("runs and resets don't match")
    # every run that ended since, and the one going now, fit inside the time played (plus what the last run already had)
    if sum(g(r, "t") for r in runs) + (g(cur, "runT") if resets else g(cur, "runT") - g(prev, "runT")) > played + (g(prev, "runT") if resets else 0) + grace:
        raise Refused("runs took longer than was played")
    per_min = GRASS_PER_MIN * grass_scale(cur)
    earned = 0
    for r in runs:
        if g(r, "t") < RUN_MIN:
            raise Refused("a run was too quick")
        if g(r, "grass") > GRASS_FREE + per_min * g(r, "t") / 60:
            raise Refused("a run made too much grass")
        earned += g(r, "grass")
    # grass the gardener brought in while the game was closed: at most the same rate, for the time that passed
    away = g(cur, "garden", "away") - g(prev, "garden", "away")
    if away < -1e-6:
        raise Refused("grass went backwards")
    if away > per_min * dt / 60 + 1:
        raise Refused("too much grass while away")
    earned += away
    unseen = (GRASS_FREE * unlisted + per_min * played / 60) if unlisted else 0  # runs the history no longer shows
    spent = sum(PERK_COST.get(k, 0) for k, v in cur["perks"].items() if v and k not in prev["perks"])
    if g(cur, "grass") + spent > g(prev, "grass") + earned + unseen + 1:
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
            "played": round(g(s, "stats", "played")), "look": look(s), "ranks": r,
            **dict(zip(("cheese", "beetles"), cheese_now(int(g(s, "t2", "cheeseLv")), g(s, "t2", "cheeseWeek", default=""), int(g(s, "t2", "beetles")))))}


def cheese_now(lv, week, beetles):
    """(this week's level, beetles) from what a save last said: a level from a week that's over counts for nothing now,
    and is already beetles in all but name (the game turns it over the next time it's opened)."""
    if week and week != cheese_week():
        return 0, beetles + lv
    return lv, beetles


def cheese_of(player):
    """The cheese patron level an account has reached this week, as of its last synced save: the cancel's server holds
    a run's claimed level to this, so a run's badge is never more than the player had given when they played it."""
    with H["db"]() as con:
        row = con.execute("SELECT cheese, cheese_week, beetles FROM net_saves WHERE player=?", (player,)).fetchone()
    return cheese_now(row["cheese"], row["cheese_week"], row["beetles"])[0] if row else 0


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
            **dict(zip(("cheese", "beetles"), cheese_now(int(g(s, "t2", "cheeseLv")), g(s, "t2", "cheeseWeek", default=""), int(g(s, "t2", "beetles"))))),
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


# ---------- share cards ----------

def clock(sec):
    sec = max(0, round(sec))
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    if h >= 48:
        return "%dd %dh" % (h // 24, h % 24)
    return "%dh %dm" % (h, m) if h else "%dm %ds" % (m, s) if m else "%ds" % s


def board_label(b, value, total):
    """A place on a board, as a card shows it."""
    name = BOARD_NAMES.get(b) or CHALLENGE_NAMES.get(b[3:], b[3:])
    if b == "fastest" or b.startswith("ch_"):
        v = clock(value)
    elif b == "online":
        v = time.strftime("%b %-d, %Y", time.gmtime(value)).lower()
    else:
        v = "%s %s" % (format(int(value), ","), {"grass": "grass", "network": "miladys", "uptime": "epochs"}[b])
    return {"board": name, "value": "%s · of %d" % (v, total)}


def card_data(con, player, handle, kind, n, b=None):
    """What a card shows, from what this service holds. None if there's nothing to show (a run it doesn't have,
    an ending that hasn't happened)."""
    row = con.execute("SELECT data FROM net_saves WHERE player=?", (player,)).fetchone()
    if not row:
        return None
    s = unpack_stored(row["data"])
    r = ranks(con, player)
    total = lambda b: con.execute("SELECT COUNT(*) FROM net_board WHERE board=?", (b,)).fetchone()[0]
    chips = lambda bs: [dict(board_label(b, r[b]["value"], total(b)), rank=r[b]["rank"]) for b in sorted(bs, key=lambda b: r[b]["rank"])]
    born = g(s, "born") / 1000
    c = {"kind": kind, "handle": handle, "look": look(s), "miladys": len(s.get("miladys") or []),
         "since": time.strftime("%b %Y", time.gmtime(born)).lower() if born else ""}
    if kind == "net":
        c.update(runs=int(g(s, "stats", "resets")), played=round(g(s, "stats", "played")), ach=len(s.get("ach") or {}), ach_of=ACH_TOTAL[0] or len(s.get("ach") or {}),
                 stage=int(g(s, "nn", "i")), epochs=int(g(s, "nn", "e")), online=bool(s.get("ended")), ranks=chips(r))
    elif kind == "run":
        run = next((x for x in s["history"] if isinstance(x, dict) and g(x, "n") == n), None)
        if not run:
            return None
        ch = run.get("challenge") if isinstance(run.get("challenge"), str) else None
        c.update(n=n, t=round(g(run, "t")), peak=int(g(run, "peak")), cycles=int(g(run, "cycles")), grass=round(g(run, "grass")),
                 challenge=CHALLENGE_NAMES.get(ch, ch) if ch else None, beaten=bool(ch and run.get("beaten")),
                 # the places this run holds: its time, or its peak, is the one on the board
                 ranks=chips([b for b in r if (b == ("ch_" + ch if ch and run.get("beaten") else "fastest" if not ch else None) and r[b]["value"] == round(g(run, "t"), 1))
                              or (b == "network" and r[b]["value"] == g(run, "peak"))]))
    elif kind == "board":
        # your place on one board, and what set it: the run, for the boards a run sets (its number, cycles and peak
        # were kept with the place), or what the place counts
        row = con.execute("SELECT value, detail FROM net_board WHERE board=? AND player=?", (b, player)).fetchone() if b and board_kind(b) else None
        if not row or b not in r:
            return None
        d = json.loads(row["detail"]) or {}
        lab = board_label(b, row["value"], total(b))
        c.update(b=b, board=lab["board"], rank=r[b]["rank"], total=total(b), value=lab["value"].split(" · ")[0],
                 detail={k: d.get(k) for k in ("n", "cycles", "peak", "grass", "runs", "days", "e") if d.get(k) is not None},
                 ranks=[])  # the place is the headline: no chip repeating it
    elif kind == "online":
        if not s.get("ended"):
            return None
        c.update(days=max(1, round((g(s, "ended") / 1000 - born) / 86400)) if born else 1, runs=int(g(s, "stats", "resets")) + 1,
                 ranks=chips([b for b in r if b in ("online", "uptime")]))
    else:
        return None
    return c


def card_words(c):
    """The share link's title, and the words a post starts with."""
    who = "~" + c["handle"].lstrip("~")
    if c["kind"] == "net":
        top = [x for x in c["ranks"] if x["rank"] <= 3]
        return ("%s's network: %s miladys" % (who, format(c["miladys"], ",")),
                "my network is growing: %s miladys, %s runs%s" % (format(c["miladys"], ","), c["runs"], (", #%d %s" % (top[0]["rank"], top[0]["board"])) if top else ""))
    if c["kind"] == "run":
        what = "beat %s in %s" % (c["challenge"], clock(c["t"])) if c["beaten"] else "touched grass after %s" % clock(c["t"])
        return ("%s %s" % (who, what), "%s with %s miladys at the peak" % (what, format(c["peak"], ",")))
    if c["kind"] == "board":
        return ("%s: #%d %s" % (who, c["rank"], c["board"]), "#%d %s: %s (of %d)" % (c["rank"], c["board"], c["value"], c["total"]))
    return ("%s turned on the new internet" % who, "i turned on the new internet, after %d day%s" % (c["days"], "" if c["days"] == 1 else "s"))


def forget_cards(con, player, now):
    """A player keeps their newest few; nobody keeps any past CARD_DAYS. Their pictures go with them."""
    old = [x[0] for x in con.execute("SELECT id FROM net_cards WHERE player=? ORDER BY created DESC LIMIT -1 OFFSET ?", (player, CARD_KEEP))]
    old += [x[0] for x in con.execute("SELECT id FROM net_cards WHERE created < ?", (now - CARD_DAYS * 86400,))]
    con.executemany("DELETE FROM net_cards WHERE id=?", [(i,) for i in old])
    for cid in old:
        try:
            os.remove(os.path.join(CARD_DIR, cid + ".png"))
        except OSError:
            pass


def card_post(h):
    d = body(h, 4000)
    handle, player = who(h, d)
    if not handle:
        return h.send(401, {"error": "sign in first"})
    kind = d.get("kind")
    n = d.get("n") if isinstance(d.get("n"), int) and not isinstance(d.get("n"), bool) else None
    b = d.get("b") if isinstance(d.get("b"), str) and len(d.get("b")) <= 40 else None
    if kind not in ("net", "run", "online", "board") or (kind == "run" and n is None) or (kind == "board" and not (b and board_kind(b))):
        return h.send(400, {"error": "which card?"})
    if not H["rate_ok"]("netcard:" + player, CARDS_PER_HOUR):
        return h.send(429, {"error": "slow down"})
    now = int(time.time())
    with H["db"]() as con:
        c = card_data(con, player, handle, kind, n, b)
        if not c:
            return h.send(404, {"error": "nothing to put on a card yet"})
        raw = json.dumps(c, separators=(",", ":"), sort_keys=True)
        cid = hashlib.sha256((player + "|" + raw).encode()).hexdigest()[:10]
        con.execute("""INSERT INTO net_cards (id, player, kind, data, created) VALUES (?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET created=excluded.created""", (cid, player, kind, raw, now))
        forget_cards(con, player, now)
    threading.Thread(target=card_png, args=(cid,), daemon=True).start()  # drawn ahead, so it's there when they look
    title, words = card_words(c)
    h.send(200, {"ok": True, "id": cid, "share": SHARE + "/n/" + cid, "image": SHARE + "/n/" + cid + ".png", "title": title, "text": words})


def card_row(cid):
    if not RE_NETCARD.match(cid):
        return None
    with H["db"]() as con:
        r = con.execute("SELECT data FROM net_cards WHERE id=?", (cid,)).fetchone()
    return json.loads(r["data"]) if r else None


_draw = threading.Lock()  # one card at a time: drawing is the heavy thing


def card_png(cid):
    path = os.path.join(CARD_DIR, cid + ".png")
    try:
        with open(path, "rb") as f:
            png = f.read()
        os.utime(path)  # used: the last to be let go
        return png
    except OSError:
        pass
    c = card_row(cid)
    if not c:
        return None
    with _draw:
        if not os.path.exists(path):
            import net_card  # Pillow is only needed here
            png = net_card.render(c, cid)
            os.makedirs(CARD_DIR, exist_ok=True)
            with open(path + ".tmp", "wb") as f:
                f.write(png)
            os.replace(path + ".tmp", path)
            if not card_row(cid):  # let go of while it was being drawn: don't leave its picture behind
                os.remove(path)
                return png
            trim_pictures()
    with open(path, "rb") as f:
        return f.read()


def trim_pictures():
    """At most CARD_FILES pictures on disk: the ones looked at longest ago go (and are drawn again if wanted)."""
    try:
        files = [e for e in os.scandir(CARD_DIR) if e.name.endswith(".png")]
    except OSError:
        return
    if len(files) <= CARD_FILES:
        return
    files.sort(key=lambda e: e.stat().st_mtime)
    for e in files[:len(files) - CARD_FILES]:
        try:
            os.remove(e.path)
        except OSError:
            pass


def share_page(cid, c):
    """What a link preview reads. People are sent on to the game, to this player's card there."""
    title, _ = card_words(c)
    to = SITE + "?p=" + c["handle"]
    img = "%s/n/%s.png" % (SHARE, cid)
    e = lambda v: str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    desc = "the network is growing, a neochibi idle clicker. post. build the network. touch grass."
    return ("<!doctype html><html><head><meta charset='utf-8'><title>{t}</title>"
            "<meta property='og:type' content='website'><meta property='og:title' content=\"{t}\">"
            "<meta property='og:description' content=\"{d}\"><meta property='og:image' content=\"{i}\">"
            "<meta property='og:image:width' content='1200'><meta property='og:image:height' content='630'>"
            "<meta property='og:image:type' content='image/png'><meta property='og:url' content=\"{u}\">"
            "<meta property='og:site_name' content='the network is growing'><meta name='twitter:card' content='summary_large_image'>"
            "<meta name='twitter:title' content=\"{t}\"><meta name='twitter:description' content=\"{d}\"><meta name='twitter:image' content=\"{i}\">"
            "<meta name='theme-color' content='#8be9fd'>"
            # preview robots don't run scripts, so they stay and read the tags; people are sent on
            "<script>location.replace({js})</script><noscript><meta http-equiv='refresh' content=\"0;url={to}\"></noscript></head>"
            "<body style='background:#000;color:#8be9fd;font-family:monospace'><a style='color:#8be9fd' href=\"{to}\">see the network</a></body></html>"
            ).format(t=e(title), d=e(desc), i=e(img), u=e(SHARE + "/n/" + cid), to=e(to), js=json.dumps(to).replace("<", "\\u003c"))


def send_png(h, png):
    h.send_response(200)
    o = h.allowed_origin()
    if o:  # the game fetches it to save it to the player's device
        h.send_header("Access-Control-Allow-Origin", o)
        h.send_header("Vary", "Origin")
    h.send_header("Content-Type", "image/png")
    h.send_header("Cache-Control", "public, max-age=86400")
    h.send_header("Content-Length", str(len(png)))
    h.end_headers()
    h.wfile.write(png)


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
        con.execute("""INSERT INTO net_saves (player, handle, data, rev, saved, linked, linked_n, linked_played, grass_total, linked_e, cheese, cheese_week, beetles)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(player) DO UPDATE SET handle=excluded.handle, data=excluded.data, rev=excluded.rev, saved=excluded.saved,
                       grass_total=excluded.grass_total, cheese=excluded.cheese, cheese_week=excluded.cheese_week, beetles=excluded.beetles""",
                    (player, handle, pack(cur), rev, now, linked, linked_n, linked_played, grass_total, linked_e,
                     int(g(cur, "t2", "cheeseLv")), g(cur, "t2", "cheeseWeek", default="") or "", int(g(cur, "t2", "beetles"))))
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
    if path.startswith("/api/net/card/") and path.endswith(".png"):
        try:
            png = card_png(path[14:-4]) if RE_NETCARD.match(path[14:-4]) else None
        except Exception as e:  # a card that can't be drawn must not take the service down
            print("net card failed: %s %s" % (type(e).__name__, e), flush=True)
            png = None
        return send_png(h, png) if png else h.send(404, {"error": "no such card"})
    if path.startswith("/api/net/s/"):
        c = card_row(path[11:])
        if not c:
            return h.redirect(SITE)  # expired or mistyped: the link still opens the game
        return h.raw(200, "text/html; charset=utf-8", share_page(path[11:], c).encode(), "public, max-age=300")
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
    if path == "/api/net/card":
        return card_post(h)
    return h.send(404, {"error": "not found"})
