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
  if(h >= 48) return Math.floor(h/24)+"d "+(h%24)+"h";
  return h ? h+"h "+m+"m" : m ? m+"m "+s+"s" : s+"s";
}
const pct = x => Math.round(x*100)+"%";
const localFile = path => (window.INLINE_FILES && window.INLINE_FILES[path]) || path; // dist.html carries its pictures inside it
const COIN = window.INLINE_FILES ? localFile("assets/img/cult_coin.png") : "assets/img/cult_coin.png?v=2"; // v2: cut to its circle (a kept copy of the square one is passed over)
const resIcon = id => RES_BY[id].icon==="coin" ? '<img class="coin" src="'+COIN+'" alt="$CULT">' : RES_BY[id].icon;

/* ---------- state ---------- */
let S = null;
function fresh(keep){
  const s = {
    v:1, last:Date.now(), t:0, runT:0,
    res:{}, seen:{}, b:{}, tech:{}, up:{}, miladys:[], nextId:1,
    cycle:0, phaseT:0, buffs:[],
    timers:{ arrive:0, leave:0, sparkle:60, drama:180, auto:0, feed:40, bot:0 },
    run:{ cult:0, start:Date.now(), auto:{ b:0, t:0, u:0, m:0 } },
    nn:{ i:0, got:{}, on:true, share:0.5 }, ended:0, endSeen:false,
    auto:{ build:true, tech:true, up:true, meme:true, rite:true, raid:true, wonder:true, grass:true, keep:0.25, skip:{},
      rites:{ prayer:true, hyperpost:true, airdrop:true, vigil:true, meetup:false, bull:false } }, // which rituals the choirmaster holds
    grass:0, perks:{}, ach:{}, relics:{}, chDone:{}, challenge:null,
    cd:{}, raids:[], wonder:0, autoJob:"poster", seenNew:{}, history:[], born:Date.now(),
    garden:{ at:"best", min:10, runs:[], away:0 }, // the gardener: when it touches grass, its last few runs (for time away), and grass it brought in while you were
    t2:null, // the second tier, once the gardener has it running: { res, b, tech, frozen (the grass bonus, locked in), e0 (the epoch it opened on) }
    who:{ kind:"milady", token:null, eye:"" }, // who you are: a milady or a remilio, rolled or a token by its number (S.you is the layers)
    stats:{ clicks:0, sparkles:0, resets:0, played:0, made:{}, rituals:0, raids:0, cancels:0, cycles:0 },
    you:null, settings:{ mute:false, bg:true, calm:!!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches),
      notifyOn:false, notify:{ raid:true, ritual:true, full:false, grass:true, nn:true } }, log:[], started:false,
  };
  for(const r of RES){ s.res[r.id] = 0; s.seen[r.id] = 0; }
  for(const b of BUILDINGS) s.b[b.id] = 0;
  if(keep) Object.assign(s, keep);
  return deviceSettings(s);
}
/* Signed out, the network lives in this browser (SAVE_KEY). Signed in, it lives on the account, and this browser keeps
   a copy of it under the account's id so it opens instantly and plays on with no connection. */
const slotKey = () => acct() ? SAVE_KEY+":"+acct().player : SAVE_KEY;
function save(){
  if(!S) return;
  try{ localStorage.setItem(slotKey(), JSON.stringify(S)); }catch(e){}
  keepDevice();
}
/* Some settings belong to the device, not the network: a phone that lags wants the backdrop off while the desktop
   keeps it, and sound or the ambient screen are about where you are. Each device keeps its own and lays them over
   whatever a save says, whichever device that save came from. A device that has never set them starts from the
   network's. */
const DEVICE_KEY = "network-device", DEVICE_SETTINGS = ["mute", "vol", "music", "bg", "calm", "faces", "ambient", "notifyOn", "notify"];
function deviceSettings(s){
  let d = null; try{ d = JSON.parse(localStorage.getItem(DEVICE_KEY)); }catch(e){}
  if(d && s && s.settings) for(const k of DEVICE_SETTINGS) if(k in d) s.settings[k] = d[k];
  return s;
}
function keepDevice(){
  const d = {}; for(const k of DEVICE_SETTINGS) if(S.settings[k]!==undefined) d[k] = S.settings[k];
  try{ localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); }catch(e){}
}
function load(){
  try{
    const raw = localStorage.getItem(slotKey());
    if(raw) return migrate(JSON.parse(raw));
  }catch(e){}
  return null;
}
function migrate(s){ // fill in anything a newer version added
  const base = fresh();
  if(s.netName){ // a name from when networks could have one: gone, and so is every feed line it was in
    const was = esc(s.netName);
    s.log = (s.log||[]).filter(l=>!String(l.html).includes(was));
    delete s.netName;
  }
  if(s.stats && s.stats.cycles==null) s.stats.cycles = Math.max(s.cycle||0, Math.floor((s.stats.played||0)/(PHASE_SECS*PHASES.length))); // older saves: a good guess from time played
  if(s.born==null && s.stats) s.born = Date.now() - (s.stats.played||0)*1000;
  for(const k in base) if(s[k]==null) s[k] = base[k];
  for(const k of ["res","seen","b","timers","stats","settings","run","nn","auto"]) s[k] = Object.assign({}, base[k], s[k]);
  s.settings.notify = Object.assign({}, base.settings.notify, s.settings.notify);
  s.run.auto = Object.assign({}, base.run.auto, s.run.auto);
  s.auto.rites = Object.assign({}, base.auto.rites, s.auto.rites);
  return deviceSettings(s);
}

const netName = () => "the network"; // networks used to take a name; not any more (anyone could put anything there)
const esc = t => String(t).replace(/[&<>"]/g, c=>({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]);

/* ---------- the rules ---------- */
const ACH_EACH = 0.01;
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
  for(let i=0; i<((s.nn && s.nn.i)||0); i++) add(NEWNET[i].fx, 1);
  add(EPOCH_FX, (s.nn && s.nn.e)||0);
  if(s.t2){ for(const b of T2_BUILDINGS) add(b.fx, s.t2.b[b.id]||0); for(const t of T2_TECH) if(s.t2.tech[t.id]) add(t.fx, 1); }
  f.all = (f.all||0) + Object.keys(s.ach).length * ACH_EACH; // every achievement is worth a little
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
  const grassMult = 1 + (s.t2 ? s.t2.frozen : s.grass*(GRASS_EACH + (f.grassEach||0))); // in the second tier it's locked in
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
  // your posting bots are part of the vibes coming in (they post even on a logged-off run: it's you who can't)
  const autoclick = f.autoclick||0, bots = autoclick * (rule(s, "logoff") ? (1 + (f.click||0)) * grassMult : click);
  net.vibes += bots;
  const t2 = {}; // what the second tier makes a second: each epoch is +10% to it too
  if(s.t2) for(const r of T2_RES) t2[r.id] = (f["t2."+r.id]||0) * (1 + (f["t2mult."+r.id]||0)) * (1 + EPOCH_FX.all*((s.nn && s.nn.e)||0));
  return { f, jobs, happy, prod, cap, net, eat, housing, click, autoclick, bots, phase:ph, grassMult, t2 };
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
  for(const r of RES) gain(s, r.id, R.net[r.id]*dt, R.cap[r.id]); // (vibes' net has your posting bots in it)

  // the market
  const before = Math.floor(s.phaseT/PHASE_SECS);
  s.phaseT += dt;
  const after = Math.floor(s.phaseT/PHASE_SECS);
  if(after!==before){
    if(after % PHASES.length===0){ s.cycle++; s.stats.cycles++; }
    if(live && !rule(s, "bear")){ const p = phase(s); FX.phase(p); react({ mania:"hype", bear:"worry", dist:"smug", accum:"calm" }[p.id]); log(p.icon+" the market turns: <b style='color:"+p.color+"'>"+p.name+"</b>. "+p.desc+"."); }
  }

  // miladys turn up while there's room and something to eat; they leave when there isn't
  const n = s.miladys.length;
  if(n > (s.run.peak||0)) s.run.peak = n;
  if(n < R.housing && s.res.vibes > 0){
    s.timers.arrive += dt * (1 + (R.f.arrive||0));
    if(s.timers.arrive >= 5){ s.timers.arrive = 0; const m = newMilady(s, R); if(live){ FX.arrive(); log((m.kind==="remilio" ? "🤘" : "🌸")+" <b>"+m.name+"</b> joined "+esc(netName())+"."); } }
  } else s.timers.arrive = 0;
  if((s.res.vibes <= 0 && R.net.vibes < 0) || n > R.housing){
    s.timers.leave += dt;
    if(s.timers.leave >= 4 && n){
      s.timers.leave = 0;
      const home = s.miladys.filter(m=>!m.away), m = home.find(m=>!m.job) || home[home.length-1];
      if(m){
        s.miladys.splice(s.miladys.indexOf(m), 1);
        if(live){ log("🥀 <b>"+m.name+"</b> logged off. "+(n>R.housing ? "no room." : "the vibes ran out."), "bad"); react("sad"); }
      }
    }
  } else s.timers.leave = 0;

  for(let i=s.raids.length-1; i>=0; i--) if(s.raids[i].until <= s.t) raidHome(s, i, live);
  s.buffs = s.buffs.filter(b=>b.until > s.t);
  if(s.t2) for(const r of T2_RES) s.t2.res[r.id] += R.t2[r.id]*dt;
  pour(s, R, dt, live);
  automate(s, R, dt, live);
  sample(s, R);
  splits(s);
  if(live) liveEvents(s, dt, R);
  if(s===S) gardener(s, R, live); // last: it can start a new run
}

/* ---------- the new internet: poured into, a stage at a time ---------- */
const nnOpen = s => resets(s) >= NEWNET_NG;
function nnReqMet(s, st){
  const q = st.req || {};
  return (!q.miladys || s.miladys.length >= q.miladys) && (!q.cathedral || (s.wonder||0) >= WONDER.length);
}
/* how fast a resource is going in: a share of what you make, and all of it while storage is full (it'd be lost) */
function pourRate(s, R, k){
  if(inT2(s)) return Math.max(0, R.t2[k]||0) * s.nn.share; // the second tier has no storage to overflow
  const full = s.res[k] >= R.cap[k] - 1e-6;
  return Math.max(0, R.net[k]) * (full ? 1 : s.nn.share);
}
/* what's being poured into: a stage, or past the ending, the next epoch (from the second tier, once it's running) */
const inT2 = s => !!(s.t2 && s.ended);
const epochMult = s => Math.max(0.2, 1 + (s.t2 ? T2_TECH.reduce((a, t)=>a + (s.t2.tech[t.id] && t.fx.epochCost || 0), 0) : 0));
const nnStage = s => s.ended ? epochStage(s.nn.e||0, inT2(s) ? { t2:true, from:s.t2.e0, mult:epochMult(s) } : null) : NEWNET[s.nn.i];
const nnBank = s => inT2(s) ? s.t2.res : s.res;
function pour(s, R, dt, live){
  if(!nnOpen(s)) return;
  const st = nnStage(s); if(!st) return;
  const bank = nnBank(s);
  if(s.nn.on) for(const k in st.need){
    const left = st.need[k] - (s.nn.got[k]||0); if(left <= 0) continue;
    const take = Math.min(left, bank[k], pourRate(s, R, k)*dt);
    if(take > 0){ bank[k] -= take; s.nn.got[k] = (s.nn.got[k]||0) + take; }
  }
  if(Object.keys(st.need).every(k=>(s.nn.got[k]||0) >= st.need[k]-1e-6) && nnReqMet(s, st)) finishStage(s, live);
}
function pourStored(){ // everything you're holding that the stage still needs, in one go
  const st = nnStage(S); if(!st) return;
  let any = 0;
  const bank = nnBank(S);
  for(const k in st.need){ const take = Math.min(st.need[k] - (S.nn.got[k]||0), bank[k]); if(take > 0){ bank[k] -= take; S.nn.got[k] = (S.nn.got[k]||0) + take; any++; } }
  if(!any) return sfx.no();
  sfx.buy(); FX.buy($("nn-pour-now"));
  pour(S, R, 0, true); refresh();
}
function finishStage(s, live){
  const st = nnStage(s);
  s.nn.got = {};
  if(s.ended){
    s.nn.e = (s.nn.e||0) + 1;
    if(live){ sfx.shiny(); FX.research(); react("love"); log("♾️ the new internet: <b>"+st.name+"</b> is done. "+fxDesc(st.fx)+", for good."); }
    return;
  }
  s.nn.i++;
  if(s.nn.i >= NEWNET.length){ s.ended = Date.now(); s.endSeen = false; }
  if(!live) return;
  sfx.shiny(); FX.research(); react("love");
  log(st.icon+" the new internet: <b>"+st.name+"</b> is done. "+fxDesc(st.fx)+", for good.");
  if(s.ended) showEnding();
}

/* ---------- automation: the robots the late runs buy ---------- */
function automate(s, R, dt, live){
  const p = s.perks, a = s.auto;
  if(!p.automeme && !p.autotech && !p.autobuild && !p.autoup && !p.autorite && !p.autoraid && !p.autowonder) return;
  s.timers.bot = (s.timers.bot||0) + dt;
  if(s.timers.bot < 1) return;
  const n = Math.min(20, Math.floor(s.timers.bot)); s.timers.bot -= n; // one go a second (a long step offline gets a few)
  const spare = c => Object.keys(c).every(k=>s.res[k] - c[k] >= a.keep*R.cap[k] - 1e-9); // leaves the reserve alone
  const room = c => Math.max(...Object.keys(c).map(k=>c[k]/R.cap[k])); // how much of your storage it takes
  const cheapest = list => list.sort((x, y)=>room(x.c) - room(y.c))[0];
  const ct = s.run.auto, did = { m:0, t:[], u:[], b:{}, x:[] }; // what this go bought, for ambient mode's cards
  for(let i=0; i<n; i++){
    if(p.automeme && a.meme && s.res.vibes >= R.cap.vibes*0.9){
      const m = Math.min(Math.floor((s.res.vibes - R.cap.vibes*0.6)/MEME_COST), Math.floor(R.cap.memes - s.res.memes));
      if(m > 0){ s.res.vibes -= m*MEME_COST; gain(s, "memes", m, R.cap.memes); ct.m += m; did.m += m; }
    }
    if(p.autotech && a.tech){
      const t = cheapest(TECHS.filter(t=>!s.tech[t.id] && techShownIn(s, t)).map(t=>({ x:t, c:techPrice(t, s, R.f) })).filter(o=>canPay(s, o.c)));
      if(t){ pay(s, t.c); s.tech[t.x.id] = true; ct.t++; did.t.push(t.x.name); if(live){ log("🤖 researched <b>"+t.x.name+"</b>. "+t.x.desc); FX.research(); } }
    }
    if(p.autoup && a.up && !rule(s, "frugal")){
      const u = cheapest(UPGRADES.filter(u=>!s.up[u.id] && shownIn(s, u) && canPay(s, u.cost)).map(u=>({ x:u, c:u.cost })));
      if(u){ pay(s, u.c); s.up[u.x.id] = true; ct.u++; did.u.push(u.x.name); if(live) log("🤖 bought <b>"+u.x.name+"</b>: "+u.x.desc); }
    }
    if(p.autobuild && a.build){
      const b = cheapest(BUILDINGS.filter(b=>shownIn(s, b) && !a.skip[b.id]).map(b=>({ x:b, c:priceOf(b, s, R.cap) })).filter(o=>canPay(s, o.c) && spare(o.c)));
      if(b){ pay(s, b.c); s.b[b.x.id]++; ct.b++; did.b[b.x.name] = (did.b[b.x.name]||0) + 1; if(live && s.b[b.x.id]===1) log("🤖 built your first <b>"+b.x.name+"</b>."); }
    }
    if(p.autowonder && a.wonder && (s.wonder||0) < WONDER.length && s.tech.geometry){
      const c = wonderPrice(s.wonder||0, R.f);
      // the reserve is kept where it can be: a stage bigger than what's spare above it is built as soon as it's affordable
      const fits = Object.keys(c).every(k=>c[k] <= (1 - a.keep)*R.cap[k]);
      if(canPay(s, c) && (spare(c) || !fits)){ const w = WONDER[s.wonder||0]; doStage(s, R); did.x.push(["⛪", "built", w.name]); if(live) stageLog(s, w, true); }
    }
    if(p.autorite && a.rite) for(const r of RITUALS) if(a.rites[r.id] && ritualOk(s, R, r)){
      const msg = doRitual(s, R, r.id); did.x.push([r.icon, "held", r.name]);
      if(live){ ritualFx(r.id); log("🤖 "+r.icon+" held <b>"+r.name+"</b>. "+msg); }
    }
    if(p.autoraid && a.raid && s.tech.raiding){
      // idle miladys go first; of the workers, never more than a quarter are out raiding at once
      const idle = s.miladys.filter(m=>!m.away && !m.job).length, workers = s.miladys.filter(m=>m.job).length, out = s.miladys.filter(m=>m.job && m.away).length;
      const r = RAIDS.filter(r=>!s.raids.some(x=>x.id===r.id) && out + Math.max(0, r.n - idle) <= Math.floor(workers/4)).pop(); // the best there's a crew for
      if(r){ const x = doRaid(s, R, r.id); did.x.push(["⚔️", "raided", r.name]); if(live) log("🤖 ⚔️ "+r.n+" miladys left to raid <b>"+r.name+"</b>. back in "+fmtTime(x.len)+"."); }
    }
  }
  if(live && typeof AMBIENT!=="undefined" && AMBIENT.on) AMBIENT.bot(did);
}

/* ---------- graphs: what you held, through the run ---------- */
/* a point every 15s; when there are too many, every other one goes and the gap doubles, so a long run still fits */
const GRAPH_MAX = 240;
function sample(s, R){
  const g = s.run.g || (s.run.g = { every:15, next:0, t:[], v:{} });
  if(s.runT < g.next) return;
  g.next = s.runT + g.every;
  g.t.push(Math.round(s.runT));
  // a series that starts partway through a run (a save from before it was kept) is zeros up to here, so they all line up
  const put = (k, v) => (g.v[k] || (g.v[k] = new Array(g.t.length-1).fill(0))).push(v);
  for(const r of RES) put(r.id, +s.res[r.id].toPrecision(3));
  put("miladys", s.miladys.length);
  if(R){
    for(const j of JOBS) put("j."+j.id, R.jobs[j.id]);
    put("j.idle", R.jobs.idle); put("j.away", R.jobs.away);
    const src = vibeSources(s, R, g);
    for(const k in src) put("v."+k, +src[k].toPrecision(3));
    put("ph", PHASES.indexOf(R.phase));
  }
  if(g.t.length > GRAPH_MAX){
    const half = arr => arr.filter((_, i)=>i%2===0);
    g.t = half(g.t); for(const k in g.v) g.v[k] = half(g.v[k]);
    g.every *= 2; g.next = g.t[g.t.length-1] + g.every;
  }
}

/* where the vibes are coming from right now, after every bonus, and what eating takes */
function vibeSources(s, R, g){
  const f = R.f, J = R.jobs, poster = JOBS[0];
  const posters = J.w.poster * poster.rate * (1 + (f["job.poster"]||0)) * R.happy;
  const buildings = BUILDINGS.reduce((a, b)=>a + (s.b[b.id]||0)*(b.fx["rate.vibes"]||0), 0);
  const other = Math.max(0, (f["rate.vibes"]||0) - buildings) + (f["idle.vibes"]||0)*J.idle;
  const base = posters + buildings + other, mult = base > 0 ? R.prod.vibes/base : 0;
  // you: the posts since the last point, at what a post is worth now
  const dt = s.runT - (g.clkT||0), you = g.clk!=null && dt > 0 ? Math.max(0, s.stats.clicks - g.clk)/dt*R.click : 0;
  g.clk = s.stats.clicks; g.clkT = s.runT;
  return { posters:posters*mult, you, bots:R.bots, buildings:buildings*mult, other:other*mult, eat:-R.eat };
}
/* run splits: when the network first got to 10, 50, 100 and 250 at once */
const SPLITS = [10, 50, 100, 250];
function splits(s){
  const sp = s.run.sp || (s.run.sp = {}), n = s.miladys.length;
  if(n < 10) return;
  for(const k of SPLITS) if(!sp[k] && n >= k) sp[k] = Math.round(s.runT);
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
      log("💢 drama in the group chat. -15% happiness for 90s."+(s.tech.moderation ? " mods would help." : ""), "bad"); react("drama");
    }
  }
  s.timers.feed -= dt;
  if(s.timers.feed <= 0){ s.timers.feed = 50 + rnd()*70; log("<i>"+choice(FEED[R.phase.id])+"</i>", "dim"); }
}

/* ---------- prices ---------- */
/* a building that adds storage never costs more than 95% of the storage it adds to: its price grows faster than the
   room it makes, so without this a long run reaches one it can't fit, and then nothing can ever make that room */
const STORE_MAX = 0.95;
const stores = (b, k) => { const f = b.fx || {}; return !!(f["cap."+k] || f["capMult."+k] || f.capAll); };
const capOf = s => s===S && R ? R.cap : rates(s).cap;
function priceOf(b, s, cap){
  const n = s.b[b.id] || 0, c = {};
  for(const k in b.cost){
    c[k] = b.cost[k] * Math.pow(b.ratio, n);
    if(stores(b, k)){ cap = cap || capOf(s); c[k] = Math.min(c[k], cap[k]*STORE_MAX); }
  }
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
    order:["Background","Skin","Face","Eyes","Mouth","Neck","Necklaces","Shirt","Hair","Brows","Earrings","Face Decoration","Glasses","Hat"],
    odds:{ Face:0.6, Neck:0.08, Necklaces:0.3, "Face Decoration":0.2, Earrings:0.3, Glasses:0.3, Hat:0.4 } },
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
  const M = TOKEN_MAP[kind||"milady"]; // and whatever the collection hides under something else (a strawberry hat has no hair showing)
  for(const layer in M.exclusions){ const v = look[layer] && look[layer].slice(0, -5); for(const gone of (M.exclusions[layer][v]||[])) delete look[gone]; }
  return look;
}
/* a token's traits ([[trait, value], …]) as layers, the way the cancel is coming reads them. Null if it has no body. */
function tokenLayers(kind, attrs){
  const M = TOKEN_MAP[kind], K = KINDS[kind], files = ASSETS[M.cfg], layers = {};
  const title = v => v.split(" ").map(w=>w ? w[0].toUpperCase()+w.slice(1) : w).join(" ");
  let eye = "";
  for(const [trait, value] of attrs){
    const layer = M.names[trait] || trait;
    const want = (M.values[trait]||{})[value] || (M.transform==="titlecase" ? title(value) : value);
    if(M.tint && layer===M.tint.by){ eye = want; continue; }
    if(layer==="Background" || !K.order.includes(layer) || !files[layer]) continue; // backgrounds, overlays and scores aren't worn
    const f = files[layer].find(x=>x.toLowerCase()===(want+".webp").toLowerCase());
    if(f) layers[layer] = f;
  }
  for(const layer in M.exclusions){ const v = layers[layer] && layers[layer].slice(0, -5); for(const gone of (M.exclusions[layer][v]||[])) delete layers[gone]; }
  for(const layer in M.layerExclusions) if(layers[layer]) for(const gone of M.layerExclusions[layer]) delete layers[gone];
  return layers[M.body] ? { layers, eye:(files[M.tint ? M.tint.by : ""]||[]).includes(eye+".webp") ? eye : "" } : null;
}
/* a Milady's eye color, as the maker does it: inside the eye mask, each pixel keeps its lightness and takes the color's
   hue and saturation (the same as the cancel is coming) */
function rgb2hsl(r, g, b){
  r/=255; g/=255; b/=255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2, d = mx-mn;
  let h = 0, s = 0;
  if(d){ s = d/(1-Math.abs(2*l-1)); h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4; h *= 60; if(h<0) h += 360; }
  return [h, s*100, l*100];
}
function hsl2rgb(h, s, l){
  s/=100; l/=100;
  const k = n => (n+h/30)%12, a = s*Math.min(l,1-l), f = n => l-a*Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
  return [255*f(0), 255*f(8), 255*f(4)];
}
function tintEyes(cx, mask, swatch, darken){
  const W = 600, Y = 180, H = 320; // the eyes sit in this band
  const t = document.createElement("canvas"); t.width = W; t.height = 750;
  const tx = t.getContext("2d", { willReadFrequently:true });
  tx.drawImage(swatch, 0, 0, W, 750);
  const c = tx.getImageData(300, 375, 1, 1).data, [th, ts] = rgb2hsl(c[0], c[1], c[2]);
  tx.clearRect(0, 0, W, 750); tx.drawImage(mask, 0, 0, W, 750);
  const m = tx.getImageData(0, Y, W, H), e = cx.getImageData(0, Y, W, H), md = m.data, ed = e.data;
  for(let i=0; i<md.length; i+=4){
    if(md[i+3] < 128 || md[i]+md[i+1]+md[i+2] < 180){ md[i+3] = 0; continue; } // black or empty: not the iris
    let l = rgb2hsl(ed[i], ed[i+1], ed[i+2])[2];
    if(darken) l = l < 5 ? 5 : l*darken;
    const [r, g, b] = hsl2rgb(th, ts, l);
    md[i] = r; md[i+1] = g; md[i+2] = b; md[i+3] = 255;
  }
  tx.clearRect(0, 0, W, 750); tx.putImageData(m, 0, Y);
  cx.drawImage(t, 0, 0);
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
    // a token's eye color, on the eyes that have a mask for it
    const T = TOKEN_MAP.milady.tint, eyes = look.Eyes && look.Eyes.slice(0, -5);
    const tint = K.cfg==="Milady" && look._eye && T.values.includes(eyes)
      ? await Promise.all([loadImg("assets/img/Milady/"+T.mask+"/"+look.Eyes), loadImg("assets/img/Milady/"+T.by+"/"+look._eye+".webp")]).catch(()=>null) : null;
    const cv = document.createElement("canvas"); cv.width = K.w; cv.height = K.h;
    const cx = cv.getContext("2d", { willReadFrequently:!!tint });
    ims.forEach((im, i)=>{
      if(im) cx.drawImage(im, 0, 0, K.w, K.h);
      if(tint && layers[i]==="Eyes") try{ tintEyes(cx, tint[0], tint[1], T.darken[look._eye]||0); }catch(e){}
    });
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
  vol = (vol||0.04) * (S && S.settings.vol!=null ? S.settings.vol : 70)/70; // the effects volume, out of 100 (70 is how it always was)
  if(vol <= 0) return;
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type||"square"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq*1.5, t+len);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t+len);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t+len);
  }catch(e){}
}
/* a post is a note from a five-note scale, rooted where the market is: bright in mania, low in a bear market */
const POST_ROOT = { accum:523, mania:659, dist:587, bear:440 }, PENTA = [1, 9/8, 5/4, 3/2, 5/3];
const sfx = {
  post: ()=>blip((POST_ROOT[S && R ? R.phase.id : "accum"]||523) * choice(PENTA), 0.06, "square", 0.025),
  chime:()=>{ [1568,2093].forEach((f,i)=>setTimeout(()=>blip(f, 0.18, "sine", 0.035), i*90)); },
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
/* posting tops out at 25 a second, however it's done (a held key, an autoclicker): an account's saves are refused
   past 30 a second (network_api.py, CLICKS_PER_SEC), so the game never gets near it */
const POST_GAP = 40;
let lastPost = 0;
function post(e){
  if(rule(S, "logoff")){ if(e && e.clientX!=null) floatText(e.clientX, e.clientY, "logged off"); return sfx.no(); }
  const now = performance.now();
  if(now - lastPost < POST_GAP) return;
  lastPost = now;
  const got = gain(S, "vibes", R.click, R.cap.vibes);
  S.stats.clicks++;
  sfx.post();
  lastTouch = Date.now();
  react(got>0 ? "talk" : "full");
  if(POST_MILESTONES.includes(S.stats.clicks)){ celebrate(S.stats.clicks); react("love"); }
  const you = $("you-wrap");
  you.classList.remove("boop"); void you.offsetWidth; you.classList.add("boop");
  if(e && e.clientX!=null){ floatText(e.clientX, e.clientY, got>0 ? "+"+fmt(R.click)+" 🌸" : "full 🌸"); if(got>0) FX.post(e.clientX, e.clientY); }
}
const POST_MILESTONES = [100, 1000, 10000, 100000, 1000000];
function celebrate(n){ // a posting milestone: she lights up
  const w = $("you-wrap"), r = w.getBoundingClientRect();
  FX.sparkle(r.left+r.width/2, r.top+r.height/2); sfx.shiny();
  w.classList.remove("beam"); void w.offsetWidth; w.classList.add("beam");
  log("🎉 post number <b>"+fmt(n)+"</b>. she's glowing.");
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
/* buying buildings by the one, the ten, or as many as you can: the network tab's selector, or shift for ten */
function priceN(b, s, n){
  const k = s.b[b.id] || 0, c = {}, f = b.ratio===1 ? n : (Math.pow(b.ratio, n) - 1)/(b.ratio - 1);
  let cap = null;
  for(const r in b.cost){
    if(!stores(b, r)){ c[r] = b.cost[r] * Math.pow(b.ratio, k) * f; continue; }
    cap = cap || capOf(s); c[r] = 0; // each one held to what fits now (more room after each would only lower the price)
    for(let i=0; i<n; i++) c[r] += Math.min(b.cost[r] * Math.pow(b.ratio, k+i), cap[r]*STORE_MAX);
  }
  return c;
}
function maxAfford(b, s){
  let n = 0;
  while(n < 500 && canPay(s, priceN(b, s, n+1))) n++;
  return n;
}
const buyMode = () => S.settings.buyN || "1";
function wantN(b, shift){ // how many a click buys (and the card prices)
  const m = shift ? "10" : buyMode();
  return m==="max" ? Math.max(1, maxAfford(b, S)) : +m;
}
function buyBuilding(id, card, shift){
  const b = byId(BUILDINGS, id), want = wantN(b, shift);
  let n = 0;
  while(n < want && canPay(S, priceOf(b, S))){ pay(S, priceOf(b, S)); S.b[id]++; n++; } // as many of them as you can afford
  if(!n) return sfx.no();
  sfx.buy(); FX.buy(card, n>1); react(n>1 ? "big" : "buy");
  if(S.b[id]===n) log("🏗️ you built your first <b>"+b.name+"</b>"+(n>1 ? ", and "+(n-1)+" more" : "")+".");
  refresh();
}
function buyTech(id, card){
  const t = byId(TECHS, id), c = techPrice(t, S);
  if(S.tech[id] || !canPay(S, c)) return sfx.no();
  pay(S, c); S.tech[id] = true; sfx.buy(); FX.buy(card, true); FX.research(); react("study");
  log("📜 researched <b>"+t.name+"</b>. "+t.desc);
  refresh();
}
function buyUpgrade(id, card){
  const u = byId(UPGRADES, id);
  if(S.up[id] || !canPay(S, u.cost)) return sfx.no();
  pay(S, u.cost); S.up[id] = true; sfx.buy(); FX.buy(card); react("buy");
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
    '<p>you keep <b>+'+g+' grass 🌿</b>, your perks, your relics, your achievements and your own milady. '+(S.t2 ? "grass is what the new internet is built from." : "every grass you hold makes everything "+pct(GRASS_EACH+(R.f.grassEach||0))+" faster.")+'</p>'+
    (cur ? '<p>'+(met ? '✅ you beat <b>'+cur.name+'</b>: '+cur.rdesc+'.' : '❌ <b>'+cur.name+'</b> isn\'t beaten this time.')+'</p>' : "")+
    (next ? '<p class="unlock-note">🔓 next run opens <b>'+next.name+'</b>: '+next.desc+'</p>' : "")+
    (ch ? '<p class="unlock-note">⚖️ the next run is a challenge: <b>'+ch.name+'</b>. '+ch.rule+'</p>' : "")+
    '<div class="row"><button class="btn big" id="grass-yes">touch grass 🌿</button><button class="btn small" data-close>not yet</button></div>');
  $("grass-yes").onclick = ()=>{
    doTouchGrass(into);
    closeModal(); sfx.shiny(); FX.grass(); react("calm");
    log("🌿 you touched grass. +"+g+" grass. the network starts again, and it remembers you. "+shareBtn(resets(S)));
    if(next) log("🔓 new: <b>"+next.name+"</b>. "+next.desc);
    if(met) log("✅ challenge beaten: <b>"+cur.name+"</b>. "+cur.rdesc+".");
    if(ch) log("⚖️ challenge: <b>"+ch.name+"</b>. "+ch.rule);
    tab = "network"; refresh(true);
  };
}
/* the run ends and a new one starts with what's kept: by you, or by the gardener (bot) */
let syncSoon = 0;
function doTouchGrass(into, bot){
  const g = grassGain(S), met = challengeMet(S), done = Object.assign({}, S.chDone);
  if(met) done[S.challenge] = true;
  const history = (S.history||[]).concat({ n:resets(S)+1, t:S.runT, cycles:S.cycle, peak:S.run.peak||S.miladys.length, grass:g, sp:S.run.sp,
    challenge:S.challenge, beaten:!!met, end:Date.now(), bot:bot ? 1 : undefined }).slice(-50);
  const garden = bot ? Object.assign({}, S.garden, { runs:S.garden.runs.concat({ t:S.runT, g }).slice(-5) }) : S.garden;
  const keep = { grass:S.grass+g, perks:S.perks, ach:S.ach, you:S.you, who:S.who, settings:S.settings, started:true, relics:S.relics, chDone:done,
    challenge:into||null, autoJob:S.autoJob, seenNew:S.seenNew, seenInit:true, history, born:S.born, garden, t2:S.t2, log:S.log.slice(0, 40),
    nn:S.nn, auto:S.auto, ended:S.ended, endSeen:S.endSeen, stats:Object.assign(S.stats, { resets:S.stats.resets+1 }), nextId:S.nextId };
  if(!bot) keep.log = [];
  S = fresh(keep);
  applyPerksAtStart(S);
  galleryKnown = null;
  clearTimeout(syncSoon); syncSoon = setTimeout(()=>syncUp(), 1000); // a new run is worth keeping straight away
  return g;
}
/* ---------- the gardener: touches grass for you ---------- */
const gardenerOn = s => !!(s.perks.gardener && s.auto.grass);
const grassRaw = (s, f) => Math.sqrt(s.run.cult/500) * (1 + ((f||sumFx(s)).grass||0)); // grassGain, before it's rounded down
function gardener(s, R, live){
  if(!gardenerOn(s) || !s.tech.garden || s.runT < RUN_MIN) return;
  if(s.challenge && !challengeMet(s)) return; // a challenge run is seen through
  const g = grassGain(s, R.f); if(g < 1) return;
  let go;
  if(s.garden.at==="min") go = g >= s.garden.min;
  else { // at the best moment: grass a minute has peaked (smoothly, not in whole grass) and is on its way down
    const rate = grassRaw(s, R.f)/s.runT;
    if(rate > (s.run.gbest||0)) s.run.gbest = rate;
    go = rate < s.run.gbest*0.97;
  }
  if(!go) return;
  const t = s.runT, got = doTouchGrass(null, true);
  if(live){ FX.grass(); log("🤖 🌿 the gardener touched grass after "+fmtTime(t)+": +"+got+" grass. "+shareBtn(resets(S))); refresh(true); }
}
const RUN_MIN = 61; // a run shorter than a minute isn't taken by the account service (network_api.py, RUN_MIN)
/* grass a second the gardener has been bringing in, from its last few runs: what time away is worth */
function gardenRate(s){ const r = s.garden.runs, t = r.reduce((a, x)=>a + x.t, 0); return t ? r.reduce((a, x)=>a + x.g, 0)/t : 0; }
function applyPerksAtStart(s){
  if(s.perks.headstart){ s.b.groupchat = 2; s.b.moodboard = 2; s.res.memes = 50; s.seen.memes = 50; s.seen.vibes = 50; }
  if(s.perks.memory) for(const id of ["wallets","memetics","servers"]) s.tech[id] = true;
  if(s.perks.devops) s.tech.wallets = s.tech.opensource = true;
  if(s.perks.autopilot) for(const id of ["wallets","opensource","inference","agents"]) s.tech[id] = true;
  if(s.perks.faithful){ for(const id of ["memetics","aesthetics","servers","moderation","spirituality","liturgy"]) s.tech[id] = true; s.res.devotion = s.seen.devotion = 100; }
}
const perkShown = (s, p) => opened(s, p) && (!p.show || p.show(s));
function buyPerk(id, card){
  const p = byId(PERKS, id);
  if(S.perks[id] || S.grass < p.cost || !perkShown(S, p)) return sfx.no();
  const frozen = S.grass*(GRASS_EACH + (R.f.grassEach||0)); // the bonus as it stands before paying: buying it never costs you any
  S.grass -= p.cost; S.perks[id] = true; sfx.buy(); FX.buy(card, true); react("big");
  log("🌿 perk: <b>"+p.name+"</b>. "+p.desc);
  if(id==="gardener" && !S.t2){
    S.t2 = { res:{ signal:0, trust:0, memory:0 }, b:{}, tech:{}, frozen, e0:S.nn.e||0 };
    log("🌐 the second tier is open, in the new internet. your grass bonus is locked in at <b>+"+pct(frozen)+"</b> for good: grass is for building now.");
    refresh(true); return;
  }
  refresh();
}
function gardenBox(){
  const g = S.garden, box = el("div", "garden-box");
  box.innerHTML = '<div class="nn-h"><b>🤖 the gardener</b><span id="garden-rate"></span></div>'+
    '<div class="nn-ctl"><button class="tog'+(S.auto.grass ? " on" : "")+'" id="garden-on">'+(S.auto.grass ? "touching grass" : "resting")+'</button>'+
    '<span class="seg"><button class="pick'+(g.at==="best" ? " on" : "")+'" data-at="best">at the best moment</button><button class="pick'+(g.at==="min" ? " on" : "")+'" data-at="min">once there\'s</button></span>'+
    (g.at==="min" ? '<label class="garden-min"><input id="garden-min" type="number" min="1" step="1" value="'+g.min+'"> 🌿</label>' : "")+'</div>'+
    '<p class="note">'+(g.at==="best" ? "it waits until grass a minute has peaked and starts falling, then touches it: the most grass for the time." : "it touches grass as soon as there's at least that much to gain.")+
    ' it never cuts a challenge run short, and every run lasts at least a minute. while you\'re away, the first ten minutes play out and the rest comes in at the rate its last few runs did.</p>';
  box.querySelector("#garden-on").onclick = ()=>{ S.auto.grass = !S.auto.grass; refresh(true); };
  box.querySelectorAll("[data-at]").forEach(b=>b.onclick = ()=>{ g.at = b.dataset.at; refresh(true); });
  const m = box.querySelector("#garden-min"); if(m) m.onchange = ()=>{ g.min = Math.max(1, Math.round(+m.value||1)); };
  return box;
}
/* ---------- the second tier: built from grass, in the new internet ---------- */
const t2Icon = k => k==="grass" ? "🌿" : byId(T2_RES, k).icon;
function t2CostHtml(c){
  return '<span class="cost">'+Object.keys(c).map(k=>'<i class="'+(t2Have(S, k) >= c[k]-1e-9 ? "ok" : "")+'">'+t2Icon(k)+" "+fmt(c[k])+"</i>").join("")+"</span>";
}
function buildT2(body){
  body.appendChild(el("div", "box-h", "🌐 the second tier <span>built from grass</span>"));
  const bar = el("div", "t2-bar");
  bar.innerHTML = '<div class="t2-res"><u>grass</u><b>🌿 <span id="t2-grass"></span></b><em id="t2-grass-r"></em></div>'+
    T2_RES.map(r=>'<div class="t2-res" title="'+esc(r.desc)+'"><u>'+r.name+'</u><b style="color:'+r.color+'">'+r.icon+' <span id="t2-'+r.id+'"></span></b><em id="t2-'+r.id+'-r"></em></div>').join("");
  body.appendChild(bar);
  const grid = el("div", "grid");
  for(const b of T2_BUILDINGS){
    const c = card(b.icon+" "+b.name+' <span class="t2n" id="t2n-'+b.id+'"></span>', b.desc, c=>buyT2(b.id, c));
    c.dataset.t2b = b.id; grid.appendChild(c);
  }
  body.appendChild(grid);
  body.appendChild(el("div", "box-h", "📜 protocols <span>researched once</span>"));
  const tg = el("div", "grid");
  for(const t of T2_TECH){
    const c = card(t.name, t.desc, c=>researchT2(t.id, c));
    c.dataset.t2t = t.id; if(S.t2.tech[t.id]) c.classList.add("owned"); tg.appendChild(c);
  }
  body.appendChild(tg);
}
function updateT2(body){
  if(!S.t2 || !$("t2-grass")) return;
  $("t2-grass").textContent = fmt(Math.floor(S.grass));
  const gr = gardenerOn(S) ? gardenRate(S) : 0;
  $("t2-grass-r").textContent = gr ? "+"+fmt(gr*3600)+"/h" : "";
  for(const r of T2_RES){ $("t2-"+r.id).textContent = fmt(S.t2.res[r.id]); $("t2-"+r.id+"-r").textContent = R.t2[r.id] ? fmtRate(R.t2[r.id]) : ""; }
  body.querySelectorAll("[data-t2b]").forEach(c=>{
    const b = byId(T2_BUILDINGS, c.dataset.t2b), pr = t2Price(S, b);
    c.querySelector(".cc").innerHTML = t2CostHtml(pr);
    c.classList.toggle("cant", !t2CanPay(S, pr));
    const n = S.t2.b[b.id]||0; $("t2n-"+b.id).textContent = n ? "×"+n : "";
  });
  body.querySelectorAll("[data-t2t]").forEach(c=>{
    const t = byId(T2_TECH, c.dataset.t2t);
    if(S.t2.tech[t.id]){ c.querySelector(".cc").innerHTML = '<span class="done">running</span>'; c.classList.remove("cant"); return; }
    c.querySelector(".cc").innerHTML = t2CostHtml(t.cost);
    c.classList.toggle("cant", !t2CanPay(S, t.cost));
  });
}
const t2Have = (s, k) => k==="grass" ? s.grass : s.t2.res[k];
const t2Price = (s, b) => { const n = s.t2.b[b.id]||0, c = {}; for(const k in b.cost) c[k] = b.cost[k]*Math.pow(b.ratio, n); return c; };
const t2CanPay = (s, c) => Object.keys(c).every(k=>t2Have(s, k) >= c[k]-1e-9);
function t2Pay(s, c){ for(const k in c){ if(k==="grass") s.grass = Math.max(0, s.grass - c[k]); else s.t2.res[k] = Math.max(0, s.t2.res[k] - c[k]); } }
function buyT2(id, card){
  const b = byId(T2_BUILDINGS, id), c = t2Price(S, b);
  if(!S.t2 || !t2CanPay(S, c)) return sfx.no();
  t2Pay(S, c); S.t2.b[id] = (S.t2.b[id]||0) + 1; sfx.buy(); FX.buy(card);
  if(S.t2.b[id]===1) log(b.icon+" your first <b>"+b.name+"</b>. "+b.desc);
  refresh();
}
function researchT2(id, card){
  const t = byId(T2_TECH, id);
  if(!S.t2 || S.t2.tech[id] || !t2CanPay(S, t.cost)) return sfx.no();
  t2Pay(S, t.cost); S.t2.tech[id] = true; sfx.shiny(); FX.buy(card, true); FX.research();
  log("📜 protocol: <b>"+t.name+"</b>. "+t.desc);
  refresh(true);
}

/* ---------- rituals: spend devotion for something now ---------- */
/* a ritual, held by you or by the choirmaster: what happened, or null if it couldn't be */
const ritualOk = (s, R, r) => !!s.tech.iconography && shownIn(s, r) && (s.cd[r.id]||0) <= s.t && canPay(s, ritualPrice(r, R.f));
function doRitual(s, R, id){
  const r = byId(RITUALS, id);
  if(!ritualOk(s, R, r)) return null;
  pay(s, ritualPrice(r, R.f));
  s.cd[id] = s.t + r.cd * Math.max(0.2, 1 + (R.f.ritualCd||0));
  s.stats.rituals = (s.stats.rituals||0) + 1;
  let msg = r.desc;
  if(id==="prayer") s.buffs.push({ kind:"prayer", happy:0.3, until:s.t+120 });
  else if(id==="hyperpost") s.buffs.push({ kind:"hyperpost", click:9, until:s.t+30 });
  else if(id==="vigil") s.buffs.push({ kind:"vigil", all:0.5, until:s.t+120 });
  else if(id==="airdrop") msg = "airdrop: "+(windfall(120, s, R).join(" ") || "nothing fit. build more storage.");
  else if(id==="meetup"){
    let k = 0; while(k < 10 && s.miladys.length < R.housing){ newMilady(s, R); k++; }
    msg = k ? k+" miladys turned up for the meetup." : "nobody came: there's no room.";
  }
  else if(id==="bull"){ // to the start of this cycle's mania if it's still ahead (or under way), otherwise the next one's
    const at = Math.floor(s.phaseT/PHASE_SECS) % 4, base = Math.floor(s.phaseT/(PHASE_SECS*4)) * PHASE_SECS*4;
    s.phaseT = base + (at <= 1 ? 1 : 5) * PHASE_SECS;
    if(at > 1){ s.cycle++; s.stats.cycles++; } // skipping ahead into the next cycle still counts it
  }
  return msg;
}
function ritualFx(id){ react(id==="bull" || id==="airdrop" ? "hype" : "pray"); if(id==="bull") FX.phase(PHASES[1]); }
function holdRitual(id, card){
  const r = byId(RITUALS, id), msg = shown(r) ? doRitual(S, R, id) : null;
  if(msg==null) return sfx.no();
  ritualFx(id); sfx.shiny(); FX.buy(card, true);
  log(r.icon+" <b>"+r.name+"</b>. "+msg);
  refresh(true);
}
/* `secs` seconds of everything you make, into storage */
function windfall(secs, s, R2){
  s = s || S; R2 = R2 || R;
  const got = [];
  for(const r of RES) if(R2.prod[r.id] > 0 && isVisibleIn(s, r.id)){
    const g = gain(s, r.id, Math.max(R2.prod[r.id]*secs, r.id==="vibes" ? R2.click*secs/3 : 0), R2.cap[r.id]);
    if(g >= 0.5) got.push("+"+fmt(g)+" "+resIcon(r.id));
  }
  return got;
}

/* ---------- raids: miladys go out, and come home with loot (most of them) ---------- */
function raidTime(r, f){ return r.secs / (1 + (f.raidSpeed||0)); }
/* a raid sent, by you or by the war council: the raid, or null if there's no crew for it */
function doRaid(s, R, id){
  const r = byId(RAIDS, id), home = s.miladys.filter(m=>!m.away);
  if(!s.tech.raiding || home.length < r.n || s.raids.some(x=>x.id===id)) return null;
  // the idle go first, then whoever's on the busiest job
  const crew = [];
  for(const m of home.filter(m=>!m.job)) if(crew.length < r.n) crew.push(m);
  while(crew.length < r.n){
    const c = jobCounts(s), busiest = JOBS.filter(j=>c[j.id]).sort((a,b)=>c[b.id]-c[a.id])[0];
    const m = home.find(m=>m.job===busiest.id && !crew.includes(m)); m.away = id; crew.push(m);
  }
  crew.forEach(m=>m.away = id);
  // what they bring home is set now, from what the network makes as they leave
  const loot = {};
  for(const k in r.loot) if(isVisibleIn(s, k)) loot[k] = Math.max(R.prod[k], 0.5) * r.loot[k];
  const x = { id, until:s.t + raidTime(r, R.f), len:raidTime(r, R.f), loot };
  s.raids.push(x);
  return x;
}
function sendRaid(id, card){
  const r = byId(RAIDS, id), x = doRaid(S, R, id);
  if(!x) return sfx.no();
  sfx.buy(); FX.buy(card);
  log("⚔️ "+r.n+" miladys left to raid <b>"+r.name+"</b>. back in "+fmtTime(x.len)+".");
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
    if(pool.length){ relic = choice(pool); s.relics[relic.id] = (s.relics[relic.id]||0) + 1; if(relic.wear && live) drawYou(); }
  }
  const msg = "⚔️ the raid on <b>"+r.name+"</b> came home: "+(got.join(" ") || "nothing fit, build more storage")+"."+
    (lost.length ? " "+lost.map(m=>m.name).join(", ")+" stayed with the other side." : "")+
    (relic ? " they found a relic: "+relic.icon+" <b>"+relic.name+"</b>"+(s.relics[relic.id]>1 ? " (level "+s.relics[relic.id]+")" : "")+"." : "");
  log(msg, lost.length ? "bad" : "");
  if(document.hidden) raidBack = true;
  if(live){ toast(msg, 5000); if(relic) sfx.shiny(); react(relic ? "shiny" : "smug"); }
}

/* ---------- the cathedral ---------- */
/* the cathedral's next stage, built by you or by the masons: false if it can't be */
function doStage(s, R){
  const i = s.wonder||0; if(i >= WONDER.length || !s.tech.geometry) return false;
  const c = wonderPrice(i, R.f);
  if(!canPay(s, c)) return false;
  pay(s, c); s.wonder = i+1;
  return true;
}
const stageLog = (s, w, bot) => log((bot ? "🤖 " : "")+"⛪ the cathedral: <b>"+w.name+"</b> is finished."+(s.wonder===WONDER.length ? " it's done. it was always going to be infinite." : ""));
function buildStage(card){
  const w = WONDER[S.wonder||0];
  if(!doStage(S, R)) return sfx.no();
  sfx.shiny(); FX.buy(card, true); FX.research(); react("shiny");
  stageLog(S, w);
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
  sfx.chime();
  setTimeout(()=>sp.classList.add("fading"), 10000); // three seconds of warning before it goes
  setTimeout(()=>sp.remove(), 13000);
}
function catchSparkle(){
  S.stats.sparkles++; sfx.shiny(); react("shiny");
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
function isVisibleIn(s, id){
  const r = RES_BY[id];
  if(id==="vibes" || s.seen[id] > 0) return true;
  return opened(s, r) && (r.tech ? !!s.tech[r.tech] : r.show ? r.show(s) : false);
}
const isVisible = id => isVisibleIn(S, id);
const techShownIn = (s, t) => opened(s, t) && (s.b.archive>0 || s.seen.lore>0) && (t.req||[]).every(r=>s.tech[r]);
const techShown = t => techShownIn(S, t);
function tabs(){
  const t = [{ id:"network", name:"network" }];
  if(R.housing>0 || S.miladys.length) t.push({ id:"miladys", name:"miladys" });
  if(TECHS.some(techShown)) t.push({ id:"lore", name:"lore" });
  if(UPGRADES.some(shown)) t.push({ id:"upgrades", name:"upgrades" });
  if(S.tech.iconography) t.push({ id:"rituals", name:"rituals" });
  if(S.tech.raiding) t.push({ id:"raids", name:"raids" });
  if(S.tech.geometry) t.push({ id:"cathedral", name:"cathedral" });
  if(nnOpen(S)) t.push({ id:"newnet", name:"internet" });
  if(S.tech.garden || S.grass>0 || resets(S)>0) t.push({ id:"grass", name:"grass" });
  t.push({ id:"stats", name:"stats" });
  if(online()) t.push({ id:"boards", name:"boards" });
  return t;
}
let tab = "network", sig = "";

function costHtml(c, cls){
  const t = eta(c);
  return '<span class="cost '+(cls||"")+'">'+Object.keys(c).map(k=>{
    const have = S.res[k] >= c[k]-1e-9, over = c[k] > R.cap[k]+1e-9;
    return '<i data-r="'+k+'" class="'+(have ? "ok" : over ? "over" : "")+'">'+resIcon(k)+" "+fmt(c[k])+"</i>";
  }).join("")+(t ? '<span class="eta">'+t+'</span>' : "")+"</span>";
}
/* how long until you can pay for this, at the rate you're going: nothing when you already can, nothing when it
   won't fit in storage (the card says so), "not at this rate" when something it needs isn't coming in */
function eta(c){
  let worst = 0;
  for(const k in c){
    const need = c[k] - S.res[k];
    if(need <= 1e-9) continue;
    if(c[k] > R.cap[k]+1e-9) return "";
    const rate = R.net[k];
    if(rate <= 1e-9) return "⏳ not at this rate";
    worst = Math.max(worst, need/rate);
  }
  return worst ? "⏳ "+(worst > 99*3600 ? "ages" : fmtTime(Math.ceil(worst))) : "";
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
    if(!S.seenNew["tab:"+t.id]) b.classList.add("fresh");
    b.onclick = ()=>{ commitSeen(); S.seenNew["tab:"+t.id] = 1; tab = t.id; refresh(true); const tb = $("tab-body"); tb.classList.remove("enter"); void tb.offsetWidth; tb.classList.add("enter"); };
    b.dataset.tab = t.id;
    nav.appendChild(b);
  }
  if(S.challenge){ const c = byId(CHALLENGES, S.challenge); body.appendChild(el("div", "challenge-bar", "⚖️ challenge: <b>"+c.name+"</b>. "+c.rule+(c.id==="speed" ? ' <span id="speed-left"></span>' : ""))); }
  ({ network:buildNetwork, miladys:buildMiladys, lore:buildLore, upgrades:buildUpgrades, rituals:buildRituals,
     raids:buildRaids, cathedral:buildCathedral, newnet:buildNewnet, grass:buildGrass, boards:buildBoards }[tab] || buildStats)(body);
  tagNew(body);
}
/* "new!": anything you haven't seen before wears a tag until you've been to its tab and left again (or bought it).
   Seen is forever, across touching grass. */
const NEW_ATTRS = ["b","t","u","rit","raid","p","ch","j"];
let pendingSeen = new Set();
function tagNew(body){
  body.querySelectorAll(NEW_ATTRS.map(a=>"[data-"+a+"]").join(",")).forEach(c=>{
    const a = NEW_ATTRS.find(a=>c.dataset[a]!=null), key = a+":"+c.dataset[a];
    if(S.seenNew[key]) return;
    pendingSeen.add(key);
    c.classList.add("fresh");
    (c.querySelector(".ct b, .jn b") || c).insertAdjacentHTML("beforeend", ' <span class="new-tag">new</span>');
    c.addEventListener("click", ()=>{ S.seenNew[key] = 1; }, { once:true });
  });
}
function commitSeen(){ for(const k of pendingSeen) S.seenNew[k] = 1; pendingSeen = new Set(); }
function markAllSeen(){ // an old save: what's already there isn't news
  const mark = (p, list, ok) => list.forEach(x=>{ if(ok(x)) S.seenNew[p+":"+x.id] = 1; });
  mark("b", BUILDINGS, b=>shown(b) || S.b[b.id]); mark("t", TECHS, t=>techShown(t) || S.tech[t.id]); mark("u", UPGRADES, u=>shown(u) || S.up[u.id]);
  mark("j", JOBS, shown); mark("rit", RITUALS, shown); mark("raid", RAIDS, ()=>S.tech.raiding); mark("p", PERKS, p=>opened(S, p)); mark("ch", CHALLENGES, ()=>resets(S)>=5);
  tabs().forEach(t=>S.seenNew["tab:"+t.id] = 1);
}
function card(title, desc, onclick){
  const c = el("button", "card");
  c.innerHTML = '<div class="ct"><b>'+title+'</b><em></em></div><div class="cd">'+desc+'</div><div class="cc"></div>';
  c.onclick = e=>onclick(c, e);
  return c;
}
function buildNetwork(body){
  const bar = el("div", "buy-bar");
  bar.innerHTML = '<span>buy</span><span class="seg">'+["1","10","max"].map(m=>'<button class="pick'+(buyMode()===m ? " on" : "")+'" data-buy="'+m+'">'+(m==="max" ? "max" : "×"+m)+'</button>').join("")+'</span><span class="note">shift-click buys ten</span>';
  bar.querySelectorAll("[data-buy]").forEach(x=>x.onclick = ()=>{ S.settings.buyN = x.dataset.buy; refresh(true); });
  body.appendChild(bar);
  if(PERKS.some(p=>p.auto && S.perks[p.id])) body.appendChild(autoBox());
  const grid = el("div", "grid");
  for(const b of BUILDINGS){
    if(!shown(b) && !S.b[b.id]) continue;
    const c = card(b.name+NEW_LAYER(b), b.desc+(fxLine(b.fx) ? '<br><span class="fx">'+fxLine(b.fx)+'</span>' : ""), (c, e)=>buyBuilding(b.id, c, e && e.shiftKey));
    c.dataset.b = b.id;
    grid.appendChild(c);
  }
  body.appendChild(grid);
  if(!grid.children.length) body.appendChild(el("p", "note", "post a little. things show up once you can almost afford them."));
}
/* the robots you've bought, each with an off switch, and how much they've done this run */
const AUTO_WHAT = { meme:["automeme","🐸 memes"], tech:["autotech","📜 research"], up:["autoup","✨ upgrades"], build:["autobuild","🏗️ buildings"],
  rite:["autorite","🕯️ rituals"], raid:["autoraid","⚔️ raids"], wonder:["autowonder","⛪ cathedral"], grass:["gardener","🌿 touching grass"] };
function autoBox(){
  const a = S.auto, box = el("div", "auto-box");
  box.innerHTML = '<span class="auto-h">🤖 automation</span>'+
    Object.keys(AUTO_WHAT).filter(k=>S.perks[AUTO_WHAT[k][0]]).map(k=>'<button class="tog'+(a[k] ? " on" : "")+'" data-auto="'+k+'">'+AUTO_WHAT[k][1]+'</button>').join("")+
    (S.perks.autobuild ? '<span class="seg" title="what buildings never dip into">keep '+[0, 0.25, 0.5].map(v=>'<button class="pick'+(a.keep===v ? " on" : "")+'" data-keep="'+v+'">'+pct(v)+'</button>').join("")+'</span>'+
      '<button class="btn small" id="auto-skip">'+(Object.values(a.skip).some(Boolean) ? "skipping "+Object.values(a.skip).filter(Boolean).length : "skip some")+'</button>' : "")+
    (S.perks.autorite ? '<button class="btn small" id="auto-rites">which rituals</button>' : "")+
    '<span class="auto-ct" id="auto-ct"></span>';
  box.querySelectorAll("[data-auto]").forEach(b=>b.onclick = ()=>{ a[b.dataset.auto] = !a[b.dataset.auto]; refresh(true); });
  box.querySelectorAll("[data-keep]").forEach(b=>b.onclick = ()=>{ a.keep = +b.dataset.keep; refresh(true); });
  const skip = box.querySelector("#auto-skip"); if(skip) skip.onclick = openSkip;
  const rites = box.querySelector("#auto-rites"); if(rites) rites.onclick = openRites;
  return box;
}
function openRites(){
  openModal('<h2>🤖 what the choirmaster holds</h2><p class="note">each ticked ritual is held the moment it\'s ready and there\'s devotion for it. summon the bull moves the market, and a meetup can fill the room, so those start off.</p><div class="skip-list">'+
    RITUALS.filter(r=>shown(r)).map(r=>'<button class="tog'+(S.auto.rites[r.id] ? " on" : "")+'" data-rite="'+r.id+'">'+r.icon+" "+r.name+'</button>').join("")+
    '</div><div class="row"><button class="btn small" data-close>done</button></div>');
  document.querySelectorAll("#modal [data-rite]").forEach(x=>x.onclick = ()=>{ const id = x.dataset.rite; S.auto.rites[id] = !S.auto.rites[id]; x.classList.toggle("on", !!S.auto.rites[id]); });
}
function openSkip(){
  const list = BUILDINGS.filter(b=>shown(b) || S.b[b.id]);
  openModal('<h2>🤖 what the scripts build</h2><p class="note">switch a building off and the scripts leave it to you.</p><div class="skip-list">'+
    list.map(b=>'<button class="tog'+(S.auto.skip[b.id] ? "" : " on")+'" data-skip="'+b.id+'">'+b.name+'</button>').join("")+
    '</div><div class="row"><button class="btn small" data-close>done</button></div>');
  document.querySelectorAll("#modal [data-skip]").forEach(x=>x.onclick = ()=>{
    const id = x.dataset.skip; S.auto.skip[id] = !S.auto.skip[id];
    x.classList.toggle("on", !S.auto.skip[id]); sig = "";
  });
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
      '<div class="jc"><button class="btn small" data-d="-1" title="shift: 10">−</button><b class="jcount">0</b><button class="btn small" data-d="1" title="shift: 10">+</button>'+
      '<button class="btn small all" data-d="all" title="every idle milady">all</button></div>';
    row.querySelectorAll("button").forEach(btn=>btn.onclick = e=>{
      if(btn.dataset.d==="all") return assign(j.id, R.jobs.idle);
      const n = e.shiftKey ? 10 : 1;
      btn.dataset.d==="1" ? assign(j.id, n) : unassign(j.id, n);
    });
    list.appendChild(row);
  }
  body.appendChild(list);
  const rem = S.miladys.filter(m=>m.kind==="remilio").length;
  const g = el("div", "box-h", "the network <span>"+S.miladys.length+(rem ? " · "+rem+" remilios" : "")+"</span>");
  body.appendChild(g);
  // which of them to show, and in what order
  const ctl = el("div", "gal-ctl");
  const opt = (v, l, cur) => '<option value="'+v+'"'+(cur===v ? " selected" : "")+'>'+l+'</option>';
  ctl.innerHTML = '<select id="gal-filter" class="name-in" aria-label="show">'+opt("all","everyone",galFilter)+opt("idle","💤 idle",galFilter)+
    (R.jobs.away ? opt("away","⚔️ away raiding",galFilter) : "")+(rem ? opt("milady","miladys",galFilter)+opt("remilio","remilios",galFilter) : "")+
    JOBS.filter(shown).map(j=>opt(j.id, j.icon+" "+j.name+"s", galFilter)).join("")+'</select>'+
    '<select id="gal-sort" class="name-in" aria-label="order">'+opt("new","newest first",galSort)+opt("old","oldest first",galSort)+opt("name","by name",galSort)+opt("job","by job",galSort)+'</select>';
  body.appendChild(ctl);
  ctl.querySelector("#gal-filter").onchange = e=>{ galFilter = e.target.value; fillGallery(); };
  ctl.querySelector("#gal-sort").onchange = e=>{ galSort = e.target.value; fillGallery(); };
  const gal = el("div", "gallery");
  gal.id = "gallery";
  body.appendChild(gal);
  fillGallery();
}
let galleryKnown = null; // ids already shown, so only new faces pop in
let galFilter = "all", galSort = "new";
function galleryList(){
  const jobOrder = m => m.away ? 99 : m.job ? JOBS.findIndex(j=>j.id===m.job) : 98;
  let list = S.miladys.filter(m=>galFilter==="all" ? true : galFilter==="idle" ? !m.job && !m.away : galFilter==="away" ? !!m.away :
    galFilter==="milady" ? m.kind!=="remilio" : galFilter==="remilio" ? m.kind==="remilio" : m.job===galFilter && !m.away);
  if(galSort==="new") list = list.slice().reverse();
  else if(galSort==="name") list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));
  else if(galSort==="job") list = list.slice().sort((a,b)=>jobOrder(a)-jobOrder(b));
  return list;
}
function fillGallery(){
  const gal = $("gallery"); if(!gal) return;
  gal.innerHTML = "";
  const known = galleryKnown;
  galleryKnown = new Set(S.miladys.map(m=>m.id));
  if(!S.miladys.length){ gal.innerHTML = '<p class="note">nobody yet. build a group chat and keep the vibes up.</p>'; return; }
  const list = galleryList();
  if(!list.length){ gal.innerHTML = '<p class="note">nobody like that right now.</p>'; return; }
  for(const m of list){
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
/* the new internet: seven stages in a ring that closes as they're finished */
function nnRing(done){
  const n = NEWNET.length, R0 = 70, c = 90, pt = i => { const a = -Math.PI/2 + i/n*Math.PI*2; return [c + R0*Math.cos(a), c + R0*Math.sin(a)]; };
  let s = '<svg class="nn-ring" viewBox="0 0 180 180" aria-hidden="true">';
  for(let i=0; i<n; i++) for(let j=i+1; j<n; j++){ // every finished node threads to every other finished one: a mesh
    if(i < done && j < done){ const [x1,y1] = pt(i), [x2,y2] = pt(j); s += '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" class="on"/>'; }
  }
  for(let i=0; i<n; i++){ const [x,y] = pt(i), [x2,y2] = pt((i+1)%n); s += '<line x1="'+x+'" y1="'+y+'" x2="'+x2+'" y2="'+y2+'" class="'+(i < done && (i+1)%n < done ? "on" : "")+'"/>'; }
  NEWNET.forEach((st, i)=>{ const [x,y] = pt(i); s += '<g class="'+(i < done ? "on" : i===done ? "next" : "")+'"><circle cx="'+x+'" cy="'+y+'" r="13"/><text x="'+x+'" y="'+(y+5)+'">'+st.icon+'</text></g>'; });
  return s + '<text class="mid" x="90" y="96">'+(done >= n ? "online" : done+" / "+n)+'</text></svg>';
}
function buildNewnet(body){
  const i = S.nn.i, st = nnStage(S), e = S.nn.e||0;
  const wrap = el("div", "cathedral nn");
  wrap.innerHTML = nnRing(i)+'<div class="stages">'+NEWNET.map((w,k)=>'<div class="stage'+(k<i ? " done" : k===i ? " next" : "")+'"><b>'+(k<i ? "✅ " : w.icon+" ")+w.name+'</b><span>'+(k<=i ? w.desc+" " : "")+fxDesc(w.fx)+'</span></div>').join("")+'</div>';
  body.appendChild(wrap);
  if(S.ended){
    body.appendChild(el("p", "big-note", "🌐 the new internet is online, since "+new Date(S.ended).toLocaleDateString()+". it doesn't need you to keep it going. it'd like you to stay anyway."));
    const b = el("button", "btn small", "watch the ending again"); b.onclick = ()=>showEnding(); body.appendChild(b);
    if(S.t2) buildT2(body);
    body.appendChild(el("div", "box-h", "♾️ epochs <span>"+(e ? e+" done · "+fxDesc({ all:EPOCH_FX.all*e })+", for good" : "it keeps growing")+(S.t2 ? " · poured from the second tier" : "")+"</span>"));
  }
  const box = el("div", "nn-box");
  box.innerHTML = '<div class="nn-h"><b>'+st.icon+" "+st.name+'</b><span>'+(S.ended ? "past the ending, as far as it goes · " : "stage "+(i+1)+" of "+NEWNET.length+" · ")+st.desc+'</span></div>'+
    Object.keys(st.need).map(k=>'<div class="nn-row" data-nn="'+k+'"><span>'+(RES_BY[k] ? resIcon(k)+" "+RES_BY[k].name : t2Icon(k)+" "+byId(T2_RES, k).name)+'</span><i class="pbar"><u></u></i><b></b><em></em></div>').join("")+
    (st.req ? '<div class="nn-req" id="nn-req"></div>' : "")+
    '<div class="nn-ctl"><button class="tog'+(S.nn.on ? " on" : "")+'" id="nn-on">'+(S.nn.on ? "pouring" : "paused")+'</button>'+
    '<span class="seg" title="how much of what you make goes in">'+[0.25, 0.5, 1].map(v=>'<button class="pick'+(S.nn.share===v ? " on" : "")+'" data-share="'+v+'">'+pct(v)+'</button>').join("")+'</span>'+
    '<button class="btn small" id="nn-pour-now">pour in what you\'re holding</button></div>'+
    '<p class="note">'+(inT2(S) ? "while it\'s pouring, that share of what the second tier makes goes in as it's made." : "while it\'s pouring, that share of everything the stage needs goes in as you make it, and all of it once storage is full. what goes in stays when you touch grass.")+'</p>';
  body.appendChild(box);
  $("nn-on").onclick = ()=>{ S.nn.on = !S.nn.on; refresh(true); };
  box.querySelectorAll("[data-share]").forEach(b=>b.onclick = ()=>{ S.nn.share = +b.dataset.share; refresh(true); });
  $("nn-pour-now").onclick = pourStored;
}
function buildGrass(body){
  const top = el("div", "grass-top");
  top.innerHTML = '<div class="big-num">🌿 <b id="grass-have">0</b> grass</div>'+
    (S.t2 ? '<div class="note">your grass bonus is locked in at <b id="grass-bonus"></b>, for good. grass is for building in the new internet now.</div>'
      : '<div class="note">every grass you hold makes everything <b>'+pct(GRASS_EACH+(R.f.grassEach||0))+'</b> faster. right now: <b id="grass-bonus"></b>.</div>')+
    '<div class="note">grass comes from the $CULT you made this run: <b id="grass-run"></b> so far. touching grass now gives <b id="grass-gain"></b>.</div>'+
    '<button class="btn big" id="btn-grass">touch grass 🌿</button><div class="note" id="grass-why"></div>';
  body.appendChild(top);
  if(S.perks.gardener) body.appendChild(gardenBox());
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
    if(!perkShown(S, p)) continue;
    const c = card(p.name+NEW_LAYER(p), p.desc, c=>buyPerk(p.id, c));
    c.dataset.p = p.id;
    if(S.perks[p.id]) c.classList.add("owned");
    grid.appendChild(c);
  }
  body.appendChild(grid);
  const hidden = PERKS.filter(p=>!perkShown(S, p)).length;
  if(hidden) body.appendChild(el("p", "note", hidden+" more perks open as you keep touching grass."));
  $("btn-grass").onclick = ()=>touchGrass();
}
const CYCLE_SECS = PHASE_SECS * PHASES.length;
const runNo = () => resets(S) + 1;
function dayCount(){ return Math.floor((Date.now() - (S.born||Date.now()))/86400000) + 1; }
function clockTitle(){
  return "run "+runNo()+" · cycle "+(S.cycle+1)+" of this run · "+fmtTime(S.runT)+" in\n"+
    fmt(S.stats.cycles)+" market cycles and "+fmtTime(S.stats.played)+" played in all · day "+dayCount();
}
/* every run you've finished, newest first, and the one you're on */
function runHistory(){
  const h = (S.history||[]).slice().reverse(), done = h.filter(r=>!r.challenge);
  const best = done.length ? Math.min(...done.map(r=>r.t)) : null;
  const row = (r, now) => '<tr'+(now ? ' class="now"' : "")+'><td>'+(now ? "▶ "+r.n : r.n)+'</td><td>'+fmtTime(r.t)+(!now && r.t===best && !r.challenge ? ' <i title="your fastest">⚡</i>' : "")+'</td><td>'+r.cycles+'</td><td>'+fmt(r.peak)+'</td><td>'+(now ? (S.tech.garden ? "+"+fmt(grassGain(S)) : "–") : "+"+fmt(r.grass))+'</td><td>'+
    (r.challenge ? (r.beaten ? "✅ " : now ? "⚖️ " : "❌ ")+byId(CHALLENGES, r.challenge).name : "")+'</td><td>'+(now ? "now" : new Date(r.end).toLocaleDateString())+'</td></tr>';
  return '<div class="box-h">runs <span>'+(h.length ? h.length+" finished · fastest "+(best!=null ? fmtTime(best) : "none yet") : resets(S) ? "" : "this is your first")+'</span></div>'+
    '<div class="runs-wrap"><table class="runs"><tr><th>#</th><th>time</th><th>cycles</th><th>peak</th><th>grass</th><th>challenge</th><th>ended</th></tr>'+
    row({ n:runNo(), t:S.runT, cycles:S.cycle, peak:S.run.peak||S.miladys.length, challenge:S.challenge }, true)+h.map(r=>row(r)).join("")+'</table></div>'+
    (resets(S) > h.length ? '<p class="note">runs from before this was kept aren\'t listed.</p>' : "");
}
function buildStats(body){
  const made = RES.filter(r=>S.stats.made[r.id]).map(r=>'<span>'+resIcon(r.id)+" "+r.name+'</span><b>'+fmt(S.stats.made[r.id])+'</b>').join("");
  body.innerHTML = '<div class="box-h">time <span>day '+dayCount()+'</span></div><div class="stat-grid">'+
    '<span>run</span><b>'+runNo()+(S.challenge ? " · ⚖️ "+byId(CHALLENGES, S.challenge).name : "")+'</b>'+
    '<span>this run</span><b id="st-run">'+fmtTime(S.runT)+'</b>'+
    '<span>market cycles done this run</span><b id="st-cyc">'+S.cycle+'</b>'+
    '<span>market cycles done in all</span><b id="st-cyc-all">'+fmt(S.stats.cycles)+'</b>'+
    '<span>played in all</span><b id="st-played">'+fmtTime(S.stats.played)+'</b>'+
    '<span>first logged on</span><b>'+new Date(S.born).toLocaleDateString()+'</b>'+
    '</div>'+
    '<div class="box-h">this run, over time <span id="chart-pick">'+chartSeries().map(k=>'<button class="pick'+(k===chartKey ? " on" : "")+'" data-chart="'+k+'">'+(k==="miladys" ? "🌸 miladys" : resIcon(k))+'</button>').join("")+'</span></div>'+
    '<div class="chart" id="chart-run"></div>'+
    '<div class="box-h">who\'s doing what <span class="seg">'+[["count","how many"],["share","share"]].map(([k,l])=>'<button class="pick'+(crowdMode===k ? " on" : "")+'" data-crowd="'+k+'">'+l+'</button>').join("")+'<button class="pick'+(tableOn.crowd ? " on" : "")+'" data-table="crowd" title="as a table">▦</button></span></div>'+
    '<div class="chart stack" id="chart-crowd"></div>'+
    '<div class="box-h">where the vibes come from, and go <span class="seg"><button class="pick'+(tableOn.vibes ? " on" : "")+'" data-table="vibes" title="as a table">▦</button></span></div>'+
    '<div class="chart stack" id="chart-vibes"></div>'+
    runHistory()+
    ((S.history||[]).length >= 1 ? '<div class="box-h">every run, in splits <span>⚡ your fastest · ▶ this one</span></div><div class="chart" id="chart-runs"></div>' : "")+
    '<div class="box-h">the network</div><div class="stat-grid">'+
    '<span>posts</span><b>'+fmt(S.stats.clicks)+'</b>'+
    '<span>sparkles caught</span><b>'+fmt(S.stats.sparkles)+'</b>'+
    '<span>times you touched grass</span><b>'+resets(S)+'</b>'+
    '<span>rituals held</span><b>'+fmt(S.stats.rituals||0)+'</b>'+
    '<span>raids come home</span><b>'+fmt(S.stats.raids||0)+'</b>'+
    made+'</div>'+
    '<div class="box-h">achievements <span>'+Object.keys(S.ach).length+" / "+ACHIEVEMENTS.length+' · each one +'+pct(ACH_EACH)+' everything · now +'+pct(Object.keys(S.ach).length*ACH_EACH)+'</span></div>'+
    '<div class="achs">'+ACHIEVEMENTS.map(a=>'<div class="ach'+(S.ach[a.id] ? " got" : "")+'"><b>'+(S.ach[a.id] ? "🏆 " : "🔒 ")+a.name+'</b><span>'+a.desc+'</span></div>').join("")+'</div>';
  if(resets(S) >= 3 || Object.keys(S.relics).length) body.appendChild(relicShelf());
  if(S.ended){ const b = el("button", "btn small", "🌐 watch the ending again"); b.onclick = ()=>showEnding(); body.appendChild(b); }
  body.querySelectorAll("[data-chart]").forEach(b=>b.onclick = ()=>{ chartKey = b.dataset.chart; refresh(true); });
  body.querySelectorAll("[data-crowd]").forEach(b=>b.onclick = ()=>{ crowdMode = b.dataset.crowd; refresh(true); });
  body.querySelectorAll("[data-table]").forEach(b=>b.onclick = ()=>{ tableOn[b.dataset.table] = !tableOn[b.dataset.table]; refresh(true); });
  chartDrawn = ""; stackDrawn = {}; drawRunChart(); drawStacks(); drawRunsChart();
}

/* ---------- charts: plain svg, one series at a time, with a crosshair ---------- */
let chartKey = "vibes", chartDrawn = "";
const chartSeries = () => RES.filter(r=>isVisible(r.id)).map(r=>r.id).concat("miladys");
const svgEl = (tag, attrs) => '<'+tag+' '+Object.keys(attrs).map(k=>k+'="'+attrs[k]+'"').join(" ")+'/>';
function niceMax(v){ if(v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))), m = v/e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10)*e; }
/* one line: what you held of something, from the start of the run to now */
function drawRunChart(){
  const box = $("chart-run"), g = S.run.g; if(!box) return;
  if(!chartSeries().includes(chartKey)) chartKey = "vibes";
  const key = chartKey+"|"+(g ? g.t.length : 0)+"|"+box.clientWidth;
  if(key===chartDrawn) return; chartDrawn = key;
  if(!g || g.t.length < 2){ box.innerHTML = '<p class="note">a point every 15 seconds. give it a minute.</p>'; return; }
  const ts = g.t, vs = g.v[chartKey], W = Math.max(280, box.clientWidth), H = 180, L = 46, Rp = 10, T = 10, B = 32;
  const top = niceMax(Math.max(...vs)), x = t => L + (t - ts[0])/Math.max(1, ts[ts.length-1] - ts[0])*(W-L-Rp), y = v => T + (1 - v/top)*(H-T-B);
  const col = chartKey==="miladys" ? "#ff79c6" : RES_BY[chartKey].color;
  let s = '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="'+(chartKey==="miladys" ? "miladys" : RES_BY[chartKey].name)+' over this run">';
  for(const f of [0, 0.5, 1]) s += svgEl("line", { x1:L, x2:W-Rp, y1:y(top*f), y2:y(top*f), class:"grid" }) + '<text class="ax" x="'+(L-6)+'" y="'+(y(top*f)+4)+'" text-anchor="end">'+fmt(top*f)+'</text>';
  s += '<text class="ax" x="'+L+'" y="'+(H-4)+'">'+fmtTime(ts[0])+'</text><text class="ax" x="'+(W-Rp)+'" y="'+(H-4)+'" text-anchor="end">'+fmtTime(ts[ts.length-1])+'</text>';
  s += phaseBand(ts, g.v.ph, x, H - B + 6, 6);
  const pts = ts.map((t,i)=>x(t).toFixed(1)+","+y(vs[i]).toFixed(1));
  s += '<path d="M'+x(ts[0])+','+y(0)+' L'+pts.join(" L")+' L'+x(ts[ts.length-1])+','+y(0)+' Z" fill="'+col+'" opacity=".12"/>';
  s += '<polyline points="'+pts.join(" ")+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round"/>';
  s += '<g class="xh hidden"><line y1="'+T+'" y2="'+(H-B)+'"/><circle r="4" fill="'+col+'"/></g><rect class="hit" x="'+L+'" y="0" width="'+(W-L-Rp)+'" height="'+H+'" fill="transparent"/></svg><div class="chart-tip hidden"></div>';
  box.innerHTML = s;
  const xh = box.querySelector(".xh"), tip = box.querySelector(".chart-tip");
  const at = ev => {
    const r = box.querySelector("svg").getBoundingClientRect(), px = (ev.clientX - r.left)*W/r.width;
    let i = 0; for(let k=1; k<ts.length; k++) if(Math.abs(x(ts[k]) - px) < Math.abs(x(ts[i]) - px)) i = k;
    xh.classList.remove("hidden"); tip.classList.remove("hidden");
    xh.querySelector("line").setAttribute("x1", x(ts[i])); xh.querySelector("line").setAttribute("x2", x(ts[i]));
    xh.querySelector("circle").setAttribute("cx", x(ts[i])); xh.querySelector("circle").setAttribute("cy", y(vs[i]));
    tip.innerHTML = '<b>'+fmt(vs[i])+'</b> '+(chartKey==="miladys" ? "miladys" : RES_BY[chartKey].name)+' <span>at '+fmtTime(ts[i])+(g.v.ph && PHASES[g.v.ph[i]] ? " · "+PHASES[g.v.ph[i]].icon+" "+PHASES[g.v.ph[i]].name : "")+'</span>';
    tip.style.left = Math.min(r.width-140, Math.max(0, x(ts[i])*r.width/W - 60))+"px";
  };
  const hit = box.querySelector(".hit");
  hit.addEventListener("pointermove", at); hit.addEventListener("pointerdown", at);
  hit.addEventListener("pointerleave", ()=>{ xh.classList.add("hidden"); tip.classList.add("hidden"); });
}
/* ---------- stacked charts: who's doing what, and where the vibes come from ---------- */
/* chart colors are their own set, stepped for the dark page and checked for colorblind separation in stacking order
   (the game's neon is too light and too alike for areas that touch). A job keeps its color whatever else is showing. */
const JOB_STACK = [["poster","#d55181"],["memer","#008300"],["keeper","#9085e9"],["trader","#c98500"],["artist","#199e70"],["streamer","#d95926"],["dev","#3987e5"],["acolyte","#e66767"]];
const REST_COL = "#5c5c58", EAT_COL = "#e66767";
const SPLIT_COL = ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]; // one blue, light to dark: to 10, 50, 100, 250, the rest
let crowdMode = "count", tableOn = {}, stackDrawn = {};
function drawStacks(){
  const g = S.run.g;
  const ready = g && g.v["j.poster"] && g.t.length >= 2;
  for(const id of ["crowd", "vibes"]){
    const box = $("chart-"+id); if(!box) continue;
    const key = (ready ? g.t.length : 0)+"|"+box.clientWidth+"|"+crowdMode+"|"+!!tableOn[id];
    if(stackDrawn[id]===key) continue; stackDrawn[id] = key;
    if(!ready){ box.innerHTML = '<p class="note">a point every 15 seconds. give it a minute.</p>'; continue; }
    const z = g.v["j.poster"].map(()=>0), v = k => g.v[k] || z;
    if(id==="crowd"){
      const named = JOB_STACK.map(([j, col])=>({ name:byId(JOBS, j).name+"s", col, v:v("j."+j) })).filter(l=>l.v.some(x=>x>0));
      const restIds = JOBS.filter(j=>!JOB_STACK.some(([k])=>k===j.id)).map(j=>j.id).concat("idle", "away");
      const rest = { name:"everyone else", col:REST_COL, v:z.map((_, i)=>restIds.reduce((a, k)=>a + v("j."+k)[i], 0)),
        parts:restIds.map(k=>({ name:k==="idle" ? "idle" : k==="away" ? "out raiding" : byId(JOBS, k).name+"s", v:v("j."+k) })) };
      stackChart(box, { label:"who's doing what over this run", layers:named.concat(rest.v.some(x=>x>0) ? [rest] : []), share:crowdMode==="share", fmtV:fmt, table:tableOn.crowd });
    } else {
      const layers = [["posters", "#d55181", "posters"], ["you posting", "#3987e5", "you"], ["posting bots", "#199e70", "bots"], ["buildings", "#c98500", "buildings"], ["everything else", REST_COL, "other"]]
        .map(([name, col, k])=>({ name, col, v:v("v."+k) })).filter(l=>l.v.some(x=>x>0));
      stackChart(box, { label:"vibes made and eaten over this run", layers, under:[{ name:"eating", col:EAT_COL, v:v("v.eat") }], net:true, fmtV:fmtRate, table:tableOn.vibes });
    }
  }
}
/* layers stack up from zero, `under` stacks down from it, `net` draws what's left as a line; a strip of market phases runs underneath */
function stackChart(box, o){
  const g = S.run.g, ts = g.t, n = ts.length, ph = g.v.ph;
  const sum = (ls, i) => ls.reduce((a, l)=>a + Math.abs(l.v[i]||0), 0);
  const scale = i => o.share ? (sum(o.layers, i) || 1)/100 : 1;
  if(o.table){ box.innerHTML = stackTable(o, ts, scale); return; }
  const W = Math.max(280, box.clientWidth), H = 190, L = 46, Rp = 10, T = 10, B = 32, band = 6;
  const hiRaw = Math.max(...ts.map((_, i)=>sum(o.layers, i)/scale(i))), loRaw = o.under ? Math.max(...ts.map((_, i)=>sum(o.under, i))) : 0;
  const hi = o.share ? 100 : niceMax(hiRaw), lo = loRaw ? Math.max(niceMax(loRaw), hi/5) : 0; // the underside gets a fifth at least, so a little eating still reads
  const x = t => L + (t - ts[0])/Math.max(1, ts[n-1] - ts[0])*(W-L-Rp), y = val => T + (hi - val)/(hi + lo)*(H-T-B);
  const fv = val => o.share ? Math.round(val)+"%" : fmt(val)+(o.net ? "/s" : "");
  let s = '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="'+o.label+', stacked: '+o.layers.map(l=>l.name).join(", ")+'">';
  for(const val of lo ? [hi, 0, -lo] : [hi, hi/2, 0]) s += svgEl("line", { x1:L, x2:W-Rp, y1:y(val), y2:y(val), class:val===0 ? "grid zero" : "grid" }) + '<text class="ax" x="'+(L-6)+'" y="'+(y(val)+4)+'" text-anchor="end">'+(val < 0 ? "-" : "")+fv(Math.abs(val))+'</text>';
  // each layer is the band between the running total below it and the one with it added
  const area = (ls, sign) => {
    let acc = ts.map(()=>0), out = "";
    for(const l of ls){
      const top = acc.map((a, i)=>a + Math.abs(l.v[i]||0)/scale(i));
      const up = ts.map((t, i)=>x(t).toFixed(1)+","+y(sign*top[i]).toFixed(1)), down = ts.map((t, i)=>x(t).toFixed(1)+","+y(sign*acc[i]).toFixed(1)).reverse();
      out += '<path class="lyr" d="M'+up.join(" L")+" L"+down.join(" L")+' Z" fill="'+l.col+'"/>';
      acc = top;
    }
    return out;
  };
  s += area(o.layers, 1) + (o.under ? area(o.under, -1) : "");
  if(o.net){
    const pts = ts.map((t, i)=>x(t).toFixed(1)+","+y(o.layers.reduce((a, l)=>a + (l.v[i]||0), 0) + o.under.reduce((a, l)=>a + (l.v[i]||0), 0)).toFixed(1));
    s += '<polyline class="net" points="'+pts.join(" ")+'"/>';
  }
  s += phaseBand(ts, ph, x, H - B + 6, band);
  s += '<text class="ax" x="'+L+'" y="'+(H-4)+'">'+fmtTime(ts[0])+'</text><text class="ax" x="'+(W-Rp)+'" y="'+(H-4)+'" text-anchor="end">'+fmtTime(ts[n-1])+'</text>';
  s += '<g class="xh hidden"><line y1="'+T+'" y2="'+(H-B)+'"/></g><rect class="hit" x="'+L+'" y="0" width="'+(W-L-Rp)+'" height="'+H+'" fill="transparent"/></svg>';
  const legend = o.layers.concat(o.under||[]).map(l=>'<span><i style="background:'+l.col+'"></i>'+l.name+'</span>').join("") + (o.net ? '<span><i class="ln"></i>what\'s left</span>' : "");
  box.innerHTML = '<div class="legend">'+legend+'</div>' + s + '<div class="chart-tip hidden"></div>';
  hover(box, ts, x, W, i=>{
    const row = (l, val) => '<tr><td><i style="background:'+l.col+'"></i>'+l.name+'</td><td>'+(o.share ? Math.round((val||0)/scale(i))+"%" : o.fmtV(val||0))+'</td></tr>';
    let h = '<b>'+fmtTime(ts[i])+'</b>'+(ph && PHASES[ph[i]] ? ' <span>'+PHASES[ph[i]].icon+" "+PHASES[ph[i]].name+'</span>' : "")+'<table>';
    for(const l of o.layers.slice().reverse()){
      h += row(l, l.v[i]);
      if(l.parts) for(const p of l.parts) if(p.v[i]) h += '<tr class="sub"><td>'+p.name+'</td><td>'+(o.share ? Math.round(p.v[i]/scale(i))+"%" : o.fmtV(p.v[i]))+'</td></tr>';
    }
    if(o.under) for(const l of o.under) h += row(l, l.v[i]);
    if(o.net) h += '<tr class="sum"><td>what\'s left</td><td>'+o.fmtV(o.layers.concat(o.under).reduce((a, l)=>a + (l.v[i]||0), 0))+'</td></tr>';
    else if(!o.share) h += '<tr class="sum"><td>in all</td><td>'+o.fmtV(sum(o.layers, i))+'</td></tr>';
    return h+'</table>';
  });
}
/* the same numbers, for reading rather than looking: a dozen points spread through the run */
function stackTable(o, ts, scale){
  const n = ts.length, idx = [...new Set(Array.from({ length:Math.min(12, n) }, (_, k)=>Math.round(k*(n-1)/Math.max(1, Math.min(12, n)-1))))];
  const ls = o.layers.concat(o.under||[]);
  return '<div class="runs-wrap"><table class="runs"><tr><th>at</th>'+ls.map(l=>'<th>'+l.name+'</th>').join("")+'</tr>'+
    idx.map(i=>'<tr><td>'+fmtTime(ts[i])+'</td>'+ls.map(l=>'<td>'+(o.share ? Math.round((l.v[i]||0)/scale(i))+"%" : o.fmtV(l.v[i]||0))+'</td>').join("")+'</tr>').join("")+'</table></div>';
}
/* which market it was, along the bottom of a run chart */
function phaseBand(ts, ph, x, top, h){
  if(!ph) return "";
  let s = "", from = 0;
  for(let i=1; i<=ts.length; i++){
    if(i < ts.length && ph[i]===ph[from]) continue;
    const p = PHASES[ph[from]], x0 = x(ts[from]), x1 = i < ts.length ? x(ts[i]) : x(ts[ts.length-1]);
    if(p && x1 > x0) s += '<rect class="ph" x="'+x0.toFixed(1)+'" y="'+top+'" width="'+Math.max(1, x1 - x0 - 1).toFixed(1)+'" height="'+h+'" rx="2" fill="'+p.color+'"><title>'+p.icon+" "+p.name+'</title></rect>';
    from = i;
  }
  return s;
}
/* crosshair and tooltip for a chart over time */
function hover(box, ts, x, W, tipHtml){
  const xh = box.querySelector(".xh"), tip = box.querySelector(".chart-tip"), svg = box.querySelector("svg");
  const at = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left)*W/r.width, br = box.getBoundingClientRect();
    let i = 0; for(let k=1; k<ts.length; k++) if(Math.abs(x(ts[k]) - px) < Math.abs(x(ts[i]) - px)) i = k;
    xh.classList.remove("hidden"); tip.classList.remove("hidden");
    xh.querySelector("line").setAttribute("x1", x(ts[i])); xh.querySelector("line").setAttribute("x2", x(ts[i]));
    tip.innerHTML = tipHtml(i);
    const cx = x(ts[i])*r.width/W + (r.left - br.left), tw = tip.offsetWidth;
    tip.style.left = (cx + 14 + tw > br.width ? Math.max(0, cx - 14 - tw) : cx + 14)+"px";
    tip.style.top = (r.top - br.top + 8)+"px";
  };
  const hit = box.querySelector(".hit");
  hit.addEventListener("pointermove", at); hit.addEventListener("pointerdown", at);
  hit.addEventListener("pointerleave", ()=>{ xh.classList.add("hidden"); tip.classList.add("hidden"); });
}
/* bars: every run's length, oldest on the left, split where the network got to 10, 50, 100 and 250, so you can see which
   stretch got faster. The run you're on is the last bar, outlined. */
function drawRunsChart(){
  const box = $("chart-runs"); if(!box) return;
  const h = (S.history||[]).slice(-29).concat({ n:runNo(), t:S.runT, sp:S.run.sp, challenge:S.challenge, now:true });
  const W = Math.max(280, box.clientWidth), H = 150, L = 46, T = 16, B = 20, Rp = 10;
  const most = Math.max(60, ...h.map(r=>r.t)), top = most > 3600 ? Math.ceil(most/3600)*3600 : Math.ceil(most/600)*600; // whole hours, or ten minutes
  const bw = Math.min(44, (W-L-Rp)/h.length), y = v => T + (1 - v/top)*(H-T-B);
  const plain = h.filter(r=>!r.challenge && !r.now), best = plain.length ? Math.min(...plain.map(r=>r.t)) : -1;
  const legs = r => { // [from, to, color index] for each stretch of a run
    if(!r.sp || !Object.keys(r.sp).length) return [[0, r.t, -1]];
    const out = []; let from = 0;
    SPLITS.forEach((k, j)=>{ if(r.sp[k] != null){ out.push([from, r.sp[k], j]); from = r.sp[k]; } });
    out.push([from, r.t, out.length < SPLITS.length ? out.length : SPLITS.length]);
    return out;
  };
  const LEG_NAME = ["to 10 miladys", "10 to 50", "50 to 100", "100 to 250", "250 and on"];
  let s = '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="how long each run took, split by how big the network had got">';
  for(const f of [0, 0.5, 1]) s += svgEl("line", { x1:L, x2:W-Rp, y1:y(top*f), y2:y(top*f), class:"grid" }) + '<text class="ax" x="'+(L-6)+'" y="'+(y(top*f)+4)+'" text-anchor="end">'+fmtTime(top*f).replace(/ 0[ms]$/, "")+'</text>';
  h.forEach((r, i)=>{
    const bx = L + i*bw + 1, w = Math.max(2, bw-2), ls = legs(r);
    s += '<g class="run'+(r.now ? " now" : "")+'" data-i="'+i+'">';
    ls.forEach(([a, b, c], j)=>{
      const y0 = y(a), y1 = y(b), last = j===ls.length-1, rr = last ? Math.min(4, w/2, Math.max(0, y0 - y1)) : 0, gap = j ? 1 : 0; // a hairline of page between stretches
      const col = c < 0 ? REST_COL : SPLIT_COL[c];
      s += '<path d="M'+bx+','+(y0-gap)+' V'+(y1+rr)+' Q'+bx+','+y1+' '+(bx+rr)+','+y1+' H'+(bx+w-rr)+' Q'+(bx+w)+','+y1+' '+(bx+w)+','+(y1+rr)+' V'+(y0-gap)+' Z" fill="'+col+'"/>';
    });
    s += '<rect class="hit" x="'+(bx-1)+'" y="'+T+'" width="'+(w+2)+'" height="'+(H-T-B)+'" fill="transparent"/></g>';
    const mark = r.now ? "▶" : r.t===best && !r.challenge ? "⚡" : r.challenge ? "⚖️" : "";
    if(mark) s += '<text class="ax" x="'+(bx+w/2)+'" y="'+(y(r.t)-4)+'" text-anchor="middle">'+mark+'</text>';
    if(h.length <= 15 || i%Math.ceil(h.length/15)===0 || r.now) s += '<text class="ax" x="'+(bx+w/2)+'" y="'+(H-6)+'" text-anchor="middle">'+r.n+'</text>';
  });
  const legend = LEG_NAME.map((l, j)=>'<span><i style="background:'+SPLIT_COL[j]+'"></i>'+l+'</span>').join("") + (h.some(r=>!r.sp) ? '<span><i style="background:'+REST_COL+'"></i>not split (older runs)</span>' : "");
  box.innerHTML = '<div class="legend">'+legend+'</div>' + s + '</svg><div class="chart-tip hidden"></div>';
  const tip = box.querySelector(".chart-tip");
  box.querySelectorAll(".run").forEach(b=>{
    const show = ()=>{ const r = h[+b.dataset.i], br = b.getBoundingClientRect(), cr = box.getBoundingClientRect();
      const ls = legs(r);
      tip.innerHTML = '<b>'+(r.now ? "this run, so far" : "run "+r.n)+'</b> '+fmtTime(r.t)+
        (r.now ? "" : ' <span>· '+r.cycles+' cycles · peak '+fmt(r.peak)+' · +'+fmt(r.grass)+' 🌿'+(r.challenge ? " · ⚖️ "+byId(CHALLENGES, r.challenge).name : "")+'</span>')+
        (ls[0][2] >= 0 ? '<table>'+ls.map(([a, b2, c])=>'<tr><td><i style="background:'+SPLIT_COL[c]+'"></i>'+LEG_NAME[c]+'</td><td>'+fmtTime(b2 - a)+'</td></tr>').join("")+'</table>' : "");
      tip.classList.remove("hidden");
      const tw = tip.offsetWidth, left = br.left - cr.left + br.width + 8;
      tip.style.left = (left + tw > cr.width ? Math.max(0, br.left - cr.left - 8 - tw) : left)+"px"; tip.style.top = "24px"; };
    b.addEventListener("pointerenter", show); b.addEventListener("pointerdown", show);
    b.addEventListener("pointerleave", ()=>tip.classList.add("hidden"));
  });
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
      row.addEventListener("mouseenter", ()=>showTip(r.id, row));
      row.addEventListener("mouseleave", ()=>{ if(!tipPinned) hideTip(); });
      row.addEventListener("click", ()=>{ if(tipFor===r.id && tipPinned){ hideTip(); } else { showTip(r.id, row); tipPinned = true; } });
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
  if(tipFor && !$("tip").classList.contains("hidden")) $("tip").innerHTML = breakdown(tipFor);
  const outfit = JSON.stringify(youLook()); // relics changed what she'd wear (a raid, a restored save): dress her again
  if(outfit !== wornNow){ wornNow = outfit; drawYou(); }
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
  $("clock-cyc").textContent = S.cycle+1;
  $("clock-run").textContent = fmtTime(S.runT);
  $("clock").title = clockTitle();
  if($("st-run")){ $("st-run").textContent = fmtTime(S.runT); $("st-cyc").textContent = S.cycle; $("st-cyc-all").textContent = fmt(S.stats.cycles); $("st-played").textContent = fmtTime(S.stats.played); }
  $("phase-fill").style.width = (into/PHASE_SECS*100)+"%";
  $("phase-fill").style.background = ph.color;
  $("phase-left").textContent = fmtTime(PHASE_SECS-into);
  const nx = rule(S, "bear") ? null : PHASES[(PHASES.indexOf(ph)+1) % PHASES.length];
  $("phase-next").textContent = nx ? "→ "+nx.icon : "forever";
  $("phase-next").title = nx ? "next: "+nx.name+" ("+nx.desc+")" : "bear season: it stays a bear market";
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
    const b = byId(BUILDINGS, c.dataset.b), n = wantN(b), p = priceN(b, S, n);
    c.querySelector("em").textContent = S.b[b.id] ? "×"+S.b[b.id] : "";
    c.querySelector(".cc").innerHTML = (n>1 ? '<span class="buy-n">+'+n+'</span>' : "")+costHtml(p);
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
    row.querySelector('[data-d="1"]').disabled = row.querySelector('[data-d="all"]').disabled = !R.jobs.idle;
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
  if($("auto-ct")){
    const c = S.run.auto;
    $("auto-ct").textContent = "this run: "+[c.b && fmt(c.b)+" built", c.t && c.t+" researched", c.u && c.u+" upgrades", c.m && fmt(c.m)+" memes"].filter(Boolean).join(" · ") || "this run: nothing yet";
  }
  updateT2(body);
  const st = nnStage(S);
  if(st) body.querySelectorAll("[data-nn]").forEach(row=>{
    const k = row.dataset.nn, got = S.nn.got[k]||0, need = st.need[k], left = need - got, rate = S.nn.on ? pourRate(S, R, k) : 0;
    row.querySelector("u").style.width = Math.min(100, got/need*100)+"%";
    row.querySelector("b").textContent = fmt(got)+" / "+fmt(need);
    row.querySelector("em").textContent = left <= 1e-6 ? "✅" : rate > 0 ? "⏳ "+(left/rate > 99*3600 ? "ages" : fmtTime(left/rate)) : S.nn.on ? "nothing coming in" : "paused";
  });
  if($("nn-req") && st){
    const q = st.req;
    $("nn-req").innerHTML = (q.miladys ? (S.miladys.length >= q.miladys ? "✅" : "⏳")+" needs "+q.miladys+" miladys in the network at once ("+S.miladys.length+" now). " : "")+
      (q.cathedral ? ((S.wonder||0) >= WONDER.length ? "✅" : "⏳")+" needs the cathedral finished this run." : "");
  }
  if($("chart-run")){ drawRunChart(); drawStacks(); }
  if($("speed-left")) $("speed-left").textContent = S.runT <= 5400 ? fmtTime(5400 - S.runT)+" left." : "out of time.";
  if($("grass-have")){
    const g = grassGain(S, R.f);
    $("grass-have").textContent = fmt(Math.floor(S.grass));
    $("grass-bonus").textContent = "+"+pct(S.t2 ? S.t2.frozen : S.grass*(GRASS_EACH+(R.f.grassEach||0)));
    if($("garden-rate")){ const r = gardenRate(S); $("garden-rate").textContent = r ? fmt(r*3600)+" 🌿 an hour, lately" : "no runs yet"; }
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

/* ---------- where a number comes from ---------- */
function breakdown(id){
  const s = S, f = R.f, r = RES_BY[id], lines = [];
  let base = 0;
  for(const j of JOBS) if(j.res===id && R.jobs.w[j.id]){
    const v = R.jobs.w[j.id] * j.rate * (1 + (f["job."+j.id]||0)) * R.happy;
    base += v; lines.push([R.jobs[j.id]+" "+j.name+(R.jobs[j.id]>1 ? "s" : ""), v]);
  }
  for(const b of BUILDINGS) if(s.b[b.id] && b.fx["rate."+id]){ const v = s.b[b.id]*b.fx["rate."+id]; base += v; lines.push([s.b[b.id]+" "+b.name+(s.b[b.id]>1 ? "s" : ""), v]); }
  const idle = (f["idle."+id]||0) * R.jobs.idle; if(idle){ base += idle; lines.push([R.jobs.idle+" idle", idle]); }
  const flat = (f["rate."+id]||0) - BUILDINGS.reduce((a,b)=>a + (s.b[b.id]||0)*(b.fx["rate."+id]||0), 0);
  if(flat > 1e-9){ base += flat; lines.push(["other", flat]); }
  const bonus = (f["mult."+id]||0) + (f.all||0), ph = R.phase.mod[id]||0, bf = buff(s, "all");
  let html = '<b style="color:'+r.color+'">'+resIcon(id)+" "+r.name+'</b><div class="tip-d">'+r.desc+'</div><table>';
  html += lines.length ? lines.map(([l,v])=>'<tr><td>'+l+'</td><td>'+fmtRate(v)+'</td></tr>').join("") : '<tr><td class="dim" colspan="2">nothing makes it yet</td></tr>';
  if(lines.length){
    if(lines.length>1) html += '<tr class="sum"><td>base</td><td>'+fmtRate(base)+'</td></tr>';
    if(R.jobs.w && JOBS.some(j=>j.res===id && R.jobs.w[j.id])) html += '<tr class="m"><td>happiness</td><td>'+pct(R.happy)+' (in the jobs above)</td></tr>';
    if(bonus) html += '<tr class="m"><td>bonuses</td><td>'+(bonus>0 ? "+" : "")+pct(bonus)+'</td></tr>';
    if(ph) html += '<tr class="m"><td>'+R.phase.icon+" "+R.phase.name+'</td><td>'+(ph>0 ? "+" : "")+pct(ph)+'</td></tr>';
    if(bf) html += '<tr class="m"><td>rituals</td><td>+'+pct(bf)+'</td></tr>';
    if(R.grassMult > 1) html += '<tr class="m"><td>🌿 grass</td><td>×'+R.grassMult.toFixed(2)+'</td></tr>';
    html += '<tr class="sum"><td>made</td><td>'+fmtRate(R.prod[id])+'</td></tr>';
  }
  if(id==="vibes"){
    if(R.bots) html += '<tr><td>your posting bots ('+R.autoclick+'/s)</td><td>'+fmtRate(R.bots)+'</td></tr>';
    if(R.eat) html += '<tr class="neg"><td>'+(S.miladys.length-R.jobs.away)+' miladys eating</td><td>'+fmtRate(-R.eat)+'</td></tr>';
    html += '<tr class="sum"><td>all told</td><td>'+fmtRate(R.net.vibes)+'</td></tr>';
  }
  html += '</table><div class="tip-d">room for '+fmt(R.cap[id])+(S.res[id] < R.cap[id] && R.net[id] > 0 ? " · full in "+fmtTime((R.cap[id]-S.res[id])/R.net[id]) : S.res[id] >= R.cap[id]-1e-6 ? " · full" : "")+'</div>';
  return html;
}
let tipFor = null, tipPinned = false, tipAt = null;
function showTip(id, row){
  const t = $("tip"); tipFor = id; tipAt = row;
  t.innerHTML = breakdown(id); t.classList.remove("hidden");
  const r = row.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
  let x = r.right + 10, y = r.top - 6;
  if(x + w > innerWidth - 8) x = Math.max(8, r.left + r.width/2 - w/2), y = r.bottom + 8; // no room beside it: below it
  t.style.left = x+"px"; t.style.top = Math.max(8, Math.min(y, innerHeight - h - 8))+"px";
}
function hideTip(){ $("tip").classList.add("hidden"); tipFor = null; tipPinned = false; }
document.addEventListener("click", e=>{ if(tipPinned && !e.target.closest("#tip, .res-row")) hideTip(); });

/* rebuild when the set of things on screen changes, otherwise just update */
function signature(){
  return [tab, tabs().map(t=>t.id).join(), BUILDINGS.filter(b=>shown(b)||S.b[b.id]).length,
    TECHS.filter(t=>techShown(t)||S.tech[t.id]).map(t=>t.id+(S.tech[t.id]?1:0)).join(),
    UPGRADES.filter(u=>shown(u)||S.up[u.id]).map(u=>u.id+(S.up[u.id]?1:0)).join(),
    JOBS.filter(shown).length, Object.keys(S.perks).length, RITUALS.filter(shown).length, S.raids.length, S.wonder, Object.keys(S.relics).length,
    Object.values(S.relics).join(""), !!R.f.autoassign, S.nn.i, S.nn.e, S.ended, tab==="miladys" ? S.miladys.map(m=>m.id+m.job+(m.away||"")).join() : ""].join("|");
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
    '<div class="acct-row" id="acct-set"></div>'+
    '<div class="set-h">on this device <span>'+(acct() ? "your other devices keep their own" : "")+'</span></div>'+
    '<div class="set-row"><span>sound</span><button class="tog'+(S.settings.mute ? "" : " on")+'" id="set-mute">'+(S.settings.mute ? "off" : "on")+'</button></div>'+
    '<div class="set-row"><span>effects volume</span><input id="set-vol" type="range" min="0" max="100" value="'+(S.settings.vol!=null ? S.settings.vol : 70)+'"></div>'+
    '<div class="set-row"><span>music <small class="note">(all the way down is off)</small></span><input id="set-music" type="range" min="0" max="100" value="'+(S.settings.music!=null ? S.settings.music : 40)+'"></div>'+
    '<div class="set-row"><span>animated backdrop<br><span class="note">off is lighter, for a phone that lags</span></span><button class="tog'+(S.settings.bg!==false ? " on" : "")+'" id="set-bg">'+(S.settings.bg!==false ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>calm (less motion)</span><button class="tog'+(S.settings.calm ? " on" : "")+'" id="set-calm">'+(S.settings.calm ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>her face reacts</span><button class="tog'+(S.settings.faces!==false ? " on" : "")+'" id="set-faces">'+(S.settings.faces!==false ? "on" : "off")+'</button></div>'+
    '<div class="set-row"><span>📺 ambient mode, when nobody\'s touched anything for</span><span class="seg">'+Object.keys(AMBIENT_AFTER).map(k=>'<button class="pick'+((S.settings.ambient||"3")===k ? " on" : "")+'" data-amb="'+k+'">'+(k==="off" ? "never" : k+" min")+'</button>').join("")+'</span></div>'+
    '<div class="set-row"><span>notifications<br><span class="note">only while the game\'s in a background tab</span></span><button class="tog'+(S.settings.notifyOn ? " on" : "")+'" id="set-notify">'+(S.settings.notifyOn ? "on" : "off")+'</button></div>'+
    (S.settings.notifyOn ? '<div class="set-row notify-kinds">'+Object.keys(NOTIFY_WHAT).map(k=>'<button class="tog'+(S.settings.notify[k] ? " on" : "")+'" data-notify="'+k+'">'+NOTIFY_WHAT[k]+'</button>').join("")+'</div>' : "")+
    (standalone() ? "" : '<div class="set-row"><span>install it as an app</span>'+(installPrompt ? '<button class="btn small" id="set-install">install</button>' : '<span class="note">'+(/iphone|ipad/i.test(navigator.userAgent) ? "in safari: share → add to home screen" : "use your browser's install button")+'</span>')+'</div>')+
    (window.caches && !window.INLINE_FILES ? '<div class="set-row"><span>keep every picture, to play offline (about 11 MB)</span><button class="btn small" id="set-offline">'+(offlineState==="done" ? "kept ✓" : offlineState==="busy" ? "keeping…" : "keep them")+'</button></div>' : "")+
    '<div class="set-h">'+(acct() ? "everywhere you play" : "your network")+'</div>'+
    '<div class="set-row"><span>numbers</span><span class="seg">'+Object.keys(NOTATIONS).map(k=>'<button class="pick'+((S.settings.num||"short")===k ? " on" : "")+'" data-num="'+k+'">'+NOTATIONS[k]+'</button>').join("")+'</span></div>'+
    '<div class="set-row"><span>wear your relics</span><button class="tog'+(S.settings.wear!==false ? " on" : "")+'" id="set-wear">'+(S.settings.wear!==false ? "on" : "off")+'</button></div>'+
    '<div class="set-row who-set"><span>who you are</span><div class="who-row" id="who-set"></div></div>'+
    (acct() ? "" : '<div class="set-row"><span>start over, for real</span><button class="btn small danger" id="set-wipe">wipe this device</button></div>')+
    '<p class="note">'+(acct() ? "your network is kept on your account, and saved there every minute. sign in anywhere to pick it up." : "the game saves itself every few seconds, in this browser. sign in to keep it on your account and play it on any device.")+'</p>'+
    '<div class="row"><button class="btn small" data-close>close</button></div>');
  $("set-mute").onclick = ()=>{ S.settings.mute = !S.settings.mute; syncMute(); openSettings(); };
  $("set-bg").onclick = ()=>{ S.settings.bg = S.settings.bg===false; syncLook(); openSettings(); };
  $("set-calm").onclick = ()=>{ S.settings.calm = !S.settings.calm; syncLook(); openSettings(); };
  document.querySelectorAll("#modal [data-num]").forEach(b=>b.onclick = ()=>{ S.settings.num = b.dataset.num; refresh(true); renderLog(); openSettings(); });
  whoControls($("who-set"));
  $("set-vol").oninput = e=>{ S.settings.vol = +e.target.value; };
  $("set-music").oninput = e=>{ S.settings.music = +e.target.value; MUSIC.update(); };
  $("set-vol").onchange = ()=>sfx.post();
  $("set-wear").onclick = ()=>{ S.settings.wear = S.settings.wear===false; drawYou(); openSettings(); };
  document.querySelectorAll("#modal [data-amb]").forEach(b=>b.onclick = ()=>{ S.settings.ambient = b.dataset.amb; openSettings(); });
  $("set-faces").onclick = ()=>{ S.settings.faces = S.settings.faces===false; face = null; faceTick(); openSettings(); };
  $("set-notify").onclick = ()=>{ if(S.settings.notifyOn){ S.settings.notifyOn = false; openSettings(); } else askNotify(); };
  document.querySelectorAll("#modal [data-notify]").forEach(b=>b.onclick = ()=>{ const k = b.dataset.notify; S.settings.notify[k] = !S.settings.notify[k]; openSettings(); });
  if($("set-install")) $("set-install").onclick = async ()=>{ installPrompt.prompt(); await installPrompt.userChoice.catch(()=>{}); installPrompt = null; openSettings(); };
  if($("set-offline")) $("set-offline").onclick = ()=>keepOffline(false);
  renderAcct($("acct-set"));
  if($("set-wipe")) $("set-wipe").onclick = ()=>{
    openModal('<h2>wipe everything?</h2><p>grass, perks, achievements, all of it. there\'s no undo.</p><div class="row"><button class="btn danger" id="wipe-yes">wipe it</button><button class="btn small" data-close>no</button></div>');
    $("wipe-yes").onclick = ()=>{ localStorage.removeItem(SAVE_KEY); S = null; location.reload(); };
  };
}
function syncName(){
  document.querySelectorAll(".brand").forEach(b=>b.innerHTML = "the network <b>"+(S.ended ? "is online" : "is growing")+"</b>");
  setTitle();
}
function syncLook(){
  document.body.classList.toggle("calm", !!S.settings.calm);
  document.body.classList.toggle("nobg", S.settings.bg===false);
}
function syncMute(){ document.querySelectorAll(".mute").forEach(b=>b.textContent = S.settings.mute ? "🔇" : "🔊"); if(typeof MUSIC!=="undefined") MUSIC.update(); }

function openHelp(){
  openModal('<h2>how to play</h2>'+
    '<p><b>click your milady</b> to post. posting makes vibes 🌸. turn 25 vibes into a meme 🐸 with <b>meme it</b>.</p>'+
    '<p>build <b>group chats</b> and miladys show up. every milady eats '+EAT+' vibes a second. if the vibes run out, they leave.</p>'+
    '<p>new miladys sit idle. give them <b>jobs</b> in the miladys tab: posters make vibes, memers make memes, and so on.</p>'+
    '<p>build an <b>archive</b> for lore 📜, and spend lore on <b>research</b>. research unlocks the rest.</p>'+
    '<p>the <b>market</b> goes round: accumulation, mania, distribution, bear. each one is good for something.</p>'+
    '<p>catch the <b>💎 sparkles</b> when they show up.</p>'+
    '<p>much later you can <b>touch grass</b>: start over with grass 🌿 that makes everything faster, forever. every time you do, something new opens: compute and devs, then rituals and remilios, then raids and relics, then a cathedral, then challenges. the grass tab says what\'s next.</p>'+
    '<p>after six times, the last thing opens: <b>the new internet</b>, seven stages you pour into across runs. late runs can buy <b>robots</b> (perks) that meme, research, upgrade and build for you.</p>'+
    '<p class="note">the game keeps going while you\'re away (up to 8 hours). settings can let it ping you when a raid\'s home, and on most browsers it installs as an app that plays offline.</p>'+
    '<div class="keys"><b>keys</b><span>arrows move the highlight · enter presses it (shift+enter does 10) · space posts · m makes a meme · q / e or 1-9 change tabs · esc backs out</span>'+
    '<b>gamepad</b><span>d-pad or stick moves · Ⓐ press · Ⓑ back · Ⓧ post · Ⓨ meme it · LB / RB tabs · START settings</span></div>'+
    '<p>want something with more fight in it? <a href="https://cancel.tylerirl.com/">the cancel is coming</a> is this one\'s companion: a roguelite with the same miladys. your network keeps growing while you play it.</p>'+
    '<div class="row"><button class="btn small" data-close>got it</button></div>');
}

/* ---------- you ---------- */
/* your milady puts on the relics you hold: one per slot, the highest level wins */
const youKind = () => (S && S.who && S.who.kind) || "milady";
function youLook(){
  const look = Object.assign({}, S.you);
  if(S.who && S.who.eye) look._eye = S.who.eye;
  if(S.settings.wear===false || youKind()!=="milady") return look; // relics are milady art: a remilio wears her own things
  const best = {};
  for(const r of RELICS){ const lv = S.relics[r.id]||0; if(lv && r.wear && (!best[r.wear[0]] || lv > best[r.wear[0]].lv)) best[r.wear[0]] = { lv, file:r.wear[1] }; }
  for(const slot in best) look[slot] = best[slot].file;
  return look;
}
let wornNow = "";
/* her face: what happens to the network shows on it. A reaction swaps in other eyes, a mouth, brows or a blush from
   the milady trait layers for a moment; a mood (frenzy, dozing off) holds while it lasts; she blinks now and then.
   Everything else she's wearing stays put. pri: a reaction only cuts in over one that matters less. */
const FACES = {
  talk:   { Mouth:"Open.webp", ms:110, pri:0 },
  blink:  { Eyes:"Closed.webp", ms:130, pri:0 },
  full:   { Mouth:"Hm.webp", Brows:"Flat.webp", ms:700, pri:1 },
  buy:    { Mouth:"Smile C.webp", ms:800, pri:1 },
  big:    { Eyes:"Sparkle.webp", Mouth:"Smile B.webp", ms:1300, pri:2 },
  study:  { Eyes:"Dilated.webp", Mouth:"Hm.webp", ms:1400, pri:2 },
  pray:   { Eyes:"Closed.webp", Mouth:"3.webp", ms:1800, pri:2 },
  smug:   { Eyes:"Smug.webp", Mouth:"Smug.webp", Brows:"Complacent A.webp", ms:2200, pri:2 },
  hype:   { Eyes:"Sparkle.webp", Mouth:"Open.webp", ms:2200, pri:2 },
  worry:  { Eyes:"Teary.webp", Mouth:"Flat.webp", Brows:"Concerned A.webp", ms:2400, pri:2 },
  sad:    { Eyes:"Crying.webp", Mouth:"Pout.webp", Brows:"Concerned B.webp", ms:2200, pri:3 },
  drama:  { Eyes:"Teary.webp", Mouth:"Crooked.webp", Brows:"Concerned C.webp", ms:3000, pri:3 },
  shiny:  { Eyes:"Sparkle.webp", Mouth:"W.webp", Face:"Blush.webp", ms:1800, pri:3 },
  calm:   { Eyes:"Closed.webp", Mouth:"Smile A.webp", Face:"Line Blush.webp", ms:2600, pri:3 },
  love:   { Eyes:"Heart.webp", Mouth:"Cat.webp", Face:"Big Blush.webp", ms:2600, pri:4 },
  frenzy: { Eyes:"Spiral.webp", Mouth:"Open.webp", pri:1 },  // a mood: held while the frenzy lasts
  sleepy: { Eyes:"Sleepy.webp", Mouth:"Flat.webp", pri:0 },  // a mood: nobody's posted in a while
  asleep: { Eyes:"Closed.webp", Mouth:"3.webp", pri:0 },
};
/* a remilio's faces, from the remilio layers (TIRED: the tired eyes nearest her own color). It only changes layers she
   has (a zombie has no eyes to swap), and no blush goes under a costume. A remilio has no closed eyes, so no blink. */
const FACES_REMILIO = {
  full:   { Brows:"Sad.webp" },
  buy:    { Mouth:"Smug.webp" },
  big:    { Eyes:"Stars.webp", Mouth:"Smug.webp" },
  study:  { Eyes:"Void.webp", Brows:"Notched.webp" },
  pray:   { Eyes:"TIRED" },
  smug:   { Mouth:"Smug.webp" },
  hype:   { Eyes:"Stars.webp", Mouth:"Troll.webp" },
  worry:  { Eyes:"Tears.webp", Brows:"Sad.webp" },
  sad:    { Eyes:"Tears.webp", Brows:"Sad.webp" },
  drama:  { Eyes:"Tears.webp", Brows:"Sad.webp", Face:"Angry.webp" },
  shiny:  { Eyes:"Stars.webp", Face:"Blush.webp" },
  calm:   { Eyes:"TIRED", Face:"Blush.webp" },
  love:   { Eyes:"Stars.webp", Face:"Blush Heart.webp" },
  frenzy: { Eyes:"Meth.webp" },
  sleepy: { Eyes:"TIRED" },
  asleep: { Eyes:"TIRED", Brows:"Sad.webp" },
};
const tiredEyes = e => /Light Blue|Blue/.test(e||"") ? "Tired Light Blue.webp" : /Green/.test(e||"") ? "Tired Green.webp" : "Tired Brown.webp";
const FACE_LAYERS = ["Eyes", "Mouth", "Brows", "Face"];
let face = null, faceUntil = 0, faceMood = "", faceNow = "", faceSeq = 0, lastTouch = Date.now(), nextBlink = 0;
const facesOn = () => S && S.settings.faces!==false;
function react(name){
  const f = FACES[name]; if(!f || !facesOn()) return;
  const now = performance.now();
  if(face && now < faceUntil && FACES[face].pri > f.pri) return;
  face = name; faceUntil = now + f.ms;
  faceTick();
}
function faceLook(){
  const look = youLook();
  if(!facesOn()) return look;
  const now = performance.now(), name = face && now < faceUntil ? face : faceMood;
  if(youKind()==="remilio"){
    const f = FACES_REMILIO[name];
    if(f) for(const l of FACE_LAYERS) if(f[l] && (look[l] || (l==="Face" && !look.Costume))) look[l] = f[l]==="TIRED" ? tiredEyes(look.Eyes) : f[l];
    return look;
  }
  const f = FACES[name];
  if(f) for(const l of FACE_LAYERS) if(f[l]) look[l] = f[l];
  return look;
}
/* about ten times a second: is it time to blink, has a reaction run out, has the mood changed */
function faceTick(){
  if(!S) return;
  const now = performance.now();
  if(face && now >= faceUntil) face = null;
  const idle = Date.now() - lastTouch;
  faceMood = S.buffs.some(b=>b.kind==="frenzy") ? "frenzy" : idle > 300000 ? "asleep" : idle > 90000 ? "sleepy" : "";
  if(!face && faceMood!=="asleep" && now > nextBlink){ if(nextBlink) react("blink"); nextBlink = now + 2500 + rnd()*4000; }
  const key = JSON.stringify(faceLook());
  if(key !== faceNow){ faceNow = key; drawYou(); }
}
async function drawYou(){
  const kind = youKind(), seq = ++faceSeq, cv = await compose(faceLook(), true, kind);
  if(seq !== faceSeq) return; // a newer face was asked for while this one was being put together
  for(const id of ["you", "title-you", "fab-you"]){
    const c = $(id); if(!c) continue;
    const cx = c.getContext("2d"); cx.clearRect(0, 0, 600, 750);
    if(kind==="remilio") cx.drawImage(cv, -70, -32, 762, 762); // square, with a smaller head: fitted to the portrait the way the cancel is coming does
    else cx.drawImage(cv, 0, 0);
  }
}
function warmFaces(){ // every face she can make, loaded ahead so the first of each isn't late
  const rem = youKind()==="remilio";
  for(const f of Object.values(rem ? FACES_REMILIO : FACES)) for(const l of FACE_LAYERS) if(f[l])
    loadImg("assets/img/"+(rem ? "Remilio" : "Milady")+"/"+l+"/"+(f[l]==="TIRED" ? tiredEyes(S.you.Eyes) : f[l])).catch(()=>{});
}

/* ---------- who you are: as on the cancel is coming's character screen ----------
   Milady or Remilio, made from the trait files (reroll), or a token by its number, rebuilt from its traits; or
   Radbro, who is one Remilio and nothing to choose. The character follows the number as it's typed. */
const isRadbro = t => !!t && t.kind===RADBRO_TOKEN.kind && +t.id===RADBRO_TOKEN.id;
let whoTok = 0;
const whoLabel = () => isRadbro(S.who.token) ? "radbro" : S.who.token ? S.who.kind+" #"+S.who.token.id : "a "+S.who.kind+" of your own";
function whoControls(box){
  if(!box) return;
  const w = S.who, rad = isRadbro(w.token);
  box.innerHTML = '<select class="name-in" data-who="kind" aria-label="collection">'+["milady","remilio","radbro"].map(k=>'<option value="'+k+'">'+k+'</option>').join("")+'</select>'+
    '<input class="name-in who-id'+(rad ? " hidden" : "")+'" data-who="id" type="number" min="0" max="9999" inputmode="numeric" placeholder="token #" aria-label="token number" value="'+(w.token && !rad ? w.token.id : "")+'">'+
    '<button class="btn small" data-who="roll"'+(rad ? " disabled" : "")+'>🎲 reroll</button>'+
    '<span class="note who-msg">'+esc(whoLabel())+'</span>';
  const kind = box.querySelector('[data-who="kind"]'), id = box.querySelector('[data-who="id"]'), msg = box.querySelector(".who-msg");
  kind.value = rad ? "radbro" : w.kind;
  let t = 0;
  const useId = ()=>{ clearTimeout(t); const n = parseInt(id.value, 10);
    if(kind.value==="radbro") return; // the number box sits out: radbro is one remilio (its change can fire after the switch)
    if(/^\d+$/.test(id.value.trim()) && n>=0 && n<=9999 && !(S.who.token && S.who.token.kind===kind.value && +S.who.token.id===n)) loadWho({ kind:kind.value, id:n }, msg); };
  id.oninput = ()=>{ clearTimeout(t); t = setTimeout(useId, 380); }; // a beat after the last keystroke
  id.onchange = useId;
  kind.onchange = ()=>{
    const rad = kind.value==="radbro";
    id.classList.toggle("hidden", rad); box.querySelector('[data-who="roll"]').disabled = rad;
    if(rad) return loadWho(RADBRO_TOKEN, msg);
    if(id.value.trim()) return useId();
    if(kind.value!==S.who.kind || S.who.token) rollWho(kind.value, msg);
  };
  box.querySelector('[data-who="roll"]').onclick = ()=>{ if(kind.value==="radbro") return; id.value = ""; rollWho(kind.value, msg); };
}
function rollWho(kind, msg){
  whoTok++;
  S.you = rollLook(kind); S.who = { kind, token:null, eye:"" };
  if(msg) msg.textContent = whoLabel();
  whoChanged();
}
async function loadWho(tok, msg){
  const t = ++whoTok, label = isRadbro(tok) ? "radbro" : tok.kind+" #"+tok.id;
  if(!online()){ if(msg) msg.textContent = "tokens load from the service, which this copy can't reach"; return; }
  if(msg) msg.textContent = "loading "+label+"…";
  const r = await api("/api/token?kind="+tok.kind+"&id="+tok.id, null, { ms:12000 });
  if(t!==whoTok) return; // something newer was asked for meanwhile
  const tk = r.status===200 && r.data && Array.isArray(r.data.attributes) ? tokenLayers(tok.kind, r.data.attributes) : null;
  if(!tk){ if(msg) msg.textContent = r.status===429 ? "that's a lot of lookups. try again in a bit" : "couldn't load "+label+": check the number and your connection"; return; }
  S.you = tk.layers; S.who = { kind:tok.kind, token:{ kind:tok.kind, id:tok.id }, eye:tk.eye };
  if(msg) msg.textContent = "playing as "+label;
  whoChanged();
}
function whoChanged(){
  wornNow = ""; faceNow = ""; face = null; warmFaces(); drawYou(); save();
  document.querySelectorAll(".who-msg").forEach(m=>m.textContent = m.textContent.startsWith("loading") || m.textContent.startsWith("couldn") ? m.textContent : whoLabel());
  const c = $("title-you"); if(c){ c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop"); }
}

/* ---------- time away ---------- */
/* a background tab the browser only wakes once a minute is played quietly, and the welcome back covers all of it
   once you're looking again */
let awaySnap = null;
function catchUp(quiet){
  const cap = (S.perks.sleep ? 24 : 8)*3600;
  const gone = Math.min(cap, (Date.now() - S.last)/1000);
  S.last = Date.now();
  if(gone <= 0 && !awaySnap) return;
  if(!awaySnap) awaySnap = { secs:0, res:Object.assign({}, S.res), people:S.miladys.length, firstId:S.nextId, raids:S.stats.raids||0,
    relics:Object.assign({}, S.relics), cycles:S.cycle, nn:S.nn.i, ep:S.nn.e||0 };
  awaySnap.secs += Math.max(0, gone);
  // with the gardener, only the first ten minutes are played out (so it can finish the run it was on); the rest is
  // grass at the rate its recent runs brought it in (a little under), and whatever the second tier makes meanwhile
  const sim = gardenerOn(S) && gardenRate(S) > 0 ? Math.min(gone, 600) : gone, rest = gone - sim;
  awaySnap.resets = awaySnap.resets==null ? resets(S) : awaySnap.resets;
  const step = Math.max(1, sim/20000);
  for(let t=0; t<sim; t+=step) tick(S, Math.min(step, sim-t), false);
  if(rest > 0){
    const gr = gardenRate(S)*rest*0.9, R2 = rates(S);
    S.grass += gr; S.garden.away += gr; S.stats.played += rest;
    if(S.t2) for(const r of T2_RES) S.t2.res[r.id] += R2.t2[r.id]*rest;
    awaySnap.harvest = (awaySnap.harvest||0) + gr;
  }
  if(quiet) return;
  const snap = awaySnap; awaySnap = null;
  const away = snap.secs, before = snap.res, people = snap.people, firstId = snap.firstId, raids = snap.raids, relics = snap.relics, cycles = snap.cycles;
  const got = resets(S) > (snap.resets||0) ? "" : RES.filter(r=>isVisible(r.id) && Math.abs(S.res[r.id]-before[r.id]) >= 1)
    .map(r=>'<span class="chip">'+(S.res[r.id]>=before[r.id] ? "+" : "")+fmt(S.res[r.id]-before[r.id])+" "+resIcon(r.id)+"</span>").join(" ");
  const joined = S.nextId - firstId, left = joined - (S.miladys.length - people), back = (S.stats.raids||0) - raids;
  const found = RELICS.filter(r=>(S.relics[r.id]||0) > (relics[r.id]||0)).map(r=>r.icon+" "+r.name+(S.relics[r.id]>1 ? " (lv "+S.relics[r.id]+")" : ""));
  const lines = [joined && "🌸 "+joined+" miladys joined", left > 0 && "🥀 "+left+" logged off", back && "⚔️ "+back+" raid"+(back>1 ? "s" : "")+" came home",
    found.length && "🗿 relics: "+found.join(", "), S.cycle > cycles && "📈 the market went round "+(S.cycle-cycles)+" time"+(S.cycle-cycles>1 ? "s" : ""),
    S.nn.i > snap.nn && "🌐 finished "+NEWNET.slice(snap.nn, S.nn.i).map(s=>s.name).join(", "),
    (S.nn.e||0) > snap.ep && "♾️ "+((S.nn.e||0) - snap.ep)+" epoch"+((S.nn.e||0) - snap.ep > 1 ? "s" : "")+" of the new internet done",
    resets(S) > snap.resets && "🤖 the gardener touched grass "+(resets(S) - snap.resets)+" time"+(resets(S) - snap.resets > 1 ? "s" : ""),
    snap.harvest >= 1 && "🌿 "+fmt(snap.harvest)+" grass came in while you were gone, at the rate the gardener's been going"].filter(Boolean);
  const msg = "while you were away ("+fmtTime(away)+"): "+(got || "nothing much.")+(lines.length ? " "+lines.join(" · ")+"." : "");
  if(away < 60) return; // a tab that was in the background a moment isn't worth a message
  log("🌙 "+msg);
  if(away > 300) openModal('<h2>welcome back</h2><p>you were gone '+fmtTime(away)+'. '+netName()+' kept going.</p><p>'+(got||"nothing much happened.")+'</p>'+
    (lines.length ? '<ul class="away">'+lines.map(l=>"<li>"+l+"</li>").join("")+'</ul>' : "")+
    (away >= (S.perks.sleep ? 24 : 8)*3600 - 1 ? '<p class="note">that\'s as much time as counts. the sleep schedule perk makes it 24 hours.</p>' : "")+
    '<div class="row"><button class="btn big" data-close>back to it</button></div>');
}

/* ---------- achievements ---------- */
function checkAch(){
  for(const a of ACHIEVEMENTS){
    if(S.ach[a.id]) continue;
    let ok = false; try{ ok = a.test(S, R); }catch(e){}
    if(ok){ S.ach[a.id] = Date.now(); react("love"); toast("🏆 <b>"+a.name+"</b> · "+a.desc+' <span class="dim">+'+pct(ACH_EACH)+' everything</span>', 4200); log("🏆 achievement: <b>"+a.name+"</b>."); sfx.shiny(); }
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
function navScope(){ return $("ending") || (modalOpen() ? $("modal-panel") : document.querySelector(".screen.active")); }
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
  if(e.key==="Enter"){ e.preventDefault(); if(typing){ e.target.blur(); return; } if(e.repeat && navSel && navSel.id==="you-wrap") return; return navPress(e.shiftKey); } // posting is a press, not a hold (as with space)
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
let titleT = 0, raidBack = false;
function setTitle(){
  const base = netName()+" is growing";
  document.title = S.started ? (raidBack ? "⚔️ raid's back · " : "")+"🌸 "+fmt(S.res.vibes)+" · "+base : base+" · Tyler (in real life)";
}
function frame(){
  if(!S || !S.started) return;
  if((titleT += 1) % 7 === 0) setTitle(); // about once a second
  const now = Date.now(), dt = (now - S.last)/1000;
  if(dt > 5){ catchUp(document.hidden); if(!document.hidden) refresh(true); }
  else if(dt > 0){ tick(S, dt, true); S.last = now; }
  saveT += dt; achT += dt;
  if(achT > 1){ achT = 0; checkAch(); watch(); }
  if(saveT > 5){ saveT = 0; save(); }
  if(S.ended && !S.endSeen && !document.hidden && !$("ending")) showEnding();
  refresh();
}

/* ---------- notifications: only if you ask, only while the tab's in the background ---------- */
const NOTIFY_WHAT = { raid:"a raid comes home", ritual:"a ritual is ready", full:"storage fills up", grass:"you can touch grass", nn:"a stage or epoch of the new internet is done" };
let watchPrev = null, SWREG = null;
function watchState(){
  return { raids:S.stats.raids||0, rit:S.tech.iconography ? readyCounts().rituals : 0, nn:S.nn.i, ep:S.nn.e||0,
    full:RES.filter(r=>isVisible(r.id) && S.res[r.id] >= R.cap[r.id]-1e-6).map(r=>r.id), grass:!!S.tech.garden && grassGain(S, R.f) >= 1 };
}
function watch(){
  const now = watchState(), p = watchPrev; watchPrev = now;
  if(!p || !document.hidden || !S.settings.notifyOn) return;
  if(now.raids > p.raids) notify("raid", "⚔️ "+(now.raids-p.raids > 1 ? (now.raids-p.raids)+" raids came home" : "a raid came home"), "the loot's in. send them out again?");
  if(now.rit > 0 && p.rit===0) notify("ritual", "🕯️ a ritual is ready", "there's devotion to spend.");
  const fresh = now.full.filter(k=>!p.full.includes(k));
  if(fresh.length) notify("full", "📦 "+fresh.map(k=>RES_BY[k].name).join(", ")+" "+(fresh.length > 1 ? "are" : "is")+" full", "anything more is going to waste.");
  if(now.grass && !p.grass) notify("grass", "🌿 you can touch grass", "the infinite garden is up.");
  if(now.ep > p.ep) notify("nn", "♾️ "+epochStage(now.ep-1).name+" is done", "on to "+epochStage(now.ep).name+".");
  if(now.nn > p.nn) notify("nn", "🌐 "+NEWNET[now.nn-1].name+" is done", now.nn >= NEWNET.length ? "the new internet is online." : "on to "+NEWNET[now.nn].name+".");
}
function notify(kind, title, body){
  if(!S.settings.notify[kind] || !("Notification" in window) || Notification.permission!=="granted") return;
  const o = { body, icon:"assets/icons/icon-192.png", badge:"assets/icons/favicon-32.png", tag:"network-"+kind };
  if(SWREG && SWREG.showNotification) SWREG.showNotification(netName()+": "+title, o).catch(()=>{});
  else try{ const n = new Notification(netName()+": "+title, o); n.onclick = ()=>{ window.focus(); n.close(); }; }catch(e){}
}
async function askNotify(){
  if(!("Notification" in window)) return toast("this browser can't do notifications");
  const ok = Notification.permission==="granted" || (await Notification.requestPermission())==="granted";
  S.settings.notifyOn = ok;
  if(!ok) toast("the browser said no. it can be changed in the site's settings.");
  openSettings();
}

/* ---------- accounts: sign in with RemiliaNET or Urbit ID, and the network follows you ----------
   The same service and the same sign-in as the cancel game. The account holds the save: this browser keeps a copy
   to open instantly and play on without a connection, and sends it back every minute. The service holds each save
   against the last one it took, so there's no loading a save from a file or a paste any more: that would let anyone
   put anything on the boards. */
const API_DEFAULT = "https://cancel-api.tylerirl.com";
const apiBase = () => { try{ return localStorage.getItem("network_api") || API_DEFAULT; }catch(e){ return API_DEFAULT; } };
const online = () => /^https?:$/.test(location.protocol) && !window.INLINE_FILES; // dist.html, opened as a file, has no origin the service takes
const SESSION_KEY = "network-session", SYNC_KEY = "network-sync";
const lsGet = k => { try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } };
const lsSet = (k, v) => { try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
function acct(){ const a = lsGet(SESSION_KEY); return a && a.exp*1000 > Date.now() ? a : null; }
const syncMeta = () => (acct() && (lsGet(SYNC_KEY) || {})[acct().player]) || { rev:0 };
function setSyncMeta(m){ const all = lsGet(SYNC_KEY) || {}; all[acct().player] = Object.assign({}, syncMeta(), m); lsSet(SYNC_KEY, all); }
let netOn = null, syncing = false, syncState = "", syncAt = 0, netRanks = {};

async function api(path, body, o){ // {status, data}; status 0 when the service couldn't be reached
  if(!online()) return { status:0 };
  o = o || {};
  const ctl = new AbortController(), t = setTimeout(()=>ctl.abort(), o.ms || 10000);
  try{
    const r = await fetch(apiBase()+path, body ? { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body), signal:ctl.signal, keepalive:!!o.keepalive } : { signal:ctl.signal });
    let data = null; try{ data = await r.json(); }catch(e){}
    return { status:r.status, data };
  }catch(e){ return { status:0 }; }finally{ clearTimeout(t); }
}
/* a save is about 200 KB of JSON and a tenth of that gzipped */
async function gz(text){
  if(!window.CompressionStream) return null;
  const b = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let bin = ""; for(let i=0; i<b.length; i+=0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i+0x8000));
  return btoa(bin);
}
async function gunzip(b64){
  const bytes = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
function authReturn(){ // back from signing in: the service put its own signed session in the address's #fragment
  const m = /[#&]rn(_error)?=([^&]*)/.exec(location.hash); if(!m) return null;
  try{ history.replaceState(null, "", location.pathname+location.search); }catch(e){}
  if(m[1]) return { error:"sign-in didn't go through ("+decodeURIComponent(m[2])+")" };
  try{
    const d = JSON.parse(decodeURIComponent(escape(atob(m[2].split(".")[0].replace(/-/g,"+").replace(/_/g,"/")))));
    lsSet(SESSION_KEY, { token:m[2], handle:String(d.h), name:String(d.n||d.h), player:String(d.p), exp:+d.exp });
    return { fresh:true };
  }catch(e){ return { error:"sign-in didn't go through" }; }
}
/* on opening the game signed in: the account's save, if it's newer than the copy here */
async function pullAccount(){
  const r = await api("/api/net/load", { session:acct().token }, { ms:6000 });
  if(r.status===401){ lsSet(SESSION_KEY, null); S = load(); return "your sign-in ran out. sign in again to keep syncing."; }
  if(r.status!==200){ syncState = "offline: it'll sync when it can"; return ""; }
  netRanks = r.data.ranks || {};
  if(r.data.gz){
    if(!S || r.data.rev !== syncMeta().rev){ S = migrate(JSON.parse(await gunzip(r.data.gz))); setSyncMeta({ rev:r.data.rev }); save(); }
    syncState = "synced"; syncAt = Date.now();
  } else if(!S){ // a new account: this browser's network joins it. Moved, not copied, so signing out here starts afresh
    const mine = lsGet(SAVE_KEY);
    S = mine ? migrate(mine) : fresh();
    setSyncMeta({ rev:0 }); save(); lsSet(SAVE_KEY, null);
    if(mine) return "this device's network is on your account now.";
  }
  return "";
}
async function syncUp(leaving){
  const a = acct(); if(!a || !S || !S.started || syncing || !online()) return;
  syncing = true;
  try{
    save();
    const text = JSON.stringify(S), packed = await gz(text);
    const r = await api("/api/net/save", Object.assign({ session:a.token, rev:syncMeta().rev }, packed ? { gz:packed } : { json:JSON.parse(text) }), { keepalive:leaving });
    if(r.status===200){ setSyncMeta({ rev:r.data.rev }); syncAt = Date.now(); syncState = "synced"; netRanks = r.data.ranks || netRanks; }
    else if((r.status===409 || r.status===422) && r.data) await adopt(r.data, r.status===409
      ? "picked up where your other device left off."
      : "your account didn't take the last change ("+esc(r.data.error||"")+"), so it's back to the last good save.");
    else if(r.status===401){ toast("your sign-in ran out. sign in again to keep syncing."); signOut(); }
    else syncState = r.status ? "the service said no ("+r.status+")" : "offline: it'll sync when it can";
  }catch(e){ syncState = "couldn't sync"; }
  finally{ syncing = false; renderAcctAll(); }
}
/* the account's copy wins: another device saved since, or the service wouldn't take this one */
async function adopt(d, msg){
  if(!d.gz){ setSyncMeta({ rev:d.rev||0 }); return; } // the account has nothing: the next sync is its first
  S = migrate(JSON.parse(await gunzip(d.gz))); setSyncMeta({ rev:d.rev }); save();
  awaySnap = null; galleryKnown = null; watchPrev = null; wornNow = "";
  closeModal(); syncLook(); syncName(); syncMute(); renderLog(); drawYou();
  if(S.started){ catchUp(false); startGame(); } else show("screen-title");
  syncState = "synced"; syncAt = Date.now();
  toast("🔄 "+msg, 5000);
}
function signIn(kind){
  save();
  location.assign(apiBase()+(kind==="ur" ? "/api/auth/urbit/login" : "/api/auth/login")+"?return="+encodeURIComponent(location.origin+location.pathname));
}
async function signOut(){
  if(acct()){ await syncUp(); save(); }
  S = null; // nothing more gets saved on the way out, or it would land in this browser's own slot
  lsSet(SESSION_KEY, null);
  location.reload(); // and this browser's own network comes back
}
const isShip = h => typeof h==="string" && h[0]==="~";
const URBIT_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.4 13.4c1.2-2.6 2.9-3.3 4.6-2.1l2 1.4c1.7 1.2 3.4.5 4.6-2.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const REMILIA_LOGO = "assets/img/remilia_logo.webp";
/* a verified name: a RemiliaNET account in gold, an Urbit ship in blue */
const whoTag = h => isShip(h) ? '<span class="vtag ur" title="verified Urbit ship">'+URBIT_MARK+'<b>'+esc(h)+'</b></span>'
  : '<a class="vtag rm" href="https://remilia.net/~'+encodeURIComponent(h)+'" target="_blank" rel="noopener" title="verified RemiliaNET account"><img src="'+localFile(REMILIA_LOGO)+'" alt=""><b>~'+esc(h)+'</b></a>';
async function checkNet(){
  if(netOn!==null || !online()) return;
  const r = await api("/api/net/health", null, { ms:6000 });
  netOn = r.status===200 && r.data ? { rn:!!r.data.rn, ur:!!r.data.ur } : { rn:false, ur:false, down:true };
  renderAcctAll();
}
function renderAcct(box){
  if(!box) return;
  if(!online()){ box.innerHTML = ""; return; }
  const a = acct();
  if(a){
    const ago = syncAt ? Math.round((Date.now()-syncAt)/1000) : null;
    box.innerHTML = '<span class="acct-who">✓ signed in as '+whoTag(a.handle)+'</span>'+
      '<span class="note">'+(syncState==="synced" && ago!=null ? "synced "+(ago < 5 ? "just now" : fmtTime(ago)+" ago") : esc(syncState || "syncing…"))+'</span>'+
      '<span class="acct-btns"><button class="btn small acct-sync">sync now</button><button class="btn small acct-out">sign out</button></span>';
    box.querySelector(".acct-sync").onclick = ()=>syncUp();
    box.querySelector(".acct-out").onclick = ()=>{
      openModal('<h2>sign out?</h2><p>your network stays on your account. this device goes back to its own.</p><div class="row"><button class="btn" id="out-yes">sign out</button><button class="btn small" data-close>no</button></div>');
      $("out-yes").onclick = ()=>signOut();
    };
    return;
  }
  if(!netOn || netOn.down || !(netOn.rn || netOn.ur)){ box.innerHTML = netOn && netOn.down ? '<span class="note">accounts can\'t be reached right now.</span>' : ""; return; }
  box.innerHTML = '<div class="sso">'+(netOn.rn ? '<button class="btn sso-btn" data-sso="rn"><img src="'+localFile(REMILIA_LOGO)+'" alt="">Remilia SSO</button>' : "")+
    (netOn.rn && netOn.ur ? "<i>or</i>" : "")+(netOn.ur ? '<button class="btn sso-btn" data-sso="ur">'+URBIT_MARK+'Urbit ID</button>' : "")+'</div>'+
    '<span class="note">sign in to play your network on any device and get on the leaderboards. the same sign-in as the cancel is coming.</span>';
  box.querySelectorAll("[data-sso]").forEach(b=>b.onclick = ()=>signIn(b.dataset.sso));
}
function renderAcctAll(){
  renderAcct($("acct-title")); renderAcct($("acct-set")); renderAcct($("acct-boards"));
  // who's playing, under their milady: there in any screenshot of the game
  const who = $("you-who"), a = online() && acct();
  if(who && who.dataset.h !== (a ? a.handle : "")){ who.dataset.h = a ? a.handle : ""; who.innerHTML = a ? whoTag(a.handle) : ""; }
}

/* ---------- the boards ---------- */
const BOARD_INFO = {
  fastest: ["⚡ fastest run", "quickest to the infinite garden. challenge runs don't count"],
  grass:   ["🌿 most grass", "grass earned while signed in"],
  network: ["🌸 biggest network", "the most miladys at once in one run"],
  online:  ["🌐 first online", "who turned on the new internet first"],
  uptime:  ["♾️ uptime", "the most epochs past the ending, grown while signed in"],
  ch:      ["⚖️ challenges", ""],
  recent:  ["📰 lately", "what's happened on the network lately, newest first"],
};
/* each challenge has a board of its own: its fastest clear */
const boardInfo = k => k.startsWith("ch_") ? ["⚖️ "+byId(CHALLENGES, k.slice(3)).name, "fastest to beat "+byId(CHALLENGES, k.slice(3)).name+": "+byId(CHALLENGES, k.slice(3)).rule.replace(/\.$/, "")] : BOARD_INFO[k];
let boardKey = "fastest", boardCh = CHALLENGES[0].id;
const boardCache = {};
function boardValue(b, r){
  const d = r.detail || {};
  if(b==="fastest" || b.startsWith("ch_")) return ['<b>'+fmtTime(r.value)+'</b>', "run "+d.n+" · "+d.cycles+" cycles · peak "+fmt(d.peak)];
  if(b==="grass") return ['<b>'+fmt(r.value)+' 🌿</b>', d.runs+" runs"];
  if(b==="network") return ['<b>'+fmt(r.value)+' miladys</b>', "run "+d.n];
  if(b==="uptime") return ['<b>'+fmt(r.value)+' epoch'+(r.value===1 ? "" : "s")+'</b>', d.days ? "online "+d.days+" day"+(d.days===1 ? "" : "s") : ""];
  return ['<b>'+new Date(r.value*1000).toLocaleDateString()+'</b>', "day "+d.days+" · run "+d.runs];
}
/* how far it is to the next place up (first online is settled once it happens: nothing to close) */
function boardGap(b, me){
  if(me.rank===1) return "nobody's ahead of you";
  if(me.ahead==null || b==="online") return "";
  const n = Math.abs(me.ahead - me.value), to = " to pass #"+(me.rank-1);
  if(b==="fastest" || b.startsWith("ch_")) return fmtTime(n)+" faster"+to;
  if(b==="uptime") return fmt(n+1)+" more epoch"+(n ? "s" : "")+to;
  if(b==="grass") return fmt(Math.floor(n)+1)+" 🌿 more"+to;
  return fmt(n+1)+" more miladys at once"+to;
}
/* who a player plays as, from the board: only trait files this game has, so a face is never a stray picture */
function boardLook(l){
  if(!l || !l.layers || !ASSETS || !ASSETS[l.cfg]) return null;
  const look = {};
  for(const k in l.layers) if(ASSETS[l.cfg][k] && ASSETS[l.cfg][k].includes(l.layers[k])) look[k] = l.layers[k];
  if(!Object.keys(look).length) return null;
  if(l.eye) look._eye = l.eye;
  return { look, kind:l.cfg==="Remilio" ? "remilio" : "milady" };
}
const boardFace = (l, cls) => { const f = boardLook(l);
  return '<span class="bface '+(cls||"")+'">'+(f ? '<img alt="" data-look="'+esc(JSON.stringify(f))+'">' : '<i>🌸</i>')+'</span>'; };
function buildBoards(body){
  const group = boardKey.startsWith("ch_") ? "ch" : boardKey;
  body.innerHTML = '<div class="boards"><div class="board-pick seg wrap">'+Object.keys(BOARD_INFO).map(k=>'<button class="pick'+(k===group ? " on" : "")+'" data-board="'+k+'">'+BOARD_INFO[k][0]+'</button>').join("")+'</div>'+
    (group==="ch" ? '<div class="board-sub seg wrap">'+CHALLENGES.map(c=>'<button class="pick'+("ch_"+c.id===boardKey ? " on" : "")+'" data-board="ch_'+c.id+'">'+c.name+'</button>').join("")+'</div>' : "")+
    '<p class="note" id="board-what">'+boardInfo(boardKey)[1]+'.</p><div id="board-list">'+(boardKey==="recent" ? feedSkeleton() : boardSkeleton())+'</div>'+
    '<div class="acct-row" id="acct-boards"></div>'+
    '<p class="note">only verified players are on the boards, and only runs started after signing in count. the game runs on your device, so the service checks every save against the last one it took: time can\'t go faster than it does, and everything has to add up.</p></div>';
  body.querySelectorAll("[data-board]").forEach(b=>b.onclick = ()=>{
    const k = b.dataset.board;
    if(k.startsWith("ch_")) boardCh = k.slice(3);
    boardKey = k==="ch" ? "ch_"+boardCh : k; refresh(true); });
  renderAcct($("acct-boards"));
  loadBoard();
}
/* the shape of what's on its way, instead of the word "loading" */
const boardSkeleton = () => '<div class="podium skel" aria-busy="true">'+[2,1,3].map(n=>'<div class="pod p'+n+'"><span class="bface big"></span><b></b><em></em><div class="plinth"></div></div>').join("")+'</div>'+
  '<div class="brows skel">'+'<div class="brow"><i></i><span class="bface"></span><b></b><em></em></div>'.repeat(5)+'</div>';
async function loadBoard(){
  const k = boardKey, c = boardCache[k];
  if(c && Date.now()-c.at < 30000) return k==="recent" ? drawFeed(c.data) : drawBoard(k, c.data);
  const r = await api(k==="recent" ? "/api/net/recent?limit=40" : "/api/net/board?b="+k+"&limit=50"+(acct() ? "&player="+acct().player : ""));
  if(r.status!==200){ if($("board-list") && boardKey===k) $("board-list").innerHTML = '<p class="note">the boards can\'t be reached right now.</p>'; return; }
  boardCache[k] = { at:Date.now(), data:r.data };
  k==="recent" ? drawFeed(r.data) : drawBoard(k, r.data);
}
/* faces fill in as they're put together; the same one is only made once */
function fillFaces(box){
  for(const im of box.querySelectorAll("img[data-look]")){
    const f = JSON.parse(im.dataset.look);
    thumb(f.look, f.kind).then(src=>{ if(im.isConnected){ im.src = src; im.parentNode.classList.add("ready"); } }).catch(()=>{});
  }
}
/* anyone on a board or in the feed opens their card (their name is a link of its own, and still goes where it goes) */
function wireProfiles(box){
  box.querySelectorAll("[data-h]").forEach(e=>{ e.classList.add("tap"); e.tabIndex = 0;
    e.onclick = ev=>{ if(!ev.target.closest("a")) openProfile(e.dataset.h); };
    e.onkeydown = ev=>{ if(ev.key==="Enter" && !ev.target.closest("a")) openProfile(e.dataset.h); }; });
}
const agoShort = at => { const m = Math.max(0, Math.round((Date.now()/1000-at)/60)); return m<1 ? "now" : m<60 ? m+"m" : m<1440 ? Math.round(m/60)+"h" : Math.round(m/1440)+"d"; };
const feedSkeleton = () => '<div class="brows skel" aria-busy="true">'+'<div class="brow"><i></i><span class="bface"></span><b></b><em></em></div>'.repeat(8)+'</div>';
function feedLine(e){
  const d = e.detail || {}, ch = d.ch && byId(CHALLENGES, d.ch);
  if(e.kind==="online") return ["🌐", "turned on the new internet", "after "+d.days+" day"+(d.days===1 ? "" : "s")];
  if(e.kind==="epoch") return ["♾️", "reached "+epochStage(d.e-1).name, "past the ending"];
  if(ch && d.beaten) return ["⚖️", "beat <b>"+ch.name+"</b> in "+fmtTime(d.t), "run "+d.n+" · peak "+fmt(d.peak)+" miladys"];
  return ["🌿", "touched grass after "+fmtTime(d.t)+(ch ? " under "+ch.name : ""), "run "+d.n+" · peak "+fmt(d.peak)+" miladys · +"+fmt(d.grass)+" 🌿"];
}
function drawFeed(d){
  const box = $("board-list"); if(!box || boardKey!=="recent") return;
  if(!d.rows.length){ box.innerHTML = '<p class="note board-empty">nothing yet. finish a run while you\'re signed in and it shows up here.</p>'; return; }
  box.innerHTML = '<div class="brows feed">'+d.rows.map(e=>{ const [ic, what, sub] = feedLine(e);
    return '<div class="brow k-'+e.kind+'" data-h="'+esc(e.handle)+'"><i title="'+esc(new Date(e.at*1000).toLocaleString())+'">'+agoShort(e.at)+'</i>'+boardFace(e.look)+
      '<div class="fwho">'+whoTag(e.handle)+'<span class="what">'+ic+" "+what+'</span><span>'+sub+'</span></div></div>'; }).join("")+'</div>';
  fillFaces(box); wireProfiles(box);
}
function drawBoard(k, d){
  const box = $("board-list"); if(!box || boardKey!==k) return;
  if($("board-what")) $("board-what").innerHTML = boardInfo(k)[1]+"."+(d.total ? ' <b class="board-n">'+d.total+' on this board</b>' : "");
  const MEDAL = ["🥇","🥈","🥉"];
  const pod = n => { const r = d.rows[n-1];
    if(!r) return '<div class="pod p'+n+' open"><span class="bface big"><i>?</i></span><b class="who">open</b><em>could be you</em><div class="plinth">'+n+'</div></div>';
    const [v, sub] = boardValue(k, r);
    return '<div class="pod p'+n+(r.me ? " me" : "")+'" data-h="'+esc(r.handle)+'">'+(n===1 ? '<u class="crown">👑</u>' : "")+boardFace(r.look, "big")+'<s>'+MEDAL[n-1]+'</s>'+
      '<b class="who">'+whoTag(r.handle)+'</b><em>'+v+'</em><span>'+sub+'</span><div class="plinth">'+n+'</div></div>'; };
  const row = r => { const [v, sub] = boardValue(k, r);
    return '<div class="brow'+(r.me ? " me" : "")+'" data-h="'+esc(r.handle)+'"><i>'+r.rank+'</i>'+boardFace(r.look)+'<b>'+whoTag(r.handle)+(r.me ? ' <u>you</u>' : "")+'</b><em>'+v+'<span>'+sub+'</span></em></div>'; };
  const me = d.me, gap = me ? boardGap(k, me) : "";
  const mine = me ? '<div class="board-you'+(me.rank<=3 ? " top" : "")+'"'+(acct() ? ' data-h="'+esc(acct().handle)+'"' : "")+'>'+boardFace(me.look)+
      '<div><u>your standing</u><b>#'+me.rank+' <small>of '+d.total+'</small></b>'+(gap ? '<span>'+gap+'</span>' : "")+'</div>'+
      '<em>'+boardValue(k, Object.assign({ detail:{} }, me, (d.rows.find(r=>r.me)||{})))[0]+'</em></div>' : "";
  box.innerHTML = (d.rows.length ? "" : '<p class="note board-empty">nobody yet. the top spot is open.</p>')+
    '<div class="podium">'+[2,1,3].map(pod).join("")+'</div>'+mine+
    (d.rows.length > 3 ? '<div class="brows">'+d.rows.slice(3).map(row).join("")+'</div>' : "")+
    (d.total > d.rows.length ? '<p class="note">the top '+d.rows.length+' of '+d.total+'.</p>' : "");
  fillFaces(box); wireProfiles(box);
}

/* ---------- a player's card: who they play as, how big their network is, where they stand ---------- */
async function openProfile(handle){
  openModal('<div class="prof skel"><span class="bface big"></span><b></b><em></em></div>');
  const r = await api("/api/net/profile?h="+encodeURIComponent(handle));
  if($("modal").classList.contains("hidden")) return;
  if(r.status!==200){ openModal('<h2>'+whoTag(handle)+'</h2><p class="note">'+(r.status===404 ? "they haven't synced a network yet." : "their card can't be reached right now.")+'</p><div class="row"><button class="btn small" data-close>close</button></div>'); return; }
  const p = r.data, f = boardLook(p.look), K = KINDS[f ? f.kind : "milady"];
  const tile = (label, v, sub) => '<div class="pcell"><u>'+label+'</u><b>'+v+'</b>'+(sub ? '<span>'+sub+'</span>' : "")+'</div>';
  const nn = p.online ? (p.epochs ? "♾️ "+p.epochs : "🌐 on") : p.stage+" / "+NEWNET.length;
  const order = Object.keys(BOARD_INFO).filter(k=>p.ranks[k]).concat(CHALLENGES.map(c=>"ch_"+c.id).filter(k=>p.ranks[k]));
  const relics = RELICS.filter(x=>p.relics[x.id]).sort((a, b)=>p.relics[b.id]-p.relics[a.id]);
  const mine = acct() && acct().handle===p.handle;
  const run = x => { const ch = x.challenge && byId(CHALLENGES, x.challenge);
    return '<div class="prun'+(mine ? " mine" : "")+'"><i>#'+x.n+'</i><b>'+fmtTime(x.t)+'</b><span>peak '+fmt(x.peak||0)+' · +'+fmt(x.grass||0)+' 🌿</span>'+(ch ? '<u class="'+(x.beaten ? "won" : "")+'">'+(x.beaten ? "✅ " : "")+ch.name+'</u>' : "<u></u>")+
      (mine ? '<button class="pshare" data-share-run="'+x.n+'" title="share this run" aria-label="share run '+x.n+'">📸</button>' : "")+'</div>'; };
  openModal('<div class="prof">'+
      '<canvas id="prof-cv" class="portrait" width="'+K.w+'" height="'+K.h+'"></canvas>'+
      '<h2>'+whoTag(p.handle)+(acct() && acct().handle===p.handle ? ' <small class="you-tag">you</small>' : "")+'</h2>'+
      '<p class="note">'+(p.born ? "playing since "+new Date(p.born).toLocaleDateString()+" · " : "")+(agoShort(p.saved)==="now" ? "synced just now" : "last synced "+agoShort(p.saved)+" ago")+(p.online ? " · 🌐 online since "+new Date(p.online).toLocaleDateString() : "")+'</p>'+
      '<div class="pgrid">'+tile("network", fmt(p.miladys), "miladys now")+tile("runs", fmt(p.runs), "touched grass")+tile("played", fmtTime(p.played))+
        tile("grass", fmt(p.grass), "earned signed in")+tile("new internet", nn, p.online ? (p.epochs ? "epochs past the end" : "online") : "stages")+tile("achievements", p.ach+" / "+ACHIEVEMENTS.length)+'</div>'+
      (order.length ? '<div class="box-h">on the boards</div><div class="pranks">'+order.map(k=>{ const x = p.ranks[k];
        return '<button class="prank'+(x.rank<=3 ? " top r"+x.rank : "")+'" data-pb="'+k+'"><i>'+(x.rank<=3 ? ["🥇","🥈","🥉"][x.rank-1] : "#"+x.rank)+'</i><b>'+boardInfo(k)[0]+'</b><span>'+boardValue(k, Object.assign({ detail:{} }, x))[0]+' · of '+x.total+'</span></button>'; }).join("")+'</div>' : "")+
      (relics.length ? '<div class="box-h">relics <span>'+relics.length+' of '+RELICS.length+'</span></div><div class="prelics">'+relics.map(x=>'<span title="'+esc(x.name)+'">'+x.icon+(p.relics[x.id]>1 ? '<sub>'+p.relics[x.id]+'</sub>' : "")+'</span>').join("")+'</div>' : "")+
      (p.last.length ? '<div class="box-h">last runs</div><div class="pruns">'+p.last.map(run).join("")+'</div>' : "")+
    '</div><div class="row">'+(mine ? '<button class="btn small" id="prof-share">📸 share your network</button>' : "")+'<button class="btn small" data-close>close</button></div>');
  if($("prof-share")) $("prof-share").onclick = ()=>shareCard("net");
  $("modal-panel").querySelectorAll("[data-pb]").forEach(b=>b.onclick = ()=>{
    const k = b.dataset.pb; if(k.startsWith("ch_")) boardCh = k.slice(3);
    boardKey = k; closeModal(); if(tab!=="boards"){ tab = "boards"; } refresh(true); });
  if(f) compose(f.look, false, f.kind).then(cv=>{ const c = $("prof-cv"); if(c) c.getContext("2d").drawImage(cv, 0, 0); }).catch(()=>{});
}

/* ---------- sharing: a card of your network, a run, or the ending, drawn by the service from what it holds ---------- */
const shareBtn = n => '<button class="ln-share" data-share-run="'+n+'">share it 📸</button>';
document.addEventListener("click", e=>{ const b = e.target.closest("[data-share-run]"); if(b){ e.stopPropagation(); shareCard("run", +b.dataset.shareRun); } });
async function synced(){ // the service has to have it before it can put it on a card
  for(let i=0; syncing && i<40; i++) await new Promise(r=>setTimeout(r, 250));
  await syncUp();
}
const SITE_URL = "https://clicker.tylerirl.com/";
async function shareCard(kind, n){
  const a = acct();
  if(!a || !online()){ // no account, no card: the words and the game
    const text = kind==="online" ? "i turned on the new internet" : kind==="run" ? "i touched grass in the network is growing" : "my network is growing: "+fmt(S.miladys.length)+" miladys";
    return shareSheet({ text, share:SITE_URL }, '<p class="note">sign in and your share comes with a card: your milady, your network and where you stand on the boards.</p>');
  }
  openModal('<h2>share</h2><div class="share-card skel"><i></i></div><p class="note" id="share-note">making your card…</p>');
  await synced();
  const r = await api("/api/net/card", { session:a.token, kind, n });
  if($("modal").classList.contains("hidden") || !$("share-note")) return;
  if(r.status!==200) return $("share-note").textContent = r.status===429 ? "that's a lot of cards. try again in a bit." : r.status===404 ? "the service doesn't have that yet. try again in a minute." : "the card can't be made right now.";
  shareSheet(r.data);
}
function shareSheet(d, extra){
  const text = d.text+" "+d.share, x = "https://x.com/intent/post?text="+encodeURIComponent(d.text)+"&url="+encodeURIComponent(d.share);
  openModal('<h2>share</h2>'+(d.image ? '<div class="share-card"><img id="share-img" alt="your share card" src="'+esc(d.image)+'"></div>' : "")+(extra||"")+
    '<div class="share-text">'+esc(text)+'</div>'+
    '<div class="row share-row">'+(navigator.share ? '<button class="btn small" id="sh-native">share…</button>' : "")+
      '<a class="btn small" href="'+esc(x)+'" target="_blank" rel="noopener">post to 𝕏</a><button class="btn small" id="sh-copy">copy link</button>'+
      (d.image ? '<button class="btn small" id="sh-save">save card</button>' : "")+'<button class="btn small" data-close>close</button></div>');
  const img = $("share-img"); if(img) img.onload = ()=>img.parentNode.classList.add("ready");
  const blob = ()=> d.image ? fetch(d.image).then(r=>r.ok ? r.blob() : null).catch(()=>null) : Promise.resolve(null);
  $("sh-copy").onclick = async ()=>{ try{ await navigator.clipboard.writeText(text); toast("📋 copied"); }catch(e){ toast("couldn't copy. the link is "+esc(d.share), 6000); } };
  if($("sh-save")) $("sh-save").onclick = async ()=>{
    const b = await blob(); if(!b) return toast("the card can't be saved right now");
    const u = URL.createObjectURL(b), l = document.createElement("a"); l.href = u; l.download = "the-network-is-growing-"+d.id+".png"; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(()=>URL.revokeObjectURL(u), 5000); };
  if($("sh-native")) $("sh-native").onclick = async ()=>{ // on a phone: the card itself goes with it, where that's allowed
    const b = await blob(), file = b && new File([b], "the-network-is-growing.png", { type:"image/png" });
    try{ await navigator.share(Object.assign({ text:d.text, url:d.share }, file && navigator.canShare && navigator.canShare({ files:[file] }) ? { files:[file] } : {})); }catch(e){}
  };
}

/* ---------- the app: installs, and plays offline ---------- */
let installPrompt = null;
const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone===true;
function registerSW(){
  if(!("serviceWorker" in navigator) || window.INLINE_FILES || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").then(reg=>{ SWREG = reg; if(standalone()) keepOffline(true); }).catch(()=>{});
  addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); installPrompt = e; });
  addEventListener("appinstalled", ()=>{ installPrompt = null; toast("🌸 installed. it plays offline too."); keepOffline(true); });
}
/* every trait picture, so new miladys look right with no connection (about 11 MB, once) */
let offlineState = "";
async function keepOffline(quietly){
  if(!window.caches || !ASSETS || offlineState==="busy") return;
  const urls = [];
  for(const cfg in ASSETS.order) for(const layer in ASSETS[cfg]) for(const name of ASSETS[cfg][layer]) urls.push("assets/img/"+cfg+"/"+layer+"/"+name);
  try{
    const c = await caches.open("network-assets");
    const have = new Set((await c.keys()).map(r=>decodeURIComponent(new URL(r.url).pathname)));
    const want = urls.filter(u=>!have.has(decodeURIComponent(new URL(u, location.href).pathname)));
    if(!want.length){ offlineState = "done"; if(!quietly) toast("every picture's already kept"); return; }
    offlineState = "busy";
    for(let i=0; i<want.length; i+=12){
      await Promise.all(want.slice(i, i+12).map(u=>c.add(u).catch(()=>{})));
      if($("set-offline")) $("set-offline").textContent = "keeping… "+Math.round((i+12)/want.length*100)+"%";
    }
    offlineState = "done";
    if(!quietly) toast("📦 every picture kept. it plays offline now.");
    if($("set-offline")) $("set-offline").textContent = "kept ✓";
  }catch(e){ offlineState = ""; if(!quietly) toast("couldn't keep them all. try again with a connection."); }
}

/* ---------- ambient: the network at work, for a screen left up all day (js/ambient.js) ---------- */
const AMBIENT_AFTER = { off:0, "1":60, "3":180, "10":600 };
let lastActive = Date.now();
function ambientCheck(){
  const wait = AMBIENT_AFTER[S && S.settings.ambient || "3"];
  if(!wait || !S || !S.started || AMBIENT.on || document.hidden || $("ending") || !$("screen-main").classList.contains("active")) return;
  if(Date.now() - lastActive > wait*1000){ closeModal(); hideTip(); AMBIENT.start(); }
}
function ambientBack(){ lastActive = Date.now(); refresh(true); }

/* ---------- the ending ---------- */
function showEnding(){
  if($("ending")) return;
  S.endSeen = true; save(); syncName();
  closeModal(); FX.ending(true); sfx.shiny();
  const n = netName(), runs = resets(S)+1, met = S.nextId-1;
  const lines = [
    "you started alone, posting.",
    "then someone else was there.",
    "then a group chat. then a scene. then a movement.",
    "you touched grass "+resets(S)+" time"+(resets(S)===1 ? "" : "s")+", and came back every time.",
    "the old internet was a place you went.",
    "this one is a place you are.",
    "no center. no owner. nobody can log it off.",
    esc(n)+" isn't growing any more.",
    "it's grown.",
  ];
  const ov = el("div", "ending");
  ov.id = "ending";
  ov.innerHTML = '<div class="end-in">'+lines.map((l,i)=>'<p style="--d:'+(0.6+i*2.1)+'s">'+l+'</p>').join("")+
    '<h1 style="--d:'+(0.6+lines.length*2.1+0.6)+'s">the new internet is online<span class="cursor">_</span></h1>'+
    (online() && acct() ? '<div class="end-who" style="--d:'+(0.6+lines.length*2.1+1.6)+'s">'+whoTag(acct().handle)+'</div>' : "")+
    '<div class="end-stats" style="--d:'+(0.6+lines.length*2.1+2.2)+'s">'+
      [["day", dayCount()], ["runs", runs], ["market cycles", fmt(S.stats.cycles)], ["posts", fmt(S.stats.clicks)], ["miladys met", fmt(met)], ["relics", Object.keys(S.relics).length+" / "+RELICS.length], ["played", fmtTime(S.stats.played)]]
        .map(([k,v])=>'<div><span>'+k+'</span><b>'+v+'</b></div>').join("")+'</div>'+
    '<div class="end-credits" style="--d:'+(0.6+lines.length*2.1+3.4)+'s"><p>made by <a href="https://tylerirl.com/" target="_blank" rel="noopener">tyler (in real life)</a> · trait art: remilia corporation, copyleft · not affiliated</p>'+
      '<p>the network was always going to be infinite. thank you for growing it.</p>'+
      '<div class="row"><button class="btn big" id="end-stay">keep posting</button><button class="btn small" id="end-share">share it 📸</button><a class="btn small" href="https://cancel.tylerirl.com/">play the cancel is coming ↗</a></div></div>'+
    '<button class="btn small end-skip" id="end-skip">skip</button></div>';
  document.body.appendChild(ov);
  const close = ()=>{ ov.classList.add("out"); FX.ending(false); setTimeout(()=>ov.remove(), 900); refresh(true); };
  $("end-stay").onclick = close;
  $("end-share").onclick = ()=>{ close(); shareCard("online"); };
  $("end-skip").onclick = ()=>{ ov.classList.add("skip"); $("end-skip").remove(); };
  ov.querySelector('a[href*="cancel"]').addEventListener("click", save);
}

async function init(){
  try{ await loadAssets(); }catch(e){ console.warn("assets", e); }
  try{ localStorage.removeItem("network-backup-v1"); }catch(e){} // the old "go back to before you touched grass": gone with accounts
  const ret = online() ? authReturn() : null;
  S = load();
  let note = ret && ret.error ? esc(ret.error) : ret && ret.fresh ? "✓ signed in as "+(isShip(acct().handle) ? "" : "~")+esc(acct().handle)+"." : "";
  if(acct() && online()){ const m = await pullAccount(); if(m) note = (note ? note+" " : "")+m; }
  if(!S){ S = fresh(); }
  if(!S.seenInit){ R = rates(S); markAllSeen(); S.seenInit = true; }
  syncLook(); syncName(); FX.start();
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
  $("clock").onclick = ()=>{ commitSeen(); tab = "stats"; refresh(true); };
  document.querySelectorAll(".help").forEach(b=>b.onclick = openHelp);
  document.querySelectorAll(".mute").forEach(b=>b.onclick = ()=>{ S.settings.mute = !S.settings.mute; syncMute(); });
  document.querySelectorAll(".fs").forEach(b=>b.onclick = ()=>{
    if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(()=>{});
  });
  whoControls($("who-title"));
  $("btn-logon").onclick = ()=>{ S.started = true; S.last = Date.now(); save(); startGame(); };
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden){ save(); syncUp(true); } else { raidBack = false; if(S.started && awaySnap){ catchUp(false); refresh(true); } frame(); setTitle(); } });
  registerSW();
  window.addEventListener("pagehide", save);
  document.querySelectorAll('a[href*="cancel.tylerirl.com"]').forEach(a=>a.addEventListener("click", save)); // off to the other game: save on the way out

  if(S.started){ catchUp(); startGame(); }
  else { show("screen-title"); drawYou(); }
  setInterval(frame, 150);
  setInterval(faceTick, 100); warmFaces();
  setInterval(ambientCheck, 1000);
  for(const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, ()=>{ lastActive = Date.now(); }, { passive:true, capture:true });
  document.querySelectorAll(".tv").forEach(b=>b.onclick = e=>{ e.stopPropagation(); AMBIENT.start(); });
  for(const ev of ["pointerdown", "keydown"]) addEventListener(ev, ()=>{ lastTouch = Date.now(); }, { passive:true });
  checkVersion(); setInterval(checkVersion, 5*60*1000);
  checkNet().then(()=>{ // a shared link brings people here with ?p=handle: open that player's card
    const p = new URLSearchParams(location.search).get("p");
    if(!p || !netOn || netOn.down) return;
    try{ history.replaceState(null, "", location.pathname); }catch(e){}
    openProfile(p);
  });
  renderAcctAll();
  if(note) toast(note, 5000);
  if(acct()){ setTimeout(()=>syncUp(), 3000); setInterval(()=>syncUp(), 60*1000); setInterval(renderAcctAll, 15*1000); }
}
init();
