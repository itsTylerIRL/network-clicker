/* the network is growing: content. Everything the game knows about lives here; js/game.js runs it.

   Effects (fx) are flat keys, summed over everything you own:
     rate.<res>     +N per second, per copy        cap.<res>      +N storage, per copy
     mult.<res>     +x production of that resource capMult.<res>  +x storage of that resource
     job.<job>      +x output of that job          all            +x every resource's production
     housing        +N miladys                     happy          +x happiness
     click          +N vibes per post              clickMult      +x vibes per post
     clickRate      a post also pays this many seconds of your vibes production
     autoclick      posts per second, for you      sparkle        +x how often sparkles turn up
     costMult.tech  +x research prices (negative is cheaper)
     idle.<res>     +N per second for every milady with no job
     capAll         +x storage of everything       housingMult    +x room everywhere
     arrive         +x how fast miladys turn up    remilio        +x what a remilio makes, over a milady
     ritualCost / ritualCd   +x ritual prices / cooldowns (negative is cheaper / sooner)
     raidSpeed      +x how fast raids come home    relicChance    +x the odds a raid brings a relic home
     wonderCost     +x cathedral prices            grass          +x grass when you touch it
     grassEach      +x what each grass you hold is worth
     autoassign     new arrivals go straight to work (the miladys tab says at what)

   ng: how many times you must have touched grass before something exists at all. Every reset opens a layer.
*/

const RES = [
  { id:"vibes",   name:"vibes",    icon:"🌸", color:"#ff79c6", cap:500, desc:"what the network runs on. every milady eats some." },
  { id:"memes",   name:"memes",    icon:"🐸", color:"#50fa7b", cap:200, desc:"what the network is built out of." },
  { id:"cult",    name:"$CULT",    icon:"coin", color:"#f1fa8c", cap:100, desc:"money. traders make it.", tech:"wallets" },
  { id:"lore",    name:"lore",     icon:"📜", color:"#bd93f9", cap:250, desc:"spend it on research.", show:s=>s.b.archive>0 },
  { id:"drip",    name:"drip",     icon:"💧", color:"#8be9fd", cap:50,  desc:"taste, distilled. artists make it.", tech:"aesthetics" },
  { id:"clout",   name:"clout",    icon:"📣", color:"#ffb86c", cap:100, desc:"people paying attention. streamers make it.", tech:"streaming" },
  { id:"compute", name:"compute",  icon:"⚡", color:"#a6e3ff", cap:150, desc:"cycles. devs make it.", tech:"opensource", ng:1 },
  { id:"devotion",name:"devotion", icon:"🕯️", color:"#ffd27f", cap:100, desc:"faith in the network. acolytes keep it, rituals spend it.", tech:"liturgy", ng:2 },
  { id:"ether",   name:"ether",    icon:"💠", color:"#c3a6ff", cap:25,  desc:"what the cathedral is made of. seers find it.", tech:"hyperreality", ng:4 },
];

/* Playing as a token: its traits (read through the cancel game's service) rebuilt in layers, by the same rules as the
   cancel is coming. names/values map a collection's trait names onto the layer folders; exclusions are what the
   collection itself hides under something else; tint is how a Milady's Eye Color colors her eyes. */
const TOKEN_MAP = {
 milady: { cfg:"Milady", body:"Skin", transform:"titlecase",
   names:{"Race":"Skin", "Necklace":"Necklaces", "Eyebrows":"Brows", "Earring":"Earrings"},
   values:{"Race":{"clay":"Clay", "pale":"Pale", "tan":"Tan", "black":"Black", "pink":"Pink", "alien":"Alien"}, "Eyes":{"heart eyes":"Heart"}, "Hair":{"og black":"OG Black", "og blonde":"OG Blonde", "og blue":"OG Blue", "og frosted blonde":"OG Frosted Blonde", "og frosted purple":"OG Frosted Purple", "og green":"OG Green", "og orange":"OG Orange", "og slate":"OG Slate"}, "Hat":{"denim usa cap":"Denim USA Cap", "cat ears with bell":"Cat Ears with Bell"}, "Shirt":{"mwo shirt":"MWO Shirt", "sweater and tie":"Sweater and Tie"}, "Necklace":{"eth necklace":"ETH Necklace", "pearl necklace":"Mestwood Pearl Necklace"}, "Glasses":{"yy glasses":"YY Glasses"}, "Mouth":{"smile":"Smile A", "smileb":"Smile B", "smilec":"Smile C"}, "Eyebrows":{"complacent":"Complacent A", "complacentb":"Complacent B", "concerneda":"Concerned A", "concernedb":"Concerned B", "concernedc":"Concerned C"}},
   exclusions:{"Hat":{"Strawberry Hat":["Hair", "Earrings"]}, "Eyes":{"Chinese":["Brows"]}}, layerExclusions:{},
   tint:{ by:"Eye Color", mask:"Eyes-Mask", values:["Classic", "Crying", "Dilated", "Heart", "Sleepy", "Sparkle", "Teary"], darken:{Brown:0.47, Leaf:0.28, Blue:0.8, Gold:0.7} } },
 remilio: { cfg:"Remilio", body:"Race", transform:"none",
   names:{"Overlays":"Overlay", "Eyebrow":"Brows"},
   values:{"Hair":{"Ulenka Golden Painted":"Ulenka Golden"}, "Glasses":{"Cobain":"Clout Goggles"}},
   exclusions:{"Race":{"Oni Dark":["Hair", "Hat"], "Oni Light":["Hair", "Hat"], "Alien":["Eyes"], "Reptilian":["Eyes"], "Zombie":["Eyes"]}, "Hat":{"Strawberry Hat":["Earrings"]}, "Eyes":{"Southpark":["Brows"]}}, layerExclusions:{"Costume":["Shirt", "Hat", "Glasses", "Hair", "Face"]} },
};
const RADBRO_TOKEN = { kind:"remilio", id:2305 }; // "Radbro" is this one Remilio, as on the cancel's character screen: nothing to choose

const EAT = 0.5; // vibes per second, per milady at home (one away on a raid eats elsewhere)

const JOBS = [
  { id:"poster",  name:"poster",     icon:"💬", res:"vibes",   rate:1.0,   desc:"posts all day. makes vibes." },
  { id:"memer",   name:"memer",      icon:"🐸", res:"memes",   rate:0.1,   desc:"makes memes." },
  { id:"keeper",  name:"lorekeeper", icon:"📜", res:"lore",    rate:0.15,  desc:"reads the archive. makes lore.", show:s=>s.b.archive>0 },
  { id:"trader",  name:"trader",     icon:"📈", res:"cult",    rate:0.06,  desc:"watches charts. makes $CULT.", tech:"wallets" },
  { id:"artist",  name:"artist",     icon:"🎨", res:"drip",    rate:0.04,  desc:"makes drip.", tech:"aesthetics" },
  { id:"streamer",name:"streamer",   icon:"📣", res:"clout",   rate:0.04,  desc:"goes live. makes clout.", tech:"streaming" },
  { id:"mod",     name:"mod",        icon:"🛡️", res:null,      rate:0,     desc:"keeps the peace: +3% happiness each, and less drama.", tech:"moderation" },
  { id:"dev",     name:"dev",        icon:"⌨️", res:"compute", rate:0.04,  desc:"ships code. makes compute.", tech:"opensource", ng:1 },
  { id:"acolyte", name:"acolyte",    icon:"🕯️", res:"devotion",rate:0.03,  desc:"tends the candles. makes devotion.", tech:"liturgy", ng:2 },
  { id:"seer",    name:"seer",       icon:"🔮", res:"ether",   rate:0.008, desc:"looks past the timeline. finds ether.", tech:"hyperreality", ng:4 },
];

/* cost is the first copy; each copy after costs `ratio` times the last */
const BUILDINGS = [
  { id:"moodboard", name:"mood board",     cost:{vibes:10}, ratio:1.12, fx:{"rate.vibes":0.125},
    desc:"pin something cute. it makes vibes by itself.", show:s=>s.seen.vibes>=5 },
  { id:"groupchat", name:"group chat",     cost:{vibes:40, memes:5}, ratio:1.25, fx:{housing:2},
    desc:"room for 2 more miladys.", show:s=>s.seen.memes>=1 },
  { id:"archive",   name:"archive",        cost:{memes:25}, ratio:1.15, fx:{"cap.lore":250, "mult.lore":0.1},
    desc:"somewhere to keep lore. lorekeepers work here.", show:s=>s.seen.memes>=10 },
  { id:"drive",     name:"cloud drive",    cost:{memes:40}, ratio:1.35, fx:{"cap.vibes":500, "cap.memes":200, "cap.cult":50},
    desc:"more storage.", show:s=>s.seen.memes>=25 },
  { id:"memefarm",  name:"meme farm",      cost:{memes:80, cult:20}, ratio:1.15, fx:{"rate.memes":0.2},
    desc:"a folder that fills itself.", tech:"memetics" },
  { id:"telegram",  name:"telegram group", cost:{vibes:600, memes:120}, ratio:1.28, fx:{housing:3},
    desc:"room for 3 more miladys. nobody reads the pinned message.", tech:"groupdynamics" },
  { id:"wallet",    name:"cold wallet",    cost:{memes:50, cult:10}, ratio:1.3, fx:{"cap.cult":200},
    desc:"holds $CULT.", tech:"wallets" },
  { id:"discord",   name:"discord server", cost:{memes:200, cult:50}, ratio:1.3, fx:{housing:5},
    desc:"room for 5 more miladys.", tech:"servers" },
  { id:"desk",      name:"trading desk",   cost:{memes:120, cult:30}, ratio:1.15, fx:{"job.trader":0.12, "cap.cult":50},
    desc:"traders make 12% more.", tech:"charts" },
  { id:"merch",     name:"merch store",    cost:{memes:250, drip:20}, ratio:1.15, fx:{"rate.cult":0.15, "cap.cult":80},
    desc:"hoodies. it makes $CULT by itself.", tech:"merch" },
  { id:"studio",    name:"studio",         cost:{memes:150, cult:60}, ratio:1.15, fx:{"job.artist":0.1, "cap.drip":60},
    desc:"artists make 10% more, and more room for drip.", tech:"aesthetics" },
  { id:"stage",     name:"stream setup",   cost:{cult:100, drip:20}, ratio:1.15, fx:{"job.streamer":0.1, "cap.clout":100},
    desc:"streamers make 10% more, and more room for clout.", tech:"streaming" },
  { id:"library",   name:"library",        cost:{memes:300, cult:80}, ratio:1.2, fx:{"cap.lore":600, "mult.lore":0.05},
    desc:"a lot more room for lore.", tech:"archivism" },
  { id:"shrine",    name:"shrine",         cost:{memes:100, drip:30}, ratio:1.2, fx:{happy:0.04},
    desc:"network spirituality. +4% happiness.", tech:"spirituality" },
  { id:"rig",       name:"ai rig",         cost:{cult:200, drip:40}, ratio:1.15, fx:{all:0.06},
    desc:"everything makes 6% more.", tech:"compute" },
  { id:"house",     name:"milady house",   cost:{memes:600, cult:400, drip:80}, ratio:1.25, fx:{housing:8},
    desc:"an irl house. room for 8 more.", tech:"irl" },
  { id:"billboard", name:"billboard",      cost:{cult:200, clout:50}, ratio:1.15, fx:{"mult.vibes":0.15, "mult.clout":0.05},
    desc:"+15% vibes, +5% clout.", tech:"marketing" },
  { id:"podcast",   name:"podcast studio", cost:{cult:300, drip:50}, ratio:1.15, fx:{"rate.clout":0.05, "job.streamer":0.05, "cap.clout":60},
    desc:"three hours a week of nothing. it makes clout by itself.", tech:"marketing" },
  { id:"warehouse", name:"warehouse",      cost:{memes:1500, cult:1500, lore:1500}, ratio:1.35, fx:{capAll:0.1},
    desc:"+10% room for everything.", tech:"infrastructure" },
  { id:"garden",    name:"the garden",     cost:{cult:1500, drip:250, clout:250}, ratio:1.25, fx:{all:0.05, happy:0.05, grass:0.1},
    desc:"it's infinite. +5% everything, +5% happiness, +10% grass when you touch it.", tech:"garden" },
  // the stack (after your first grass)
  { id:"rack",      name:"server rack",    cost:{memes:600, cult:400}, ratio:1.18, fx:{"cap.compute":150, "job.dev":0.1},
    desc:"room for compute, and devs make 10% more.", tech:"opensource", ng:1 },
  { id:"gpu",       name:"gpu cluster",    cost:{cult:800, compute:40}, ratio:1.2, fx:{all:0.04},
    desc:"everything makes 4% more.", tech:"inference", ng:1 },
  { id:"datacenter",name:"data center",    cost:{cult:3000, compute:200, drip:200}, ratio:1.25, fx:{"rate.compute":0.5, "cap.compute":500},
    desc:"it makes compute by itself. a lot of room for it.", tech:"scaling", ng:1 },
  // network spirituality (after your second)
  { id:"chapel",    name:"chapel",         cost:{memes:800, drip:60}, ratio:1.2, fx:{"cap.devotion":100, "job.acolyte":0.1},
    desc:"room for devotion, and acolytes make 10% more.", tech:"liturgy", ng:2 },
  { id:"iconwall",  name:"icon wall",      cost:{drip:200, devotion:40}, ratio:1.2, fx:{happy:0.03, "mult.devotion":0.05},
    desc:"+3% happiness, +5% devotion.", tech:"iconography", ng:2 },
  // the cathedral (after your fourth)
  { id:"observatory",name:"observatory",   cost:{cult:2000, ether:15}, ratio:1.22, fx:{"cap.ether":40, "job.seer":0.1},
    desc:"room for ether, and seers make 10% more.", tech:"hyperreality", ng:4 },
];

const TECHS = [
  { id:"wallets",      name:"wallets",           cost:{lore:30},
    desc:"traders, and cold wallets to keep $CULT in." },
  { id:"memetics",     name:"memetics",          cost:{lore:50}, fx:{"job.memer":0.25},
    desc:"memers make 25% more, and meme farms." },
  { id:"groupdynamics",name:"group dynamics",    cost:{lore:80}, fx:{"idle.vibes":0.15},
    desc:"telegram groups. and a milady with no job still posts a little: 0.15 vibes a second." },
  { id:"servers",      name:"servers",           cost:{lore:100}, req:["wallets"],
    desc:"discord servers." },
  { id:"doomscrolling",name:"doomscrolling",     cost:{lore:120}, req:["memetics"], fx:{click:2},
    desc:"+2 vibes per post." },
  { id:"charts",       name:"charts",            cost:{lore:150, cult:20}, req:["wallets"],
    desc:"trading desks." },
  { id:"compression",  name:"compression",       cost:{lore:200}, req:["memetics"], fx:{"capMult.vibes":0.25, "capMult.memes":0.25},
    desc:"+25% room for vibes and memes." },
  { id:"aesthetics",   name:"aesthetics",        cost:{lore:250}, req:["memetics"],
    desc:"artists, drip and studios." },
  { id:"moderation",   name:"moderation",        cost:{lore:300}, req:["servers"],
    desc:"mods." },
  { id:"merch",        name:"merch",             cost:{lore:350, cult:50}, req:["charts","aesthetics"],
    desc:"merch stores." },
  { id:"streaming",    name:"streaming",         cost:{lore:450, drip:10}, req:["aesthetics"],
    desc:"streamers, clout and stream setups." },
  { id:"lurkers",      name:"lurkers",           cost:{lore:500}, req:["groupdynamics","moderation"], fx:{"idle.vibes":0.25, happy:0.03},
    desc:"idle miladys post more (0.4 a second all told), and +3% happiness." },
  { id:"spirituality", name:"network spirituality", cost:{lore:600, drip:25}, req:["aesthetics","moderation"],
    desc:"shrines." },
  { id:"compute",      name:"compute",           cost:{lore:800, cult:150}, req:["charts"],
    desc:"ai rigs." },
  { id:"archivism",    name:"archivism",         cost:{lore:900}, req:["compression"], fx:{"capMult.lore":0.5, "mult.lore":0.15},
    desc:"libraries, +50% room for lore, +15% lore." },
  { id:"irl",          name:"irl meetups",       cost:{lore:1100, clout:30}, req:["spirituality"], fx:{arrive:1},
    desc:"milady houses. miladys turn up twice as fast." },
  { id:"marketing",    name:"marketing",         cost:{lore:1400, clout:60}, req:["streaming"],
    desc:"billboards and podcast studios." },
  { id:"irony",        name:"irony poisoning",   cost:{lore:1600, drip:60}, req:["marketing"], fx:{"mult.memes":0.3, "mult.clout":0.1},
    desc:"+30% memes, +10% clout." },
  { id:"hyperstition", name:"hyperstition",      cost:{lore:2000, drip:100}, req:["compute","marketing"], fx:{all:0.1, sparkle:0.5},
    desc:"+10% everything, and sparkles turn up more." },
  { id:"infrastructure",name:"infrastructure",   cost:{lore:2500, cult:800}, req:["compute","archivism"], fx:{capAll:0.25},
    desc:"+25% room for everything, and warehouses." },
  { id:"garden",       name:"the infinite garden", cost:{lore:3000, drip:150, clout:150}, req:["irl","hyperstition"],
    desc:"the garden. and you can touch grass." },
  { id:"postirony",    name:"post-irony",        cost:{lore:4500, clout:300}, req:["garden"], fx:{happy:0.1, "job.poster":0.5},
    desc:"+10% happiness, posters make 50% more." },
  { id:"september",    name:"eternal september", cost:{lore:6000, cult:2000}, req:["garden"], fx:{housingMult:0.25},
    desc:"+25% room for miladys everywhere." },
  { id:"accelerate",   name:"accelerationism",   cost:{lore:9000, cult:4000, drip:600}, req:["postirony","september"], fx:{all:0.25, autoclick:5},
    desc:"+25% everything, and you post 5 more times a second." },
  // the stack
  { id:"opensource",   name:"open source",       cost:{lore:400}, req:["wallets"], ng:1,
    desc:"devs, compute and server racks." },
  { id:"inference",    name:"inference",         cost:{lore:900, compute:30}, req:["opensource"], ng:1, fx:{"job.keeper":0.2},
    desc:"gpu clusters, and lorekeepers make 20% more." },
  { id:"agents",       name:"agents",            cost:{lore:1500, compute:80}, req:["inference"], ng:1, fx:{autoassign:1},
    desc:"new miladys go straight to work: pick their job in the miladys tab." },
  { id:"scaling",      name:"scaling laws",      cost:{lore:3000, compute:200}, req:["agents"], ng:1, fx:{"mult.compute":0.25},
    desc:"data centers, and +25% compute." },
  { id:"alignment",    name:"alignment",         cost:{lore:4000, compute:300}, req:["scaling"], ng:1, fx:{happy:0.1},
    desc:"+10% happiness." },
  { id:"singularity",  name:"the singularity",   cost:{lore:12000, compute:1500}, req:["alignment","accelerate"], ng:1, fx:{all:0.5, autoclick:10},
    desc:"+50% everything, and you post 10 more times a second." },
  // network spirituality
  { id:"liturgy",      name:"liturgy",           cost:{lore:600, drip:40}, req:["spirituality"], ng:2,
    desc:"acolytes, devotion and chapels." },
  { id:"iconography",  name:"iconography",       cost:{lore:1200, devotion:30}, req:["liturgy"], ng:2,
    desc:"icon walls, and rituals." },
  { id:"schism",       name:"schism",            cost:{lore:2500, devotion:80}, req:["iconography"], ng:2, fx:{ritualCost:-0.25},
    desc:"rituals cost 25% less." },
  { id:"mass",         name:"the mass",          cost:{lore:5000, devotion:200}, req:["schism","irl"], ng:2, fx:{ritualCd:-0.4},
    desc:"rituals come back 40% sooner, and the vigil." },
  // raids
  { id:"raiding",      name:"raiding",           cost:{lore:1500, clout:100}, req:["marketing"], ng:3,
    desc:"send miladys out to raid. they come home with loot, and sometimes a relic." },
  { id:"opsec",        name:"opsec",             cost:{lore:3000, clout:200}, req:["raiding"], ng:3, fx:{raidSpeed:0.25},
    desc:"raids come home 25% sooner." },
  { id:"loottables",   name:"loot tables",       cost:{lore:5000, clout:400, cult:1000}, req:["opsec"], ng:3, fx:{relicChance:0.5},
    desc:"raids are half again as likely to bring home a relic." },
  // the cathedral
  { id:"hyperreality", name:"hyperreality",      cost:{lore:6000, clout:400}, req:["garden"], ng:4,
    desc:"seers, ether and observatories." },
  { id:"geometry",     name:"sacred geometry",   cost:{lore:9000, ether:20}, req:["hyperreality"], ng:4,
    desc:"the cathedral of the network." },
];

/* bought once */
const UPGRADES = [
  { id:"takes",     name:"hot takes",      cost:{memes:15},             fx:{click:1},           desc:"+1 vibe per post.", show:s=>s.seen.memes>=5 },
  { id:"ringlight", name:"ring light",     cost:{vibes:150, memes:40},  fx:{"job.poster":0.25}, desc:"posters make 25% more.", show:s=>s.b.groupchat>0 },
  { id:"templates", name:"meme templates", cost:{memes:60},             fx:{"job.memer":0.25},  desc:"memers make 25% more.", show:s=>s.b.groupchat>0 },
  { id:"replyguy",  name:"reply guy",      cost:{memes:80, cult:20},    fx:{clickMult:1},       desc:"posts make twice as much.", tech:"wallets" },
  { id:"bot",       name:"posting bot",    cost:{memes:120, cult:60},   fx:{autoclick:1},       desc:"posts for you once a second.", tech:"wallets" },
  { id:"shitpost",  name:"shitposting",    cost:{vibes:1000, memes:200},fx:{click:3},           desc:"+3 vibes per post.", tech:"doomscrolling" },
  { id:"alpha",     name:"alpha group",    cost:{cult:80},              fx:{"job.trader":0.3},  desc:"traders make 30% more.", tech:"charts" },
  { id:"zip",       name:"zip files",      cost:{memes:150, lore:100},  fx:{"capMult.vibes":0.25, "capMult.memes":0.25}, desc:"+25% room for vibes and memes.", tech:"compression" },
  { id:"c2e",       name:"click to earn",  cost:{memes:300, cult:150},  fx:{clickRate:0.05},    desc:"every post also pays 5% of a second of vibes production.", tech:"charts" },
  { id:"rules",     name:"group chat rules", cost:{cult:120, lore:400}, fx:{happy:0.05},        desc:"+5% happiness.", tech:"moderation" },
  { id:"lighting",  name:"mood lighting",  cost:{cult:50, drip:20},     fx:{happy:0.05},        desc:"+5% happiness.", tech:"aesthetics" },
  { id:"procreate", name:"procreate",      cost:{cult:100, drip:40},    fx:{"job.artist":0.3},  desc:"artists make 30% more.", tech:"aesthetics" },
  { id:"drop",      name:"merch drop",     cost:{cult:400, drip:50},    fx:{"job.trader":0.25}, desc:"traders make 25% more.", tech:"merch" },
  { id:"monitor",   name:"second monitor", cost:{cult:150, lore:300},   fx:{"mult.lore":0.25},  desc:"+25% lore.", tech:"servers" },
  { id:"obs",       name:"obs scenes",     cost:{drip:30, clout:40},    fx:{"job.streamer":0.3},desc:"streamers make 30% more.", tech:"streaming" },
  { id:"fanart",    name:"fan art",        cost:{drip:120, clout:60},   fx:{"job.artist":0.3},  desc:"artists make 30% more.", tech:"streaming" },
  { id:"ledger",    name:"ledger",         cost:{cult:200},             fx:{"capMult.cult":0.5},desc:"+50% room for $CULT.", tech:"compute" },
  { id:"botnet",    name:"botnet",         cost:{cult:300, drip:60},    fx:{autoclick:4},       desc:"posts for you 4 more times a second.", tech:"compute" },
  { id:"hug",       name:"group hug",      cost:{drip:60, clout:80},    fx:{happy:0.08},        desc:"+8% happiness.", tech:"spirituality" },
  { id:"wiki",      name:"lore wiki",      cost:{memes:400, lore:800},  fx:{"mult.lore":0.2},   desc:"+20% lore.", tech:"archivism" },
  { id:"bible",     name:"lore bible",     cost:{memes:500, lore:1500}, fx:{"capMult.lore":0.5},desc:"+50% room for lore.", tech:"archivism" },
  { id:"boost",     name:"server boost",   cost:{cult:500, clout:100},  fx:{housingMult:0.1},   desc:"+10% room for miladys everywhere.", tech:"irl" },
  { id:"viral",     name:"viral loop",     cost:{memes:800, clout:150}, fx:{"mult.vibes":0.25, "mult.clout":0.1}, desc:"+25% vibes, +10% clout.", tech:"marketing" },
  { id:"hyperpop",  name:"hyperpop",       cost:{cult:600, drip:200, clout:300}, fx:{all:0.1}, desc:"+10% everything.", tech:"hyperstition" },
  { id:"thinkpiece",name:"thinkpiece",     cost:{lore:4000, clout:400}, fx:{clickRate:0.15},    desc:"every post also pays 15% of a second more.", tech:"postirony" },
  // the stack
  { id:"copilot",   name:"copilot",        cost:{compute:50, cult:500}, fx:{"job.keeper":0.3},  desc:"lorekeepers make 30% more.", tech:"opensource", ng:1 },
  { id:"prompts",   name:"prompt engineering", cost:{compute:100, lore:500}, fx:{clickRate:0.1}, desc:"every post also pays 10% of a second more.", tech:"inference", ng:1 },
  { id:"rlhf",      name:"rlhf",           cost:{compute:200, clout:200}, fx:{happy:0.05, "job.dev":0.2}, desc:"+5% happiness, devs make 20% more.", tech:"agents", ng:1 },
  { id:"quant",     name:"quantization",   cost:{compute:300, cult:1000}, fx:{"capMult.compute":0.5}, desc:"+50% room for compute.", tech:"scaling", ng:1 },
  // network spirituality
  { id:"incense",   name:"incense",        cost:{devotion:50, drip:100}, fx:{"job.acolyte":0.3}, desc:"acolytes make 30% more.", tech:"liturgy", ng:2 },
  { id:"glass",     name:"stained glass",  cost:{devotion:100, drip:300}, fx:{happy:0.05, "mult.devotion":0.1}, desc:"+5% happiness, +10% devotion.", tech:"iconography", ng:2 },
  { id:"collective",name:"remilio collective", cost:{devotion:150, cult:1500}, fx:{remilio:0.25}, desc:"remilios make another 25% more than a milady.", tech:"schism", ng:2 },
  // raids
  { id:"warroom",   name:"war room",       cost:{clout:300, cult:800},  fx:{raidSpeed:0.15},    desc:"raids come home 15% sooner.", tech:"raiding", ng:3 },
  { id:"metal",     name:"metal detector", cost:{clout:500, compute:200}, fx:{relicChance:0.25}, desc:"raids are a quarter again as likely to bring home a relic.", tech:"opsec", ng:3 },
  // the cathedral
  { id:"scaffold",  name:"scaffolding",    cost:{ether:30, cult:3000},  fx:{wonderCost:-0.15},  desc:"the cathedral costs 15% less.", tech:"geometry", ng:4 },
];

/* bought with grass, kept forever. Grass you hold is worth +3% to everything, so spending it is a trade. */
const GRASS_EACH = 0.03;
const PERKS = [
  { id:"headstart", name:"head start",      cost:2,  fx:{},              desc:"every run starts with 2 group chats, 2 mood boards and 50 memes." },
  { id:"muscle",    name:"muscle memory",   cost:2,  fx:{clickMult:2},   desc:"+200% vibes per post." },
  { id:"sleep",     name:"sleep schedule",  cost:3,  fx:{},              desc:"time away counts for up to 24 hours instead of 8." },
  { id:"wellness",  name:"wellness",        cost:4,  fx:{happy:0.1},     desc:"+10% happiness." },
  { id:"golden",    name:"golden hour",     cost:4,  fx:{sparkle:1},     desc:"sparkles turn up twice as often." },
  { id:"landlord",  name:"landlord",        cost:5,  fx:{housing:4},     desc:"room for 4 more miladys." },
  { id:"scholar",   name:"quick learner",   cost:6,  fx:{"costMult.tech":-0.2}, desc:"research costs 20% less." },
  { id:"memory",    name:"long memory",     cost:8,  fx:{},              desc:"keep wallets, memetics and servers when you touch grass." },
  { id:"overclock", name:"overclock",       cost:5,  fx:{"mult.compute":0.25}, desc:"+25% compute.", ng:1 },
  { id:"devops",    name:"devops",          cost:6,  fx:{},              desc:"every run starts with open source researched.", ng:1 },
  { id:"autopilot", name:"autopilot",       cost:10, fx:{},              desc:"every run starts with agents researched, so new miladys go straight to work.", ng:1 },
  { id:"faithful",  name:"the faithful",    cost:8,  fx:{},              desc:"every run starts with liturgy researched and 100 devotion.", ng:2 },
  { id:"blessing",  name:"remilia's blessing", cost:6, fx:{},            desc:"half of all new arrivals are remilios.", ng:2 },
  { id:"scout",     name:"scout",           cost:6,  fx:{raidSpeed:0.3}, desc:"raids come home 30% sooner.", ng:3 },
  { id:"treasure",  name:"treasure map",    cost:8,  fx:{relicChance:0.25}, desc:"raids are a quarter again as likely to bring home a relic.", ng:3 },
  { id:"architect", name:"architect",       cost:10, fx:{wonderCost:-0.2}, desc:"the cathedral costs 20% less.", ng:4 },
  { id:"roots",     name:"deep roots",      cost:15, fx:{grassEach:0.01}, desc:"every grass you hold is worth 4% instead of 3%.", ng:3 },
  { id:"photo",     name:"photosynthesis",  cost:12, fx:{grass:0.25},    desc:"+25% grass every time you touch it.", ng:2 },
  /* automation: the late runs play themselves a little. Each can be switched off on the network tab. */
  { id:"automeme",  name:"meme machine",    cost:8,  fx:{}, auto:"meme",  desc:"🤖 once vibes are nearly full, the spare ones are memed for you.", ng:2 },
  { id:"autotech",  name:"grad students",   cost:12, fx:{}, auto:"tech",  desc:"🤖 research does itself, the cheapest first.", ng:3 },
  { id:"autobuild", name:"scripts",         cost:15, fx:{}, auto:"build", desc:"🤖 buildings buy themselves out of what's spare, the cheapest for your storage first.", ng:3 },
  { id:"autoup",    name:"personal shopper",cost:12, fx:{}, auto:"up",    desc:"🤖 upgrades buy themselves.", ng:4 },
  { id:"autorite",  name:"choirmaster",     cost:10, fx:{}, auto:"rite",  desc:"🤖 rituals are held as soon as they're ready: the ones you tick.", ng:2 },
  { id:"autoraid",  name:"war council",     cost:10, fx:{}, auto:"raid",  desc:"🤖 raiders go back out on the best raid there's a crew for, idle miladys first, never more than a quarter of the workers.", ng:3 },
  { id:"autowonder",name:"masons",          cost:12, fx:{}, auto:"wonder",desc:"🤖 the cathedral builds its next stage as soon as it's affordable.", ng:4 },
  /* the big one: once the new internet is on, the gardener touches grass for you, and grass becomes something to spend */
  { id:"gardener",  name:"the gardener",    cost:100, fx:{}, auto:"grass", ng:6, show:s=>!!s.ended && !!s.perks.autotech, // it needs the grad students to reach the garden each run
    desc:"🤖 touches grass for you, at the best moment or once there's as much as you say. grass stops being a bonus and becomes what the new internet is built from: your bonus now is locked in, for good." },
];

/* what each reset opens, shown in the grass tab so the next one is something to look forward to */
const MILESTONES = [
  { n:1, name:"the stack",            desc:"compute ⚡ and devs. server racks, gpu clusters, data centers. agents put new miladys straight to work. the singularity." },
  { n:2, name:"network spirituality", desc:"devotion 🕯️ and acolytes, chapels, and rituals. and remilios start joining the network." },
  { n:3, name:"raids",                desc:"send miladys out raiding. they come home with loot, and relics you keep forever." },
  { n:4, name:"the cathedral",        desc:"ether 💠 and seers, and a cathedral of the network, ten stages tall." },
  { n:5, name:"challenges",           desc:"touch grass into a run with the rules bent, for rewards that last." },
  { n:6, name:"the new internet",     desc:"the last thing to build, and bigger than any one run: seven stages, poured into a little at a time. what goes in stays when you touch grass." },
];

/* the new internet: the ending. Seven stages, each filled by pouring resources in (a share of what you make, and
   everything that would overflow), kept across touching grass. Every stage finished is a bonus for good. */
const NEWNET_NG = 6;
const NEWNET = [
  { id:"protocol",  icon:"📡", name:"the protocol",     desc:"write down how a network talks to itself.",           need:{lore:1.2e7,  compute:2.4e6},              fx:{all:0.25} },
  { id:"nodes",     icon:"🖥️", name:"the nodes",        desc:"every milady runs a node.",                           need:{memes:1.8e7, cult:1.2e7}, req:{miladys:250}, fx:{all:0.25, housingMult:0.1} },
  { id:"mesh",      icon:"🕸️", name:"the mesh",         desc:"threads between all of them. no center to cut.",      need:{drip:3.6e6,  clout:6e6},                fx:{all:0.25, happy:0.15} },
  { id:"handshake", icon:"🤝", name:"the handshake",    desc:"everyone agrees to trust each other, a little.",      need:{devotion:1.8e6, cult:2.4e7},              fx:{all:0.25, ritualCd:-0.2} },
  { id:"namespace", icon:"🏷️", name:"the namespace",    desc:"everyone gets a name. nobody owns the list.",         need:{lore:4.8e7,  memes:3.6e7, clout:1.8e7},     fx:{all:0.25, capAll:0.25} },
  { id:"archive",   icon:"🗄️", name:"the archive",      desc:"nothing posted is ever lost again.",                  need:{compute:1.8e7, drip:1.2e7, ether:3.6e5},    fx:{all:0.25, grass:0.5} },
  { id:"internet",  icon:"🌐", name:"the new internet", desc:"turn it on.",                                         need:{vibes:1.8e8, devotion:6e6, ether:1.2e6}, req:{cathedral:true}, fx:{all:1} },
];

/* after the ending: the new internet keeps growing, an epoch at a time, poured into the same way. There's no last one:
   each asks for half again what the one before did, from a different mix, and each is +10% everything for good. */
const EPOCH_GROW = 1.5, EPOCH_FX = { all:0.1 };
/* need: from the first tier's resources. need2: from the second tier's, once the gardener has it running (counted
   from the epoch it opened on, so a player far along doesn't start the second tier owing half again per epoch) */
const EPOCHS = [
  { name:"uptime",           desc:"keep it running. that's the whole job now.",   need:{vibes:1.2e8,  memes:3e7},             need2:{signal:2e4,  trust:2000} },
  { name:"the long tail",    desc:"everyone who was ever too shy to post.",       need:{lore:4e7,     compute:1.6e7},          need2:{trust:4000,  memory:300} },
  { name:"mirrors",          desc:"copies of everything, everywhere.",            need:{cult:3e7,     drip:1e7},               need2:{signal:5e4,  memory:500} },
  { name:"federation",       desc:"other networks ask to join.",                  need:{clout:1.6e7,  devotion:5e6},           need2:{signal:4e4,  trust:6000} },
  { name:"the commons",      desc:"a park in the middle of it, for nobody.",      need:{ether:1e6,    vibes:1.6e8},            need2:{trust:5000,  memory:800} },
  { name:"dead links",       desc:"bring back every page that went missing.",     need:{memes:5e7,    lore:4e7, ether:5e5},    need2:{signal:6e4,  trust:6000, memory:600} },
];
/* o: { t2, from, mult }: the second tier's needs, counted from epoch `from`, times `mult` (a protocol can lower it) */
function epochStage(e, o){
  o = o || {};
  const E = EPOCHS[e % EPOCHS.length], x = Math.pow(EPOCH_GROW, o.t2 ? Math.max(0, e - (o.from||0)) : e) * (o.mult||1), need = {};
  const base = o.t2 ? E.need2 : E.need, round = o.t2 ? 10 : 1000;
  for(const k in base) need[k] = Math.round(base[k]*x/round)*round;
  return { id:"epoch", icon:"♾️", name:"epoch "+(e+1)+": "+E.name, desc:E.desc, need, fx:EPOCH_FX };
}

/* ---------- the second tier: the new internet, running ----------
   Once the gardener touches grass for you, grass is something to spend, the way vibes is in the first tier. It's
   built into the new internet, which makes signal, trust and memory. Buildings make them by themselves (there's no
   one to feed); protocols are researched once. Some of it reaches back: the first tier goes faster, and every time
   the gardener touches grass there's more of it. Epochs are poured from it. Each epoch is +10% to this tier too. */
const T2_RES = [
  { id:"signal", name:"signal", icon:"📡", color:"#8be9fd", desc:"the new internet talking to itself. relays and nodes make it." },
  { id:"trust",  name:"trust",  icon:"🤝", color:"#50fa7b", desc:"everyone believing everyone, a little. the mesh makes it." },
  { id:"memory", name:"memory", icon:"🗄️", color:"#bd93f9", desc:"what the archive keeps. name servers and archive shards make it." },
];
const T2_BUILDINGS = [
  { id:"relay",     name:"relay",         icon:"📡", cost:{grass:5},                           ratio:1.15, fx:{"t2.signal":0.5},                   desc:"passes the signal along. +0.5 📡/s." },
  { id:"node",      name:"node",          icon:"🖥️", cost:{grass:40,  signal:60},              ratio:1.17, fx:{"t2.signal":3, "t2.trust":0.1},     desc:"a milady runs one. +3 📡/s, +0.1 🤝/s." },
  { id:"mesh",      name:"mesh link",     icon:"🕸️", cost:{grass:120, signal:400},             ratio:1.18, fx:{"t2.trust":0.6},                    desc:"a thread between two nodes. +0.6 🤝/s." },
  { id:"namesrv",   name:"name server",   icon:"🏷️", cost:{grass:300, trust:500},              ratio:1.2,  fx:{"t2.memory":0.15},                  desc:"everyone gets a name, nobody owns the list. +0.15 🗄️/s." },
  { id:"keyserver", name:"keyserver",     icon:"🔑", cost:{signal:2500, trust:300},            ratio:1.2,  fx:{"t2mult.signal":0.1, "t2mult.trust":0.1}, desc:"the handshake, kept. +10% 📡 and 🤝." },
  { id:"shard",     name:"archive shard", icon:"🗄️", cost:{signal:2e4, trust:3000, memory:200}, ratio:1.22, fx:{"t2.memory":1.2},                   desc:"a piece of everything. +1.2 🗄️/s." },
  // what reaches back into the first tier
  { id:"uplink",    name:"uplink",        icon:"🛰️", cost:{signal:1500, trust:150},            ratio:1.35, fx:{grass:0.1},                         desc:"+10% grass every time it's touched." },
  { id:"seedbank",  name:"seed bank",     icon:"🌱", cost:{trust:600, memory:60},              ratio:1.35, fx:{all:0.25},                          desc:"+25% to everything the network makes, so the gardener's runs go faster." },
];
const T2_TECH = [
  { id:"gossip",    name:"gossip protocol",    cost:{signal:500},                 fx:{"t2mult.signal":0.5},  desc:"+50% 📡." },
  { id:"wot",       name:"web of trust",       cost:{signal:3000, trust:400},     fx:{"t2mult.trust":0.5},   desc:"+50% 🤝." },
  { id:"cas",       name:"content addressing", cost:{trust:2000, memory:150},     fx:{"t2mult.memory":0.5},  desc:"+50% 🗄️." },
  { id:"fastlane",  name:"fast lanes",         cost:{signal:8000, trust:1000},    fx:{all:1},                desc:"+100% to everything the network makes." },
  { id:"seedvault", name:"seed vault",         cost:{trust:5000, memory:500},     fx:{grass:0.5},            desc:"+50% grass every time it's touched." },
  { id:"consensus", name:"consensus",          cost:{memory:2000},                fx:{epochCost:-0.2},       desc:"epochs ask 20% less." },
];

/* rituals: spend devotion for something now. cd is the cooldown in seconds. */
const RITUALS = [
  { id:"prayer",   name:"group prayer",     icon:"🙏", cost:{devotion:30}, cd:180, desc:"+30% happiness for 2 minutes." },
  { id:"hyperpost",name:"hyperpost",        icon:"⚡", cost:{devotion:25}, cd:120, desc:"posts make 10× for 30 seconds." },
  { id:"airdrop",  name:"airdrop",          icon:"🪂", cost:{devotion:50}, cd:300, desc:"two minutes of everything you make, right now." },
  { id:"meetup",   name:"meetup",           icon:"🫂", cost:{devotion:40}, cd:300, desc:"up to 10 miladys turn up at once, if there's room." },
  { id:"bull",     name:"summon the bull",  icon:"🐂", cost:{devotion:60}, cd:600, desc:"the market jumps straight to mania." },
  { id:"vigil",    name:"vigil",            icon:"🕯️", cost:{devotion:80}, cd:600, desc:"+50% everything for 2 minutes.", tech:"mass" },
];

/* raids: n miladys leave for secs seconds, and come home with `loot` seconds of what you make of those resources.
   Some may not come back. */
const RAIDS = [
  { id:"replies",  name:"the replies",      n:3,  secs:120,  loot:{clout:180, memes:180},          relic:0.06, lose:0,    desc:"easy. somebody said something wrong." },
  { id:"discord",  name:"a rival discord",  n:6,  secs:300,  loot:{memes:300, cult:300},           relic:0.12, lose:0.08, desc:"they have emotes we don't." },
  { id:"ct",       name:"crypto twitter",   n:10, secs:600,  loot:{cult:600, clout:600},           relic:0.25, lose:0.12, desc:"loud, rich, and mostly bots." },
  { id:"timeline", name:"the timeline",     n:20, secs:1200, loot:{vibes:900, memes:900, cult:900, lore:900, drip:900, clout:900}, relic:0.5, lose:0.18, desc:"all of it at once." },
  { id:"cancel",   name:"the cancel",       n:30, secs:2400, loot:{cult:1800, clout:1800, drip:1800, lore:1800}, relic:1, lose:0.3, desc:"it's coming anyway. go to it. (cancel.tylerirl.com)" },
];

/* relics come home from raids and are kept forever. Another copy levels one up, to 5. fx is per level.
   wear: the trait your own milady puts on while you hold it (one per slot: the highest level wins). */
const RELIC_MAX = 5;
const RELICS = [
  { id:"hat",      name:"milady hat",       icon:"🧢", fx:{click:2},              desc:"+2 vibes per post", wear:["Hat","Trucker Gothic Milady.webp"] },
  { id:"coin",     name:"cult coin",        icon:"🪙", fx:{"mult.cult":0.04},     desc:"+4% $CULT", wear:["Necklaces","Silver Coin Necklace.webp"] },
  { id:"light",    name:"pink ring light",  icon:"💡", fx:{"job.poster":0.05},    desc:"posters +5%", wear:["Glasses","Harajuku Glasses.webp"] },
  { id:"frog",     name:"frog plush",       icon:"🐸", fx:{"job.memer":0.05},     desc:"memers +5%" },
  { id:"scroll",   name:"lore scroll",      icon:"📜", fx:{"mult.lore":0.04},     desc:"+4% lore" },
  { id:"bonkler",  name:"bonkler figurine", icon:"🤖", fx:{all:0.02},             desc:"+2% everything" },
  { id:"hoodie",   name:"hikki hoodie",     icon:"🧥", fx:{happy:0.02},           desc:"+2% happiness", wear:["Shirt","Hikki Condition Shirt.webp"] },
  { id:"nano",     name:"ledger nano",      icon:"🔐", fx:{"capMult.cult":0.1},   desc:"+10% room for $CULT", wear:["Necklaces","Fliphone Lanyard.webp"] },
  { id:"sticker",  name:"remilio sticker",  icon:"🏷️", fx:{"job.trader":0.05},    desc:"traders +5%", wear:["Shirt","Remilia Tank.webp"] },
  { id:"palette",  name:"paint palette",    icon:"🎨", fx:{"job.artist":0.06},    desc:"artists +6%", wear:["Hat","Beret.webp"] },
  { id:"deck",     name:"stream deck",      icon:"🎛️", fx:{"job.streamer":0.06},  desc:"streamers +6%", wear:["Hat","Kossphones.webp"] },
  { id:"hammer",   name:"ban hammer",       icon:"🔨", fx:{happy:0.02},           desc:"+2% happiness", wear:["Earrings","Double Safety Pins.webp"] },
  { id:"chip",     name:"spare gpu",        icon:"🖥️", fx:{"mult.compute":0.05},  desc:"+5% compute", wear:["Glasses","Prescription Glasses.webp"] },
  { id:"rosary",   name:"rosary",           icon:"📿", fx:{"mult.devotion":0.05}, desc:"+5% devotion", wear:["Necklaces","Coral Cross Necklace.webp"] },
  { id:"candle",   name:"prayer candle",    icon:"🕯️", fx:{"job.acolyte":0.06},   desc:"acolytes +6%", wear:["Earrings","Chrome Cross.webp"] },
  { id:"zipties",  name:"zip ties",         icon:"🪢", fx:{"capMult.memes":0.1},  desc:"+10% room for memes" },
  { id:"usb",      name:"flash drive",      icon:"💾", fx:{"capMult.lore":0.1},   desc:"+10% room for lore" },
  { id:"tama",     name:"tamagotchi",       icon:"🥚", fx:{autoclick:1},          desc:"posts for you once a second" },
  { id:"cat",      name:"lucky cat",        icon:"🐱", fx:{sparkle:0.15},         desc:"sparkles +15% more often", wear:["Hat","Cat Ears with Bell.webp"] },
  { id:"keys",     name:"house keys",       icon:"🔑", fx:{housing:2},            desc:"room for 2 more miladys" },
  { id:"teddy",    name:"teddy bear",       icon:"🧸", fx:{happy:0.03},           desc:"+3% happiness", wear:["Hat","Bear Ears.webp"] },
  { id:"glitter",  name:"glitter",          icon:"✨", fx:{"mult.drip":0.05},     desc:"+5% drip", wear:["Face Decoration","Star Heart Tattoo.webp"] },
  { id:"mega",     name:"megaphone",        icon:"📢", fx:{"mult.clout":0.05},    desc:"+5% clout" },
  { id:"clippings",name:"grass clippings",  icon:"🌿", fx:{grass:0.03},           desc:"+3% grass when you touch it", wear:["Hat","Flower Clip.webp"] },
];

/* the cathedral: built a stage at a time, in order. Every stage is +10% everything; some do more. */
const WONDER = [
  { name:"the foundation",   cost:{memes:3000,  cult:2000,  ether:10},               fx:{all:0.1} },
  { name:"the nave",         cost:{memes:5000,  cult:4000,  ether:20},               fx:{all:0.1, housing:10, capAll:0.2} },
  { name:"the pews",         cost:{memes:7000,  drip:1200,  ether:30},               fx:{all:0.1, happy:0.1} },
  { name:"the choir",        cost:{cult:7000,   clout:2000, ether:40},               fx:{all:0.1, "mult.devotion":0.5} },
  { name:"the windows",      cost:{drip:1800,   clout:3000, ether:55},               fx:{all:0.1, sparkle:0.5, capAll:0.2} },
  { name:"the altar",        cost:{cult:10000,  devotion:600, ether:70},             fx:{all:0.1, ritualCd:-0.25} },
  { name:"the bells",        cost:{memes:10000, clout:4000, ether:90},               fx:{all:0.1, autoclick:20} },
  { name:"the spire",        cost:{cult:14000,  compute:3000, ether:110},            fx:{all:0.1, housingMult:0.25} },
  { name:"the icon",         cost:{drip:2500,   devotion:1200, ether:140},           fx:{all:0.1, grass:0.5} },
  { name:"the infinite",     cost:{cult:18000,  memes:14000, clout:5000, ether:180}, fx:{all:0.5, grass:1} },
];

/* challenges: touch grass into a run with a rule bent. Get to the infinite garden under it and the reward is yours for good. */
const CHALLENGES = [
  { id:"logoff",  name:"logged off",   rule:"you can't post. the network has to do it.",            reward:{autoclick:5},        rdesc:"you post 5 more times a second, forever" },
  { id:"bear",    name:"bear season",  rule:"the market is a bear market, the whole run.",          reward:{"mult.lore":0.25, all:0.05}, rdesc:"+25% lore and +5% everything, forever" },
  { id:"small",   name:"small world",  rule:"room for 25 miladys, no more, however much you build.", reward:{"job.poster":0.25, "job.memer":0.25, "job.trader":0.25}, rdesc:"posters, memers and traders +25%, forever" },
  { id:"frugal",  name:"no frills",    rule:"no upgrades.",                                          reward:{"costMult.tech":-0.15, happy:0.05}, rdesc:"research 15% cheaper and +5% happiness, forever" },
  { id:"speed",   name:"speedrun",     rule:"reach the infinite garden inside 90 minutes of play.",  reward:{grass:0.5},          rdesc:"+50% grass every time you touch it, forever" },
];

const PHASE_SECS = 120;
const PHASES = [
  { id:"accum", name:"accumulation", icon:"🌱", color:"#50fa7b", mod:{lore:0.2},             desc:"+20% lore" },
  { id:"mania", name:"mania",        icon:"🚀", color:"#f1fa8c", mod:{cult:0.5, vibes:0.2},  desc:"+50% $CULT, +20% vibes" },
  { id:"dist",  name:"distribution", icon:"🎪", color:"#ffb86c", mod:{clout:0.3, memes:0.1}, desc:"+30% clout, +10% memes" },
  { id:"bear",  name:"bear market",  icon:"🐻", color:"#ff5555", mod:{vibes:-0.3, lore:0.3}, desc:"-30% vibes, +30% lore" },
];

const ACHIEVEMENTS = [
  { id:"first",    name:"first post",          desc:"post once.",                         test:s=>s.stats.clicks>=1 },
  { id:"thousand", name:"poster",              desc:"post 1,000 times.",                  test:s=>s.stats.clicks>=1000 },
  { id:"tenk",     name:"terminally online",   desc:"post 10,000 times.",                 test:s=>s.stats.clicks>=10000 },
  { id:"friend",   name:"a friend",            desc:"a milady joins.",                    test:s=>s.miladys.length>=1 },
  { id:"ten",      name:"group chat",          desc:"10 miladys.",                        test:s=>s.miladys.length>=10 },
  { id:"fifty",    name:"discourse",           desc:"50 miladys.",                        test:s=>s.miladys.length>=50 },
  { id:"hundred",  name:"a scene",             desc:"100 miladys.",                       test:s=>s.miladys.length>=100 },
  { id:"twofifty", name:"a movement",          desc:"250 miladys.",                       test:s=>s.miladys.length>=250 },
  { id:"rich",     name:"bag",                 desc:"hold 1,000 $CULT.",                  test:s=>s.res.cult>=1000 },
  { id:"whale",    name:"whale",               desc:"hold 50,000 $CULT.",                 test:s=>s.res.cult>=50000 },
  { id:"scholar",  name:"well read",           desc:"research 8 things.",                 test:s=>Object.keys(s.tech).length>=8 },
  { id:"twenty",   name:"overeducated",        desc:"research 25 things in one run.",     test:s=>Object.keys(s.tech).length>=25 },
  { id:"allres",   name:"all of it",           desc:"research everything there is.",      test:s=>TECHS.every(t=>s.tech[t.id]) },
  { id:"sparkle",  name:"shiny",               desc:"catch a sparkle.",                   test:s=>s.stats.sparkles>=1 },
  { id:"sparkle25",name:"magpie",              desc:"catch 25 sparkles.",                 test:s=>s.stats.sparkles>=25 },
  { id:"cycle",    name:"full cycle",          desc:"see the market go all the way round.", test:s=>s.cycle>=1 },
  { id:"happy",    name:"good vibes",          desc:"150% happiness.",                    test:(s,r)=>r && r.happy>=1.5 },
  { id:"grass",    name:"touched grass",       desc:"touch grass.",                       test:s=>s.stats.resets>=1 },
  { id:"grass5",   name:"outside",             desc:"touch grass 5 times.",               test:s=>s.stats.resets>=5 },
  { id:"lawn",     name:"lawn",                desc:"hold 25 grass at once.",             test:s=>s.grass>=25 },
  { id:"meadow",   name:"meadow",              desc:"hold 100 grass at once.",            test:s=>s.grass>=100 },
  { id:"garden",   name:"tend the garden",     desc:"build 5 gardens.",                   test:s=>(s.b.garden||0)>=5 },
  { id:"singular", name:"singular",            desc:"research the singularity.",          test:s=>!!s.tech.singularity },
  { id:"remilio",  name:"the boys",            desc:"a remilio joins.",                   test:s=>s.miladys.some(m=>m.kind==="remilio") },
  { id:"ritual",   name:"devout",              desc:"hold a ritual.",                     test:s=>(s.stats.rituals||0)>=1 },
  { id:"ritual50", name:"high priestess",      desc:"hold 50 rituals.",                   test:s=>(s.stats.rituals||0)>=50 },
  { id:"raid",     name:"raid leader",         desc:"bring a raid home.",                 test:s=>(s.stats.raids||0)>=1 },
  { id:"cancelled",name:"cancelled the cancel",desc:"bring a raid home from the cancel.", test:s=>(s.stats.cancels||0)>=1 },
  { id:"relic",    name:"finders keepers",     desc:"find a relic.",                      test:s=>Object.keys(s.relics||{}).length>=1 },
  { id:"relics",   name:"collector",           desc:"find 12 different relics.",          test:s=>Object.keys(s.relics||{}).length>=12 },
  { id:"relicall", name:"museum",              desc:"find every relic.",                  test:s=>RELICS.every(r=>(s.relics||{})[r.id]) },
  { id:"maxrelic", name:"polished",            desc:"take a relic to level 5.",           test:s=>Object.values(s.relics||{}).some(v=>v>=RELIC_MAX) },
  { id:"foundation",name:"groundbreaking",     desc:"lay the cathedral's foundation.",    test:s=>(s.wonder||0)>=1 },
  { id:"infinite", name:"the infinite",        desc:"finish the cathedral.",              test:s=>(s.wonder||0)>=WONDER.length },
  { id:"challenge",name:"rules are rules",     desc:"finish a challenge.",                test:s=>Object.keys(s.chDone||{}).length>=1 },
  { id:"challenges",name:"no rules",           desc:"finish every challenge.",            test:s=>CHALLENGES.every(c=>(s.chDone||{})[c.id]) },
  { id:"robots",   name:"hands off",           desc:"let the robots buy 100 buildings in one run.", test:s=>((s.run.auto||{}).b||0)>=100 },
  { id:"rfc",      name:"request for comments",desc:"finish the protocol.",               test:s=>((s.nn||{}).i||0)>=1 },
  { id:"halfway",  name:"halfway there",       desc:"finish four stages of the new internet.", test:s=>((s.nn||{}).i||0)>=4 },
  { id:"online",   name:"online",              desc:"turn on the new internet.",          test:s=>!!s.ended },
  { id:"epoch",    name:"uptime",              desc:"finish an epoch of the new internet.", test:s=>((s.nn||{}).e||0)>=1 },
  { id:"epochs",   name:"the long now",        desc:"finish ten epochs of the new internet.", test:s=>((s.nn||{}).e||0)>=10 },
  { id:"gardener", name:"green thumb",         desc:"let the gardener touch grass for you.", test:s=>!!(s.perks||{}).gardener },
  { id:"uplinked", name:"uplinked",            desc:"build an uplink.",                   test:s=>!!(s.t2 && s.t2.b.uplink) },
  { id:"protocols",name:"rfc compliant",       desc:"research every protocol.",           test:s=>!!s.t2 && T2_TECH.every(t=>s.t2.tech[t.id]) },
];

const NAMES = ["Miyu","Lain","Sakura","Remi","Yuki","Hana","Momo","Kiki","Nana","Rin","Aoi","Mika","Luna","Coco","Pika","Suki",
  "Emi","Noa","Rei","Yume","Kumi","Chi","Mei","Hoshi","Tama","Riri","Nao","Sora","Fumi","Ume","Kaya","Lulu","Mimi","Ruru",
  "Bambi","Cherry","Pixie","Dolly","Bunny","Peaches","Angel","Velvet","Sugar","Sailor","Kitty","Plum","Honey","Juno","Echo",
  "Nyx","Vesper","Wren","Ivy","Opal","Pearl","Ruby","Saffron","Tansy","Zuzu","Babydoll","Glitter","Neko","Usagi","Kuro","Shiro"];
const REMILIO_NAMES = ["Remilio","Bo","Rocco","Jett","Dante","Milo","Ozzy","Kai","Rex","Taz","Ziggy","Bash","Gus","Lenny","Nico",
  "Duke","Ace","Rudy","Moe","Sid","Fritz","Bruno","Vinnie","Hank","Skip","Chet","Biff","Rico","Spike","Dash"];

/* what the timeline says while you're on it */
const FEED = {
  accum: ["quiet out there. good time to read.", "someone is building something in a group chat.", "the charts are flat. the lore isn't."],
  mania: ["everything is going up. everyone is a genius.", "a stranger asks what a milady is.", "the timeline is loud today."],
  dist:  ["people are cashing out and posting about it.", "it's all clout now.", "a lot of new accounts. most won't stay."],
  bear:  ["red candles all day. post through it.", "the tourists left. the lore is still here.", "nobody's buying. everybody's reading."],
};
