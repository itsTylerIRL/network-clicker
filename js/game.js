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
const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
function fmt(n, dp){
  if(!isFinite(n)) return "∞";
  const neg = n<0; n = Math.abs(n);
  let out;
  if(n<1000) out = dp!=null ? n.toFixed(dp) : (n<10 && n%1 ? n.toFixed(1) : Math.floor(n).toString());
  else {
    const k = Math.min(SUFFIX.length-1, Math.floor(Math.log10(n)/3));
    const v = n/Math.pow(1000, k);
    out = (v<10 ? v.toFixed(2) : v<100 ? v.toFixed(1) : Math.floor(v)) + SUFFIX[k];
  }
  return (neg ? "-" : "") + out;
}
const fmtRate = n => (n>=0 ? "+" : "") + (Math.abs(n)<10 && n!==0 ? n.toFixed(2) : fmt(n)) + "/s";
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
    v:1, last:Date.now(), t:0,
    res:{}, seen:{}, b:{}, tech:{}, up:{}, miladys:[], nextId:1,
    cycle:0, phaseT:0, buffs:[],
    timers:{ arrive:0, leave:0, sparkle:60, drama:180, auto:0, feed:40 },
    run:{ cult:0, start:Date.now() },
    grass:0, perks:{}, ach:{},
    stats:{ clicks:0, sparkles:0, resets:0, played:0, made:{} },
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
function jobCounts(s){
  const c = { idle:0 };
  for(const j of JOBS) c[j.id] = 0;
  for(const m of s.miladys) c[m.job || "idle"]++;
  return c;
}
function sumFx(s){
  const f = {};
  const add = (fx, n) => { if(fx && n) for(const k in fx) f[k] = (f[k]||0) + fx[k]*n; };
  for(const b of BUILDINGS) add(b.fx, s.b[b.id]);
  for(const t of TECHS) if(s.tech[t.id]) add(t.fx, 1);
  for(const u of UPGRADES) if(s.up[u.id]) add(u.fx, 1);
  for(const p of PERKS) if(s.perks[p.id]) add(p.fx, 1);
  return f;
}
const buff = (s, key) => s.buffs.reduce((a,b)=>a + (b[key]||0), 0);
function phase(s){ return PHASES[Math.floor(s.phaseT/PHASE_SECS) % PHASES.length]; }

/* everything the economy is doing right now */
function rates(s){
  const f = sumFx(s), jobs = jobCounts(s), n = s.miladys.length, ph = phase(s);
  const happy = Math.max(0.25, 1 + (f.happy||0) + jobs.mod*0.03 - Math.max(0, n-10)*0.01 + buff(s, "happy"));
  const grassMult = 1 + s.grass*GRASS_EACH;
  const prod = {}, cap = {}, net = {};
  for(const r of RES){
    let base = f["rate."+r.id] || 0;
    for(const j of JOBS) if(j.res===r.id) base += jobs[j.id] * j.rate * (1 + (f["job."+j.id]||0)) * happy;
    const mult = Math.max(0, 1 + (f["mult."+r.id]||0) + (f.all||0) + (ph.mod[r.id]||0));
    prod[r.id] = base * mult * grassMult;
    cap[r.id] = (r.cap + (f["cap."+r.id]||0)) * (1 + (f["capMult."+r.id]||0));
    net[r.id] = prod[r.id];
  }
  const eat = n * EAT;
  net.vibes -= eat;
  const housing = Math.floor((f.housing||0) * (1 + (f.housingMult||0)));
  const perPost = (1 + (f.click||0)) * (1 + (f.clickMult||0)) * (1 + buff(s, "click")) * grassMult;
  const click = perPost + (f.clickRate||0) * Math.max(0, prod.vibes);
  return { f, jobs, happy, prod, cap, net, eat, housing, click, autoclick:f.autoclick||0, phase:ph };
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
  s.t += dt; s.stats.played += dt;
  for(const r of RES) gain(s, r.id, R.net[r.id]*dt, R.cap[r.id]);
  // your posting bots
  if(R.autoclick){ gain(s, "vibes", R.click*R.autoclick*dt, R.cap.vibes); }

  // the market
  const before = Math.floor(s.phaseT/PHASE_SECS);
  s.phaseT += dt;
  const after = Math.floor(s.phaseT/PHASE_SECS);
  if(after!==before){
    if(after % PHASES.length===0) s.cycle++;
    if(live){ const p = phase(s); FX.phase(p); log(p.icon+" the market turns: <b style='color:"+p.color+"'>"+p.name+"</b>. "+p.desc+"."); }
  }

  // miladys turn up while there's room and something to eat; they leave when there isn't
  const n = s.miladys.length;
  if(n < R.housing && s.res.vibes > 0){
    s.timers.arrive += dt * (1 + (R.f.arrive||0));
    if(s.timers.arrive >= 5){ s.timers.arrive = 0; const m = newMilady(s); if(live){ FX.arrive(); log("🌸 <b>"+m.name+"</b> joined the network."); } }
  } else s.timers.arrive = 0;
  if((s.res.vibes <= 0 && R.net.vibes < 0) || n > R.housing){
    s.timers.leave += dt;
    if(s.timers.leave >= 4 && n){
      s.timers.leave = 0;
      const idle = s.miladys.findIndex(m=>!m.job), i = idle>=0 ? idle : s.miladys.length-1;
      const [m] = s.miladys.splice(i, 1);
      if(live) log("🥀 <b>"+m.name+"</b> logged off. "+(n>R.housing ? "no room." : "the vibes ran out."), "bad");
    }
  } else s.timers.leave = 0;

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
  const m = 1 + ((f||sumFx(s))["costMult.tech"]||0), c = {};
  for(const k in t.cost) c[k] = t.cost[k] * m;
  return c;
}
const canPay = (s, c) => Object.keys(c).every(k=>s.res[k] >= c[k]-1e-9);
const fitsCap = (c, cap) => Object.keys(c).every(k=>c[k] <= cap[k]+1e-9);
function pay(s, c){ for(const k in c) s.res[k] = Math.max(0, s.res[k]-c[k]); }

/* ---------- miladys ---------- */
const LAYER_ORDER = ["Background","Skin","Face","Eyes","Mouth","Necklaces","Shirt","Hair","Brows","Earrings","Face Decoration","Glasses","Hat"];
const LAYER_ODDS = { Face:0.6, Necklaces:0.3, "Face Decoration":0.2, Earrings:0.3, Glasses:0.3, Hat:0.4 };
let ASSETS = null;
function rollLook(){
  const look = {};
  for(const layer of LAYER_ORDER){
    const files = (ASSETS && ASSETS.Milady[layer]) || [];
    if(files.length && (LAYER_ODDS[layer]==null || rnd()<LAYER_ODDS[layer])) look[layer] = choice(files);
  }
  return look;
}
function newMilady(s){
  const used = new Set(s.miladys.map(m=>m.name));
  let name = choice(NAMES), k = 2;
  if(used.has(name)){ while(used.has(name+" "+k)) k++; name = name+" "+k; }
  const m = { id:s.nextId++, name, job:"", look:rollLook(), t:Date.now() };
  s.miladys.push(m);
  return m;
}

/* trait layers are 600x750 and stack in order */
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
function compose(look, noBg){
  const key = JSON.stringify(look) + (noBg ? "-" : "");
  if(lookCache[key]) return lookCache[key];
  return lookCache[key] = (async ()=>{
    const layers = LAYER_ORDER.filter(l=>look[l] && !(noBg && l==="Background"));
    const ims = await Promise.all(layers.map(l=>loadImg("assets/img/Milady/"+l+"/"+look[l]).catch(()=>null)));
    const cv = document.createElement("canvas"); cv.width = 600; cv.height = 750;
    const cx = cv.getContext("2d");
    for(const im of ims) if(im) cx.drawImage(im, 0, 0, 600, 750);
    return cv;
  })();
}
/* a head-and-shoulders square, small enough to show a hundred of */
const thumbCache = {};
function thumb(look){
  const key = JSON.stringify(look);
  return thumbCache[key] || (thumbCache[key] = compose(look).then(cv=>{
    const t = document.createElement("canvas"); t.width = t.height = 128;
    t.getContext("2d").drawImage(cv, 40, 20, 520, 520, 0, 0, 128, 128);
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
  const t = el("div", "toast", html);
  $("toasts").appendChild(t);
  setTimeout(()=>{ t.classList.add("out"); setTimeout(()=>t.remove(), 300); }, ms||3200);
}
function renderLog(){
  const box = $("log"); if(!box) return;
  box.innerHTML = S.log.slice(0, 40).map(l=>'<div class="ln '+l.kind+'">'+l.html+'</div>').join("");
}

/* ---------- actions ---------- */
let R = null; // the latest rates, for the page
function post(e){
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
    const m = S.miladys.find(m=>!m.job); if(!m) break;
    m.job = job;
  }
  refresh();
}
function unassign(job, n){
  for(let i=0; i<n; i++){
    const m = [...S.miladys].reverse().find(m=>m.job===job); if(!m) break;
    m.job = "";
  }
  refresh();
}

/* ---------- touching grass ---------- */
function grassGain(s, f){
  return Math.floor(Math.sqrt(s.run.cult/500) * (1 + ((f||sumFx(s)).grass||0)));
}
function touchGrass(){
  const g = grassGain(S);
  if(!S.tech.garden || g < 1) return;
  openModal('<h2>touch grass?</h2><p>you log off. everything you built goes: the miladys, the buildings, the research, every resource.</p>'+
    '<p>you keep <b>+'+g+' grass 🌿</b>, your perks, your achievements and your own milady. every grass you hold makes everything '+pct(GRASS_EACH)+' faster.</p>'+
    '<div class="row"><button class="btn big" id="grass-yes">touch grass 🌿</button><button class="btn small" data-close>not yet</button></div>');
  $("grass-yes").onclick = ()=>{
    const keep = { grass:S.grass+g, perks:S.perks, ach:S.ach, you:S.you, settings:S.settings, started:true,
      stats:Object.assign(S.stats, { resets:S.stats.resets+1 }), log:[], nextId:S.nextId };
    S = fresh(keep);
    applyPerksAtStart(S);
    closeModal(); sfx.shiny(); FX.grass(); galleryKnown = null;
    log("🌿 you touched grass. +"+g+" grass. the network starts again, and it remembers you.");
    tab = "network"; refresh(true);
  };
}
function applyPerksAtStart(s){
  if(s.perks.headstart){ s.b.groupchat = 2; s.b.moodboard = 2; s.res.memes = 50; s.seen.memes = 50; s.seen.vibes = 50; }
  if(s.perks.memory) for(const id of ["wallets","memetics","servers"]) s.tech[id] = true;
}
function buyPerk(id, card){
  const p = byId(PERKS, id);
  if(S.perks[id] || S.grass < p.cost) return sfx.no();
  S.grass -= p.cost; S.perks[id] = true; sfx.buy(); FX.buy(card, true);
  log("🌿 perk: <b>"+p.name+"</b>. "+p.desc);
  refresh();
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
    const m = newMilady(S); msg = "a stranger followed the sparkle in. <b>"+m.name+"</b> joined.";
  } else if(roll < 0.5){
    S.buffs.push({ kind:"frenzy", click:6, until:S.t+30 }); msg = "posting frenzy: posts make 7× for 30s.";
  } else if(roll < 0.65){
    S.buffs.push({ kind:"glow", happy:0.25, until:S.t+60 }); msg = "a glow comes over the network: +25% happiness for 60s.";
  } else {
    const got = [];
    for(const r of RES) if(R.prod[r.id] > 0 && isVisible(r.id)){
      const g = gain(S, r.id, Math.max(R.prod[r.id]*90, r.id==="vibes" ? R.click*30 : 0), R.cap[r.id]);
      if(g >= 0.5) got.push("+"+fmt(g)+" "+resIcon(r.id));
    }
    msg = "windfall: "+(got.join(" ") || "nothing fit. build more storage.");
  }
  log("💎 "+msg); toast("💎 "+msg);
  update();
}

/* ---------- what's on the page ---------- */
function isVisible(id){
  if(id==="cult") return !!S.tech.wallets || S.seen.cult>0;
  if(id==="lore") return S.b.archive>0 || S.seen.lore>0;
  if(id==="drip") return !!S.tech.aesthetics || S.seen.drip>0;
  if(id==="clout") return !!S.tech.streaming || S.seen.clout>0;
  return S.seen[id] > 0 || id==="vibes";
}
const shown = x => (!x.tech || S.tech[x.tech]) && (!x.show || x.show(S));
const techShown = t => (S.b.archive>0 || S.seen.lore>0) && (t.req||[]).every(r=>S.tech[r]);
function tabs(){
  const t = [{ id:"network", name:"network" }];
  if(R.housing>0 || S.miladys.length) t.push({ id:"miladys", name:"miladys" });
  if(TECHS.some(techShown)) t.push({ id:"lore", name:"lore" });
  if(UPGRADES.some(shown)) t.push({ id:"upgrades", name:"upgrades" });
  if(S.tech.garden || S.grass>0 || S.stats.resets>0) t.push({ id:"grass", name:"grass" });
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

/* the tab body is built once per change in what's unlocked; numbers are filled in on every update */
function build(){
  const body = $("tab-body"); body.innerHTML = "";
  const nav = $("tabs"); nav.innerHTML = "";
  for(const t of tabs()){
    const b = el("button", "pick"+(t.id===tab ? " on" : ""), t.name);
    b.onclick = ()=>{ tab = t.id; refresh(true); const tb = $("tab-body"); tb.classList.remove("enter"); void tb.offsetWidth; tb.classList.add("enter"); };
    b.dataset.tab = t.id;
    nav.appendChild(b);
  }
  if(tab==="network") buildNetwork(body);
  else if(tab==="miladys") buildMiladys(body);
  else if(tab==="lore") buildLore(body);
  else if(tab==="upgrades") buildUpgrades(body);
  else if(tab==="grass") buildGrass(body);
  else buildStats(body);
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
    const c = card(b.name, b.desc+(fxLine(b.fx) ? '<br><span class="fx">'+fxLine(b.fx)+'</span>' : ""), c=>buyBuilding(b.id, c));
    c.dataset.b = b.id;
    grid.appendChild(c);
  }
  body.appendChild(grid);
  if(!grid.children.length) body.appendChild(el("p", "note", "post a little. things show up once you can almost afford them."));
}
function buildMiladys(body){
  const head = el("div", "pop-head");
  head.innerHTML = '<span id="pop-count"></span><span id="pop-idle"></span><span id="pop-happy"></span>';
  body.appendChild(head);
  const list = el("div", "jobs");
  for(const j of JOBS){
    if(!shown(j)) continue;
    const row = el("div", "job");
    row.dataset.j = j.id;
    row.innerHTML = '<div class="jn"><b>'+j.icon+" "+j.name+'</b><span>'+j.desc+'</span><span class="jr"></span></div>'+
      '<div class="jc"><button class="btn small" data-d="-1" title="shift: 10">−</button><b class="jcount">0</b><button class="btn small" data-d="1" title="shift: 10">+</button></div>';
    row.querySelectorAll("button").forEach(btn=>btn.onclick = e=>{
      const n = e.shiftKey ? 10 : 1;
      btn.dataset.d==="1" ? assign(j.id, n) : unassign(j.id, n);
    });
    list.appendChild(row);
  }
  body.appendChild(list);
  const g = el("div", "box-h", "the network <span>"+S.miladys.length+"</span>");
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
    const b = el("button", "mil j-"+(m.job||"idle")+(known && !known.has(m.id) ? " new" : ""));
    b.title = m.name+" · "+(m.job ? JOB_BY[m.job].name : "idle");
    b.innerHTML = '<img alt=""><i>'+(m.job ? JOB_BY[m.job].icon : "💤")+"</i>";
    thumb(m.look).then(src=>{ b.firstChild.src = src; }).catch(()=>{});
    b.onclick = ()=>showMilady(m.id);
    b.dataset.m = m.id;
    gal.appendChild(b);
  }
}
function buildLore(body){
  const grid = el("div", "grid");
  const f = sumFx(S);
  for(const t of TECHS){
    if(!techShown(t) && !S.tech[t.id]) continue;
    const c = card(t.name, t.desc, c=>buyTech(t.id, c));
    c.dataset.t = t.id;
    if(S.tech[t.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
  const later = TECHS.filter(t=>!techShown(t) && !S.tech[t.id]).length;
  if(later) body.appendChild(el("p", "note", later+" more to find. research opens up research."));
  void f;
}
function buildUpgrades(body){
  const grid = el("div", "grid");
  const list = UPGRADES.filter(u=>shown(u) || S.up[u.id]).sort((a,b)=>(!!S.up[a.id]) - (!!S.up[b.id]));
  for(const u of list){
    const c = card(u.name, u.desc, c=>buyUpgrade(u.id, c));
    c.dataset.u = u.id;
    if(S.up[u.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
}
function buildGrass(body){
  const top = el("div", "grass-top");
  top.innerHTML = '<div class="big-num">🌿 <b id="grass-have">0</b> grass</div>'+
    '<div class="note">every grass you hold makes everything <b>'+pct(GRASS_EACH)+'</b> faster. right now: <b id="grass-bonus"></b>.</div>'+
    '<div class="note">grass comes from the $CULT you made this run: <b id="grass-run"></b> so far. touching grass now gives <b id="grass-gain"></b>.</div>'+
    '<button class="btn big" id="btn-grass">touch grass 🌿</button><div class="note" id="grass-why"></div>';
  body.appendChild(top);
  body.appendChild(el("div", "box-h", "perks <span>kept forever</span>"));
  const grid = el("div", "grid");
  for(const p of PERKS){
    const c = card(p.name, p.desc, c=>buyPerk(p.id, c));
    c.dataset.p = p.id;
    if(S.perks[p.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
  $("btn-grass").onclick = touchGrass;
}
function buildStats(body){
  const made = RES.filter(r=>S.stats.made[r.id]).map(r=>'<span>'+resIcon(r.id)+" "+r.name+'</span><b>'+fmt(S.stats.made[r.id])+'</b>').join("");
  body.innerHTML = '<div class="stat-grid">'+
    '<span>played</span><b>'+fmtTime(S.stats.played)+'</b>'+
    '<span>posts</span><b>'+fmt(S.stats.clicks)+'</b>'+
    '<span>sparkles caught</span><b>'+fmt(S.stats.sparkles)+'</b>'+
    '<span>times you touched grass</span><b>'+S.stats.resets+'</b>'+
    '<span>market cycles</span><b>'+S.cycle+'</b>'+
    made+'</div>'+
    '<div class="box-h">achievements <span>'+Object.keys(S.ach).length+" / "+ACHIEVEMENTS.length+'</span></div>'+
    '<div class="achs">'+ACHIEVEMENTS.map(a=>'<div class="ach'+(S.ach[a.id] ? " got" : "")+'"><b>'+(S.ach[a.id] ? "🏆 " : "🔒 ")+a.name+'</b><span>'+a.desc+'</span></div>').join("")+'</div>';
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
  $("pop-idle").textContent = R.jobs.idle ? R.jobs.idle+" idle" : "";
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
    ({frenzy:"🔥 frenzy", glow:"✨ glow", drama:"💢 drama"}[b.kind]||b.kind)+" "+fmtTime(b.until-S.t)+"</span>").join("");

  const mt = document.querySelector('#tabs [data-tab="miladys"]');
  if(mt) mt.classList.toggle("alert", R.jobs.idle>0 && tab!=="miladys");
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
    const each = j.res ? j.rate*(1+(R.f["job."+j.id]||0))*R.happy : 0;
    row.querySelector(".jr").innerHTML = j.res ? fmt(each, each<1 ? 3 : 2)+" "+resIcon(j.res)+"/s each, before bonuses" : "";
    row.querySelector('[data-d="1"]').disabled = !R.jobs.idle;
    row.querySelector('[data-d="-1"]').disabled = !cnt;
  });
  if($("pop-count")){
    $("pop-count").textContent = n+" / "+R.housing+" miladys";
    $("pop-idle").textContent = R.jobs.idle ? R.jobs.idle+" idle: give them something to do" : "";
    $("pop-happy").textContent = "happiness "+pct(R.happy);
  }
  if($("grass-have")){
    const g = grassGain(S, R.f);
    $("grass-have").textContent = S.grass;
    $("grass-bonus").textContent = "+"+pct(S.grass*GRASS_EACH);
    $("grass-run").textContent = fmt(S.run.cult)+" $CULT";
    $("grass-gain").textContent = "+"+g+" 🌿";
    $("btn-grass").disabled = !S.tech.garden || g<1;
    const next = Math.pow(g+1, 2)*500/Math.pow(1+(R.f.grass||0), 2);
    $("grass-why").textContent = !S.tech.garden ? "research the infinite garden first." : "next grass at "+fmt(next)+" $CULT this run.";
  }
}

/* rebuild when the set of things on screen changes, otherwise just update */
function signature(){
  return [tab, tabs().map(t=>t.id).join(), BUILDINGS.filter(b=>shown(b)||S.b[b.id]).length,
    TECHS.filter(t=>techShown(t)||S.tech[t.id]).map(t=>t.id+(S.tech[t.id]?1:0)).join(),
    UPGRADES.filter(u=>shown(u)||S.up[u.id]).map(u=>u.id+(S.up[u.id]?1:0)).join(),
    JOBS.filter(shown).length, Object.keys(S.perks).length, tab==="miladys" ? S.miladys.map(m=>m.id+m.job).join() : ""].join("|");
}
function refresh(force){
  R = rates(S);
  if(!tabs().some(t=>t.id===tab)) tab = "network";
  const s = signature();
  if(force || s!==sig){ sig = s; build(); }
  update();
}

/* ---------- a closer look at one milady ---------- */
function showMilady(id){
  const m = S.miladys.find(x=>x.id===id); if(!m) return;
  const jobBtns = ['<button class="pick'+(!m.job ? " on" : "")+'" data-job="">💤 idle</button>'].concat(
    JOBS.filter(shown).map(j=>'<button class="pick'+(m.job===j.id ? " on" : "")+'" data-job="'+j.id+'">'+j.icon+" "+j.name+"</button>")).join("");
  openModal('<h2>'+m.name+'</h2><canvas id="mil-cv" width="600" height="750" class="portrait"></canvas>'+
    '<div class="note">joined '+new Date(m.t).toLocaleString()+'</div>'+
    '<div class="seg wrap">'+jobBtns+'</div>'+
    '<div class="row"><input id="mil-name" class="name-in" maxlength="20" value="'+m.name.replace(/"/g, "&quot;")+'"><button class="btn small" id="mil-rename">rename</button></div>'+
    '<div class="row"><button class="btn small" data-close>close</button><button class="btn small danger" id="mil-kick">kick from the network</button></div>');
  compose(m.look).then(cv=>{ const c = $("mil-cv"); if(c) c.getContext("2d").drawImage(cv, 0, 0); });
  document.querySelectorAll("#modal [data-job]").forEach(b=>b.onclick = ()=>{ m.job = b.dataset.job; refresh(); showMilady(id); });
  $("mil-rename").onclick = ()=>{ const v = $("mil-name").value.trim(); if(v){ m.name = v.slice(0, 20); refresh(true); showMilady(id); } };
  $("mil-kick").onclick = ()=>{ S.miladys = S.miladys.filter(x=>x.id!==id); log("👋 you kicked <b>"+m.name+"</b>."); closeModal(); refresh(true); };
}

/* ---------- modal ---------- */
function openModal(html){
  $("modal-panel").innerHTML = html;
  $("modal").classList.remove("hidden");
  $("modal-panel").querySelectorAll("[data-close]").forEach(b=>b.onclick = closeModal);
}
function closeModal(){ $("modal").classList.add("hidden"); }

function openSettings(){
  openModal('<h2>settings</h2>'+
    '<div class="set-row"><span>sound</span><button class="tog'+(S.settings.mute ? "" : " on")+'" id="set-mute">'+(S.settings.mute ? "off" : "on")+'</button></div>'+
    '<div class="set-row"><span>animated backdrop</span><button class="tog'+(S.settings.bg!==false ? " on" : "")+'" id="set-bg">'+(S.settings.bg!==false ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>calm (less motion)</span><button class="tog'+(S.settings.calm ? " on" : "")+'" id="set-calm">'+(S.settings.calm ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>your milady</span><button class="btn small" id="set-reroll">reroll her</button></div>'+
    '<div class="set-row"><span>save</span><span><button class="btn small" id="set-export">export</button> <button class="btn small" id="set-import">import</button></span></div>'+
    '<textarea id="save-box" class="save-box hidden" spellcheck="false"></textarea>'+
    '<div class="set-row"><span>start over, for real</span><button class="btn small danger" id="set-wipe">wipe save</button></div>'+
    '<p class="note">the game saves itself every few seconds, in this browser. export it to move it somewhere else.</p>'+
    '<div class="row"><button class="btn small" data-close>close</button></div>');
  $("set-mute").onclick = ()=>{ S.settings.mute = !S.settings.mute; syncMute(); openSettings(); };
  $("set-bg").onclick = ()=>{ S.settings.bg = S.settings.bg===false; syncLook(); openSettings(); };
  $("set-calm").onclick = ()=>{ S.settings.calm = !S.settings.calm; syncLook(); openSettings(); };
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
    '<p>much later you can <b>touch grass</b>: start over with grass 🌿 that makes everything faster, forever.</p>'+
    '<p class="note">the game keeps going while you\'re away (up to 8 hours). keys: space posts, m makes a meme.</p>'+
    '<div class="row"><button class="btn small" data-close>got it</button></div>');
}

/* ---------- you ---------- */
async function drawYou(){
  const cv = await compose(S.you, true);
  for(const id of ["you", "title-you"]){
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
  document.addEventListener("keydown", e=>{
    if(!S.started || e.target.tagName==="INPUT" || e.target.tagName==="TEXTAREA") return;
    if(e.key==="Escape") return closeModal();
    if(!$("modal").classList.contains("hidden")) return;
    if(e.key===" "){ e.preventDefault(); if(!e.repeat){ const r = $("you").getBoundingClientRect(); post({ clientX:r.left+r.width/2, clientY:r.top+r.height/3 }); } }
    else if(e.key==="m") memeIt(e.shiftKey ? 10 : 1);
  });
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden) save(); else frame(); });
  window.addEventListener("pagehide", save);

  if(S.started){ catchUp(); startGame(); }
  else { show("screen-title"); drawYou(); }
  setInterval(frame, 150);
  checkVersion(); setInterval(checkVersion, 5*60*1000);
}
init();
