/* the network is growing: music, made on the spot like the blips. A slow pad of chords, a soft bass under it and a
   few notes over it from the same five-note scale the posts use, in the market's key (two octaves down from where a
   post sounds, so posting plays along): bright and busier in mania, low and sparse in a bear market, which leans on
   the minor chord. It plays while the tab is in front, follows mute, and has a volume of its own (0 is off).
   It gets deeper as the network does: once the new internet opens, an arpeggio walks the chords, swaying side to
   side through the echo; once it's turned on, a choir hangs an octave over them and a slow heartbeat sits under.
   And it moves with what's happening. A chord is played out a sixteenth at a time, each a moment before it sounds,
   so a frenzy lifts it (brighter, busier, double-time, ticking), a glow warms it (a richer chord, bells), and drama
   sours it (seasick pads, a tremolo, a dark drone, notes that slip) within half a second. Things that happen (a
   sparkle, a raid home, the market turning, touching grass) get a cue of their own, in key (MUSIC.cue). */
const MUSIC = (()=>{
  const CH = { I:[1, 5/4, 3/2], IV:[4/3, 5/3, 2], V:[3/2, 15/8, 9/4], vi:[5/3, 2, 5/2] };
  const MOOD = { // per market phase: the chords, seconds a chord lasts, how bright the pad is, how often a note sounds
    accum:{ prog:["I","vi","IV","V"],  bar:8,  cut:1400, busy:0.30, oct:1 },
    mania:{ prog:["I","V","vi","IV"],  bar:6,  cut:2400, busy:0.55, oct:2 },
    dist: { prog:["IV","I","V","vi"],  bar:8,  cut:1200, busy:0.25, oct:1 },
    bear: { prog:["vi","IV","I","V"],  bar:10, cut:700,  busy:0.14, oct:1 },
  };
  const STEPS = 16; // a chord, in sixteenths
  let out = null, wet = null, padIn = null, padLp = null, trem = null, noise = null, timer = null, playing = false;
  let bar = 0, step = 0, stepAt = 0, cur = null, quick = false; // cur: the chord being played out; quick: the next comes in fast (the market turned)
  const vol = () => (S && S.settings.music!=null ? S.settings.music : 40)/100;
  const wanted = () => !!S && !S.settings.mute && vol() > 0 && !document.hidden && !!AC;
  const phaseId = () => { const p = S && S.started ? phase(S) : null; return p && MOOD[p.id] ? p.id : "accum"; }; // straight from the game, not the last page refresh
  function setup(){
    out = AC.createGain(); out.gain.value = 0; out.connect(AC.destination);
    // a room: a reverb made of decaying noise, and an echo for the notes
    const len = AC.sampleRate*3, ir = AC.createBuffer(2, len, AC.sampleRate);
    for(let c=0; c<2; c++){ const d = ir.getChannelData(c); for(let i=0; i<len; i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 3); }
    const verb = AC.createConvolver(); verb.buffer = ir;
    const vg = AC.createGain(); vg.gain.value = 0.55; verb.connect(vg); vg.connect(out);
    const echo = AC.createDelay(2), fb = AC.createGain(); fb.gain.value = 0.35;
    echo.connect(fb); fb.connect(echo); echo.connect(verb); echo.connect(out);
    wet = { verb, echo };
    // the pads share a bus whose brightness and tremolo move with the moment: that's what reacts first
    padIn = AC.createGain(); trem = AC.createGain(); padLp = AC.createBiquadFilter();
    padLp.type = "lowpass"; padLp.frequency.value = MOOD.accum.cut; padLp.Q.value = 0.8;
    padIn.connect(trem); trem.connect(padLp); padLp.connect(out); padLp.connect(verb);
    const lfo = AC.createOscillator(), depth = AC.createGain(); lfo.frequency.value = 5.5; depth.gain.value = 0;
    lfo.connect(depth); depth.connect(trem.gain); lfo.start();
    trem.depth = depth;
    noise = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const nd = noise.getChannelData(0); for(let i=0; i<nd.length; i++) nd[i] = Math.random()*2-1;
  }
  function tone(type, f, at, len, peak, attack, cut, send, o2){ // o2: pan (-1..1), wob (vibrato, in Hz of swing), bus (instead of out and send)
    const o = AC.createOscillator(), g = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = type; o.frequency.value = f;
    lp.type = "lowpass"; lp.frequency.value = cut;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, at + Math.max(attack, len - 2.5));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    let last = g;
    if(o2 && o2.pan && AC.createStereoPanner){ const p = AC.createStereoPanner(); p.pan.value = o2.pan; g.connect(p); last = p; }
    if(o2 && o2.wob){ const l = AC.createOscillator(), d = AC.createGain(); l.frequency.value = 4.5 + Math.random(); d.gain.value = o2.wob; l.connect(d); d.connect(o.frequency); l.start(at); l.stop(at + len + 0.05); }
    o.connect(lp); lp.connect(g);
    if(o2 && o2.bus) last.connect(o2.bus); else { last.connect(out); last.connect(send); }
    o.start(at); o.stop(at + len + 0.05);
  }
  function thump(at, f, peak){ // one soft beat: a low note that drops as it fades
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f*0.62, at + 0.35);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.65);
  }
  function hiss(at, len, peak, from, to, q, send){ // filtered noise: a tick (short, high) or a whoosh (long, sweeping)
    const s = AC.createBufferSource(), bp = AC.createBiquadFilter(), g = AC.createGain();
    s.buffer = noise; s.loop = true;
    bp.type = "bandpass"; bp.Q.value = q; bp.frequency.setValueAtTime(from, at); bp.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01 + len*0.4, 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    s.connect(bp); bp.connect(g); g.connect(out); if(send) g.connect(send);
    s.start(at, Math.random()*0.5); s.stop(at + len + 0.05);
  }
  /* how deep the network is: 1 once the new internet has opened, 2 once it's been turned on */
  const depth = () => !S ? 0 : S.ended ? 2 : (S.stats && S.stats.resets||0) >= NEWNET_NG ? 1 : 0;
  /* what's going on right now, from the buffs */
  function moods(){
    const b = (S && S.buffs) || [], has = k => b.some(x=>x.kind===k);
    return { hype:has("frenzy") || has("hyperpost"), frenzy:has("frenzy"), glow:has("glow") || has("prayer") || has("vigil"),
      choir:has("prayer") || has("vigil"), drama:has("drama") };
  }
  /* the shared things that follow the moment straight away: how bright the pads are, and whether they tremble */
  function follow(md){
    const m = MOOD[cur ? cur.ph : phaseId()], now = AC.currentTime;
    padLp.frequency.setTargetAtTime(m.cut * (md.hype ? 1.8 : 1) * (md.glow ? 1.35 : 1) * (md.drama ? 0.5 : 1), now, 0.6);
    trem.depth.gain.setTargetAtTime(md.drama ? 0.32 : 0, now, 0.8);
  }
  function startBar(at, md){
    const ph = phaseId(), m = MOOD[ph], root = (POST_ROOT[ph]||523)/4, chord = CH[m.prog[bar % m.prog.length]].slice(), len = m.bar;
    // the chord's own level, so it can be let go of early when the market turns
    const bus = AC.createGain(); bus.connect(padIn);
    cur = { ph, m, root, chord, len, at, bus };
    const pa = quick ? 0.5 : 2.2, ba = quick ? 0.25 : 1.2; quick = false; // after a turn it swells in fast, crossing the old one going out
    echoTime(len);
    const spread = md.drama ? 18 : 4; // drama pulls the two voices of each tone apart: seasick
    const tones = md.glow ? chord.concat([chord[0]*9/4]) : chord; // a glow adds the ninth: warmer, wider
    for(const r of tones) for(const det of [-spread, spread])
      tone(det < 0 ? "sine" : "triangle", root*r*Math.pow(2, det/1200), at, len + 2.5, 0.022, pa, 6000, null, { bus });
    tone("sine", root*chord[0]/2, at, len + 1, 0.05, ba, 400, null, { bus }); // the bass, under it
    if(md.drama) tone("sawtooth", root*chord[0]/2*Math.SQRT2, at, len + 1, 0.012, 2.5, 260, null, { bus }); // and a tritone, darker still
    const d = depth();
    if(d >= 2 || md.choir) for(const r of chord) tone("sine", root*2*r, at, len + 2.5, 0.009, 3, 2600, null, { bus, wob:root*2*r*0.006 });
    if(d >= 2) for(const t of [0, len/2]){ thump(at + t, 62, 0.07); thump(at + t + 0.28, 55, 0.045); }
    bar++;
  }
  function playStep(at){
    const md = moods();
    if(step===0) startBar(at, md);
    const { m, root, chord, len } = cur, st = len/STEPS, d = depth();
    // a few notes over it, from the posts' scale: busier in a frenzy, sparser and slipping in drama
    const busy = Math.min(0.9, m.busy + (md.hype ? 0.35 : 0) - (md.drama ? 0.08 : 0));
    if(step % 2===0 && Math.random() < busy){
      let f = root*2*m.oct*PENTA[Math.floor(Math.random()*PENTA.length)]*(Math.random() < (md.hype ? 0.5 : 0.25) ? 2 : 1);
      if(md.drama && Math.random() < 0.35) f *= 16/15; // a half step off: it doesn't sit right
      tone("sine", f, at + Math.random()*0.04, 1.6, 0.03, 0.015, 3200, wet.echo);
    }
    // the arpeggio: deep in, or in a frenzy, up the chord and an octave over it and back down, swaying side to side
    if(d >= 1 || md.hype){
      const notes = chord.concat([chord[0]*2, chord[1]*2]), walk = md.drama ? [4, 3, 2, 1, 0, 1, 2, 3] : [0, 1, 2, 3, 4, 3, 2, 1];
      const pan = Math.sin(step/STEPS*Math.PI*2)*0.45, peak = md.hype ? 0.02 : 0.017;
      if(!md.drama || step % 2===0) tone("triangle", root*2*notes[walk[step % walk.length]], at, 0.9, peak, 0.01, m.cut*(md.hype ? 2.4 : 1.6), wet.echo, { pan });
      if(md.frenzy) tone("triangle", root*4*notes[walk[(step+4) % walk.length]], at + st/2, 0.5, 0.012, 0.005, 4000, wet.echo, { pan:-pan }); // double-time
    }
    if(md.hype && step % 2===1) hiss(at, 0.06, 0.035, 9000, 7000, 1.2); // ticks on the off-beats drive it along
    if(md.glow && Math.random() < 0.16) // bells, drifting over a glow
      tone("sine", root*8*PENTA[Math.floor(Math.random()*PENTA.length)], at + Math.random()*st, 2.6, 0.012, 0.005, 9000, wet.verb, { pan:(Math.random()*2-1)*0.6 });
    step = (step + 1) % STEPS;
  }
  /* a cue for something that just happened, in the key that's playing */
  const CUES = {
    sparkle:(at, r)=>{ for(let i=0; i<6; i++) tone("sine", r*8*PENTA[i % 5]*(i >= 5 ? 2 : 1), at + i*0.07, 1.4, 0.035, 0.004, 9000, wet.echo, { pan:(i/5 - 0.5)*0.8 }); },
    frenzy:(at, r)=>{ hiss(at, 1.1, 0.05, 400, 6000, 0.9, wet.verb); for(let i=0; i<8; i++) tone("triangle", r*2*[1, 5/4, 3/2, 2, 5/2, 3, 4, 5][i], at + 0.35 + i*0.05, 0.6, 0.03, 0.004, 5000, wet.echo); },
    glow:(at, r)=>{ for(const k of [1, 5/4, 3/2, 15/8, 9/4]) tone("sine", r*2*k, at, 3.5, 0.016, 0.7, 4000, wet.verb, { pan:(Math.random()*2-1)*0.4 }); },
    drama:(at, r)=>{ for(const k of [1, 16/15, Math.SQRT2]) tone("sawtooth", r/2*k, at, 3, 0.03, 1.4, 320, wet.verb); hiss(at, 2.4, 0.03, 2000, 200, 0.7, wet.verb); },
    raid:(at, r)=>{ for(const k of [2, 3]) tone("triangle", r*k, at, 1.2, 0.04, 0.01, 3000, wet.echo); tone("triangle", r*4, at + 0.16, 1.2, 0.035, 0.01, 4000, wet.echo); },
    relic:(at, r)=>{ CUES.raid(at, r); CUES.sparkle(at + 0.35, r); },
    phase:(at)=>{ hiss(at, 1.6, 0.045, 300, 5000, 0.8, wet.verb); },
    grass:(at, r)=>{ const run = [4, 10/3, 3, 5/2, 2, 5/3, 3/2, 1]; run.forEach((k, i)=>tone("sine", r*2*k, at + i*0.09, 1.6, 0.03, 0.005, 5000, wet.echo)); for(const k of [1, 5/4, 3/2]) tone("sine", r*k, at + 0.8, 3, 0.02, 0.6, 3000, wet.verb); },
    stage:(at, r)=>{ for(const k of [1/2, 1, 5/4, 3/2, 2, 5/2]) tone("sine", r*k, at, 4.5, 0.022, 1.2, 4500, wet.verb, { wob:r*k*0.004 }); thump(at, 62, 0.08); },
  };
  function cue(name){
    if(!playing || !CUES[name]) return;
    if(name==="phase") turn();
    const r = (POST_ROOT[phaseId()]||523)/4;
    try{ CUES[name](AC.currentTime + 0.03, r); }catch(e){}
  }
  /* the market turned: the chord that's playing lets go, and the next starts now, in the new key, under the whoosh */
  function turn(){
    if(!cur) return;
    const now = AC.currentTime;
    cur.bus.gain.setTargetAtTime(0, now + 0.3, 0.4);
    step = 0; stepAt = Math.min(stepAt, now + 0.3); quick = true; // what's already scheduled plays out (half a second at most)
    loop();
  }
  let lastBar = 0;
  function echoTime(len){ if(len !== lastBar){ lastBar = len; wet.echo.delayTime.setTargetAtTime(len/8*1.5, AC.currentTime, 0.5); } }
  function loop(){
    if(!wanted()){ if(playing){ playing = false; out.gain.setTargetAtTime(0, AC.currentTime, 0.6); } return; }
    if(!out) setup();
    if(AC.state==="suspended") AC.resume();
    if(!playing){ playing = true; stepAt = Math.max(stepAt, AC.currentTime + 0.1); step = 0; } // back from a pause: a fresh chord
    out.gain.setTargetAtTime(vol(), AC.currentTime, 0.8);
    follow(moods());
    while(stepAt < AC.currentTime + 0.6){ const at = stepAt; playStep(at); stepAt = at + cur.len/STEPS; }
  }
  function start(){ // audio can only begin from something the player does: the first click or key wakes it
    if(timer) return;
    try{ AC = AC || new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return; }
    timer = setInterval(loop, 200); loop();
  }
  for(const ev of ["pointerdown", "keydown"]) addEventListener(ev, start, { once:true, capture:true });
  document.addEventListener("visibilitychange", ()=>{ if(timer) loop(); });
  return { start, cue, update:()=>{ if(timer) loop(); } };
})();
