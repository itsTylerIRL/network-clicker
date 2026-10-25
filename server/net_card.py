"""Draws the network is growing's share card (1200x630 PNG) from a card's data alone.

It lives beside the cancel game's card.py on the service and borrows from it: the character is rebuilt from its
trait layers with the same art and layer rules (card_spec.json), in the same hologram frame, with the same fonts.
What's around it is this game's own: the network drawn behind, and what the card is for (a network, a run, the
new internet turned on) told in this game's colors.
"""
import io, math, random
from PIL import Image, ImageDraw, ImageFilter
import card  # the cancel game's card.py, beside this file on the service

CYAN, GOLD, GREEN, PINK = (139, 233, 253), (241, 250, 140), (80, 250, 123), (255, 121, 198)
MEDAL = {1: (241, 250, 140), 2: (200, 214, 222), 3: (255, 184, 108)}
W, H = 1200, 630


def clock(sec):
    """As the game writes a time: 58m 9s, 1h 3m, 2d 4h."""
    sec = max(0, round(sec))
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    if h >= 48:
        return "%dd %dh" % (h // 24, h % 24)
    return "%dh %dm" % (h, m) if h else "%dm %ds" % (m, s) if m else "%ds" % s


def short(n):
    """As the game writes a number, short: 1.24K, 3.5M."""
    n = float(n)
    for k, u in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(n) >= k:
            v = n / k
            return ("%.2f" % v if v < 10 else "%.1f" % v if v < 100 else "%d" % v).rstrip("0").rstrip(".") + u
    return "%d" % n


def network(cv, rng, n):
    """The network behind everything: one node per milady (up to sixty), each threaded to its nearest few."""
    d = ImageDraw.Draw(cv, "RGBA")
    pts = [(560 + rng.random() * 600, 40 + rng.random() * 550) for _ in range(max(12, min(60, n)))]
    for i, (x, y) in enumerate(pts):
        near = sorted(range(len(pts)), key=lambda j: (pts[j][0] - x) ** 2 + (pts[j][1] - y) ** 2)[1:3]
        for j in near:
            d.line([(x, y), pts[j]], fill=CYAN + (24,), width=1)
    for x, y in pts:
        r = 2 + rng.random() * 2.5
        d.ellipse((x - r, y - r, x + r, y + r), fill=(PINK if rng.random() < 0.25 else CYAN) + (80,))


def render(c, seed="x"):
    """c: kind (net, run, online), handle, look, and what that kind of card says. See network_api.card_data."""
    rng = random.Random(seed)
    cv = Image.new("RGB", (W, H), (0, 0, 0))
    card.over(cv, card.radial((W, H), (250, 300), 520, [(0, CYAN + (51,)), (1, CYAN + (0,))]))
    card.over(cv, card.radial((W, H), (1000, 120), 420, [(0, (189, 147, 249, 34)), (1, (189, 147, 249, 0))]))
    network(cv, rng, c.get("miladys") or 30)
    d = ImageDraw.Draw(cv, "RGBA")
    for x, y, dx, dy in ((18, 18, 1, 1), (1182, 18, -1, 1), (18, 612, 1, -1), (1182, 612, -1, -1)):  # the site's corner brackets
        d.line([(x + dx * 40, y), (x, y), (x, y + dy * 40)], fill=CYAN + (128,), width=2)

    # the character, as a hologram, as on the cancel's cards
    panel = Image.new("RGB", (400, 500), (1, 5, 6))
    card.over(panel, card.radial((400, 500), (200, 230), 330, [(0, CYAN + (87,)), (0.55, CYAN + (26,)), (1, CYAN + (5,))]))
    card.over(panel, card.compose(c.get("look"), []).resize((400, 500), Image.LANCZOS))
    pd = ImageDraw.Draw(panel, "RGBA")
    for y in range(0, 500, 4):
        pd.rectangle((0, y, 400, y + 1), fill=(0, 0, 0, 41))  # scanlines
    clip = Image.new("L", (400, 500), 0)
    ImageDraw.Draw(clip).rounded_rectangle((0, 0, 399, 499), 12, fill=255)
    cv.paste(panel, (50, 60), clip)
    edge = GOLD if c["kind"] == "online" or c.get("rank") == 1 or any(r["rank"] == 1 for r in c.get("ranks", [])) else CYAN
    d.rounded_rectangle((50, 60, 450, 560), 12, outline=edge + (170,), width=2)

    def text(t, x, y, px, color, weight="Bold"):
        d.text((x, y), t, font=card.font(px, weight), fill=color, anchor="ls")

    def fit(t, px, room, weight="Bold"):
        while d.textlength(t, font=card.font(px, weight)) > room and px > 16:
            px -= 2
        return px

    # the title glows, as the game's header: "the network" in white, "is growing" in cyan
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    f = card.font(46)
    off = gd.textlength("the network ", font=f)
    gd.text((500, 104), "the network", font=f, fill=CYAN + (180,), anchor="ls")
    gd.text((500 + off, 104), "is growing_", font=f, fill=CYAN + (180,), anchor="ls")
    card.over(cv, glow.filter(ImageFilter.GaussianBlur(9)))
    d = ImageDraw.Draw(cv, "RGBA")
    text("the network", 500, 104, 46, "#fff")
    text("is growing_", 500 + off, 104, 46, "#8be9fd")
    who = "~" + c["handle"].lstrip("~")
    text(("✓ " + who + ("  ·  playing since " + c["since"] if c.get("since") else "")).lower(), 500, 148, 22, "#bdbdbd", "Regular")

    # what this card is for, big
    k = c["kind"]
    if k == "net":
        head, color = "%s miladys" % short(c["miladys"]), GOLD
        sub = "%s runs · %s played · %d/%d achievements" % (short(c["runs"]), clock(c["played"]), c["ach"], c["ach_of"])
        nn = ("the new internet is online" + (", %d epoch%s past the end" % (c["epochs"], "" if c["epochs"] == 1 else "s") if c.get("epochs") else "")
              if c.get("online") else "the new internet: %d of 7 stages" % c["stage"] if c.get("stage") else "")
    elif k == "run":
        head = ("beat %s in %s" % (c["challenge"], clock(c["t"])) if c.get("beaten")
                else "touched grass after %s" % clock(c["t"]))
        color = GREEN
        sub = "run %d · peak %s miladys · %d market cycle%s · +%s grass" % (c["n"], short(c["peak"]), c["cycles"], "" if c["cycles"] == 1 else "s", short(c["grass"]))
        nn = "under %s, not beaten" % c["challenge"] if c.get("challenge") and not c.get("beaten") else ""
    elif k == "board":  # a place on a board, and what set it
        dd, b = c.get("detail") or {}, c["b"]
        head, color = "#%d %s" % (c["rank"], c["board"]), MEDAL.get(c["rank"], CYAN)
        if b == "fastest" or b.startswith("ch_"):
            sub = c["value"] + ("  ·  run %d · peak %s miladys · %d cycle%s" % (dd["n"], short(dd.get("peak", 0)), dd.get("cycles", 0), "" if dd.get("cycles") == 1 else "s") if dd.get("n") else "")
        elif b == "network":
            sub = c["value"] + (" at once  ·  run %d" % dd["n"] if dd.get("n") else "")
        elif b == "grass":
            sub = c["value"] + (" earned signed in  ·  %s runs" % short(dd["runs"]) if dd.get("runs") is not None else "")
        elif b == "online":
            sub = "turned on the new internet " + c["value"] + (" · after %d day%s" % (dd["days"], "" if dd["days"] == 1 else "s") if dd.get("days") else "")
        else:
            sub = c["value"] + " past the ending"
        nn = "of %d on the board" % c["total"]
    else:
        head, color = "turned on the new internet", CYAN
        sub = "after %d day%s and %s runs" % (c["days"], "" if c["days"] == 1 else "s", short(c["runs"]))
        nn = "%s miladys in the network when it came online" % short(c["miladys"])
    px = fit(head, 64, 650)
    hglow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(hglow).text((500, 250), head, font=card.font(px), fill=color + (150,), anchor="ls")
    card.over(cv, hglow.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(cv, "RGBA")
    text(head, 500, 250, px, color)
    text(sub, 500, 298, fit(sub, 24, 650, "Regular"), "#eaeaea", "Regular")
    if nn:
        text(nn, 500, 338, 22, "#8be9fd", "Regular")

    # where they stand: a medal chip for each of their best places on the boards
    x, y = 500, 400
    for r in c.get("ranks", [])[:4]:
        col = MEDAL.get(r["rank"], CYAN)
        label = "#%d %s" % (r["rank"], r["board"])
        val = r.get("value", "")
        w = max(d.textlength(label, font=card.font(20)), d.textlength(val, font=card.font(18, "Regular"))) + 36
        if x + w > 1160:
            x, y = 500, y + 84
            if y > 500:
                break
        d.rounded_rectangle((x, y, x + w, y + 70), 10, fill=(4, 8, 10, 255), outline=col + (200,), width=2)  # solid: the network stays behind it
        d.rounded_rectangle((x, y, x + w, y + 70), 10, fill=col + (22,))
        text(label, x + 18, y + 31, 20, col)
        text(val, x + 18, y + 57, 18, "#eaeaea", "Regular")
        x += w + 14
    text("CLICKER.TYLERIRL.COM", 500, 598, 16, "#666", "Regular")

    out = io.BytesIO()
    cv.save(out, "PNG", compress_level=6)
    return out.getvalue()
