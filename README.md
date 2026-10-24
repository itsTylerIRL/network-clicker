# the network is growing_

A neochibi idle clicker. Post. Build the network. Touch grass.

**Play it: [clicker.tylerirl.com](https://clicker.tylerirl.com)**

![the title, over a row of Miladys](assets/preview.png)

You start alone, posting. Click your Milady and she posts, and posting makes vibes. Turn vibes into memes, build a group chat out of them, and someone shows up. Then someone else. Before long it's a network, and a network needs feeding.

## How it plays

- **Post.** Click yourself (or press space). That's the clicker part, and early on it's the whole game.
- **Miladys.** Build somewhere for them to live (group chats, discord servers, milady houses) and they turn up on their own. Every one is generated from the official trait layers, so the network looks like a network. Each eats half a vibe a second. If the vibes run out they log off.
- **Jobs.** New arrivals sit idle until you put them to work: posters make vibes, memers make memes, lorekeepers make lore, traders make $CULT, artists make drip, streamers make clout, and mods keep everyone happy. Click any of them in the gallery to see her, rename her, or move her.
- **Happiness.** A crowd gets crabby. Past ten miladys, each new one costs a little happiness, and happiness scales everything they make. Shrines, mods and a few upgrades bring it back.
- **Lore.** Research opens up the rest: new jobs, new buildings, more storage, eventually the infinite garden.
- **Storage.** Every resource has a cap. A price you can't fit says *needs more storage*.
- **The market.** It goes round: accumulation, mania, distribution, bear. Two minutes each, and each is good for something.
- **Sparkles.** 💎 shows up now and then. Catch it for a windfall, a posting frenzy, a glow, or a stranger who followed it in. Drama shows up too, unless you have mods.
- **Touch grass.** Once you've researched the infinite garden, you can log off: everything goes, and you come back with grass. Grass you hold makes everything 3% faster, forever, or you can spend it on perks that stick.

It saves itself in your browser and keeps going while you're away (8 hours, or 24 with a perk). Settings can export a save to move it somewhere else.

## Running it yourself

It's a static site. No build step, no framework, no dependencies. Even the animated backdrop is the game's own canvas: it's your network, one node per milady, and the market sets its weather.

```sh
python3 -m http.server
```

`python3 build.py` bundles everything (pictures included) into one `dist.html`, and stamps `index.html` and `version.json` so an open tab can tell when a new version is up. Run it before you push.

The content (resources, jobs, buildings, research, upgrades, perks, achievements) is all in `js/data.js`. The engine and the page are `js/game.js`. How it moves (the network backdrop, the market's weather, petals and confetti) is `js/fx.js`.

official remilia trait assets · copyleft · not affiliated · [tylerirl.com](https://tylerirl.com/)
