/* the network is growing: music, made on the spot like the blips. A slow pad of chords, a soft bass under it and a
   few notes over it from the same five-note scale the posts use, in the market's key (two octaves down from where a
   post sounds, so posting plays along): bright and busier in mania, low and sparse in a bear market, which leans on
   the minor chord. It plays while the tab is in front, follows mute, and has a volume of its own (0 is off). */
const MUSIC = (()=>{
  const CH = { I:[1, 5/4, 3/2], IV:[4/3, 5/3, 2], V:[3/2, 15/8, 9/4], vi:[5/3, 2, 5/2] };
  const MOOD = { // per market phase: the chords, seconds a chord lasts, how bright the pad is, how often a note sounds
    accum:{ prog:["I","vi","IV","V"],  bar:8,  cut:1400, busy:0.30, oct:1 },
    mania:{ prog:["I","V","vi","IV"],  bar:6,  cut:2400, busy:0.55, oct:2 },
    dist: { prog:["IV","I","V","vi"],  bar:8,  cut:1200, busy:0.25, oct:1 },
    bear: { prog:["vi","IV","I","V"],  bar:10, cut:700,  busy:0.14, oct:1 },
  };
  let out = null, wet = null, timer = null, nextAt = 0, bar = 0, playing = false;
  const vol = () => (S && S.settings.music!=null ? S.settings.music : 40)/100;
  const wanted = () => !!S && !S.settings.mute && vol() > 0 && !document.hidden && !!AC;
  function setup(){ // a master level, and a room: a reverb made of decaying noise, and an echo for the notes
    out = AC.createGain(); out.gain.value = 0; out.connect(AC.destination);
    const len = AC.sampleRate*3, ir = AC.createBuffer(2, len, AC.sampleRate);
    for(let c=0; c<2; c++){ const d = ir.getChannelData(c); for(let i=0; i<len; i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 3); }
    const verb = AC.createConvolver(); verb.buffer = ir;
    const vg = AC.createGain(); vg.gain.value = 0.55; verb.connect(vg); vg.connect(out);
    const echo = AC.createDelay(2), fb = AC.createGain(); fb.gain.value = 0.35;
    echo.connect(fb); fb.connect(echo); echo.connect(verb); echo.connect(out);
    wet = { verb, echo };
  }
  function tone(type, f, at, len, peak, attack, cut, send){
    const o = AC.createOscillator(), g = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = type; o.frequency.value = f;
    lp.type = "lowpass"; lp.frequency.value = cut;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, at + Math.max(attack, len - 2.5));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(lp); lp.connect(g); g.connect(out); g.connect(send);
    o.start(at); o.stop(at + len + 0.05);
  }
  function playBar(at){
    const ph = (R && R.phase && MOOD[R.phase.id]) ? R.phase.id : "accum", m = MOOD[ph];
    const root = (POST_ROOT[ph]||523)/4, chord = CH[m.prog[bar % m.prog.length]], len = m.bar;
    echoTime(len);
    for(const r of chord) for(const det of [-4, 4]) // each chord tone twice, a few cents apart: it shimmers
      tone(det < 0 ? "sine" : "triangle", root*r*Math.pow(2, det/1200), at, len + 2.5, 0.022, 2.2, m.cut, wet.verb);
    tone("sine", root*chord[0]/2, at, len + 1, 0.05, 1.2, 400, wet.verb); // the bass, under it
    const steps = 8, step = len/steps;
    for(let i=0; i<steps; i++){ // a few notes over it, from the posts' scale, never on top of each other
      if(Math.random() > m.busy) continue;
      const f = root*2*m.oct*PENTA[Math.floor(Math.random()*PENTA.length)]*(Math.random() < 0.25 ? 2 : 1);
      tone("sine", f, at + i*step + Math.random()*0.04, 1.6, 0.03, 0.015, 3200, wet.echo);
    }
    bar++;
  }
  let lastBar = 0;
  function echoTime(len){ if(len !== lastBar){ lastBar = len; wet.echo.delayTime.setTargetAtTime(len/8*1.5, AC.currentTime, 0.5); } }
  function loop(){
    if(!wanted()){ if(playing){ playing = false; out.gain.setTargetAtTime(0, AC.currentTime, 0.6); } return; }
    if(!out) setup();
    if(AC.state==="suspended") AC.resume();
    if(!playing){ playing = true; nextAt = Math.max(nextAt, AC.currentTime + 0.1); }
    out.gain.setTargetAtTime(vol(), AC.currentTime, 0.8);
    while(nextAt < AC.currentTime + 1.5){ playBar(nextAt); nextAt += MOOD[(R && R.phase && MOOD[R.phase.id]) ? R.phase.id : "accum"].bar; }
  }
  function start(){ // audio can only begin from something the player does: the first click or key wakes it
    if(timer) return;
    try{ AC = AC || new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return; }
    timer = setInterval(loop, 500); loop();
  }
  for(const ev of ["pointerdown", "keydown"]) addEventListener(ev, start, { once:true, capture:true });
  document.addEventListener("visibilitychange", ()=>{ if(timer) loop(); });
  return { start, update:()=>{ if(timer) loop(); } };
})();
