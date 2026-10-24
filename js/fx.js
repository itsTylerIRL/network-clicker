/* the network is growing: how it moves. Two canvases and nothing loaded from anywhere.

   The backdrop is the network itself: faint strangers drifting by, and one brighter node for every milady you
   have, in her job's color, threaded to the ones near her. Signals run down the threads, more of them the
   bigger the network gets and every time you post. The market sets the weather: accumulation grows up slowly,
   mania rockets, distribution slides sideways, a bear market comes down in red.

   The other canvas sits over everything and only holds what's thrown: petals when you post, confetti when you
   build, a starburst when you catch a sparkle. */
const FX = (()=>{
  const hex = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2), 16));
  const rgba = (c, a) => "rgba("+c.map(Math.round).join(",")+","+a.toFixed(3)+")";
  const JOB_COL = { poster:"#ff79c6", memer:"#50fa7b", keeper:"#bd93f9", trader:"#f1fa8c", artist:"#8be9fd", streamer:"#ffb86c", mod:"#ffffff",
    dev:"#a6e3ff", acolyte:"#ffd27f", seer:"#c3a6ff", idle:"#8a8f70" };
  const TITLE = ["#ff79c6","#bd93f9","#50fa7b","#f1fa8c","#8be9fd"];
  /* vx/vy: which way the field drifts. energy: how fast, and how often signals run. */
  const MOOD = {
    title: { c:hex("#8be9fd"), energy:1,    vx:-7,  vy:-3.5, mixed:true },
    accum: { c:hex("#50fa7b"), energy:0.8,  vx:-3,  vy:-6 },
    mania: { c:hex("#f1fa8c"), energy:1.9,  vx:-4,  vy:-26 },
    dist:  { c:hex("#ffb86c"), energy:1.2,  vx:-20, vy:1.5 },
    bear:  { c:hex("#ff5555"), energy:1.1,  vx:-3, vy:22 },
  };
  const st = () => (typeof S!=="undefined" && S) || null; // game.js's state: a top-level let, so not on window
  const calm = () => !!(st() && S.settings.calm);
  const bgOn = () => !(st() && S.settings.bg===false);

  /* ---------- the backdrop ---------- */
  const B = { cv:null, cx:null, ambient:[], mine:new Map(), pulses:[], rings:[], bursts:[], w:0, h:0, d:1,
    col:hex("#8be9fd"), vx:-7, vy:-3.5, energy:1, kick:0, nextPulse:0, nextBurst:0, frame:0, last:0, end:0, endOn:false };
  function size(){
    const d = Math.min(1.5, window.devicePixelRatio||1), ow = B.w, oh = B.h;
    B.w = innerWidth; B.h = innerHeight; B.d = d;
    for(const cv of [B.cv, T.cv]){ cv.width = Math.round(B.w*d); cv.height = Math.round(B.h*d); }
    const all = [...B.ambient, ...B.mine.values()];
    if(ow && oh) for(const n of all){ n.x *= B.w/ow; n.y *= B.h/oh; }
    const want = Math.max(30, Math.min(140, Math.round(B.w*B.h/20000)));
    while(B.ambient.length < want) B.ambient.push(node(TITLE[B.ambient.length % TITLE.length], 0.25+Math.random()*0.5));
    B.ambient.length = want;
  }
  function node(color, z){
    return { x:Math.random()*B.w, y:Math.random()*B.h, z, vx:(Math.random()-0.5)*5, vy:(Math.random()-0.5)*5,
      tint:hex(color), ph:Math.random()*6.28, born:0, mine:false };
  }
  function mood(){
    const main = document.getElementById("screen-main");
    if(st() && S.started && main && main.classList.contains("active")) return MOOD[phase(S).id] || MOOD.title;
    return MOOD.title;
  }
  /* one node per milady, kept in step with the network */
  let syncT = 0;
  function sync(){
    if(!st()) return;
    const list = (main => main && main.classList.contains("active"))(document.getElementById("screen-main")) ? S.miladys.slice(-160) : [];
    const keep = new Set();
    for(const m of list){
      keep.add(m.id);
      let n = B.mine.get(m.id);
      if(!n){ n = node(JOB_COL[m.job||"idle"] || JOB_COL.idle, 0.8+Math.random()*0.2); n.mine = true; n.born = 1; B.mine.set(m.id, n); }
      n.tint = hex(JOB_COL[m.away ? "idle" : m.job||"idle"] || JOB_COL.idle);
    }
    for(const [id, n] of B.mine) if(!keep.has(id)){ B.mine.delete(id); B.rings.push({ x:n.x, y:n.y, r:4, a:0.5, c:n.tint, shrink:true }); }
  }
  function frame(now){
    requestAnimationFrame(frame);
    if(document.hidden) return;
    if(++B.frame % 2) return; // thirty frames a second is plenty for something this slow
    const dt = Math.min(0.1, (now-B.last)/1000 || 0.033); B.last = now;
    syncT -= dt; if(syncT <= 0){ syncT = 0.5; sync(); }
    drawTop(dt);
    const cx = B.cx, W = B.w, H = B.h, t = now/1000;
    cx.setTransform(B.d,0,0,B.d,0,0); cx.clearRect(0,0,W,H);
    if(!bgOn()) return;
    const m = mood(), k = Math.min(1, dt*0.8);
    B.end += ((B.endOn ? 1 : 0) - B.end)*Math.min(1, dt*0.5);
    // the ending: the colors go round all of them
    const mc = B.end > 0.01 ? (c1 => c1.map((v,i)=>v + (hex(TITLE[(Math.floor(t/2.5)+1) % TITLE.length])[i]-v)*((t/2.5)%1)))(hex(TITLE[Math.floor(t/2.5) % TITLE.length])) : m.c;
    for(let i=0;i<3;i++) B.col[i] += (mc[i]-B.col[i])*k; // the weather eases in, it doesn't cut
    B.vx += (m.vx-B.vx)*k; B.vy += (m.vy-B.vy)*k; B.energy += (m.energy-B.energy)*k;
    B.kick *= Math.pow(0.03, dt);
    const sp = calm() ? 0.25 : 1, base = B.col, link = Math.min(170, Math.max(110, W/9)) * (1 + B.end*0.6);
    // two soft clouds of the phase's color, wandering
    for(let i=0;i<2;i++){
      const gx = W*(0.5+0.38*Math.sin(t*0.05+i*2.4)), gy = H*(0.5+0.36*Math.cos(t*0.04+i*1.7)), r = Math.max(W,H)*0.45;
      const g = cx.createRadialGradient(gx,gy,0,gx,gy,r);
      g.addColorStop(0, rgba(base, 0.09+0.05*B.kick)); g.addColorStop(1, "rgba(0,0,0,0)");
      cx.fillStyle = g; cx.fillRect(0,0,W,H);
    }
    const mine = [...B.mine.values()], all = B.ambient.concat(mine);
    const tintOf = n => n.mine || m.mixed ? n.tint : base.map((v,i)=>v*0.75+n.tint[i]*0.25);
    for(const n of all){ // nearer nodes move faster, so the field has depth
      const s = (0.4+n.z)*sp*B.energy;
      n.x += (n.vx + B.vx*n.z)*s*dt + (Math.random()-0.5)*B.kick*4;
      n.y += (n.vy + B.vy*n.z)*s*dt + (Math.random()-0.5)*B.kick*4;
      if(n.x<-20) n.x += W+40; else if(n.x>W+20) n.x -= W+40;
      if(n.y<-20) n.y += H+40; else if(n.y>H+20) n.y -= H+40;
      if(n.born > 0){ n.born -= dt*0.7; }
      if(B.end > 0.01){ // everything gathers into one turning globe: nearer nodes on the outside
        const a = n.ph + t*0.12*(n.mine ? 1 : -0.6), rad = Math.min(W,H)*(0.16 + n.z*0.3), cy = Math.cos(n.ph*3.1);
        const tx = W/2 + Math.cos(a)*rad*Math.sqrt(1-cy*cy*0.6), ty = H/2 + Math.sin(a)*rad*0.9 + cy*rad*0.25;
        n.x += (tx - n.x)*Math.min(1, dt*1.4)*B.end; n.y += (ty - n.y)*Math.min(1, dt*1.4)*B.end;
      }
    }
    // each node's color, worked out once a frame rather than once per thread
    for(const n of all){ const c = tintOf(n); n.cs = Math.round(c[0])+","+Math.round(c[1])+","+Math.round(c[2]); }
    // threads between nodes that are close: bucket them so each only looks at its neighbors
    const cell = link*1.25, cols = Math.ceil(W/cell)+2, grid = new Map();
    for(const n of all){ const key = (Math.floor(n.y/cell)+1)*cols + Math.floor(n.x/cell)+1; (grid.get(key) || grid.set(key, []).get(key)).push(n); }
    cx.lineWidth = 1;
    for(const [key, list] of grid){
      for(const off of [0, 1, cols-1, cols, cols+1]){
        const other = off ? grid.get(key+off) : list; if(!other) continue;
        for(let i=0;i<list.length;i++) for(let j=off ? 0 : i+1; j<other.length; j++){
          const a = list[i], b = other[j], dx = a.x-b.x, dy = a.y-b.y, q = dx*dx+dy*dy;
          const both = a.mine && b.mine, L = both ? cell : link;
          if(q > L*L) continue;
          const al = (1-Math.sqrt(q)/L)*(both ? 0.42 : 0.26)*Math.min(a.z,b.z)*(1+B.kick);
          if(al < 0.01) continue;
          cx.strokeStyle = "rgba("+a.cs+","+al.toFixed(2)+")"; cx.beginPath(); cx.moveTo(a.x,a.y); cx.lineTo(b.x,b.y); cx.stroke();
        }
      }
    }
    for(const n of all){
      const tw = 0.75+0.25*Math.sin(t*0.8+n.ph), r = (n.mine ? 1.8 : 0.9)+1.7*n.z;
      cx.fillStyle = "rgba("+n.cs+","+(0.12*n.z*tw).toFixed(3)+")"; cx.beginPath(); cx.arc(n.x,n.y,r*4.4,0,7); cx.fill();
      cx.fillStyle = "rgba("+n.cs+","+(0.92*n.z*tw).toFixed(3)+")"; cx.beginPath(); cx.arc(n.x,n.y,r,0,7); cx.fill();
      if(n.born > 0){ // someone new: a ring opens round her
        cx.strokeStyle = "rgba("+n.cs+","+(n.born*0.9).toFixed(3)+")"; cx.lineWidth = 1.5;
        cx.beginPath(); cx.arc(n.x,n.y, r + (1-n.born)*40, 0, 7); cx.stroke(); cx.lineWidth = 1;
      }
    }
    // signals: more of them the bigger the network
    if(!calm() && t > B.nextPulse && all.length > 1){
      B.nextPulse = t + (0.9+Math.random()*1.2) / (B.energy*(1+Math.min(3, mine.length/25))*(1+B.end*6));
      pulse(mine.length && Math.random()<0.7 ? mine : all, link);
    }
    B.pulses = B.pulses.filter(pl=>{
      pl.p += dt*1.6*B.energy; if(pl.p >= 1) return false;
      const x = pl.a.x+(pl.b.x-pl.a.x)*pl.p, y = pl.a.y+(pl.b.y-pl.a.y)*pl.p, c = pl.a.tint.map((v,i)=>v*0.5+base[i]*0.2+90);
      cx.strokeStyle = rgba(c, 0.5*(1-pl.p)); cx.beginPath(); cx.moveTo(pl.a.x,pl.a.y); cx.lineTo(x,y); cx.stroke();
      cx.fillStyle = rgba(c, 0.95); cx.beginPath(); cx.arc(x,y,2,0,7); cx.fill();
      cx.fillStyle = rgba(c, 0.18); cx.beginPath(); cx.arc(x,y,7,0,7); cx.fill();
      return true;
    });
    // mania: now and then something goes off
    if((m===MOOD.mania || B.end > 0.5) && !calm() && t > B.nextBurst){
      B.nextBurst = t + (B.end > 0.5 ? 0.5 : 1.2)+Math.random()*2.5;
      const bx = W*(0.1+Math.random()*0.8), by = H*(0.1+Math.random()*0.45), col = hex(TITLE[Math.floor(Math.random()*TITLE.length)]);
      for(let i=0;i<34;i++){ const a = i/34*6.28, v = 50+Math.random()*90; B.bursts.push({ x:bx, y:by, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:1, c:col }); }
    }
    B.bursts = B.bursts.filter(p=>{
      p.life -= dt*0.75; if(p.life <= 0) return false;
      p.vy += 40*dt; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx*dt; p.y += p.vy*dt;
      cx.fillStyle = rgba(p.c, p.life*0.7); cx.beginPath(); cx.arc(p.x,p.y,1.6,0,7); cx.fill();
      return true;
    });
    B.rings = B.rings.filter(r=>{
      r.a -= dt*0.8; if(r.a <= 0) return false;
      r.r += dt*(r.shrink ? 25 : 120);
      cx.strokeStyle = rgba(r.c, r.a); cx.beginPath(); cx.arc(r.x,r.y,r.r,0,7); cx.stroke();
      return true;
    });
  }
  function pulse(pool, link){
    const a = pool[Math.floor(Math.random()*pool.length)], all = B.ambient.concat([...B.mine.values()]);
    const near = all.filter(b=>b!==a && Math.hypot(a.x-b.x, a.y-b.y) < link*1.25);
    if(near.length) B.pulses.push({ a, b:near[Math.floor(Math.random()*near.length)], p:0 });
  }

  /* ---------- the top layer: things thrown ---------- */
  const T = { cv:null, cx:null, ps:[] };
  function drawTop(dt){
    const cx = T.cx;
    cx.setTransform(B.d,0,0,B.d,0,0); cx.clearRect(0,0,B.w,B.h);
    T.ps = T.ps.filter(p=>{
      p.life -= dt/p.max; if(p.life <= 0) return false;
      p.vy += p.g*dt; p.vx *= Math.pow(p.drag, dt*60); p.vy *= Math.pow(p.drag, dt*60);
      p.x += p.vx*dt; p.y += p.vy*dt; p.rot += p.vr*dt;
      const a = Math.min(1, p.life*1.6);
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.globalAlpha = a;
      if(p.kind==="petal"){ cx.fillStyle = p.c; cx.beginPath(); cx.ellipse(0,0,p.s,p.s*0.55,0,0,7); cx.fill(); }
      else if(p.kind==="square"){ cx.fillStyle = p.c; cx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); }
      else if(p.kind==="star"){ cx.fillStyle = p.c; cx.beginPath();
        for(let i=0;i<8;i++){ const r = i%2 ? p.s*0.4 : p.s; cx.lineTo(Math.cos(i*Math.PI/4)*r, Math.sin(i*Math.PI/4)*r); } cx.fill(); }
      else if(p.kind==="ring"){ cx.globalAlpha = a*0.8; cx.strokeStyle = p.c; cx.lineWidth = 2; cx.beginPath(); cx.arc(0,0,p.s*(1.6-p.life)*1.2,0,7); cx.stroke(); }
      cx.restore();
      return true;
    });
  }
  function throwP(x, y, n, o){
    if(calm()) n = Math.ceil(n/4);
    for(let i=0;i<n;i++){
      const a = o.spread!=null ? -Math.PI/2 + (Math.random()-0.5)*o.spread : Math.random()*6.28, v = o.v*(0.5+Math.random()*0.7);
      T.ps.push({ x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, g:o.g||0, drag:o.drag||0.96, rot:Math.random()*6.28, vr:(Math.random()-0.5)*8,
        s:o.s*(0.7+Math.random()*0.6), c:o.cols[Math.floor(Math.random()*o.cols.length)], kind:o.kind, life:1, max:o.life*(0.7+Math.random()*0.6) });
    }
    if(T.ps.length > 600) T.ps.splice(0, T.ps.length-600);
  }
  const ring = (x, y, c, s) => T.ps.push({ x, y, vx:0, vy:0, g:0, drag:1, rot:0, vr:0, s:s||30, c, kind:"ring", life:1, max:0.5 });
  const center = el => { const r = el.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; };
  function flash(el, cls){ if(!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  /* ---------- what the game calls ---------- */
  return {
    start(){
      B.cv = document.getElementById("bg-canvas"); T.cv = document.getElementById("fx-canvas");
      B.cx = B.cv && B.cv.getContext("2d"); T.cx = T.cv && T.cv.getContext("2d");
      if(!B.cx || !T.cx) return;
      size(); addEventListener("resize", size);
      requestAnimationFrame(frame);
    },
    post(x, y){
      if(!T.cx) return;
      throwP(x, y, 7, { kind:"petal", v:170, g:260, drag:0.97, s:4.5, life:0.9, cols:["#ff79c6","#ffb3dd","#ffd6ec","#ff9ad5"] });
      B.kick = Math.min(1, B.kick+0.06);
      const mine = [...B.mine.values()];
      if(mine.length && Math.random()<0.5) pulse(mine, Math.min(170, Math.max(110, B.w/9)));
    },
    buy(el, big){
      if(!T.cx || !el) return;
      const [x, y] = center(el);
      throwP(x, y, big ? 40 : 22, { kind:"square", v:big ? 380 : 260, g:520, drag:0.95, spread:2.4, s:7, life:1.2,
        cols:["#8be9fd","#ff79c6","#50fa7b","#f1fa8c","#bd93f9","#ffb86c"] });
      ring(x, y, "#8be9fd", 40);
      flash(el, "bought");
    },
    sparkle(x, y){
      if(!T.cx) return;
      throwP(x, y, 30, { kind:"star", v:320, g:120, drag:0.94, s:6, life:1.1, cols:["#ffffff","#8be9fd","#ff79c6","#f1fa8c"] });
      ring(x, y, "#ffffff", 50); ring(x, y, "#8be9fd", 80);
      B.kick = 1;
    },
    arrive(){ syncT = 0; },
    phase(p){
      document.body.dataset.phase = p.id;
      const ban = document.getElementById("phase-banner");
      if(!ban || calm()) return;
      ban.innerHTML = '<span>'+p.icon+'</span><b>'+p.name+'</b><i>'+p.desc+'</i>';
      ban.style.setProperty("--pc", p.color);
      flash(ban, "show");
      B.kick = 1;
    },
    research(){ flash(document.body, "scan"); },
    grass(){ flash(document.body, "grassing"); B.mine.clear(); },
    frenzy(on){ document.body.classList.toggle("frenzy", !!on); },
    ending(on){ B.endOn = !!on; B.kick = 1; document.body.classList.toggle("the-end", !!on); },
  };
})();
