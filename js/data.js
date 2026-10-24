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
*/

const RES = [
  { id:"vibes", name:"vibes", icon:"🌸", color:"#ff79c6", cap:500,  desc:"what the network runs on. every milady eats some." },
  { id:"memes", name:"memes", icon:"🐸", color:"#50fa7b", cap:200,  desc:"what the network is built out of." },
  { id:"cult",  name:"$CULT", icon:"coin", color:"#f1fa8c", cap:100, desc:"money. traders make it." },
  { id:"lore",  name:"lore",  icon:"📜", color:"#bd93f9", cap:250,  desc:"spend it on research." },
  { id:"drip",  name:"drip",  icon:"💧", color:"#8be9fd", cap:50,   desc:"taste, distilled. artists make it." },
  { id:"clout", name:"clout", icon:"📣", color:"#ffb86c", cap:100,  desc:"people paying attention. streamers make it." },
];

const EAT = 0.5; // vibes per second, per milady

const JOBS = [
  { id:"poster",  name:"poster",     icon:"💬", res:"vibes", rate:1.0,   desc:"posts all day. makes vibes." },
  { id:"memer",   name:"memer",      icon:"🐸", res:"memes", rate:0.1,   desc:"makes memes." },
  { id:"keeper",  name:"lorekeeper", icon:"📜", res:"lore",  rate:0.15,  desc:"reads the archive. makes lore.", show:s=>s.b.archive>0 },
  { id:"trader",  name:"trader",     icon:"📈", res:"cult",  rate:0.06,  desc:"watches charts. makes $CULT.", tech:"wallets" },
  { id:"artist",  name:"artist",     icon:"🎨", res:"drip",  rate:0.04, desc:"makes drip.", tech:"aesthetics" },
  { id:"streamer",name:"streamer",   icon:"📣", res:"clout", rate:0.04,  desc:"goes live. makes clout.", tech:"streaming" },
  { id:"mod",     name:"mod",        icon:"🛡️", res:null,    rate:0,     desc:"keeps the peace: +3% happiness each, and less drama.", tech:"moderation", happy:0.02 },
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
  { id:"wallet",    name:"cold wallet",    cost:{memes:50, cult:10}, ratio:1.3, fx:{"cap.cult":200},
    desc:"holds $CULT.", tech:"wallets" },
  { id:"discord",   name:"discord server", cost:{memes:200, cult:50}, ratio:1.3, fx:{housing:5},
    desc:"room for 5 more miladys.", tech:"servers" },
  { id:"desk",      name:"trading desk",   cost:{memes:120, cult:30}, ratio:1.15, fx:{"job.trader":0.12, "cap.cult":50},
    desc:"traders make 12% more.", tech:"charts" },
  { id:"studio",    name:"studio",         cost:{memes:150, cult:60}, ratio:1.15, fx:{"job.artist":0.1, "cap.drip":60},
    desc:"artists make 10% more, and more room for drip.", tech:"aesthetics" },
  { id:"stage",     name:"stream setup",   cost:{cult:100, drip:20}, ratio:1.15, fx:{"job.streamer":0.1, "cap.clout":100},
    desc:"streamers make 10% more, and more room for clout.", tech:"streaming" },
  { id:"shrine",    name:"shrine",         cost:{memes:100, drip:30}, ratio:1.2, fx:{happy:0.04},
    desc:"network spirituality. +4% happiness.", tech:"spirituality" },
  { id:"rig",       name:"ai rig",         cost:{cult:200, drip:40}, ratio:1.15, fx:{all:0.06},
    desc:"everything makes 6% more.", tech:"compute" },
  { id:"house",     name:"milady house",   cost:{memes:600, cult:400, drip:80}, ratio:1.25, fx:{housing:8},
    desc:"an irl house. room for 8 more.", tech:"irl" },
  { id:"billboard", name:"billboard",      cost:{cult:200, clout:50}, ratio:1.15, fx:{"mult.vibes":0.15, "mult.clout":0.05},
    desc:"+15% vibes, +5% clout.", tech:"marketing" },
  { id:"garden",    name:"the garden",     cost:{cult:1500, drip:250, clout:250}, ratio:1.25, fx:{all:0.05, happy:0.05, grass:0.1},
    desc:"it's infinite. +5% everything, +5% happiness, +10% grass when you touch it.", tech:"garden" },
];

const TECHS = [
  { id:"wallets",      name:"wallets",           cost:{lore:30},
    desc:"traders, and cold wallets to keep $CULT in." },
  { id:"memetics",     name:"memetics",          cost:{lore:50}, fx:{"job.memer":0.25},
    desc:"memers make 25% more." },
  { id:"servers",      name:"servers",           cost:{lore:100}, req:["wallets"],
    desc:"discord servers." },
  { id:"charts",       name:"charts",            cost:{lore:150, cult:20}, req:["wallets"],
    desc:"trading desks." },
  { id:"compression",  name:"compression",       cost:{lore:200}, req:["memetics"], fx:{"capMult.vibes":0.25, "capMult.memes":0.25},
    desc:"+25% room for vibes and memes." },
  { id:"aesthetics",   name:"aesthetics",        cost:{lore:250}, req:["memetics"],
    desc:"artists, drip and studios." },
  { id:"moderation",   name:"moderation",        cost:{lore:300}, req:["servers"],
    desc:"mods." },
  { id:"streaming",    name:"streaming",         cost:{lore:450, drip:10}, req:["aesthetics"],
    desc:"streamers, clout and stream setups." },
  { id:"spirituality", name:"network spirituality", cost:{lore:600, drip:25}, req:["aesthetics","moderation"],
    desc:"shrines." },
  { id:"archivism",    name:"archivism",         cost:{lore:900}, req:["compression"], fx:{"capMult.lore":0.5, "mult.lore":0.15},
    desc:"+50% room for lore, +15% lore." },
  { id:"compute",      name:"compute",           cost:{lore:800, cult:150}, req:["charts"],
    desc:"ai rigs." },
  { id:"irl",          name:"irl meetups",       cost:{lore:1100, clout:30}, req:["spirituality"],
    desc:"milady houses. miladys turn up twice as fast.", fx:{arrive:1} },
  { id:"marketing",    name:"marketing",         cost:{lore:1400, clout:60}, req:["streaming"],
    desc:"billboards." },
  { id:"hyperstition", name:"hyperstition",      cost:{lore:2000, drip:100}, req:["compute","marketing"], fx:{all:0.1, sparkle:0.5},
    desc:"+10% everything, and sparkles turn up more." },
  { id:"garden",       name:"the infinite garden", cost:{lore:3000, drip:150, clout:150}, req:["irl","hyperstition"],
    desc:"the garden. and you can touch grass." },
  { id:"postirony",    name:"post-irony",        cost:{lore:4500, clout:300}, req:["garden"], fx:{happy:0.1, "job.poster":0.5},
    desc:"+10% happiness, posters make 50% more." },
  { id:"september",    name:"eternal september", cost:{lore:6000, cult:2000}, req:["garden"], fx:{housingMult:0.25},
    desc:"+25% room for miladys everywhere." },
  { id:"accelerate",   name:"accelerationism",   cost:{lore:9000, cult:4000, drip:600}, req:["postirony","september"], fx:{all:0.25, autoclick:5},
    desc:"+25% everything, and you post 5 more times a second." },
];

/* bought once */
const UPGRADES = [
  { id:"takes",     name:"hot takes",      cost:{memes:15},             fx:{click:1},           desc:"+1 vibe per post.", show:s=>s.seen.memes>=5 },
  { id:"ringlight", name:"ring light",     cost:{vibes:150, memes:40},  fx:{"job.poster":0.25}, desc:"posters make 25% more.", show:s=>s.b.groupchat>0 },
  { id:"templates", name:"meme templates", cost:{memes:60},             fx:{"job.memer":0.25},  desc:"memers make 25% more.", show:s=>s.b.groupchat>0 },
  { id:"replyguy",  name:"reply guy",      cost:{memes:80, cult:20},    fx:{clickMult:1},       desc:"posts make twice as much.", tech:"wallets" },
  { id:"bot",       name:"posting bot",    cost:{memes:120, cult:60},   fx:{autoclick:1},       desc:"posts for you once a second.", tech:"wallets" },
  { id:"alpha",     name:"alpha group",    cost:{cult:80},              fx:{"job.trader":0.3},  desc:"traders make 30% more.", tech:"charts" },
  { id:"zip",       name:"zip files",      cost:{memes:150, lore:100},  fx:{"capMult.vibes":0.25, "capMult.memes":0.25}, desc:"+25% room for vibes and memes.", tech:"compression" },
  { id:"c2e",       name:"click to earn",  cost:{memes:300, cult:150},  fx:{clickRate:0.05},    desc:"every post also pays 5% of a second of vibes production.", tech:"charts" },
  { id:"lighting",  name:"mood lighting",  cost:{cult:50, drip:20},     fx:{happy:0.05},        desc:"+5% happiness.", tech:"aesthetics" },
  { id:"procreate", name:"procreate",      cost:{cult:100, drip:40},    fx:{"job.artist":0.3},  desc:"artists make 30% more.", tech:"aesthetics" },
  { id:"monitor",   name:"second monitor", cost:{cult:150, lore:300},   fx:{"mult.lore":0.25},  desc:"+25% lore.", tech:"servers" },
  { id:"obs",       name:"obs scenes",     cost:{drip:30, clout:40},    fx:{"job.streamer":0.3},desc:"streamers make 30% more.", tech:"streaming" },
  { id:"ledger",    name:"ledger",         cost:{cult:200},             fx:{"capMult.cult":0.5},desc:"+50% room for $CULT.", tech:"compute" },
  { id:"botnet",    name:"botnet",         cost:{cult:300, drip:60},    fx:{autoclick:4},       desc:"posts for you 4 more times a second.", tech:"compute" },
  { id:"hug",       name:"group hug",      cost:{drip:60, clout:80},    fx:{happy:0.08},        desc:"+8% happiness.", tech:"spirituality" },
  { id:"bible",     name:"lore bible",     cost:{memes:500, lore:1500}, fx:{"capMult.lore":0.5},desc:"+50% room for lore.", tech:"archivism" },
  { id:"viral",     name:"viral loop",     cost:{memes:800, clout:150}, fx:{"mult.vibes":0.25, "mult.clout":0.1}, desc:"+25% vibes, +10% clout.", tech:"marketing" },
  { id:"hyperpop",  name:"hyperpop",       cost:{cult:600, drip:200, clout:300}, fx:{all:0.1}, desc:"+10% everything.", tech:"hyperstition" },
  { id:"thinkpiece",name:"thinkpiece",     cost:{lore:4000, clout:400}, fx:{clickRate:0.15},    desc:"every post also pays 15% of a second more.", tech:"postirony" },
];

/* bought with grass, kept forever. Grass you hold is worth +3% to everything, so spending it is a trade. */
const GRASS_EACH = 0.03;
const PERKS = [
  { id:"headstart", name:"head start",      cost:2, fx:{},              desc:"every run starts with 2 group chats, 2 mood boards and 50 memes." },
  { id:"muscle",    name:"muscle memory",   cost:2, fx:{clickMult:2},   desc:"posts make 3× as much." },
  { id:"wellness",  name:"wellness",        cost:4, fx:{happy:0.1},     desc:"+10% happiness." },
  { id:"sleep",     name:"sleep schedule",  cost:3, fx:{},              desc:"time away counts for up to 24 hours instead of 8." },
  { id:"golden",    name:"golden hour",     cost:4, fx:{sparkle:1},     desc:"sparkles turn up twice as often." },
  { id:"landlord",  name:"landlord",        cost:5, fx:{housing:4},     desc:"room for 4 more miladys." },
  { id:"scholar",   name:"quick learner",   cost:6, fx:{"costMult.tech":-0.2}, desc:"research costs 20% less." },
  { id:"memory",    name:"long memory",     cost:8, fx:{},              desc:"keep wallets, memetics and servers when you touch grass." },
];

/* the market goes round. Each phase lasts PHASE_SECS. */
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
  { id:"rich",     name:"bag",                 desc:"hold 1,000 $CULT.",                  test:s=>s.res.cult>=1000 },
  { id:"scholar",  name:"well read",           desc:"research 8 things.",                 test:s=>Object.keys(s.tech).length>=8 },
  { id:"allres",   name:"all of it",           desc:"research everything.",               test:s=>TECHS.every(t=>s.tech[t.id]) },
  { id:"sparkle",  name:"shiny",               desc:"catch a sparkle.",                   test:s=>s.stats.sparkles>=1 },
  { id:"sparkle25",name:"magpie",              desc:"catch 25 sparkles.",                 test:s=>s.stats.sparkles>=25 },
  { id:"cycle",    name:"full cycle",          desc:"see the market go all the way round.", test:s=>s.cycle>=1 },
  { id:"happy",    name:"good vibes",          desc:"150% happiness.",                    test:(s,r)=>r && r.happy>=1.5 },
  { id:"grass",    name:"touched grass",       desc:"touch grass.",                       test:s=>s.stats.resets>=1 },
  { id:"lawn",     name:"lawn",                desc:"hold 25 grass at once.",             test:s=>s.grass>=25 },
  { id:"garden",   name:"tend the garden",     desc:"build 5 gardens.",                   test:s=>(s.b.garden||0)>=5 },
];

const NAMES = ["Miyu","Lain","Sakura","Remi","Yuki","Hana","Momo","Kiki","Nana","Rin","Aoi","Mika","Luna","Coco","Pika","Suki",
  "Emi","Noa","Rei","Yume","Kumi","Chi","Mei","Hoshi","Tama","Riri","Nao","Sora","Fumi","Ume","Kaya","Lulu","Mimi","Ruru",
  "Bambi","Cherry","Pixie","Dolly","Bunny","Peaches","Angel","Velvet","Sugar","Sailor","Kitty","Plum","Honey","Juno","Echo",
  "Nyx","Vesper","Wren","Ivy","Opal","Pearl","Ruby","Saffron","Tansy","Zuzu","Babydoll","Glitter","Neko","Usagi","Kuro","Shiro"];

/* what the timeline says while you're on it */
const FEED = {
  accum: ["quiet out there. good time to read.", "someone is building something in a group chat.", "the charts are flat. the lore isn't."],
  mania: ["everything is going up. everyone is a genius.", "a stranger asks what a milady is.", "the timeline is loud today."],
  dist:  ["people are cashing out and posting about it.", "it's all clout now.", "a lot of new accounts. most won't stay."],
  bear:  ["it's cold. post through it.", "the tourists left. the lore is still here.", "nobody's buying. everybody's reading."],
};
