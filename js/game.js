"use strict";
/* the network is growing: the engine and the page. Content lives in js/data.js. */

const SAVE_KEY = "network-save-v1";
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if(cls) e.className = cls; if(html!=null) e.innerHTML = html; return e; };
const rnd = Math.random, choice = a => a[Math.floor(rnd()*a.length)];
const byId = (list, id) => list.find(x=>x.id===id);
const RES_BY = Object.fromEntries(RES.map(r=>[r.id, r]));
const JOB_BY = Object.fromEntries(JOBS.map(j=>[j.id, j]));

/* ---------- numbers ---------- */
/* four ways to write a big number, picked in settings: short (1.23M), scientific (1.23e6), engineering (the exponent
   in threes, like the suffixes: 1.23e6, 45.6e6) and words (1.23 million). Below a thousand they all agree. */
const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "UDc", "DDc", "TDc", "QaDc", "QiDc", "SxDc", "SpDc", "OcDc", "NoDc", "Vg"];
const WORDS = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion", "sextillion", "septillion", "octillion", "nonillion",
  "decillion", "undecillion", "duodecillion", "tredecillion", "quattuordecillion", "quindecillion", "sexdecillion", "septendecillion", "octodecillion", "novemdecillion", "vigintillion"];
const NOTATIONS = { short:"1.23M", sci:"1.23e6", eng:"45.6e6", words:"1.23 million" };
const sig3 = v => v<10 ? v.toFixed(2) : v<100 ? v.toFixed(1) : Math.floor(v).toString(); // three figures
function fmt(n, dp){
  if(!isFinite(n)) return "∞";
  const neg = n<0; n = Math.abs(n);
  let out;
  if(n<1000) out = dp!=null ? n.toFixed(dp) : (n<10 && n%1 ? n.toFixed(1) : Math.floor(n).toString());
  else {
    const mode = (typeof S!=="undefined" && S && S.settings && S.settings.num) || "short";
    const e = Math.floor(Math.log10(n)), k = Math.floor(e/3);
    if(mode==="sci" || (k >= SUFFIX.length && mode!=="eng")) out = (n/Math.pow(10, e)).toFixed(2)+"e"+e;
    else if(mode==="eng") out = sig3(n/Math.pow(1000, k))+"e"+k*3;
    else if(mode==="words") out = sig3(n/Math.pow(1000, k))+" "+WORDS[k];
    else out = sig3(n/Math.pow(1000, k))+SUFFIX[k];
  }
  return (neg ? "-" : "") + out;
}
/* a rate keeps a little more precision while it's small, so a trickle doesn't read as nothing */
const fmtRate = n => { const a = Math.abs(n);
  return (n>=0 ? "+" : "-") + (n===0 ? "0" : a<0.1 ? a.toFixed(3) : a<10 ? a.toFixed(2) : fmt(a)) + "/s"; };
function fmtTime(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  return h ? h+"h "+m+"m" : m ? m+"m "+s+"s" : s+"s";
}
const pct = x => Math.round(x*100)+"%";
const localFile = path => (window.INLINE_FILES && window.INLINE_FILES[path]) || path; // dist.html carries its pictures inside it
const COIN = localFile("assets/img/cult_coin.png");
const resIcon = id => RES_BY[id].icon==="coin" ? '<img class="coin" src="'+COIN+'" alt="$CULT">' : RES_BY[id].icon;

/* ---------- state ---------- */
let S = null;
function fresh(keep){
  const s = {
    v:1, last:Date.now(), t:0, runT:0,
    res:{}, seen:{}, b:{}, tech:{}, up:{}, miladys:[], nextId:1,
    cycle:0, phaseT:0, buffs:[],
    timers:{ arrive:0, leave:0, sparkle:60, drama:180, auto:0, feed:40 },
    run:{ cult:0, start:Date.now() },
    grass:0, perks:{}, ach:{}, relics:{}, chDone:{}, challenge:null,
    cd:{}, raids:[], wonder:0, autoJob:"poster",
    stats:{ clicks:0, sparkles:0, resets:0, played:0, made:{}, rituals:0, raids:0, cancels:0 },
    you:null, settings:{ mute:false, bg:true, calm:!!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) }, log:[], started:false,
  };
  for(const r of RES){ s.res[r.id] = 0; s.seen[r.id] = 0; }
  for(const b of BUILDINGS) s.b[b.id] = 0;
  if(keep) Object.assign(s, keep);
  return s;
}
function save(){
  if(!S) return;
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
}
function load(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(raw) return migrate(JSON.parse(raw));
  }catch(e){}
  return null;
}
function migrate(s){ // fill in anything a newer version added
  const base = fresh();
  for(const k in base) if(s[k]==null) s[k] = base[k];
  for(const k of ["res","seen","b","timers","stats","settings","run"]) s[k] = Object.assign({}, base[k], s[k]);
  return s;
}

/* ---------- the rules ---------- */
const resets = s => s.stats.resets || 0;
const opened = (s, x) => resets(s) >= (x.ng||0); // has this layer opened yet
const rule = (s, id) => s.challenge===id; // a challenge run bends one rule
/* who's doing what. A remilio counts for more than one (job weight); someone away raiding counts for nothing. */
function jobCounts(s, f){
  const c = { idle:0, away:0, w:{} }, rw = 1.25 + ((f && f.remilio)||0);
  for(const j of JOBS){ c[j.id] = 0; c.w[j.id] = 0; }
  for(const m of s.miladys){
    if(m.away){ c.away++; continue; }
    const j = m.job || "idle";
    c[j]++;
    if(j!=="idle") c.w[j] += m.kind==="remilio" ? rw : 1;
  }
  return c;
}
function sumFx(s){
  const f = {};
  const add = (fx, n) => { if(fx && n) for(const k in fx) f[k] = (f[k]||0) + fx[k]*n; };
  for(const b of BUILDINGS) add(b.fx, s.b[b.id]);
  for(const t of TECHS) if(s.tech[t.id]) add(t.fx, 1);
  if(!rule(s, "frugal")) for(const u of UPGRADES) if(s.up[u.id]) add(u.fx, 1);
  for(const p of PERKS) if(s.perks[p.id]) add(p.fx, 1);
  for(const r of RELICS) if(s.relics[r.id]) add(r.fx, s.relics[r.id]);
  for(let i=0; i<(s.wonder||0); i++) add(WONDER[i].fx, 1);
  for(const c of CHALLENGES) if(s.chDone[c.id]) add(c.reward, 1);
  return f;
}
const buff = (s, key) => s.buffs.reduce((a,b)=>a + (b[key]||0), 0);
function phase(s){ return rule(s, "bear") ? PHASES[3] : PHASES[Math.floor(s.phaseT/PHASE_SECS) % PHASES.length]; }

/* a crowd gets crabby: nothing up to ten, then less and less for each one more (-53% at 100, -75% at 200, -98% at 400) */
const crowding = n => n > 10 ? 0.35*Math.log(1 + (n-10)/25) : 0;

/* everything the economy is doing right now */
function rates(s){
  const f = sumFx(s), jobs = jobCounts(s, f), home = s.miladys.length - jobs.away, ph = phase(s);
  const happy = Math.max(0.25, 1 + (f.happy||0) + jobs.mod*0.03 - crowding(home) + buff(s, "happy"));
  const grassMult = 1 + s.grass*(GRASS_EACH + (f.grassEach||0));
  const prod = {}, cap = {}, net = {};
  for(const r of RES){
    let base = (f["rate."+r.id] || 0) + (f["idle."+r.id] || 0) * jobs.idle;
    for(const j of JOBS) if(j.res===r.id) base += jobs.w[j.id] * j.rate * (1 + (f["job."+j.id]||0)) * happy;
    const mult = Math.max(0, 1 + (f["mult."+r.id]||0) + (f.all||0) + (ph.mod[r.id]||0) + buff(s, "all"));
    prod[r.id] = base * mult * grassMult;
    cap[r.id] = (r.cap + (f["cap."+r.id]||0)) * (1 + (f["capMult."+r.id]||0) + (f.capAll||0));
    net[r.id] = prod[r.id];
  }
  const eat = home * EAT;
  net.vibes -= eat;
  let housing = Math.floor((f.housing||0) * (1 + (f.housingMult||0)));
  if(rule(s, "small")) housing = Math.min(housing, 25);
  const perPost = rule(s, "logoff") ? 0 : (1 + (f.click||0)) * (1 + (f.clickMult||0)) * (1 + buff(s, "click")) * grassMult;
  const click = perPost ? perPost + (f.clickRate||0) * Math.max(0, prod.vibes) : 0;
  return { f, jobs, happy, prod, cap, net, eat, housing, click, autoclick:f.autoclick||0, phase:ph, grassMult };
}

function gain(s, id, amt, cap){
  const before = s.res[id];
  s.res[id] = Math.max(0, Math.min(cap, before + amt));
  const got = s.res[id] - before;
  if(got>0){
    s.stats.made[id] = (s.stats.made[id]||0) + got;
    if(id==="cult") s.run.cult += got;
  }
  if(s.res[id] > s.seen[id]) s.seen[id] = s.res[id];
  return got;
}

function tick(s, dt, live){
  const R = rates(s);
  s.t += dt; s.runT += dt; s.stats.played += dt;
  for(const r of RES) gain(s, r.id, R.net[r.id]*dt, R.cap[r.id]);
  // your posting bots (they post even on a logged-off run: it's you who can't)
  if(R.autoclick){
    const per = rule(s, "logoff") ? (1 + (R.f.click||0)) * R.grassMult : R.click;
    gain(s, "vibes", per*R.autoclick*dt, R.cap.vibes);
  }

  // the market
  const before = Math.floor(s.phaseT/PHASE_SECS);
  s.phaseT += dt;
  const after = Math.floor(s.phaseT/PHASE_SECS);
  if(after!==before){
    if(after % PHASES.length===0) s.cycle++;
    if(live && !rule(s, "bear")){ const p = phase(s); FX.phase(p); log(p.icon+" the market turns: <b style='color:"+p.color+"'>"+p.name+"</b>. "+p.desc+"."); }
  }

  // miladys turn up while there's room and something to eat; they leave when there isn't
  const n = s.miladys.length;
  if(n < R.housing && s.res.vibes > 0){
    s.timers.arrive += dt * (1 + (R.f.arrive||0));
    if(s.timers.arrive >= 5){ s.timers.arrive = 0; const m = newMilady(s, R); if(live){ FX.arrive(); log((m.kind==="remilio" ? "🤘" : "🌸")+" <b>"+m.name+"</b> joined the network."); } }
  } else s.timers.arrive = 0;
  if((s.res.vibes <= 0 && R.net.vibes < 0) || n > R.housing){
    s.timers.leave += dt;
    if(s.timers.leave >= 4 && n){
      s.timers.leave = 0;
      const home = s.miladys.filter(m=>!m.away), m = home.find(m=>!m.job) || home[home.length-1];
      if(m){
        s.miladys.splice(s.miladys.indexOf(m), 1);
        if(live) log("🥀 <b>"+m.name+"</b> logged off. "+(n>R.housing ? "no room." : "the vibes ran out."), "bad");
      }
    }
  } else s.timers.leave = 0;

  for(let i=s.raids.length-1; i>=0; i--) if(s.raids[i].until <= s.t) raidHome(s, i, live);
  s.buffs = s.buffs.filter(b=>b.until > s.t);
  if(live) liveEvents(s, dt, R);
}

/* sparkles, drama and chatter only happen while you're watching */
function liveEvents(s, dt, R){
  s.timers.sparkle -= dt * (1 + (R.f.sparkle||0));
  if(s.timers.sparkle <= 0){ s.timers.sparkle = 90 + rnd()*150; spawnSparkle(); }
  s.timers.drama -= dt;
  if(s.timers.drama <= 0){
    s.timers.drama = 150 + rnd()*120;
    if(s.miladys.length >= 8 && rnd() < 0.35*Math.max(0, 1 - R.jobs.mod*0.1)){
      s.buffs.push({ kind:"drama", happy:-0.15, until:s.t+90 });
      log("💢 drama in the group chat. -15% happiness for 90s."+(s.tech.moderation ? " mods would help." : ""), "bad");
    }
  }
  s.timers.feed -= dt;
  if(s.timers.feed <= 0){ s.timers.feed = 50 + rnd()*70; log("<i>"+choice(FEED[R.phase.id])+"</i>", "dim"); }
}

/* ---------- prices ---------- */
function priceOf(b, s){
  const n = s.b[b.id] || 0, c = {};
  for(const k in b.cost) c[k] = b.cost[k] * Math.pow(b.ratio, n);
  return c;
}
function techPrice(t, s, f){
  const m = Math.max(0.2, 1 + ((f||sumFx(s))["costMult.tech"]||0)), c = {};
  for(const k in t.cost) c[k] = t.cost[k] * m;
  return c;
}
function ritualPrice(r, f){ const m = Math.max(0.2, 1 + (f.ritualCost||0)), c = {}; for(const k in r.cost) c[k] = r.cost[k]*m; return c; }
function wonderPrice(i, f){ const m = Math.max(0.2, 1 + (f.wonderCost||0)), c = {}; for(const k in WONDER[i].cost) c[k] = WONDER[i].cost[k]*m; return c; }
const canPay = (s, c) => Object.keys(c).every(k=>s.res[k] >= c[k]-1e-9);
const fitsCap = (c, cap) => Object.keys(c).every(k=>c[k] <= cap[k]+1e-9);
function pay(s, c){ for(const k in c) s.res[k] = Math.max(0, s.res[k]-c[k]); }

/* ---------- miladys (and, once the network has its spirituality, remilios) ---------- */
const KINDS = {
  milady: { cfg:"Milady", w:600, h:750, crop:[40, 20, 520],
    order:["Background","Skin","Face","Eyes","Mouth","Necklaces","Shirt","Hair","Brows","Earrings","Face Decoration","Glasses","Hat"],
    odds:{ Face:0.6, Necklaces:0.3, "Face Decoration":0.2, Earrings:0.3, Glasses:0.3, Hat:0.4 } },
  remilio: { cfg:"Remilio", w:600, h:600, crop:[60, 0, 480],
    order:["Background","Race","Brows","Eyes","Hair","Face","Shirt","Mouth","Costume","Earrings","Glasses","Hat","Weapon","Friend"],
    odds:{ Costume:0.2, Mouth:0.6, Face:0.3, Earrings:0.3, Glasses:0.3, Hat:0.4, Friend:0.3, Weapon:0.25 } },
};
let ASSETS = null;
function rollLook(kind){
  const K = KINDS[kind||"milady"], look = {};
  for(const layer of K.order){
    const files = (ASSETS && ASSETS[K.cfg] && ASSETS[K.cfg][layer]) || [];
    if(files.length && (K.odds[layer]==null || rnd()<K.odds[layer])) look[layer] = choice(files);
  }
  if(look.Costume) for(const l of ["Shirt","Hat","Glasses","Hair","Face"]) delete look[l]; // a costume is the whole outfit, hood and all
  return look;
}
function newMilady(s, R){
  const remilio = resets(s) >= 2 && rnd() < (s.perks.blessing ? 0.5 : 0.25);
  const kind = remilio ? "remilio" : "milady";
  const used = new Set(s.miladys.map(m=>m.name));
  let name = choice(remilio ? REMILIO_NAMES : NAMES), k = 2;
  if(used.has(name)){ while(used.has(name+" "+k)) k++; name = name+" "+k; }
  const f = R ? R.f : sumFx(s);
  const job = f.autoassign && s.autoJob && JOBS.some(j=>j.id===s.autoJob && shownIn(s, j)) ? s.autoJob : "";
  const m = { id:s.nextId++, name, job, kind, look:rollLook(kind), t:Date.now() };
  s.miladys.push(m);
  return m;
}

/* trait layers stack in order, at their own size: 600x750 for a milady, 600x600 for a remilio */
const imgCache = {};
function loadImg(url){
  if(!imgCache[url]) imgCache[url] = new Promise((res,rej)=>{
    const im = new Image();
    im.onload = ()=>res(im); im.onerror = ()=>rej(url);
    im.src = localFile(url);
  });
  return imgCache[url];
}
async function loadAssets(){
  if(window.INLINE_ASSET_INDEX) ASSETS = window.INLINE_ASSET_INDEX;
  else { const r = await fetch("assets/asset_index.json"); ASSETS = await r.json(); }
}
const lookCache = {};
function compose(look, noBg, kind){
  const K = KINDS[kind||"milady"], key = (kind||"milady") + JSON.stringify(look) + (noBg ? "-" : "");
  if(lookCache[key]) return lookCache[key];
  return lookCache[key] = (async ()=>{
    const layers = K.order.filter(l=>look[l] && !(noBg && l==="Background"));
    const ims = await Promise.all(layers.map(l=>loadImg("assets/img/"+K.cfg+"/"+l+"/"+look[l]).catch(()=>null)));
    const cv = document.createElement("canvas"); cv.width = K.w; cv.height = K.h;
    const cx = cv.getContext("2d");
    for(const im of ims) if(im) cx.drawImage(im, 0, 0, K.w, K.h);
    return cv;
  })();
}
/* a head-and-shoulders square, small enough to show a hundred of */
const thumbCache = {};
function thumb(look, kind){
  const K = KINDS[kind||"milady"], key = (kind||"milady") + JSON.stringify(look);
  return thumbCache[key] || (thumbCache[key] = compose(look, false, kind).then(cv=>{
    const t = document.createElement("canvas"); t.width = t.height = 128;
    t.getContext("2d").drawImage(cv, K.crop[0], K.crop[1], K.crop[2], K.crop[2], 0, 0, 128, 128);
    return t.toDataURL("image/webp", 0.85);
  }));
}

/* ---------- sound: tiny blips, made on the spot ---------- */
let AC = null;
function blip(freq, len, type, vol){
  if(S && S.settings.mute) return;
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type||"square"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq*1.5, t+len);
    g.gain.setValueAtTime(vol||0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t+len);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t+len);
  }catch(e){}
}
const sfx = {
  post: ()=>blip(520+rnd()*120, 0.06, "square", 0.025),
  buy:  ()=>{ blip(660, 0.08, "triangle", 0.06); setTimeout(()=>blip(990, 0.1, "triangle", 0.05), 60); },
  no:   ()=>blip(140, 0.12, "sawtooth", 0.03),
  shiny:()=>{ [880,1175,1568].forEach((f,i)=>setTimeout(()=>blip(f, 0.12, "sine", 0.06), i*70)); },
};

/* ---------- feed & toasts ---------- */
function log(html, kind){
  S.log.unshift({ html, kind:kind||"", t:Date.now() });
  if(S.log.length > 60) S.log.length = 60;
  renderLog();
}
function toast(html, ms){
  const t = el("div", "toast", html), box = $("toasts");
  box.appendChild(t);
  while(box.children.length > 3) box.firstChild.remove(); // a burst of news shows the latest three
  setTimeout(()=>{ t.classList.add("out"); setTimeout(()=>t.remove(), 300); }, ms||3200);
}
function renderLog(){
  const box = $("log"); if(!box) return;
  box.innerHTML = S.log.slice(0, 40).map(l=>'<div class="ln '+l.kind+'">'+l.html+'</div>').join("");
}

/* ---------- actions ---------- */
let R = null; // the latest rates, for the page
function post(e){
  if(rule(S, "logoff")){ if(e && e.clientX!=null) floatText(e.clientX, e.clientY, "logged off"); return sfx.no(); }
  const got = gain(S, "vibes", R.click, R.cap.vibes);
  S.stats.clicks++;
  sfx.post();
  const you = $("you-wrap");
  you.classList.remove("boop"); void you.offsetWidth; you.classList.add("boop");
  if(e && e.clientX!=null){ floatText(e.clientX, e.clientY, got>0 ? "+"+fmt(R.click)+" 🌸" : "full 🌸"); if(got>0) FX.post(e.clientX, e.clientY); }
}
function floatText(x, y, txt){
  const f = el("div", "float", txt);
  f.style.left = (x + (rnd()*30-15))+"px"; f.style.top = (y-10)+"px";
  document.body.appendChild(f);
  setTimeout(()=>f.remove(), 900);
}
const MEME_COST = 25;
function memeIt(times){
  times = Math.min(times, Math.floor(S.res.vibes/MEME_COST), Math.floor(R.cap.memes - S.res.memes));
  if(times < 1) return sfx.no();
  S.res.vibes -= times*MEME_COST; gain(S, "memes", times, R.cap.memes);
  sfx.post(); update();
}
function buyBuilding(id, card){
  const b = byId(BUILDINGS, id), c = priceOf(b, S);
  if(!canPay(S, c)) return sfx.no();
  pay(S, c); S.b[id]++; sfx.buy(); FX.buy(card);
  if(S.b[id]===1) log("🏗️ you built your first <b>"+b.name+"</b>.");
  refresh();
}
function buyTech(id, card){
  const t = byId(TECHS, id), c = techPrice(t, S);
  if(S.tech[id] || !canPay(S, c)) return sfx.no();
  pay(S, c); S.tech[id] = true; sfx.buy(); FX.buy(card, true); FX.research();
  log("📜 researched <b>"+t.name+"</b>. "+t.desc);
  refresh();
}
function buyUpgrade(id, card){
  const u = byId(UPGRADES, id);
  if(S.up[id] || !canPay(S, u.cost)) return sfx.no();
  pay(S, u.cost); S.up[id] = true; sfx.buy(); FX.buy(card);
  log("✨ <b>"+u.name+"</b>: "+u.desc);
  refresh();
}
function assign(job, n){
  for(let i=0; i<n; i++){
    const m = S.miladys.find(m=>!m.job && !m.away); if(!m) break;
    m.job = job;
  }
  refresh();
}
function unassign(job, n){
  for(let i=0; i<n; i++){
    const m = [...S.miladys].reverse().find(m=>m.job===job && !m.away); if(!m) break;
    m.job = "";
  }
  refresh();
}

/* ---------- touching grass ---------- */
function grassGain(s, f){
  return Math.floor(Math.sqrt(s.run.cult/500) * (1 + ((f||sumFx(s)).grass||0)));
}
/* did this run meet its challenge? (reaching the garden is the finish line; the speedrun also has a clock) */
function challengeMet(s){
  if(!s.challenge || !s.tech.garden) return false;
  return s.challenge!=="speed" || s.runT <= 90*60;
}
function touchGrass(into){
  const g = grassGain(S);
  if(!S.tech.garden || g < 1) return;
  const next = MILESTONES.find(m=>m.n===resets(S)+1);
  const ch = into ? byId(CHALLENGES, into) : null, met = challengeMet(S), cur = S.challenge ? byId(CHALLENGES, S.challenge) : null;
  openModal('<h2>touch grass?</h2><p>you log off. everything you built goes: the miladys, the buildings, the research, every resource.</p>'+
    '<p>you keep <b>+'+g+' grass 🌿</b>, your perks, your relics, your achievements and your own milady. every grass you hold makes everything '+pct(GRASS_EACH+(R.f.grassEach||0))+' faster.</p>'+
    (cur ? '<p>'+(met ? '✅ you beat <b>'+cur.name+'</b>: '+cur.rdesc+'.' : '❌ <b>'+cur.name+'</b> isn\'t beaten this time.')+'</p>' : "")+
    (next ? '<p class="unlock-note">🔓 next run opens <b>'+next.name+'</b>: '+next.desc+'</p>' : "")+
    (ch ? '<p class="unlock-note">⚖️ the next run is a challenge: <b>'+ch.name+'</b>. '+ch.rule+'</p>' : "")+
    '<div class="row"><button class="btn big" id="grass-yes">touch grass 🌿</button><button class="btn small" data-close>not yet</button></div>');
  $("grass-yes").onclick = ()=>{
    const done = Object.assign({}, S.chDone);
    if(met) done[S.challenge] = true;
    const keep = { grass:S.grass+g, perks:S.perks, ach:S.ach, you:S.you, settings:S.settings, started:true, relics:S.relics, chDone:done,
      challenge:into||null, autoJob:S.autoJob, stats:Object.assign(S.stats, { resets:S.stats.resets+1 }), log:[], nextId:S.nextId };
    S = fresh(keep);
    applyPerksAtStart(S);
    closeModal(); sfx.shiny(); FX.grass(); galleryKnown = null;
    log("🌿 you touched grass. +"+g+" grass. the network starts again, and it remembers you.");
    if(next) log("🔓 new: <b>"+next.name+"</b>. "+next.desc);
    if(met) log("✅ challenge beaten: <b>"+cur.name+"</b>. "+cur.rdesc+".");
    if(ch) log("⚖️ challenge: <b>"+ch.name+"</b>. "+ch.rule);
    tab = "network"; refresh(true);
  };
}
function applyPerksAtStart(s){
  if(s.perks.headstart){ s.b.groupchat = 2; s.b.moodboard = 2; s.res.memes = 50; s.seen.memes = 50; s.seen.vibes = 50; }
  if(s.perks.memory) for(const id of ["wallets","memetics","servers"]) s.tech[id] = true;
  if(s.perks.devops) s.tech.wallets = s.tech.opensource = true;
  if(s.perks.autopilot) for(const id of ["wallets","opensource","inference","agents"]) s.tech[id] = true;
  if(s.perks.faithful){ for(const id of ["memetics","aesthetics","servers","moderation","spirituality","liturgy"]) s.tech[id] = true; s.res.devotion = s.seen.devotion = 100; }
}
function buyPerk(id, card){
  const p = byId(PERKS, id);
  if(S.perks[id] || S.grass < p.cost || !opened(S, p)) return sfx.no();
  S.grass -= p.cost; S.perks[id] = true; sfx.buy(); FX.buy(card, true);
  log("🌿 perk: <b>"+p.name+"</b>. "+p.desc);
  refresh();
}

/* ---------- rituals: spend devotion for something now ---------- */
function holdRitual(id, card){
  const r = byId(RITUALS, id), c = ritualPrice(r, R.f);
  if((S.cd[id]||0) > S.t || !canPay(S, c) || !shown(r)) return sfx.no();
  pay(S, c);
  S.cd[id] = S.t + r.cd * Math.max(0.2, 1 + (R.f.ritualCd||0));
  S.stats.rituals = (S.stats.rituals||0) + 1;
  let msg = r.desc;
  if(id==="prayer") S.buffs.push({ kind:"prayer", happy:0.3, until:S.t+120 });
  else if(id==="hyperpost") S.buffs.push({ kind:"hyperpost", click:9, until:S.t+30 });
  else if(id==="vigil") S.buffs.push({ kind:"vigil", all:0.5, until:S.t+120 });
  else if(id==="airdrop") msg = "airdrop: "+(windfall(120).join(" ") || "nothing fit. build more storage.");
  else if(id==="meetup"){
    let k = 0; while(k < 10 && S.miladys.length < R.housing){ newMilady(S, R); k++; }
    msg = k ? k+" miladys turned up for the meetup." : "nobody came: there's no room.";
  }
  else if(id==="bull"){ // to the start of this cycle's mania if it's still ahead (or under way), otherwise the next one's
    const at = Math.floor(S.phaseT/PHASE_SECS) % 4, base = Math.floor(S.phaseT/(PHASE_SECS*4)) * PHASE_SECS*4;
    S.phaseT = base + (at <= 1 ? 1 : 5) * PHASE_SECS; FX.phase(PHASES[1]);
  }
  sfx.shiny(); FX.buy(card, true);
  log(r.icon+" <b>"+r.name+"</b>. "+msg);
  refresh(true);
}
/* `secs` seconds of everything you make, into storage */
function windfall(secs){
  const got = [];
  for(const r of RES) if(R.prod[r.id] > 0 && isVisible(r.id)){
    const g = gain(S, r.id, Math.max(R.prod[r.id]*secs, r.id==="vibes" ? R.click*secs/3 : 0), R.cap[r.id]);
    if(g >= 0.5) got.push("+"+fmt(g)+" "+resIcon(r.id));
  }
  return got;
}

/* ---------- raids: miladys go out, and come home with loot (most of them) ---------- */
function raidTime(r, f){ return r.secs / (1 + (f.raidSpeed||0)); }
function sendRaid(id, card){
  const r = byId(RAIDS, id), home = S.miladys.filter(m=>!m.away);
  if(!S.tech.raiding || home.length < r.n || S.raids.some(x=>x.id===id)) return sfx.no();
  // the idle go first, then whoever's on the busiest job
  const crew = [];
  for(const m of home.filter(m=>!m.job)) if(crew.length < r.n) crew.push(m);
  while(crew.length < r.n){
    const c = jobCounts(S), busiest = JOBS.filter(j=>c[j.id]).sort((a,b)=>c[b.id]-c[a.id])[0];
    const m = home.find(m=>m.job===busiest.id && !crew.includes(m)); m.away = id; crew.push(m);
  }
  crew.forEach(m=>m.away = id);
  // what they bring home is set now, from what the network makes as they leave
  const loot = {};
  for(const k in r.loot) if(isVisible(k)) loot[k] = Math.max(R.prod[k], 0.5) * r.loot[k];
  S.raids.push({ id, until:S.t + raidTime(r, R.f), len:raidTime(r, R.f), loot });
  sfx.buy(); FX.buy(card);
  log("⚔️ "+r.n+" miladys left to raid <b>"+r.name+"</b>. back in "+fmtTime(raidTime(r, R.f))+".");
  refresh(true);
}
function raidHome(s, i, live){
  const x = s.raids.splice(i, 1)[0], r = byId(RAIDS, x.id), f = sumFx(s);
  const crew = s.miladys.filter(m=>m.away===x.id), lost = [];
  for(const m of crew){ delete m.away; if(rnd() < r.lose){ lost.push(m); s.miladys.splice(s.miladys.indexOf(m), 1); } }
  const caps = rates(s).cap, got = [];
  for(const k in x.loot){ const g = gain(s, k, x.loot[k], caps[k]); if(g >= 0.5) got.push("+"+fmt(g)+" "+resIcon(k)); }
  s.stats.raids = (s.stats.raids||0) + 1;
  if(x.id==="cancel") s.stats.cancels = (s.stats.cancels||0) + 1;
  let relic = null;
  if(rnd() < Math.min(1, r.relic * (1 + (f.relicChance||0)))){
    const pool = RELICS.filter(q=>(s.relics[q.id]||0) < RELIC_MAX);
    if(pool.length){ relic = choice(pool); s.relics[relic.id] = (s.relics[relic.id]||0) + 1; }
  }
  const msg = "⚔️ the raid on <b>"+r.name+"</b> came home: "+(got.join(" ") || "nothing fit, build more storage")+"."+
    (lost.length ? " "+lost.map(m=>m.name).join(", ")+" stayed with the other side." : "")+
    (relic ? " they found a relic: "+relic.icon+" <b>"+relic.name+"</b>"+(s.relics[relic.id]>1 ? " (level "+s.relics[relic.id]+")" : "")+"." : "");
  log(msg, lost.length ? "bad" : "");
  if(live){ toast(msg, 5000); if(relic) sfx.shiny(); }
}

/* ---------- the cathedral ---------- */
function buildStage(card){
  const i = S.wonder||0; if(i >= WONDER.length || !S.tech.geometry) return sfx.no();
  const c = wonderPrice(i, R.f);
  if(!canPay(S, c)) return sfx.no();
  pay(S, c); S.wonder = i+1; sfx.shiny(); FX.buy(card, true); FX.research();
  log("⛪ the cathedral: <b>"+WONDER[i].name+"</b> is finished."+(S.wonder===WONDER.length ? " it's done. it was always going to be infinite." : ""));
  refresh(true);
}

/* ---------- sparkles ---------- */
function spawnSparkle(){
  if(document.hidden || $("sparkle")) return;
  const sp = el("button", "sparkle", "💎");
  sp.id = "sparkle"; sp.title = "catch it";
  sp.style.left = (8 + rnd()*80)+"vw"; sp.style.top = (15 + rnd()*65)+"vh";
  sp.onclick = ()=>{ const r = sp.getBoundingClientRect(); FX.sparkle(r.left+r.width/2, r.top+r.height/2); sp.remove(); catchSparkle(); };
  document.body.appendChild(sp);
  setTimeout(()=>sp.remove(), 13000);
}
function catchSparkle(){
  S.stats.sparkles++; sfx.shiny();
  const roll = rnd(), room = S.miladys.length < R.housing;
  let msg;
  if(roll < 0.25 && room){
    const m = newMilady(S, R); msg = "a stranger followed the sparkle in. <b>"+m.name+"</b> joined.";
  } else if(roll < 0.5){
    S.buffs.push({ kind:"frenzy", click:6, until:S.t+30 }); msg = "posting frenzy: posts make 7× for 30s.";
  } else if(roll < 0.65){
    S.buffs.push({ kind:"glow", happy:0.25, until:S.t+60 }); msg = "a glow comes over the network: +25% happiness for 60s.";
  } else msg = "windfall: "+(windfall(90).join(" ") || "nothing fit. build more storage.");
  log("💎 "+msg); toast("💎 "+msg);
  update();
}

/* ---------- what's on the page ---------- */
function shownIn(s, x){ return opened(s, x) && (!x.tech || s.tech[x.tech]) && (!x.show || x.show(s)); }
const shown = x => shownIn(S, x);
function isVisible(id){
  const r = RES_BY[id];
  if(id==="vibes" || S.seen[id] > 0) return true;
  return opened(S, r) && (r.tech ? !!S.tech[r.tech] : r.show ? r.show(S) : false);
}
const techShown = t => opened(S, t) && (S.b.archive>0 || S.seen.lore>0) && (t.req||[]).every(r=>S.tech[r]);
function tabs(){
  const t = [{ id:"network", name:"network" }];
  if(R.housing>0 || S.miladys.length) t.push({ id:"miladys", name:"miladys" });
  if(TECHS.some(techShown)) t.push({ id:"lore", name:"lore" });
  if(UPGRADES.some(shown)) t.push({ id:"upgrades", name:"upgrades" });
  if(S.tech.iconography) t.push({ id:"rituals", name:"rituals" });
  if(S.tech.raiding) t.push({ id:"raids", name:"raids" });
  if(S.tech.geometry) t.push({ id:"cathedral", name:"cathedral" });
  if(S.tech.garden || S.grass>0 || resets(S)>0) t.push({ id:"grass", name:"grass" });
  t.push({ id:"stats", name:"stats" });
  return t;
}
let tab = "network", sig = "";

function costHtml(c, cls){
  return '<span class="cost '+(cls||"")+'">'+Object.keys(c).map(k=>{
    const have = S.res[k] >= c[k]-1e-9, over = c[k] > R.cap[k]+1e-9;
    return '<i data-r="'+k+'" class="'+(have ? "ok" : over ? "over" : "")+'">'+resIcon(k)+" "+fmt(c[k])+"</i>";
  }).join("")+"</span>";
}
function fxLine(fx){
  const out = [];
  for(const k in fx){
    const v = fx[k], [a, b] = k.split(".");
    if(a==="rate") out.push(fmtRate(v)+" "+resIcon(b));
    else if(a==="cap") out.push("+"+fmt(v)+" "+resIcon(b)+" room");
    else if(k==="housing") out.push("+"+v+" 🏠");
  }
  return out.join(" · ");
}
/* any effect, in words */
function fxDesc(fx){
  const p = v => (v>0 ? "+" : "")+Math.round(v*100)+"%";
  return Object.keys(fx).map(k=>{
    const v = fx[k], [a, b] = k.split(".");
    if(k==="all") return p(v)+" everything";
    if(k==="happy") return p(v)+" happiness";
    if(k==="housing") return "+"+v+" room";
    if(k==="housingMult") return p(v)+" room for miladys";
    if(k==="capAll") return p(v)+" room for everything";
    if(k==="sparkle") return "sparkles "+p(v);
    if(k==="autoclick") return "posts "+v+" more times a second";
    if(k==="ritualCd") return "rituals "+Math.round(-v*100)+"% sooner";
    if(k==="grass") return p(v)+" grass";
    if(a==="mult") return p(v)+" "+RES_BY[b].name;
    if(a==="job") return JOB_BY[b].name+"s "+p(v);
    return k;
  }).join(" · ");
}
const NEW_LAYER = x => x.ng ? ' <span class="ng" title="opened by touching grass">🌿'+x.ng+'</span>' : "";

/* the tab body is built once per change in what's unlocked; numbers are filled in on every update */
function build(){
  const body = $("tab-body"); if(!body) return;
  body.innerHTML = "";
  const nav = $("tabs"); nav.innerHTML = "";
  for(const t of tabs()){
    const b = el("button", "pick"+(t.id===tab ? " on" : ""), t.name);
    b.onclick = ()=>{ tab = t.id; refresh(true); const tb = $("tab-body"); tb.classList.remove("enter"); void tb.offsetWidth; tb.classList.add("enter"); };
    b.dataset.tab = t.id;
    nav.appendChild(b);
  }
  if(S.challenge){ const c = byId(CHALLENGES, S.challenge); body.appendChild(el("div", "challenge-bar", "⚖️ challenge: <b>"+c.name+"</b>. "+c.rule+(c.id==="speed" ? ' <span id="speed-left"></span>' : ""))); }
  ({ network:buildNetwork, miladys:buildMiladys, lore:buildLore, upgrades:buildUpgrades, rituals:buildRituals,
     raids:buildRaids, cathedral:buildCathedral, grass:buildGrass }[tab] || buildStats)(body);
}
function card(title, desc, onclick){
  const c = el("button", "card");
  c.innerHTML = '<div class="ct"><b>'+title+'</b><em></em></div><div class="cd">'+desc+'</div><div class="cc"></div>';
  c.onclick = ()=>onclick(c);
  return c;
}
function buildNetwork(body){
  const grid = el("div", "grid");
  for(const b of BUILDINGS){
    if(!shown(b) && !S.b[b.id]) continue;
    const c = card(b.name+NEW_LAYER(b), b.desc+(fxLine(b.fx) ? '<br><span class="fx">'+fxLine(b.fx)+'</span>' : ""), c=>buyBuilding(b.id, c));
    c.dataset.b = b.id;
    grid.appendChild(c);
  }
  body.appendChild(grid);
  if(!grid.children.length) body.appendChild(el("p", "note", "post a little. things show up once you can almost afford them."));
}
function buildMiladys(body){
  const head = el("div", "pop-head");
  head.innerHTML = '<span id="pop-count"></span><span id="pop-idle"></span><span id="pop-away"></span><span id="pop-happy"></span>';
  body.appendChild(head);
  if(R.f.autoassign){
    const row = el("div", "auto-row");
    row.innerHTML = '<span>🤖 new arrivals go straight to</span><select id="auto-job" class="name-in">'+
      '<option value="">nothing (idle)</option>'+JOBS.filter(shown).map(j=>'<option value="'+j.id+'"'+(S.autoJob===j.id ? " selected" : "")+'>'+j.icon+" "+j.name+'</option>').join("")+'</select>';
    body.appendChild(row);
    row.querySelector("select").onchange = e=>{ S.autoJob = e.target.value; };
  }
  const list = el("div", "jobs");
  for(const j of JOBS){
    if(!shown(j)) continue;
    const row = el("div", "job");
    row.dataset.j = j.id;
    row.innerHTML = '<div class="jn"><b>'+j.icon+" "+j.name+NEW_LAYER(j)+'</b><span>'+j.desc+'</span><span class="jr"></span></div>'+
      '<div class="jc"><button class="btn small" data-d="-1" title="shift: 10">−</button><b class="jcount">0</b><button class="btn small" data-d="1" title="shift: 10">+</button></div>';
    row.querySelectorAll("button").forEach(btn=>btn.onclick = e=>{
      const n = e.shiftKey ? 10 : 1;
      btn.dataset.d==="1" ? assign(j.id, n) : unassign(j.id, n);
    });
    list.appendChild(row);
  }
  body.appendChild(list);
  const rem = S.miladys.filter(m=>m.kind==="remilio").length;
  const g = el("div", "box-h", "the network <span>"+S.miladys.length+(rem ? " · "+rem+" remilios" : "")+"</span>");
  body.appendChild(g);
  const gal = el("div", "gallery");
  gal.id = "gallery";
  body.appendChild(gal);
  fillGallery();
}
let galleryKnown = null; // ids already shown, so only new faces pop in
function fillGallery(){
  const gal = $("gallery"); if(!gal) return;
  gal.innerHTML = "";
  const known = galleryKnown;
  galleryKnown = new Set(S.miladys.map(m=>m.id));
  if(!S.miladys.length){ gal.innerHTML = '<p class="note">nobody yet. build a group chat and keep the vibes up.</p>'; return; }
  for(const m of S.miladys){
    const b = el("button", "mil j-"+(m.away ? "away" : m.job||"idle")+(m.kind==="remilio" ? " remilio" : "")+(known && !known.has(m.id) ? " new" : ""));
    b.title = m.name+(m.kind==="remilio" ? " (remilio)" : "")+" · "+(m.away ? "away raiding" : m.job ? JOB_BY[m.job].name : "idle");
    b.innerHTML = '<img alt=""><i>'+(m.away ? "⚔️" : m.job ? JOB_BY[m.job].icon : "💤")+"</i>";
    thumb(m.look, m.kind).then(src=>{ b.firstChild.src = src; }).catch(()=>{});
    b.onclick = ()=>showMilady(m.id);
    b.dataset.m = m.id;
    gal.appendChild(b);
  }
}
function buildLore(body){
  const grid = el("div", "grid");
  for(const t of TECHS){
    if(!techShown(t) && !S.tech[t.id]) continue;
    const c = card(t.name+NEW_LAYER(t), t.desc, c=>buyTech(t.id, c));
    c.dataset.t = t.id;
    if(S.tech[t.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
  const later = TECHS.filter(t=>opened(S, t) && !techShown(t) && !S.tech[t.id]).length;
  const locked = TECHS.filter(t=>!opened(S, t)).length;
  if(later || locked) body.appendChild(el("p", "note", (later ? later+" more to find. research opens up research. " : "")+(locked ? locked+" more that touching grass will open." : "")));
}
function buildUpgrades(body){
  if(rule(S, "frugal")) body.appendChild(el("p", "note", "⚖️ no frills: upgrades do nothing this run."));
  const grid = el("div", "grid");
  const list = UPGRADES.filter(u=>shown(u) || S.up[u.id]).sort((a,b)=>(!!S.up[a.id]) - (!!S.up[b.id]));
  for(const u of list){
    const c = card(u.name+NEW_LAYER(u), u.desc, c=>buyUpgrade(u.id, c));
    c.dataset.u = u.id;
    if(S.up[u.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
}
function buildRituals(body){
  body.appendChild(el("p", "note", "spend devotion 🕯️ for something now. each one needs time before it can be held again."));
  const grid = el("div", "grid");
  for(const r of RITUALS){
    if(!shown(r)) continue;
    const c = card(r.icon+" "+r.name, r.desc, c=>holdRitual(r.id, c));
    c.dataset.rit = r.id;
    c.insertAdjacentHTML("beforeend", '<i class="cdbar"><u></u></i>');
    grid.appendChild(c);
  }
  body.appendChild(grid);
}
function buildRaids(body){
  body.appendChild(el("p", "note", "send miladys out. the idle go first, then whoever's on the busiest job. while they're gone they don't work, and some may not come back. what they bring home grows with the network."));
  const grid = el("div", "grid");
  for(const r of RAIDS){
    const c = card("⚔️ "+r.name, r.desc+'<br><span class="fx">'+r.n+' miladys · '+fmtTime(raidTime(r, R.f))+' · relic '+pct(Math.min(1, r.relic*(1+(R.f.relicChance||0))))+(r.lose ? ' · '+pct(r.lose)+' may not come back' : "")+'</span>', c=>sendRaid(r.id, c));
    c.dataset.raid = r.id;
    c.insertAdjacentHTML("beforeend", '<i class="cdbar"><u></u></i>');
    grid.appendChild(c);
  }
  body.appendChild(grid);
  body.appendChild(relicShelf());
}
function relicShelf(){
  const box = el("div", "relic-shelf");
  const have = RELICS.filter(r=>S.relics[r.id]).length;
  box.innerHTML = '<div class="box-h">relics <span>'+have+" / "+RELICS.length+' · kept forever</span></div><div class="relics">'+
    RELICS.map(r=>{ const lv = S.relics[r.id]||0;
      return '<div class="relic'+(lv ? "" : " unknown")+'" title="'+(lv ? r.name+": "+r.desc+" per level" : "not found yet")+'"><span>'+(lv ? r.icon : "?")+'</span><b>'+(lv ? r.name : "???")+'</b><i>'+(lv ? "lv "+lv+(lv>=RELIC_MAX ? " max" : "")+" · "+r.desc : "")+'</i></div>'; }).join("")+'</div>';
  return box;
}
function buildCathedral(body){
  const i = S.wonder||0;
  const wrap = el("div", "cathedral");
  // the building itself: ten blocks that light as they're built, narrowing to a spire
  wrap.innerHTML = '<div class="spire">'+WONDER.map((w,k)=>'<i class="'+(k<i ? "on" : k===i ? "next" : "")+'" style="--k:'+k+'" title="'+w.name+'"></i>').reverse().join("")+'</div>'+
    '<div class="stages">'+WONDER.map((w,k)=>'<div class="stage'+(k<i ? " done" : k===i ? " next" : "")+'"><b>'+(k<i ? "✅ " : "")+w.name+'</b><span>'+fxDesc(w.fx)+'</span></div>').join("")+'</div>';
  body.appendChild(wrap);
  if(i < WONDER.length){
    const c = card("build "+WONDER[i].name, "stage "+(i+1)+" of "+WONDER.length+".", c=>buildStage(c));
    c.dataset.ws = i;
    body.appendChild(c);
  } else body.appendChild(el("p", "big-note", "⛪ the cathedral of the network is finished."));
}
function buildGrass(body){
  const top = el("div", "grass-top");
  top.innerHTML = '<div class="big-num">🌿 <b id="grass-have">0</b> grass</div>'+
    '<div class="note">every grass you hold makes everything <b>'+pct(GRASS_EACH+(R.f.grassEach||0))+'</b> faster. right now: <b id="grass-bonus"></b>.</div>'+
    '<div class="note">grass comes from the $CULT you made this run: <b id="grass-run"></b> so far. touching grass now gives <b id="grass-gain"></b>.</div>'+
    '<button class="btn big" id="btn-grass">touch grass 🌿</button><div class="note" id="grass-why"></div>';
  body.appendChild(top);
  // what each reset opens: the past ones lit, the next one named, the rest a mystery
  body.appendChild(el("div", "box-h", "every time you touch grass <span>"+resets(S)+" so far</span>"));
  const ms = el("div", "milestones");
  ms.innerHTML = MILESTONES.map(m=>{ const got = resets(S) >= m.n, next = m.n===resets(S)+1;
    return '<div class="ms'+(got ? " got" : next ? " next" : "")+'"><em>'+m.n+'</em><b>'+(got || next ? m.name : "???")+'</b><span>'+(got || next ? m.desc : "touch grass "+m.n+" times to find out.")+'</span></div>'; }).join("");
  body.appendChild(ms);
  if(resets(S) >= 5){
    body.appendChild(el("div", "box-h", "challenges <span>touch grass into one</span>"));
    const cg = el("div", "grid");
    for(const c of CHALLENGES){
      const k = card((S.chDone[c.id] ? "✅ " : "⚖️ ")+c.name, c.rule+'<br><span class="fx">reward: '+c.rdesc+'</span>', ()=>touchGrass(c.id));
      k.dataset.ch = c.id;
      if(S.challenge===c.id) k.classList.add("active");
      cg.appendChild(k);
    }
    body.appendChild(cg);
  }
  body.appendChild(el("div", "box-h", "perks <span>kept forever</span>"));
  const grid = el("div", "grid");
  for(const p of PERKS){
    if(!opened(S, p)) continue;
    const c = card(p.name+NEW_LAYER(p), p.desc, c=>buyPerk(p.id, c));
    c.dataset.p = p.id;
    if(S.perks[p.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
  const hidden = PERKS.filter(p=>!opened(S, p)).length;
  if(hidden) body.appendChild(el("p", "note", hidden+" more perks open as you keep touching grass."));
  $("btn-grass").onclick = ()=>touchGrass();
}
function buildStats(body){
  const made = RES.filter(r=>S.stats.made[r.id]).map(r=>'<span>'+resIcon(r.id)+" "+r.name+'</span><b>'+fmt(S.stats.made[r.id])+'</b>').join("");
  body.innerHTML = '<div class="stat-grid">'+
    '<span>played</span><b>'+fmtTime(S.stats.played)+'</b>'+
    '<span>this run</span><b>'+fmtTime(S.runT)+'</b>'+
    '<span>posts</span><b>'+fmt(S.stats.clicks)+'</b>'+
    '<span>sparkles caught</span><b>'+fmt(S.stats.sparkles)+'</b>'+
    '<span>times you touched grass</span><b>'+resets(S)+'</b>'+
    '<span>rituals held</span><b>'+fmt(S.stats.rituals||0)+'</b>'+
    '<span>raids come home</span><b>'+fmt(S.stats.raids||0)+'</b>'+
    '<span>market cycles</span><b>'+S.cycle+'</b>'+
    made+'</div>'+
    '<div class="box-h">achievements <span>'+Object.keys(S.ach).length+" / "+ACHIEVEMENTS.length+'</span></div>'+
    '<div class="achs">'+ACHIEVEMENTS.map(a=>'<div class="ach'+(S.ach[a.id] ? " got" : "")+'"><b>'+(S.ach[a.id] ? "🏆 " : "🔒 ")+a.name+'</b><span>'+a.desc+'</span></div>').join("")+'</div>';
  if(resets(S) >= 3 || Object.keys(S.relics).length) body.appendChild(relicShelf());
}

/* fill in the numbers */
function update(){
  R = rates(S);
  // resources
  const rows = $("res");
  for(const r of RES){
    let row = rows.querySelector('[data-r="'+r.id+'"]');
    const vis = isVisible(r.id);
    if(!vis){ if(row) row.remove(); continue; }
    if(!row){
      row = el("div", "res-row");
      row.dataset.r = r.id;
      row.title = r.desc;
      row.innerHTML = '<span class="ri">'+resIcon(r.id)+'</span><span class="rn" style="color:'+r.color+'">'+r.name+'</span><span class="rv"></span><span class="rc"></span><span class="rr"></span><i class="rbar"><u style="background:'+r.color+'"></u></i>';
      // keep the order of RES
      const after = [...rows.children].find(x=>RES.findIndex(q=>q.id===x.dataset.r) > RES.findIndex(q=>q.id===r.id));
      rows.insertBefore(row, after||null);
    }
    const v = S.res[r.id], c = R.cap[r.id], n = R.net[r.id];
    row.querySelector(".rv").textContent = fmt(v);
    row.querySelector(".rc").textContent = "/"+fmt(c);
    const rr = row.querySelector(".rr");
    rr.textContent = n ? fmtRate(n) : "";
    rr.className = "rr"+(n<0 ? " neg" : "");
    row.querySelector(".rbar u").style.width = Math.min(100, v/c*100)+"%";
    row.classList.toggle("full", v >= c-1e-6);
  }
  // you
  $("post-val").textContent = "+"+fmt(R.click)+" per post"+(R.autoclick ? " · bot posts "+R.autoclick+"/s" : "");
  const memeBtn = $("btn-meme");
  memeBtn.classList.toggle("hidden", !(S.seen.vibes >= MEME_COST || S.seen.memes>0));
  memeBtn.disabled = S.res.vibes < MEME_COST || S.res.memes >= R.cap.memes;
  // people
  const n = S.miladys.length;
  $("pop").classList.toggle("hidden", !(R.housing>0 || n));
  $("pop-n").textContent = n+" / "+R.housing;
  $("pop-h").textContent = pct(R.happy);
  $("pop-h").className = R.happy < 0.8 ? "neg" : R.happy > 1.05 ? "pos" : "";
  $("pop-idle").textContent = (R.jobs.idle ? R.jobs.idle+" idle" : "")+(R.jobs.away ? " · "+R.jobs.away+" raiding" : "");
  $("pop-eat").textContent = n ? "eating "+fmt(R.eat, 1)+" 🌸/s" : "";
  // the market
  const ph = R.phase, into = S.phaseT % PHASE_SECS;
  $("phase-name").innerHTML = ph.icon+' <b style="color:'+ph.color+'">'+ph.name+'</b>';
  $("phase-name").title = ph.desc+" · cycle "+(S.cycle+1);
  $("phase-fill").style.width = (into/PHASE_SECS*100)+"%";
  $("phase-fill").style.background = ph.color;
  $("phase-left").textContent = fmtTime(PHASE_SECS-into);
  FX.frenzy(S.buffs.some(b=>b.kind==="frenzy"));
  document.body.dataset.phase = ph.id;
  $("buffs").innerHTML = S.buffs.map(b=>'<span class="chip '+(b.happy<0 ? "bad" : "")+'">'+
    ({frenzy:"🔥 frenzy", glow:"✨ glow", drama:"💢 drama", prayer:"🙏 prayer", hyperpost:"⚡ hyperpost", vigil:"🕯️ vigil"}[b.kind]||b.kind)+" "+fmtTime(b.until-S.t)+"</span>").join("");

  // tabs with something you can do right now light up, with how many
  const ready = readyCounts();
  document.querySelectorAll("#tabs [data-tab]").forEach(b=>{
    const id = b.dataset.tab, n = id===tab ? 0 : ready[id]||0;
    b.classList.toggle("ready", n>0);
    if(n>0) b.dataset.n = n>9 ? "9+" : n; else delete b.dataset.n;
    if(id==="miladys") b.classList.toggle("alert", R.jobs.idle>0 && tab!=="miladys");
  });
  // the open tab
  const body = $("tab-body");
  body.querySelectorAll("[data-b]").forEach(c=>{
    const b = byId(BUILDINGS, c.dataset.b), p = priceOf(b, S);
    c.querySelector("em").textContent = S.b[b.id] ? "×"+S.b[b.id] : "";
    c.querySelector(".cc").innerHTML = costHtml(p);
    c.classList.toggle("cant", !canPay(S, p));
    c.classList.toggle("blocked", !fitsCap(p, R.cap));
  });
  body.querySelectorAll("[data-t]").forEach(c=>{
    const t = byId(TECHS, c.dataset.t);
    if(S.tech[t.id]){ c.querySelector(".cc").innerHTML = '<span class="done">researched</span>'; c.classList.remove("cant"); return; }
    const p = techPrice(t, S, R.f);
    c.querySelector(".cc").innerHTML = costHtml(p);
    c.classList.toggle("cant", !canPay(S, p));
    c.classList.toggle("blocked", !fitsCap(p, R.cap));
  });
  body.querySelectorAll("[data-u]").forEach(c=>{
    const u = byId(UPGRADES, c.dataset.u);
    if(S.up[u.id]){ c.querySelector(".cc").innerHTML = '<span class="done">owned</span>'; c.classList.remove("cant"); return; }
    c.querySelector(".cc").innerHTML = costHtml(u.cost);
    c.classList.toggle("cant", !canPay(S, u.cost));
    c.classList.toggle("blocked", !fitsCap(u.cost, R.cap));
  });
  body.querySelectorAll("[data-p]").forEach(c=>{
    const p = byId(PERKS, c.dataset.p);
    c.querySelector(".cc").innerHTML = S.perks[p.id] ? '<span class="done">yours</span>' : '<span class="cost"><i class="'+(S.grass>=p.cost ? "ok" : "")+'">🌿 '+p.cost+'</i></span>';
    c.classList.toggle("cant", !S.perks[p.id] && S.grass < p.cost);
  });
  body.querySelectorAll("[data-j]").forEach(row=>{
    const j = JOB_BY[row.dataset.j], cnt = R.jobs[j.id];
    row.querySelector(".jcount").textContent = cnt;
    const each = j.res ? j.rate*(1+(R.f["job."+j.id]||0))*R.happy : 0; // a milady's share; a remilio makes more
    row.querySelector(".jr").innerHTML = j.res ? fmt(each, each<1 ? 3 : 2)+" "+resIcon(j.res)+"/s each, before bonuses" : "";
    row.querySelector('[data-d="1"]').disabled = !R.jobs.idle;
    row.querySelector('[data-d="-1"]').disabled = !cnt;
  });
  if($("pop-count")){
    $("pop-count").textContent = n+" / "+R.housing+" miladys";
    $("pop-idle").textContent = R.jobs.idle ? R.jobs.idle+" idle: give them something to do" : "";
    $("pop-happy").textContent = "happiness "+pct(R.happy);
    $("pop-away").textContent = R.jobs.away ? R.jobs.away+" away raiding" : "";
  }
  body.querySelectorAll("[data-rit]").forEach(c=>{
    const r = byId(RITUALS, c.dataset.rit), p = ritualPrice(r, R.f), left = (S.cd[r.id]||0) - S.t, full = r.cd*Math.max(0.2, 1+(R.f.ritualCd||0));
    c.querySelector("em").textContent = left > 0 ? fmtTime(left) : "ready";
    c.querySelector(".cc").innerHTML = costHtml(p);
    c.querySelector(".cdbar u").style.width = (left > 0 ? 100 - left/full*100 : 100)+"%";
    c.classList.toggle("cant", left > 0 || !canPay(S, p));
    c.classList.toggle("blocked", !fitsCap(p, R.cap));
  });
  body.querySelectorAll("[data-raid]").forEach(c=>{
    const r = byId(RAIDS, c.dataset.raid), x = S.raids.find(q=>q.id===r.id), home = S.miladys.length - R.jobs.away;
    c.querySelector("em").textContent = x ? "back in "+fmtTime(x.until-S.t) : "";
    c.querySelector(".cc").innerHTML = x ? '<span class="done">out raiding</span>' : home < r.n ? '<span class="cost"><i class="over">needs '+r.n+' at home ('+home+')</i></span>' : '<span class="done">send '+r.n+'</span>';
    c.querySelector(".cdbar u").style.width = (x ? 100 - (x.until-S.t)/x.len*100 : 0)+"%";
    c.classList.toggle("cant", !!x || home < r.n);
  });
  body.querySelectorAll("[data-ws]").forEach(c=>{
    const p = wonderPrice(+c.dataset.ws, R.f);
    c.querySelector(".cc").innerHTML = costHtml(p);
    c.classList.toggle("cant", !canPay(S, p));
    c.classList.toggle("blocked", !fitsCap(p, R.cap));
  });
  if($("speed-left")) $("speed-left").textContent = S.runT <= 5400 ? fmtTime(5400 - S.runT)+" left." : "out of time.";
  if($("grass-have")){
    const g = grassGain(S, R.f);
    $("grass-have").textContent = S.grass;
    $("grass-bonus").textContent = "+"+pct(S.grass*(GRASS_EACH+(R.f.grassEach||0)));
    $("grass-run").textContent = fmt(S.run.cult)+" $CULT";
    $("grass-gain").textContent = "+"+g+" 🌿";
    $("btn-grass").disabled = !S.tech.garden || g<1;
    const next = Math.pow(g+1, 2)*500/Math.pow(1+(R.f.grass||0), 2);
    $("grass-why").textContent = !S.tech.garden ? "research the infinite garden first." : "next grass at "+fmt(next)+" $CULT this run.";
  }
}

/* what each tab has that you could do this second: buy, research, hold, send, build */
function readyCounts(){
  const c = {}, home = S.miladys.length - R.jobs.away;
  c.network = BUILDINGS.filter(b=>shown(b) && canPay(S, priceOf(b, S))).length;
  c.lore = TECHS.filter(t=>!S.tech[t.id] && techShown(t) && canPay(S, techPrice(t, S, R.f))).length;
  c.upgrades = rule(S, "frugal") ? 0 : UPGRADES.filter(u=>!S.up[u.id] && shown(u) && canPay(S, u.cost)).length;
  c.rituals = S.tech.iconography ? RITUALS.filter(r=>shown(r) && (S.cd[r.id]||0) <= S.t && canPay(S, ritualPrice(r, R.f))).length : 0;
  c.raids = S.tech.raiding ? RAIDS.filter(r=>!S.raids.some(x=>x.id===r.id) && home >= r.n).length : 0;
  c.cathedral = S.tech.geometry && (S.wonder||0) < WONDER.length && canPay(S, wonderPrice(S.wonder||0, R.f)) ? 1 : 0;
  c.grass = PERKS.filter(p=>opened(S, p) && !S.perks[p.id] && S.grass >= p.cost).length + (S.tech.garden && grassGain(S, R.f) >= 1 ? 1 : 0);
  return c;
}

/* rebuild when the set of things on screen changes, otherwise just update */
function signature(){
  return [tab, tabs().map(t=>t.id).join(), BUILDINGS.filter(b=>shown(b)||S.b[b.id]).length,
    TECHS.filter(t=>techShown(t)||S.tech[t.id]).map(t=>t.id+(S.tech[t.id]?1:0)).join(),
    UPGRADES.filter(u=>shown(u)||S.up[u.id]).map(u=>u.id+(S.up[u.id]?1:0)).join(),
    JOBS.filter(shown).length, Object.keys(S.perks).length, RITUALS.filter(shown).length, S.raids.length, S.wonder, Object.keys(S.relics).length,
    Object.values(S.relics).join(""), !!R.f.autoassign, tab==="miladys" ? S.miladys.map(m=>m.id+m.job+(m.away||"")).join() : ""].join("|");
}
function refresh(force){
  R = rates(S);
  if(!$("tab-body")) return; // no page (the rules running headless)
  if(!tabs().some(t=>t.id===tab)) tab = "network";
  const s = signature();
  if(force || s!==sig){ sig = s; build(); navRestore(); }
  update();
}

/* ---------- a closer look at one milady ---------- */
function showMilady(id){
  const m = S.miladys.find(x=>x.id===id); if(!m) return;
  const jobBtns = ['<button class="pick'+(!m.job ? " on" : "")+'" data-job="">💤 idle</button>'].concat(
    JOBS.filter(shown).map(j=>'<button class="pick'+(m.job===j.id ? " on" : "")+'" data-job="'+j.id+'">'+j.icon+" "+j.name+"</button>")).join("");
  const K = KINDS[m.kind||"milady"];
  openModal('<h2>'+m.name+'</h2><canvas id="mil-cv" width="'+K.w+'" height="'+K.h+'" class="portrait"></canvas>'+
    '<div class="note">'+(m.kind==="remilio" ? "a remilio · makes "+pct(0.25+(R.f.remilio||0))+" more than a milady · " : "")+'joined '+new Date(m.t).toLocaleString()+(m.away ? ' · away raiding' : "")+'</div>'+
    '<div class="seg wrap">'+jobBtns+'</div>'+
    '<div class="row"><input id="mil-name" class="name-in" maxlength="20" value="'+m.name.replace(/"/g, "&quot;")+'"><button class="btn small" id="mil-rename">rename</button></div>'+
    '<div class="row"><button class="btn small" data-close>close</button><button class="btn small danger" id="mil-kick">kick from the network</button></div>');
  compose(m.look, false, m.kind).then(cv=>{ const c = $("mil-cv"); if(c) c.getContext("2d").drawImage(cv, 0, 0); });
  document.querySelectorAll("#modal [data-job]").forEach(b=>b.onclick = ()=>{ if(m.away) return sfx.no(); m.job = b.dataset.job; refresh(); showMilady(id); });
  $("mil-rename").onclick = ()=>{ const v = $("mil-name").value.trim(); if(v){ m.name = v.slice(0, 20); refresh(true); showMilady(id); } };
  $("mil-kick").onclick = ()=>{ if(m.away) return sfx.no(); S.miladys = S.miladys.filter(x=>x.id!==id); log("👋 you kicked <b>"+m.name+"</b>."); closeModal(); refresh(true); };
}

/* ---------- modal ---------- */
function openModal(html){
  $("modal-panel").innerHTML = html;
  $("modal").classList.remove("hidden");
  $("modal-panel").querySelectorAll("[data-close]").forEach(b=>b.onclick = closeModal);
  if(document.body.classList.contains("kb")){ const first = navItems($("modal-panel"))[0]; if(first){ navSel = null; navSet(first); } } // keys carry on into the popup
}
function closeModal(){ $("modal").classList.add("hidden"); if(navSel && !document.contains(navSel)) navSel = null; navRestore(); }

function openSettings(){
  openModal('<h2>settings</h2>'+
    '<div class="set-row"><span>sound</span><button class="tog'+(S.settings.mute ? "" : " on")+'" id="set-mute">'+(S.settings.mute ? "off" : "on")+'</button></div>'+
    '<div class="set-row"><span>animated backdrop</span><button class="tog'+(S.settings.bg!==false ? " on" : "")+'" id="set-bg">'+(S.settings.bg!==false ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>calm (less motion)</span><button class="tog'+(S.settings.calm ? " on" : "")+'" id="set-calm">'+(S.settings.calm ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>numbers</span><span class="seg">'+Object.keys(NOTATIONS).map(k=>'<button class="pick'+((S.settings.num||"short")===k ? " on" : "")+'" data-num="'+k+'">'+NOTATIONS[k]+'</button>').join("")+'</span></div>'+
    '<div class="set-row"><span>your milady</span><button class="btn small" id="set-reroll">reroll her</button></div>'+
    '<div class="set-row"><span>save</span><span><button class="btn small" id="set-export">export</button> <button class="btn small" id="set-import">import</button></span></div>'+
    '<textarea id="save-box" class="save-box hidden" spellcheck="false"></textarea>'+
    '<div class="set-row"><span>start over, for real</span><button class="btn small danger" id="set-wipe">wipe save</button></div>'+
    '<p class="note">the game saves itself every few seconds, in this browser. export it to move it somewhere else.</p>'+
    '<div class="row"><button class="btn small" data-close>close</button></div>');
  $("set-mute").onclick = ()=>{ S.settings.mute = !S.settings.mute; syncMute(); openSettings(); };
  $("set-bg").onclick = ()=>{ S.settings.bg = S.settings.bg===false; syncLook(); openSettings(); };
  $("set-calm").onclick = ()=>{ S.settings.calm = !S.settings.calm; syncLook(); openSettings(); };
  document.querySelectorAll("#modal [data-num]").forEach(b=>b.onclick = ()=>{ S.settings.num = b.dataset.num; refresh(true); renderLog(); openSettings(); });
  $("set-reroll").onclick = ()=>{ S.you = rollLook(); drawYou(); };
  $("set-export").onclick = ()=>{
    save();
    const box = $("save-box"); box.classList.remove("hidden");
    box.value = btoa(unescape(encodeURIComponent(JSON.stringify(S)))); box.select();
    try{ navigator.clipboard.writeText(box.value); toast("save copied"); }catch(e){}
  };
  $("set-import").onclick = ()=>{
    const box = $("save-box");
    if(box.classList.contains("hidden") || !box.value.trim()){ box.classList.remove("hidden"); box.value = ""; box.placeholder = "paste a save here, then press import again"; box.focus(); return; }
    try{
      S = migrate(JSON.parse(decodeURIComponent(escape(atob(box.value.trim())))));
      save(); closeModal(); drawYou(); refresh(true); renderLog(); toast("save loaded");
    }catch(e){ toast("that save didn't read"); }
  };
  $("set-wipe").onclick = ()=>{
    openModal('<h2>wipe everything?</h2><p>grass, perks, achievements, all of it. there\'s no undo.</p><div class="row"><button class="btn danger" id="wipe-yes">wipe it</button><button class="btn small" data-close>no</button></div>');
    $("wipe-yes").onclick = ()=>{ localStorage.removeItem(SAVE_KEY); S = null; location.reload(); };
  };
}
function syncLook(){
  document.body.classList.toggle("calm", !!S.settings.calm);
  document.body.classList.toggle("nobg", S.settings.bg===false);
}
function syncMute(){ document.querySelectorAll(".mute").forEach(b=>b.textContent = S.settings.mute ? "🔇" : "🔊"); }

function openHelp(){
  openModal('<h2>how to play</h2>'+
    '<p><b>click your milady</b> to post. posting makes vibes 🌸. turn 25 vibes into a meme 🐸 with <b>meme it</b>.</p>'+
    '<p>build <b>group chats</b> and miladys show up. every milady eats '+EAT+' vibes a second. if the vibes run out, they leave.</p>'+
    '<p>new miladys sit idle. give them <b>jobs</b> in the miladys tab: posters make vibes, memers make memes, and so on.</p>'+
    '<p>build an <b>archive</b> for lore 📜, and spend lore on <b>research</b>. research unlocks the rest.</p>'+
    '<p>the <b>market</b> goes round: accumulation, mania, distribution, bear. each one is good for something.</p>'+
    '<p>catch the <b>💎 sparkles</b> when they show up.</p>'+
    '<p>much later you can <b>touch grass</b>: start over with grass 🌿 that makes everything faster, forever. every time you do, something new opens: compute and devs, then rituals and remilios, then raids and relics, then a cathedral, then challenges. the grass tab says what\'s next.</p>'+
    '<p class="note">the game keeps going while you\'re away (up to 8 hours).</p>'+
    '<div class="keys"><b>keys</b><span>arrows move the highlight · enter presses it (shift+enter does 10) · space posts · m makes a meme · q / e or 1-9 change tabs · esc backs out</span>'+
    '<b>gamepad</b><span>d-pad or stick moves · Ⓐ press · Ⓑ back · Ⓧ post · Ⓨ meme it · LB / RB tabs · START settings</span></div>'+
    '<p>want something with more fight in it? <a href="https://cancel.tylerirl.com/">the cancel is coming</a> is this one\'s companion: a roguelite with the same miladys. your network keeps growing while you play it.</p>'+
    '<div class="row"><button class="btn small" data-close>got it</button></div>');
}

/* ---------- you ---------- */
async function drawYou(){
  const cv = await compose(S.you, true);
  for(const id of ["you", "title-you", "fab-you"]){
    const c = $(id); if(!c) continue;
    const cx = c.getContext("2d"); cx.clearRect(0, 0, 600, 750); cx.drawImage(cv, 0, 0);
  }
}

/* ---------- time away ---------- */
function catchUp(){
  const cap = (S.perks.sleep ? 24 : 8)*3600;
  const away = Math.min(cap, (Date.now() - S.last)/1000);
  S.last = Date.now();
  if(away <= 0) return;
  const before = Object.assign({}, S.res), people = S.miladys.length;
  const step = Math.max(1, away/20000);
  for(let t=0; t<away; t+=step) tick(S, Math.min(step, away-t), false);
  const got = RES.filter(r=>isVisible(r.id) && Math.abs(S.res[r.id]-before[r.id]) >= 1)
    .map(r=>'<span class="chip">'+(S.res[r.id]>=before[r.id] ? "+" : "")+fmt(S.res[r.id]-before[r.id])+" "+resIcon(r.id)+"</span>").join(" ");
  const dp = S.miladys.length - people;
  const msg = "while you were away ("+fmtTime(away)+"): "+(got || "nothing much.")+(dp ? " "+(dp>0 ? "+" : "")+dp+" miladys." : "");
  if(away < 60) return; // a tab that was in the background a moment isn't worth a message
  log("🌙 "+msg);
  if(away > 300) openModal('<h2>welcome back</h2><p>you were gone '+fmtTime(away)+'. the network kept going.</p><p>'+(got||"nothing much happened.")+'</p>'+
    (dp ? '<p>'+(dp>0 ? dp+" miladys joined." : (-dp)+" miladys left.")+'</p>' : "")+'<div class="row"><button class="btn big" data-close>back to it</button></div>');
}

/* ---------- achievements ---------- */
function checkAch(){
  for(const a of ACHIEVEMENTS){
    if(S.ach[a.id]) continue;
    let ok = false; try{ ok = a.test(S, R); }catch(e){}
    if(ok){ S.ach[a.id] = Date.now(); toast("🏆 <b>"+a.name+"</b> · "+a.desc, 4200); log("🏆 achievement: <b>"+a.name+"</b>."); sfx.shiny(); }
  }
}

/* ---------- a new version went up while this tab was open ---------- */
let VERSION = null;
async function checkVersion(){
  try{
    const r = await fetch("version.json?t="+Date.now(), { cache:"no-store" });
    if(!r.ok) return;
    const v = (await r.json()).v;
    if(VERSION==null) VERSION = v;
    else if(v!==VERSION && !$("update-note")){
      const n = el("button", "btn small update-note", "a new version is out · reload");
      n.id = "update-note"; n.onclick = ()=>{ save(); location.reload(); };
      document.body.appendChild(n);
    }
  }catch(e){}
}

/* ---------- keys and pads ----------
   The arrow keys (or a d-pad, or the stick) move a highlight over whatever is on screen, or inside a popup when one is
   open; Enter (Ⓐ) presses it, shift+Enter presses it ten times over where that means something. Space (Ⓧ) posts,
   M (Ⓨ) makes a meme, Q/E (LB/RB) and 1-9 change tabs, Esc (Ⓑ) backs out, START opens settings. The highlight only
   shows once a key or pad has been used, and the mouse hides it again. It survives a tab being rebuilt: it remembers
   what it was on, not the element. */
let navSel = null, navMemo = "";
const NAV_KEYS = ["tab","b","t","u","p","rit","raid","ws","ch","m","num","job","d"];
const modalOpen = () => !$("modal").classList.contains("hidden");
function navScope(){ return modalOpen() ? $("modal-panel") : document.querySelector(".screen.active"); }
function navItems(scope){
  return scope ? [...scope.querySelectorAll("button, select, input, a[href]")].filter(el=>!el.disabled && el.offsetParent!==null) : [];
}
function navMemoOf(el){ // something about this element that the rebuilt one will share
  const row = el.closest("[data-j]"), k = NAV_KEYS.find(k=>el.dataset[k]!=null);
  return (row ? "j:"+row.dataset.j+":" : "") + (k ? k+":"+el.dataset[k] : el.id ? "#"+el.id : "");
}
function navSet(el){
  if(navSel && navSel!==el) navSel.classList.remove("ksel");
  navSel = el;
  if(!el) return;
  el.classList.add("ksel"); navMemo = navMemoOf(el);
  el.scrollIntoView({ block:"nearest", inline:"nearest" });
}
function navRestore(){ // after a rebuild: find what we were on
  if(!navMemo || (navSel && document.contains(navSel))) return;
  const el = navItems(navScope()).find(e=>navMemoOf(e)===navMemo);
  if(el){ navSel = el; el.classList.add("ksel"); } else navSel = null;
}
function navMove(dx, dy){ // step to the nearest thing in that direction
  const items = navItems(navScope());
  if(!items.length) return;
  if(!navSel || !items.includes(navSel)) return navSet(items.find(e=>e.classList.contains("on")) || items[0]);
  const a = navSel.getBoundingClientRect(), ax = a.left+a.width/2, ay = a.top+a.height/2;
  let best = null, bestD = Infinity;
  for(const e of items){
    if(e===navSel) continue;
    const r = e.getBoundingClientRect(), ex = r.left+r.width/2, ey = r.top+r.height/2;
    const along = dx ? (ex-ax)*dx : (ey-ay)*dy, across = dx ? Math.abs(ey-ay) : Math.abs(ex-ax);
    if(along < (dx ? 4 : (a.height+r.height)/4)) continue; // not that way (up and down have to reach another row)
    if(dx && across > Math.max(a.height, r.height)*0.6) continue; // left and right stay on the row
    const d = along + across*2.5;
    if(d < bestD){ bestD = d; best = e; }
  }
  if(!best && dx){ const i = items.indexOf(navSel); best = items[(i+(dx>0 ? 1 : -1)+items.length)%items.length]; } // the end of a row wraps
  if(best) navSet(best);
}
function navPress(shift){
  if(!navSel || !document.contains(navSel)) return navMove(0, 1);
  if(navSel.id==="you-wrap") return postFromKeys();
  if(navSel.tagName==="SELECT"){ navSel.selectedIndex = (navSel.selectedIndex+1)%navSel.options.length; navSel.dispatchEvent(new Event("change")); return; }
  if(navSel.tagName==="INPUT") return navSel.focus();
  navSel.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, shiftKey:!!shift }));
  navRestore();
}
function postFromKeys(){
  const w = $("you-wrap"), r = w.getBoundingClientRect();
  if(r.bottom < 0 || r.top > innerHeight){ const f = $("post-fab"); if(f && f.offsetParent){ const q = f.getBoundingClientRect(); return post({ clientX:q.left+q.width/2, clientY:q.top }); } }
  post({ clientX:r.left+r.width/2, clientY:r.top+r.height/3 });
}
function stepTab(d){
  const ts = tabs(), i = ts.findIndex(t=>t.id===tab), n = ts[(i+d+ts.length)%ts.length];
  if(n){ const b = document.querySelector('#tabs [data-tab="'+n.id+'"]'); if(b) b.click(); }
}
function onKey(e){
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName), arrow = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] }[e.key];
  if(e.key==="Escape"){
    if(typing) e.target.blur();
    if(modalOpen()) closeModal(); else { navSet(null); document.body.classList.remove("kb"); }
    return;
  }
  if(typing && e.key!=="Enter") return; // a field keeps its keys
  if(arrow || e.key==="Enter") document.body.classList.add("kb");
  if(arrow){ e.preventDefault(); return navMove(arrow[0], arrow[1]); }
  if(e.key==="Enter"){ e.preventDefault(); if(typing){ e.target.blur(); return; } return navPress(e.shiftKey); }
  if(!S.started || modalOpen()) return;
  if(e.key===" "){ e.preventDefault(); if(document.activeElement && document.activeElement!==document.body) document.activeElement.blur(); if(!e.repeat) postFromKeys(); }
  else if(e.key==="m" || e.key==="M") memeIt(e.shiftKey ? 10 : 1);
  else if(e.key==="q" || e.key==="[") stepTab(-1);
  else if(e.key==="e" || e.key==="]") stepTab(1);
  else if(/^[1-9]$/.test(e.key)){ const t = tabs()[+e.key-1]; if(t){ const b = document.querySelector('#tabs [data-tab="'+t.id+'"]'); if(b) b.click(); } }
  else if(e.key==="?") openHelp();
}
/* a pad is turned into the same keys. Directions repeat while held; buttons don't (posting is a press, not a hold). */
const PAD = { on:false, held:{}, raf:0, keys:{ 12:"ArrowUp", 13:"ArrowDown", 14:"ArrowLeft", 15:"ArrowRight", 0:"Enter", 1:"Escape", 2:" ", 3:"m", 4:"q", 5:"e", 8:"?", 9:"Start" } };
function padFire(key){
  if(!PAD.on){ PAD.on = true; document.body.classList.add("pad"); padHints(); }
  if(key==="Start") return modalOpen() ? closeModal() : (S.started && openSettings());
  if(key==="Enter" && !navSel) document.body.classList.add("kb");
  onKey({ key, target:document.body, shiftKey:false, ctrlKey:false, metaKey:false, altKey:false, repeat:false, preventDefault(){} });
}
function padHints(){
  const h = document.querySelector("#screen-main .hint"); if(!h) return;
  if(!h.dataset.keys) h.dataset.keys = h.textContent;
  h.textContent = PAD.on ? "d-pad or stick moves the highlight · Ⓐ press · Ⓑ back · Ⓧ post · Ⓨ meme it · LB/RB tabs · START settings · SELECT help" : h.dataset.keys;
}
function padPoll(){
  const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(g=>g && g.connected);
  if(!gp){ PAD.raf = 0; return; }
  PAD.raf = requestAnimationFrame(padPoll);
  if(document.hidden) return;
  const now = performance.now(), want = {};
  gp.buttons.forEach((b,i)=>{ if(b.pressed && PAD.keys[i]) want[PAD.keys[i]] = 1; });
  const [x=0, y=0] = gp.axes;
  if(Math.abs(x)>0.6 || Math.abs(y)>0.6) want[Math.abs(x)>Math.abs(y) ? (x>0 ? "ArrowRight" : "ArrowLeft") : (y>0 ? "ArrowDown" : "ArrowUp")] = 1;
  for(const k in want){
    const h = PAD.held[k];
    if(!h){ PAD.held[k] = { t:now, n:0 }; padFire(k); }
    else if(k.startsWith("Arrow") && now-h.t > (h.n ? 120 : 320)){ h.t = now; h.n++; padFire(k); }
  }
  for(const k in PAD.held) if(!want[k]) delete PAD.held[k];
}
window.addEventListener("gamepadconnected", ()=>{ if(!PAD.raf) PAD.raf = requestAnimationFrame(padPoll); });
window.addEventListener("gamepaddisconnected", ()=>{ PAD.held = {}; });
document.addEventListener("mousemove", ()=>{
  document.body.classList.remove("kb");
  if(PAD.on){ PAD.on = false; document.body.classList.remove("pad"); padHints(); }
}, { passive:true });

/* ---------- start ---------- */
/* the interface is laid out for 1440x900; a bigger window scales it up (never down, and at most 1.6x) */
function fitUI(){
  const k = Math.max(1, Math.min(1.6, innerWidth/1440, innerHeight/900));
  document.documentElement.style.setProperty("--ui", k.toFixed(3));
}
function show(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active", s.id===id));
}
function startGame(){
  show("screen-main");
  drawYou(); syncMute(); syncLook(); renderLog();
  document.body.dataset.phase = phase(S).id;
  refresh(true);
  if(!S.log.length) log("🌸 you logged on. click yourself to post.");
}
/* one clock: S.last is when the game was last advanced. A short gap is played live; a long one
   (a background tab, a closed laptop) is caught up the way time away is. */
let saveT = 0, achT = 0;
function frame(){
  if(!S || !S.started) return;
  const now = Date.now(), dt = (now - S.last)/1000;
  if(dt > 5){ catchUp(); refresh(true); }
  else if(dt > 0){ tick(S, dt, true); S.last = now; }
  saveT += dt; achT += dt;
  if(achT > 1){ achT = 0; checkAch(); }
  if(saveT > 5){ saveT = 0; save(); }
  refresh();
}

async function init(){
  try{ await loadAssets(); }catch(e){ console.warn("assets", e); }
  S = load();
  if(!S){ S = fresh(); }
  syncLook(); FX.start();
  fitUI(); addEventListener("resize", fitUI);
  if(!S.you) S.you = rollLook();
  // the bindings
  $("you-wrap").addEventListener("click", post);
  $("post-fab").addEventListener("click", post);
  // the floating post button shows while your milady is off screen (it's only ever visible in the phone layout)
  if(window.IntersectionObserver) new IntersectionObserver(es=>document.body.classList.toggle("you-off", !es[0].isIntersecting && $("screen-main").classList.contains("active"))).observe($("you-wrap"));
  $("btn-meme").onclick = e=>memeIt(e.shiftKey ? 10 : 1);
  $("modal").addEventListener("click", e=>{ if(e.target.id==="modal") closeModal(); });
  document.querySelectorAll(".gear").forEach(b=>b.onclick = openSettings);
  document.querySelectorAll(".help").forEach(b=>b.onclick = openHelp);
  document.querySelectorAll(".mute").forEach(b=>b.onclick = ()=>{ S.settings.mute = !S.settings.mute; syncMute(); });
  document.querySelectorAll(".fs").forEach(b=>b.onclick = ()=>{
    if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(()=>{});
  });
  $("title-reroll").onclick = ()=>{ S.you = rollLook(); drawYou(); const c = $("title-you"); c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop"); };
  $("btn-logon").onclick = ()=>{ S.started = true; S.last = Date.now(); save(); startGame(); };
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden) save(); else frame(); });
  window.addEventListener("pagehide", save);
  document.querySelectorAll('a[href*="cancel.tylerirl.com"]').forEach(a=>a.addEventListener("click", save)); // off to the other game: save on the way out

  if(S.started){ catchUp(); startGame(); }
  else { show("screen-title"); drawYou(); }
  setInterval(frame, 150);
  checkVersion(); setInterval(checkVersion, 5*60*1000);
}
init();
