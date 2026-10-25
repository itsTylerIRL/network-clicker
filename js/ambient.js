/* the network is growing: ambient mode. For a screen the game is left up on (a side monitor, all day): when nobody
   has touched anything for a while, or from the 📺 button, the game steps aside and the network is shown at work.

   Every milady and remilio is drawn whole from her trait layers, no background, standing with the others on her job
   around you. Each crowd makes its resource, which flies down into the strip along the bottom; vibes fly back out to
   feed everyone; whatever gets spent (by you, the robots, or poured into the new internet) leaves the strip in a
   burst. Mods send hearts, the idle doze, raiders are off at the edge, newcomers pop in, the feed runs as a ticker,
   and the clock is the real one (it glows softly as each hour turns). The whole picture drifts a few pixels, slowly, so a screen that's always on doesn't
   wear an image in. Any key, click or real movement of the mouse brings the game back. */
const AMBIENT = (()=>{
  const JOB_COL = { poster:"#ff79c6", memer:"#50fa7b", keeper:"#bd93f9", trader:"#f1fa8c", artist:"#8be9fd", streamer:"#ffb86c", mod:"#ffffff",
    dev:"#a6e3ff", acolyte:"#ffd27f", seer:"#c3a6ff", idle:"#8a8f70", away:"#ff5555" };
  const SHOW_MAX = 36;        // drawn per crowd; the rest are a "+n"
  const FONT = "'Share Tech Mono','JetBrains Mono',monospace";
  let on = false, cv = null, cx = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, t0 = 0, frameN = 0, moved = 0, lock = null;
  let parts = [], rings = [], agents = new Map(), crowds = [], bars = {}, lastRes = {}, ticker = { text:"", at:0 }, seenIds = null, cards = [];

  /* ---------- a whole milady, small, from her layers (no background) ---------- */
  const sprites = new Map(); // look key -> canvas (or "busy")
  function sprite(m){
    const kind = m.kind || "milady", K = KINDS[kind], key = kind + JSON.stringify(m.look);
    const got = sprites.get(key);
    if(got && got !== "busy") return got;
    if(!got){
      sprites.set(key, "busy");
      const layers = K.order.filter(l=>m.look[l] && l!=="Background");
      Promise.all(layers.map(l=>loadImg("assets/img/"+K.cfg+"/"+l+"/"+m.look[l]).catch(()=>null))).then(ims=>{
        const c = document.createElement("canvas"), w = 96, h = Math.round(w*K.h/K.w);
        c.width = w; c.height = h;
        const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
        for(const im of ims) if(im) g.drawImage(im, 0, 0, w, h);
        sprites.set(key, c);
      });
      if(sprites.size > 1500) for(const k of [...sprites.keys()].slice(0, 300)) sprites.delete(k); // a long day of arrivals
    }
    return null;
  }
  /* emoji and the coin, drawn once each and reused */
  const glyphs = new Map();
  function glyph(id, px){
    const k = id+"|"+px; if(glyphs.has(k)) return glyphs.get(k);
    const c = document.createElement("canvas"); c.width = c.height = px*2;
    const g = c.getContext("2d");
    const r = RES_BY[id];
    if(r && r.icon==="coin"){ const im = new Image(); im.src = COIN; im.onload = ()=>g.drawImage(im, px*0.4, px*0.4, px*1.2, px*1.2); }
    else { g.font = px+"px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(r ? r.icon : id, px, px*1.1); }
    glyphs.set(k, c); return c;
  }

  /* ---------- where everyone stands ----------
     A wide screen gets a ring of crowds around you; a tall one gets you at the top and the crowds in a grid below.
     Each crowd has a slot, and its people are sized (and, if need be, fewer shown) to fit it. */
  let ui = 1, you = { x:0, y:0, s:100 }, spr = 56, wide = true, clock = 0;
  /* where a crowd is right now: the ring turns once every ten minutes; a grid sways where it stands */
  const LAP = 600;
  function crowdAt(c, t){
    if(c.a0 != null){ const a = c.a0 + t/LAP*Math.PI*2; c.x = you.x + Math.cos(a)*c.rx; c.y = you.y + Math.sin(a)*c.ry - 10*ui; }
    else { c.x = c.bx + Math.sin(t*0.13 + c.i)*8; c.y = c.by + Math.cos(t*0.11 + c.i*1.7)*5; }
    return c;
  }
  function layout(){
    const jobs = JOBS.filter(j=>R.jobs[j.id] > 0).map(j=>({ id:j.id, n:R.jobs[j.id], label:j.icon+" "+j.name+"s", res:j.res }));
    if(R.jobs.idle) jobs.push({ id:"idle", n:R.jobs.idle, label:"💤 idle", res:null });
    if(R.jobs.away) jobs.push({ id:"away", n:R.jobs.away, label:"⚔️ out raiding", res:null });
    ui = Math.max(0.62, Math.min(1, W/1000, H/680));
    // the strip along the bottom: full slots if there's room, compact ones (and two rows) if not
    const shown = RES.filter(r=>isVisible(r.id));
    let perRow = shown.length, slotW = (W - 32)/perRow;
    const compact = slotW < 150;
    if(slotW < 66){ perRow = Math.ceil(shown.length/2); slotW = (W - 32)/perRow; }
    const barH = compact ? 40 : 56, rowsN = Math.ceil(shown.length/perRow), stripTop = H - 18 - rowsN*(barH + 6);
    bars = {};
    shown.forEach((r, i)=>{ const row = Math.floor(i/perRow), col = i % perRow, inRow = Math.min(perRow, shown.length - row*perRow), x0 = (W - inRow*slotW)/2;
      bars[r.id] = { x:x0 + col*slotW + 3, y:stripTop + row*(barH + 6), w:slotW - 6, h:barH, compact, pulse:0 }; });
    const top = 112*ui + 14, bottom = stripTop - 34*ui; // under the corner text, over the ticker and the strip
    const k = jobs.length || 1; wide = W/(bottom - top) > 1.15;
    if(wide){
      you.s = Math.min(W, bottom - top)*0.26; you.x = W/2; you.y = (top + bottom)/2;
      const rx = W/2 - Math.min(W*0.13, 170), ry0 = (bottom - top)/2;
      const slotW2 = Math.min(W*0.24, 2*Math.PI*(rx + ry0)/2/k*0.82), slotH = Math.min((bottom - top)*0.26, 2*Math.PI*ry0/k*0.62); // the crowds up the sides are as close as the ring is short
      const ry = ry0 - slotH/2 - 22*ui; // the top and bottom crowds, labels and all, stay inside
      crowds = jobs.map((c, i)=>Object.assign(c, { a0:-Math.PI/2 + (i + (k===1 ? 0 : 0.5))/k*Math.PI*2, rx, ry, sw:slotW2, sh:slotH, i })); // a crowd on its own starts above you
    } else {
      you.s = Math.min(W*0.34, (bottom - top)*0.18); you.x = W/2; you.y = top + you.s*0.62;
      const cols = W < 520 ? 2 : 3, rows = Math.ceil(k/cols), gTop = you.y + you.s*0.75, cw = (W - 24)/cols, ch = (bottom - gTop)/Math.max(1, rows);
      crowds = jobs.map((c, i)=>Object.assign(c, { bx:12 + (i % cols + 0.5)*cw, by:gTop + (Math.floor(i/cols) + 0.45)*ch, sw:cw*0.92, sh:ch - 44*ui, i }));
    }
    // one spr for everyone, from the crowd that most needs the room
    const need = Math.max(1e-9, ...crowds.map(c=>Math.min(SHOW_MAX, c.n)/(c.sw*Math.max(10, c.sh))));
    spr = Math.max(22, Math.min(66, Math.sqrt(1/(need*0.62*0.55))));
    for(const c of crowds) crowdAt(c, clock);
  }
  function place(){
    const byCrowd = {};
    for(const m of S.miladys){
      const c = m.away ? "away" : m.job || "idle";
      (byCrowd[c] = byCrowd[c] || []).push(m);
    }
    const keep = new Set(), cw = spr*0.62, rh = spr*0.55;
    for(const c of crowds){
      const all = byCrowd[c.id] || [];
      const cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(Math.min(SHOW_MAX, all.length)*1.6)), Math.floor(c.sw/cw)));
      const fit = cols*Math.max(1, Math.floor(Math.max(10, c.sh)/rh));
      const list = all.slice(-Math.min(SHOW_MAX, fit));
      c.more = all.length - list.length;
      const rows = Math.ceil(list.length/cols);
      c.w = Math.min(cols, list.length)*cw; c.h = rows*rh;
      list.forEach((m, i)=>{
        keep.add(m.id);
        const col = i % cols, row = Math.floor(i/cols);
        const ox = -c.w/2 + (col + 0.5)*cw + (row%2 ? cw*0.25 : 0), oy = -c.h/2 + (row + 0.5)*rh + spr*0.4;
        let a = agents.get(m.id);
        if(!a){ a = { m, x:c.x + ox, y:c.y + oy, ph:Math.random()*6.28, born:seenIds && !seenIds.has(m.id) ? 1 : 0, hop:0, face:1 }; agents.set(m.id, a);
          if(a.born) rings.push({ x:a.x, y:a.y, r:6, a:0.9, c:JOB_COL[c.id] }); }
        if(a.crowd && a.crowd !== c.id) a.trip = null; // changed jobs: walks straight to the new crowd
        a.m = m; a.ox = ox; a.oy = oy; a.crowd = c.id; a.size = spr;
      });
    }
    for(const id of [...agents.keys()]) if(!keep.has(id)) agents.delete(id);
    seenIds = new Set(S.miladys.map(m=>m.id));
  }

  /* ---------- things in the air ---------- */
  function fly(from, to, id, o){
    o = o || {};
    parts.push({ x0:from.x, y0:from.y, x1:to.x, y1:to.y, p:0, d:o.d || 1.3 + Math.random()*0.7, id, px:o.px || 16,
      arc:o.arc!=null ? o.arc : -60 - Math.random()*80, onDone:o.onDone, alpha:o.alpha || 1, txt:o.txt });
  }
  const barPt = id => { const b = bars[id]; return b ? { x:b.x + 14, y:b.y + 12 } : null; };
  /* the camera: where it's looking (in the world) and how close; world to screen through it, plus the slow drift */
  const cam = { x:0, y:0, z:1, tx:0, ty:0, tz:1, until:0, focus:null, spot:null, lastFocus:"" };
  let drift = { x:0, y:0 };
  const toScreen = (x, y) => ({ x:(x - cam.x)*cam.z + W/2 + drift.x, y:(y - cam.y)*cam.z + H/2 + drift.y });
  const crowdOf = id => crowds.find(c=>c.id===id);
  const homeOf = a => { const c = crowdOf(a.crowd); return c ? { x:c.x + a.ox, y:c.y + a.oy } : { x:a.x, y:a.y }; };
  /* things to say: remilia, by the market and by the job. CULT is "cult morning", or afternoon or night, by the real clock */
  const SAY = {
    any:   ["CULT", "CULT", "don't worry about it", "1000 year forever", "network spirituality", "post-authorship", "trust the network",
            "yes milady", "milady", "remilia", "touch grass", "the network is growing", "neochibi", "beautiful", "♡", "🌸"],
    accum: ["building", "early", "comfy", "network spirituality"],
    mania: ["1000 year forever", "🚀", "milady season", "it's happening", "up only"],
    dist:  ["taking profits", "👀", "don't worry about it", "rotating"],
    bear:  ["don't worry about it", "still posting", "the network holds", "📉", "it's so over"],
    job: { poster:["posting", "brb posting", "post-authorship"], memer:["🐸", "new meme", "kek"], keeper:["read this", "📜", "lore"], trader:["chart", "📈", "longing"],
           artist:["🎨", "drip", "new piece"], streamer:["live!", "📣", "chat?"], mod:["be nice", "🛡️", "no drama"], dev:["shipped", "⌨️", "it compiles"],
           acolyte:["🕯️", "network spirituality", "blessed"], seer:["i see it", "🔮", "1000 year forever"], idle:["zzz", "💤", "5 more min"], away:["⚔️", "raiding", "brb"] },
  };
  const cult = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? "cult morning" : h >= 12 && h < 18 ? "cult afternoon" : "cult night"; };
  const line = t => t==="CULT" ? cult() : t;
  const say = a => { const pool = SAY.any.concat(SAY[R.phase.id]||[], SAY[R.phase.id]||[], SAY.job[a.crowd]||[]); return line(pool[Math.floor(Math.random()*pool.length)]); };
  const pick = list => list[Math.floor(Math.random()*list.length)];
  let spawnAcc = {}, tripAcc = 0, sayAcc = 0;
  function spawn(dt){
    const all = [...agents.values()];
    // each crowd sends its resource down to the strip, more of it the more they make (on a log scale, so it reads)
    for(const c of crowds){
      if(!c.res || !bars[c.res]) continue;
      const share = R.prod[c.res] > 0 ? R.prod[c.res] : 0;
      const per = Math.min(5, 0.4 + Math.log10(1 + share)*0.9);
      spawnAcc[c.id] = (spawnAcc[c.id] || 0) + per*dt;
      while(spawnAcc[c.id] >= 1){
        spawnAcc[c.id] -= 1;
        const a = pick(all.filter(a=>a.crowd===c.id && !a.trip)); if(!a) break;
        a.hop = 1;
        fly(toScreen(a.x, a.y - a.size*0.4), barPt(c.res), c.res, { onDone:()=>{ bars[c.res] && (bars[c.res].pulse = 1); } });
      }
    }
    // and vibes go back out to everyone at home: they eat
    if(R.eat > 0 && bars.vibes){
      spawnAcc._eat = (spawnAcc._eat || 0) + Math.min(4, 0.3 + Math.log10(1 + R.eat))*dt;
      while(spawnAcc._eat >= 1){
        spawnAcc._eat -= 1;
        const a = pick(all.filter(a=>a.crowd!=="away")); if(!a) break;
        fly(barPt("vibes"), toScreen(a.x, a.y - a.size*0.3), "vibes", { px:11, alpha:0.7, arc:-40 });
      }
    }
    // mods keep the peace
    const mods = all.filter(a=>a.crowd==="mod");
    if(mods.length && Math.random() < dt*Math.min(3, mods.length*0.3)){ const a = pick(mods); parts.push({ float:true, world:true, x:a.x, y:a.y - a.size*0.9, vy:-22, life:1.6, txt:"💗", px:14 }); }
    // someone gets up: to visit another crowd, or to bring you some of what they make
    tripAcc += dt;
    const out = all.filter(a=>a.trip).length, most = Math.min(8, 1 + Math.floor(all.length/12));
    if(tripAcc > 1.6 + Math.random()*2 && out < most){
      tripAcc = 0;
      const a = pick(all.filter(a=>!a.trip && !a.born && a.crowd!=="away"));
      const c = a && crowdOf(a.crowd);
      if(a && c){
        const others = crowds.filter(o=>o.id!==c.id && o.id!=="away");
        if(c.res && (Math.random() < 0.4 || !others.length)){
          const sx = (Math.random() - 0.5)*you.s*0.8;
          a.trip = { kind:"gift", res:c.res, stage:"go", to:()=>({ x:you.x + sx, y:you.y + you.s*0.55 }) };
        } else if(others.length){
          const o = pick(others), dx = (Math.random() - 0.5)*0.7, id = o.id;
          a.trip = { kind:"visit", stage:"go", to:()=>{ const q = crowdOf(id); return q ? { x:q.x + dx*q.w, y:q.y + q.h*0.5 + spr*0.45 } : homeOf(a); } };
        }
      }
    }
    // and people talk
    sayAcc += dt;
    if(sayAcc > 0.9 + Math.random()*1.6 && all.length){ sayAcc = 0; const a = pick(all.filter(a=>!a.say)); if(a) a.say = { txt:say(a), life:2.8 }; }
  }
  /* walking: a few steps' bounce, facing the way they're going; at the far end a moment's stop, then home */
  function walk(a, dt){
    const tr = a.trip, goal = tr.stage==="back" ? homeOf(a) : tr.to();
    if(tr.stage==="stay"){ tr.wait -= dt; if(tr.wait <= 0) tr.stage = "back"; return; }
    const dx = goal.x - a.x, dy = goal.y - a.y, d = Math.hypot(dx, dy), step = 75*ui*dt;
    if(Math.abs(dx) > 1) a.face = dx < 0 ? -1 : 1;
    a.walking = d > 2;
    if(d <= step){
      a.x = goal.x; a.y = goal.y; a.walking = false;
      if(tr.stage==="back"){ a.trip = null; return; }
      tr.stage = "stay"; tr.wait = 2 + Math.random()*1.5;
      if(tr.kind==="gift"){
        fly(toScreen(a.x, a.y - a.size*0.5), toScreen(you.x, you.y), tr.res, { d:0.7, arc:-40, px:16 });
        if(typeof react==="function" && Math.random() < 0.5) react("buy");
        a.say = { txt:line(pick(["for you ♡", "made this", "🎁", "CULT", "don't worry about it"])), life:2.4 };
      } else a.say = { txt:line(pick(["CULT", "hi frens", "visiting", "👋", "network spirituality", "trust the network"])), life:2.4 };
      return;
    }
    a.x += dx/d*step; a.y += dy/d*step;
  }
  /* the camera: the whole network for a while, then close on one crowd and someone in it, then back out */
  function camera(dt, t){
    const calmNow = S.settings.calm;
    if(t > cam.until || calmNow){
      if(cam.focus || calmNow || !crowds.length){ cam.focus = null; cam.spot = null; cam.tx = W/2; cam.ty = H/2; cam.tz = 1; cam.until = t + (calmNow ? 1 : 20 + Math.random()*10); }
      else {
        const choices = crowds.filter(c=>c.id!==cam.lastFocus && c.id!=="away"), c = pick(choices.length ? choices : crowds);
        const people = [...agents.values()].filter(a=>a.crowd===c.id);
        cam.focus = c.id; cam.lastFocus = c.id; cam.spot = people.length ? pick(people).m.id : null;
        cam.tz = Math.min(1.9, Math.max(1.3, (W*0.42)/Math.max(140, c.w + 60))); cam.until = t + 11 + Math.random()*4;
      }
    }
    const c = cam.focus && crowdOf(cam.focus);
    if(c){ cam.tx = c.x; cam.ty = c.y + c.h*0.2; }
    const k = Math.min(1, dt*0.55);
    cam.x += (cam.tx - cam.x)*k; cam.y += (cam.ty - cam.y)*k; cam.z += (cam.tz - cam.z)*k;
  }
  /* whatever went down since last look, beyond what the network eats, was spent: it leaves the strip in a burst,
     toward the new internet while it's being poured into, otherwise toward you */
  function spent(){
    for(const id in bars){
      const was = lastRes[id], now = S.res[id];
      lastRes[id] = now;
      if(was == null) continue;
      const drop = was - now - (id==="vibes" ? R.eat*0.5 : 0);
      if(drop > Math.max(1, R.cap[id]*0.01)){
        const n = Math.min(10, 2 + Math.floor(Math.log10(1 + drop)));
        const to = toScreen(you.x, you.y); // spent toward you (and into the new internet's ring round you, while it pours)
        for(let i=0; i<n; i++) fly(barPt(id), to, id, { d:0.9 + Math.random()*0.6, arc:-120 - Math.random()*80, px:14 });
      }
    }
  }
  const nnSink = () => nnOpen(S) && S.nn.on ? { x:you.x, y:you.y } : null;

  /* ---------- drawing ---------- */
  const rgbOf = h => [1, 3, 5].map(i=>parseInt(h.slice(i, i+2), 16));
  const mixCol = (a, b, k) => { const x = rgbOf(a), y = rgbOf(b); return "rgb("+x.map((v, i)=>Math.round(v + (y[i] - v)*k)).join(",")+")"; };
  const hexA = (h, a) => "rgba("+rgbOf(h).join(",")+","+a+")";
  function text(s, x, y, o){
    o = o || {};
    cx.font = (o.bold ? "bold " : "")+(o.px || 12)+"px "+FONT; cx.textAlign = o.align || "left"; cx.textBaseline = o.base || "alphabetic";
    cx.fillStyle = o.col || "#cfd8dc"; if(o.glow){ cx.shadowColor = o.glow; cx.shadowBlur = o.blur || 12; }
    cx.fillText(s, x, y); cx.shadowBlur = 0;
  }
  function draw(dt, t){
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    // a soft dark wash so the crowd reads over the backdrop's network (which carries on underneath)
    const g = cx.createRadialGradient(W/2, H*0.45, 0, W/2, H*0.45, Math.max(W, H)*0.7);
    g.addColorStop(0, "rgba(0,0,0,0.15)"); g.addColorStop(1, "rgba(0,0,0,0.65)");
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    drift = { x:Math.sin(t/97)*7, y:Math.cos(t/113)*5 }; // the slow drift, against burn-in
    const ph = R.phase;
    for(const c of crowds) crowdAt(c, t);
    camera(dt, t);
    // the world, through the camera
    cx.setTransform(dpr*cam.z, 0, 0, dpr*cam.z, dpr*(W/2 + drift.x - cam.x*cam.z), dpr*(H/2 + drift.y - cam.y*cam.z));

    // you, in the middle (dozing, most likely: nobody's touched anything)
    const me = document.getElementById("you"), ys = you.s, yx = you.x, yy = you.y;
    cx.save(); cx.shadowColor = ph.color; cx.shadowBlur = 30 + Math.sin(t*1.3)*10;
    cx.beginPath(); cx.arc(yx, yy, ys*0.62, 0, 7); cx.fillStyle = "rgba(0,0,0,0.35)"; cx.fill(); cx.restore();
    if(me) cx.drawImage(me, yx - ys/2, yy - ys*0.62, ys, ys*1.25);
    // the threads from you to every crowd, with signals running down them
    for(const c of crowds){
      cx.strokeStyle = "rgba(139,233,253,0.10)"; cx.lineWidth = 1/cam.z;
      cx.beginPath(); cx.moveTo(yx, yy); cx.lineTo(c.x, c.y); cx.stroke();
      const p = (t*0.35 + c.i*0.137) % 1;
      cx.fillStyle = JOB_COL[c.id] || "#fff"; cx.globalAlpha = 0.7;
      cx.beginPath(); cx.arc(yx + (c.x - yx)*p, yy + (c.y - yy)*p, 2, 0, 7); cx.fill(); cx.globalAlpha = 1;
    }
    // the new internet, while it's being poured into: a ring round you that fills
    const sink = nnSink();
    if(sink){
      const st = nnStage(S), need = Object.keys(st.need), done = need.reduce((a, k)=>a + Math.min(1, (S.nn.got[k]||0)/st.need[k]), 0)/need.length;
      const rr = you.s*0.7;
      cx.lineWidth = 4; cx.strokeStyle = "rgba(255,255,255,0.10)"; cx.beginPath(); cx.arc(sink.x, sink.y, rr, 0, 7); cx.stroke();
      cx.strokeStyle = "#8be9fd"; cx.shadowColor = "#8be9fd"; cx.shadowBlur = 12;
      cx.beginPath(); cx.arc(sink.x, sink.y, rr, -Math.PI/2, -Math.PI/2 + done*Math.PI*2); cx.stroke(); cx.shadowBlur = 0;
      text(st.icon+" "+st.name+" · "+Math.floor(done*100)+"%", sink.x, sink.y + rr + 16*ui, { align:"center", px:Math.round(11*ui+1), col:"#8be9fd" });
    }

    // the crowds: a pool of their color underfoot, breathing, then everyone, back to front
    for(const c of crowds){
      const col = JOB_COL[c.id] || "#fff", br = 1 + Math.sin(t*0.9 + c.i)*0.04;
      cx.save(); cx.globalAlpha = 0.10 + (cam.focus===c.id ? 0.06 : 0); cx.fillStyle = col;
      cx.beginPath(); cx.ellipse(c.x, c.y + c.h*0.5 + spr*0.2, (c.w*0.6 + 14)*br, (c.h*0.4 + 10)*br, 0, 0, 7); cx.fill(); cx.restore();
    }
    // how the market moves them: mania bounces, distribution sways, a bear market slumps
    const mood = { mania:{ sp:5.5, amp:4, sway:0, sink:0 }, dist:{ sp:1.8, amp:1.5, sway:3, sink:0 }, bear:{ sp:1.1, amp:1, sway:0, sink:2 } }[ph.id] || { sp:2.2, amp:1.5, sway:0, sink:0 };
    const list = [...agents.values()];
    for(const a of list){
      if(a.trip) walk(a, dt);
      else {
        a.walking = false;
        const h0 = homeOf(a);
        if(a.crowd==="away") h0.x += Math.sin(t*0.6 + a.ph)*10; // out there, wandering
        a.x += (h0.x + Math.sin(t*0.25 + a.ph)*2 - a.x)*Math.min(1, dt*2); a.y += (h0.y - a.y)*Math.min(1, dt*2);
      }
    }
    list.sort((a, b)=>a.y - b.y);
    for(const a of list){
      a.hop = Math.max(0, a.hop - dt*3);
      const sp = sprite(a.m); if(!sp) continue;
      const kind = a.m.kind || "milady", h = a.size*(kind==="remilio" ? 1.0 : 1.25), w = a.size;
      let bob, tilt = 0, sx = 0;
      if(a.walking){ bob = -Math.abs(Math.sin(t*9 + a.ph))*5; tilt = Math.sin(t*9 + a.ph)*0.07; }
      else if(a.crowd==="idle") bob = Math.sin(t*1.2 + a.ph)*1;
      else { bob = Math.sin(t*mood.sp + a.ph)*mood.amp + mood.sink - Math.sin(a.hop*Math.PI)*8; sx = Math.sin(t*1.5 + a.ph)*mood.sway; }
      let sc = 1;
      if(a.born > 0){ a.born = Math.max(0, a.born - dt*1.2); sc = 1 + Math.sin((1 - a.born)*Math.PI)*0.35 - a.born*0.3; }
      if(a.walking || a.trip){ cx.fillStyle = "rgba(0,0,0,0.3)"; cx.beginPath(); cx.ellipse(a.x, a.y + 2, w*0.3, w*0.08, 0, 0, 7); cx.fill(); }
      cx.save(); cx.translate(a.x + sx, a.y + bob); cx.rotate(tilt); cx.scale(sc*(a.trip ? a.face : 1), sc);
      if(a.crowd==="idle") cx.globalAlpha = 0.75;
      cx.drawImage(sp, -w/2, -h*0.8, w, h);
      cx.restore();
      if(a.trip && a.trip.kind==="gift" && a.trip.stage==="go") cx.drawImage(glyph(a.trip.res, 9), a.x + w*0.2, a.y - h*0.45); // carrying it
      if(a.crowd==="idle" && !a.trip && Math.sin(t*0.8 + a.ph) > 0.85) text("z", a.x + w*0.3, a.y - h*0.7 - (t*8 + a.ph*10)%10, { px:10, col:"#9aa" });
    }
    for(const c of crowds){
      const col = JOB_COL[c.id] || "#fff", ly = c.y + c.h/2 + spr*0.55 + 14*ui, lp = Math.round(12*ui), sp = Math.round(10*ui);
      text(c.label+"  ×"+fmt(c.n), c.x, ly, { align:"center", px:lp, col, bold:true });
      const sub = [c.res && fmtRate(R.prod[c.res])+" "+RES_BY[c.res].name, c.more > 0 && "+"+fmt(c.more)+" more"].filter(Boolean).join(" · ");
      if(sub) text(sub, c.x, ly + sp + 4, { align:"center", px:sp, col:"#9aa6ab" });
    }
    // the one the camera's come to see: a ring at her feet and her name, over everyone in front
    const spotA = cam.spot && agents.get(cam.spot);
    if(spotA && cam.z > 1.15){
      const w = spotA.size, h = w*(spotA.m.kind==="remilio" ? 1 : 1.25);
      cx.strokeStyle = "rgba(255,255,255,"+(0.55 + Math.sin(t*3)*0.3)+")"; cx.lineWidth = 2/cam.z;
      cx.beginPath(); cx.ellipse(spotA.x, spotA.y + 2, w*0.42, w*0.13, 0, 0, 7); cx.stroke();
      if(!spotA.say) text(spotA.m.name, spotA.x, spotA.y - h*0.85, { align:"center", px:Math.round(12/Math.sqrt(cam.z)), col:"#fff", bold:true, glow:"rgba(0,0,0,.95)" });
    }
    // what they're saying, over their heads
    for(const a of list){
      if(!a.say) continue;
      a.say.life -= dt; if(a.say.life <= 0){ a.say = null; continue; }
      const al = Math.min(1, a.say.life*2, (2.8 - a.say.life)*5), h = a.size*1.25, px = Math.max(11, Math.round(15*ui/Math.sqrt(cam.z)));
      cx.font = px+"px "+FONT; const tw = cx.measureText(a.say.txt).width + px, bx = a.x - tw/2, by = a.y - h*0.85 - px - 10;
      cx.globalAlpha = al; cx.fillStyle = "rgba(255,255,255,0.92)";
      cx.beginPath(); cx.roundRect(bx, by, tw, px + 8, 7); cx.fill();
      cx.beginPath(); cx.moveTo(a.x - 4, by + px + 8); cx.lineTo(a.x, by + px + 13); cx.lineTo(a.x + 4, by + px + 8); cx.fill();
      text(a.say.txt, a.x, by + px + 2, { align:"center", px, col:"#111" });
      cx.globalAlpha = 1;
    }
    rings = rings.filter(r=>{ r.a -= dt*0.7; r.r += dt*60; if(r.a <= 0) return false;
      cx.strokeStyle = r.c || "#fff"; cx.globalAlpha = r.a; cx.lineWidth = 2; cx.beginPath(); cx.arc(r.x, r.y, r.r, 0, 7); cx.stroke(); cx.globalAlpha = 1; return true; });
    parts = parts.filter(p=>{ // hearts float up where they are, in the world
      if(!p.world) return true;
      p.life -= dt; p.y += p.vy*dt; if(p.life <= 0) return false;
      cx.globalAlpha = Math.min(1, p.life); text(p.txt, p.x, p.y, { align:"center", px:p.px }); cx.globalAlpha = 1; return true;
    });

    // in the air, on the screen: what's made flying to the strip, vibes flying back, gifts and spending
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    parts = parts.filter(p=>{
      if(p.world) return true;
      p.p += dt/p.d;
      if(p.p >= 1){ if(p.onDone) p.onDone(); return false; }
      const e = p.p < 0.5 ? 2*p.p*p.p : 1 - Math.pow(-2*p.p + 2, 2)/2;
      const x = p.x0 + (p.x1 - p.x0)*e, y = p.y0 + (p.y1 - p.y0)*e + Math.sin(e*Math.PI)*p.arc;
      cx.globalAlpha = p.alpha*Math.min(1, (1 - p.p)*4);
      const gl = glyph(p.id, p.px); cx.drawImage(gl, x - p.px, y - p.px);
      cx.globalAlpha = 1;
      return true;
    });
    if(parts.length > 500) parts.splice(0, parts.length - 500);
    // up close: who this is
    const fc = cam.focus && crowdOf(cam.focus), spot = cam.spot && agents.get(cam.spot);
    if(fc && cam.z > 1.15){
      const al = Math.min(1, (cam.z - 1.15)*3), stripTop = Math.min(...Object.values(bars).map(b=>b.y), H - 20);
      cx.globalAlpha = al;
      text(fc.label+" · "+fmt(fc.n)+(fc.res ? " · "+fmtRate(R.prod[fc.res])+" "+RES_BY[fc.res].name : ""), W/2, stripTop - 52*ui, { align:"center", px:Math.round(16*ui), col:JOB_COL[fc.id] || "#fff", bold:true, glow:"rgba(0,0,0,.9)" });
      if(spot) text(spot.m.name+(spot.m.kind==="remilio" ? ", a remilio," : "")+" is one of them", W/2, stripTop - 32*ui, { align:"center", px:Math.round(12*ui), col:"#ddd", glow:"rgba(0,0,0,.9)" });
      cx.globalAlpha = 1;
    }
    cx.setTransform(dpr, 0, 0, dpr, dpr*drift.x, dpr*drift.y);

    // the strip
    for(const id in bars){
      const b = bars[id], r = RES_BY[id], v = S.res[id], cap = R.cap[id], net = R.net[id];
      b.pulse = Math.max(0, b.pulse - dt*2.5);
      cx.fillStyle = "rgba(0,0,0,0.45)"; cx.strokeStyle = "rgba(139,233,253,"+(0.18 + b.pulse*0.5)+")"; cx.lineWidth = 1;
      cx.beginPath(); cx.roundRect(b.x, b.y, b.w, b.h, 8); cx.fill(); cx.stroke();
      const fillY = b.compact ? b.y + 22 : b.y + 30, rateY = b.compact ? b.y + 35 : b.y + 49;
      cx.drawImage(glyph(id, b.compact ? 11 : 14), b.x + 4, b.y + (b.compact ? 2 : 6));
      if(!b.compact) text(r.name, b.x + 36, b.y + 19, { px:11, col:r.color, bold:true });
      text(fmt(v), b.x + b.w - 6, b.y + (b.compact ? 16 : 19), { px:b.compact ? 11 : 12, align:"right", col:"#fff" });
      cx.fillStyle = "rgba(255,255,255,0.08)"; cx.fillRect(b.x + 6, fillY, b.w - 12, 4);
      cx.fillStyle = r.color; cx.fillRect(b.x + 6, fillY, (b.w - 12)*Math.min(1, v/cap), 4);
      text(fmtRate(net), b.x + 6, rateY, { px:b.compact ? 9 : 10, col:net < 0 ? "#ff5555" : "#9aa6ab" });
      if(!b.compact) text("/ "+fmt(cap), b.x + b.w - 8, rateY, { px:10, align:"right", col:"#666" });
    }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hud(t, ph);
  }
  function hud(t, ph){
    const ox = Math.sin(t/131)*4, oy = Math.cos(t/89)*3, k = ui, L = 18 + 10*k, px = n => Math.round(n*k);
    cx.translate(ox, oy);
    text("the network ", L, 38*k + 4, { px:px(18), col:"#8be9fd", glow:"rgba(139,233,253,.5)" });
    const tw = cx.measureText("the network ").width;
    text(S.ended ? "is online_" : "is growing_", L + tw, 38*k + 4, { px:px(18), col:"#fff", bold:true });
    const into = S.phaseT % PHASE_SECS, y2 = 62*k + 4;
    text(ph.icon+" "+ph.name, L, y2, { px:px(13), col:ph.color, bold:true });
    cx.fillStyle = "rgba(255,255,255,0.1)"; cx.fillRect(L, y2 + 7*k, 150*k, 4); cx.fillStyle = ph.color; cx.fillRect(L, y2 + 7*k, 150*k*into/PHASE_SECS, 4);
    text("🌸 "+fmt(S.miladys.length)+" / "+fmt(R.housing)+" · happiness "+pct(R.happy), L, y2 + 28*k, { px:px(11), col:"#9aa6ab" });
    if(online() && acct()) text("✓ "+(isShip(acct().handle) ? "" : "~")+acct().handle, L, y2 + 45*k, { px:px(11), col:isShip(acct().handle) ? "#5fa8ff" : "#f1fa8c" });
    // the real clock, for the monitor it's on
    const now = new Date(), R0 = W - L, since = clock - hourAt, hr = since >= 0 && since < 45 ? 1 - since/45 : 0; // a new hour: it glows, then settles
    const hc = hr ? ph.color : "#fff", pulse = hr ? hr*(0.6 + 0.4*Math.sin(since*1.6)) : 0;
    text(now.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }), R0, 44*k + 6, { px:px(36), align:"right", col:hr ? mixCol("#ffffff", hc, Math.min(1, hr*1.4)) : "#fff",
      glow:hr ? hexA(hc, 0.25 + 0.55*pulse) : "rgba(255,255,255,.25)", blur:12 + 14*pulse });
    text(hr ? (hourN+" o'clock · "+cult()) : now.toLocaleDateString([], { weekday:"long", month:"short", day:"numeric" }).toLowerCase(), R0, 64*k + 6, { px:px(11), align:"right", col:hr ? mixCol("#9aa6ab", hc, hr) : "#9aa6ab" });
    text("run "+(resets(S)+1)+" · cycle "+(S.cycle+1)+" · "+fmtTime(S.runT), R0, 81*k + 6, { px:px(11), align:"right", col:"#777" });
    // the newest line of the feed, over the strip
    const l = S.log[0];
    if(l && l.t !== ticker.at){ ticker = { at:l.t, text:String(l.html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'), shown:performance.now() }; }
    const stripTop = Math.min(...Object.values(bars).map(b=>b.y), H - 20);
    if(ticker.text){
      const age = (performance.now() - ticker.shown)/1000, max = Math.floor(W/(7.5*k));
      cx.globalAlpha = Math.max(0.35, Math.min(1, 1.6 - age*0.05));
      text(ticker.text.length > max ? ticker.text.slice(0, max - 1)+"…" : ticker.text, W/2, stripTop - 12, { px:px(12), align:"center", col:"#ddd" });
      cx.globalAlpha = 1;
    }
    drawCards(stripTop, k);
    text("any key or click to come back", W/2, H - 5, { px:9, align:"center", col:"rgba(255,255,255,0.25)" });
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- the robots' shopping, as cards stacking up by the strip ---------- */
  /* the same thing bought again soon after counts up on its card (built 3× server rack) instead of a new one */
  function bot(did){
    const add = (icon, verb, name, n) => {
      const now = performance.now(), c = cards.find(c=>c.verb===verb && c.name===name && now - c.at < 6000);
      if(c){ c.n += n; c.at = now; c.bump = 1; return; }
      cards.unshift({ icon, verb, name, n, at:now, born:now, bump:1 });
      if(cards.length > 12) cards.length = 12;
    };
    if(did.m) add("🐸", "made", "memes", did.m);
    for(const t of did.t) add("📜", "researched", t, 1);
    for(const u of did.u) add("✨", "bought", u, 1);
    for(const b in did.b) add("🏗️", "built", b, did.b[b]);
    for(const [icon, verb, name] of did.x||[]) add(icon, verb, name, 1);
  }
  function drawCards(stripTop, k){
    const now = performance.now(), LIFE = 7000, px = Math.round(12*k), h = px + 12, R0 = W - 18 - 10*k;
    cards = cards.filter(c=>now - c.at < LIFE);
    let y = stripTop - 34*k - h;
    for(const c of cards.slice(0, 5)){
      const age = now - c.at, inT = Math.min(1, (now - c.born)/350), a = Math.min(1, (LIFE - age)/900)*inT;
      c.bump = Math.max(0, c.bump - 0.06);
      const label = "🤖 "+c.icon+" "+c.verb+" "+(c.verb==="made" ? fmt(c.n)+" " : c.n > 1 ? c.n+"× " : "")+c.name;
      cx.font = px+"px "+FONT;
      const tw = cx.measureText(label).width + 20, x = R0 - tw + (1 - inT)*40;
      cx.globalAlpha = a;
      cx.fillStyle = "rgba(10,12,18,0.82)"; cx.strokeStyle = "rgba(139,233,253,"+(0.3 + c.bump*0.6)+")"; cx.lineWidth = 1;
      cx.beginPath(); cx.roundRect(x, y, tw, h, 7); cx.fill(); cx.stroke();
      text(label, x + 10, y + h/2 + 1, { px, base:"middle", col:"#e8f6ff" });
      y -= h + 6;
      if(y < 112*k + 14) break;
    }
    cx.globalAlpha = 1;
  }

  /* ---------- the top of the hour: the time in the corner glows, softly, for a while ---------- */
  let hourAt = -999, hourKey = "", hourN = 0;
  function hourCheck(t){
    const d = new Date(), key = d.toDateString()+" "+d.getHours();
    if(d.getMinutes()===0 && d.getSeconds() < 20 && hourKey !== key){ hourKey = key; hourAt = t; hourN = d.getHours() % 12 || 12; }
  }

  /* ---------- the loop ---------- */
  let layoutT = 0, spentT = 0;
  function loop(now){
    if(!on) return;
    raf = requestAnimationFrame(loop);
    if(document.hidden || ++frameN % 2) return; // thirty frames a second is plenty
    const dt = Math.min(0.1, (now - last)/1000 || 0.033); last = now;
    const t = (now - t0)/1000;
    clock = t;
    layoutT -= dt; if(layoutT <= 0){ layoutT = 1; layout(); place(); }
    spentT -= dt; if(spentT <= 0){ spentT = 0.5; spent(); }
    if(frameN % 30===0) hourCheck(t);
    spawn(dt);
    draw(dt, t);
  }
  function size(){
    if(!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    layoutT = 0;
  }
  const leave = e => {
    if(e.type==="pointermove"){ moved += Math.abs(e.movementX||0) + Math.abs(e.movementY||0); if(moved < 40) return; } // a nudge of the desk isn't someone back
    else { e.stopPropagation(); if(e.type==="keydown") e.preventDefault(); } // the key or click that wakes it does nothing else
    stop();
  };

  function start(){
    if(on || !S || !S.started) return;
    on = true; cards = []; hourAt = -999; moved = 0; parts = []; rings = []; agents = new Map(); seenIds = null; lastRes = {}; spawnAcc = {}; tripAcc = 0; sayAcc = 0;
    cam.x = cam.tx = innerWidth/2; cam.y = cam.ty = innerHeight/2; cam.z = cam.tz = 1; cam.until = 12; cam.focus = cam.spot = null;
    cv = document.createElement("canvas"); cv.id = "ambient"; document.body.appendChild(cv);
    cx = cv.getContext("2d"); size();
    document.body.classList.add("ambient");
    addEventListener("resize", size);
    for(const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, leave, { capture:true });
    addEventListener("pointermove", leave, { capture:true });
    wake(); // keep the screen on
    t0 = last = performance.now(); frameN = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop(){
    if(!on) return;
    on = false; cancelAnimationFrame(raf);
    for(const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) removeEventListener(ev, leave, { capture:true });
    removeEventListener("pointermove", leave, { capture:true });
    removeEventListener("resize", size);
    document.body.classList.remove("ambient");
    if(cv){ cv.remove(); cv = null; }
    if(lock){ lock.release().catch(()=>{}); lock = null; }
    if(typeof ambientBack==="function") ambientBack();
  }
  // the wake lock lets go when the tab is hidden; take it again on the way back
  function wake(){ if(navigator.wakeLock && !lock) navigator.wakeLock.request("screen").then(l=>{ lock = l; l.addEventListener("release", ()=>{ lock = null; }); }).catch(()=>{}); }
  document.addEventListener("visibilitychange", ()=>{ if(on && !document.hidden) wake(); });
  return { start, stop, bot, get on(){ return on; } };
})();
