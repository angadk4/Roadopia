import io

p = 'scratchpad/mayfield-audit.html'
s = io.open(p, encoding='utf-8').read()
fails = []


def rep(old, new, tag, cnt=1):
    global s
    if old not in s:
        fails.append(tag)
        return
    s = s.replace(old, new, cnt)


rep("--a: #e5484d; --b: #2fa35b; --r: #efa321; --o: #98a1ad; --origin: #3a5bd9;",
    "--a: #e5484d; --b: #2fa35b; --c: #2d9d9b; --r: #efa321; --o: #98a1ad; --origin: #3a5bd9;", 'pal-l', 2)
rep("--a: #ff6b6f; --b: #52c47e; --r: #f7b53f; --o: #7c8794; --origin: #6d86f0;",
    "--a: #ff6b6f; --b: #52c47e; --c: #4fc2c0; --r: #f7b53f; --o: #7c8794; --origin: #6d86f0;", 'pal-d', 2)

rep("  .sw.a { background: var(--a); } .sw.b { background: var(--b); } .sw.r { background: var(--r); } .sw.o { background: var(--o); }",
    "  .sw.a { background: var(--a); } .sw.b { background: var(--b); } .sw.c { background: var(--c); } .sw.r { background: var(--r); } .sw.o { background: var(--o); }", 'sw')

rep("""    <div class="legend" aria-label="road class legend">
      <span class="key"><i class="sw a"></i>arterial / main road</span>
      <span class="key"><i class="sw b"></i>backroad</span>
      <span class="key"><i class="sw r"></i>residential</span>
      <span class="key"><i class="sw o"></i>other</span>
      <span class="key"><i class="dot origin"></i>home (your pin)</span>
    </div>""",
"""    <div class="legend" aria-label="road context legend">
      <span class="key"><i class="sw a"></i>in town (any road)</span>
      <span class="key"><i class="sw c"></i>country main road (fine)</span>
      <span class="key"><i class="sw b"></i>country backroad</span>
      <span class="key"><i class="sw r"></i>residential lane</span>
      <span class="key"><i class="sw o"></i>other</span>
      <span class="key"><i class="dot origin"></i>home (your pin)</span>
    </div>""", 'legend')

rep("  const CLASS_COLOR = { A: 'var(--a)', B: 'var(--b)', R: 'var(--r)', O: 'var(--o)' };",
    "  const CLASS_COLOR = { U: 'var(--a)', C: 'var(--c)', B: 'var(--b)', A: 'var(--a)', R: 'var(--r)', O: 'var(--o)' };", 'cmap')

rep("""  function verdict(r){
    if (!isRouted(r)) return 'bad';
    if ((r.arterialPct>=70)||(r.uturns>0)||(r.loopiness<0.2)||(r.selfOverlap>0.25)||(r.corridorDoubling>0.35)) return 'bad';
    if ((r.arterialPct>=50)||(r.selfOverlap>0.15)||(r.loopiness<0.35)||(r.corridorDoubling>0.2)) return 'mixed';
    return 'good';
  }
  function artColor(p){ return p>=70?'var(--bad)':p>=50?'var(--mixed)':'var(--good)'; }
  function flags(r){
    const f=[];
    if(!isRouted(r)){ f.push(['bad',(r.status||'no route').toUpperCase()]); return f; }
    f.push(['art',`${r.arterialPct}% main-road`, artColor(r.arterialPct)]);
    if(r.uturns>0) f.push(['bad',`${r.uturns} U-turn${r.uturns>1?'s':''}`]);
    if(r.selfOverlap>0.2) f.push(['bad','back-and-forth']);
    else if(r.selfOverlap>0.12) f.push(['mixed','some overlap']);
    if(r.corridorDoubling>0.3) f.push(['bad','doubles back']);
    if(r.loopiness<0.2) f.push(['bad','barely a loop']);
    if(r.snapOffsetM>200) f.push(['mixed',`starts ${r.snapOffsetM}m off`]);
    if(r.status==='relaxed') f.push(['mixed','relaxed']);
    if(f.length===1) f.push(['ok','clean shape']);
    return f;
  }""",
"""  function verdict(r){
    if (!isRouted(r)) return 'bad';
    if ((r.urbanPct>=35)||(r.uturns>0)||(r.loopiness<0.2)||(r.selfOverlap>0.25)||(r.corridorDoubling>0.35)) return 'bad';
    if ((r.urbanPct>=18)||(r.selfOverlap>0.15)||(r.loopiness<0.35)||(r.corridorDoubling>0.2)) return 'mixed';
    return 'good';
  }
  function urbColor(p){ return p>=35?'var(--bad)':p>=18?'var(--mixed)':'var(--good)'; }
  function flags(r){
    const f=[];
    if(!isRouted(r)){ f.push(['bad',(r.status||'no route').toUpperCase()]); return f; }
    f.push(['art',`${r.urbanPct}% in town`, urbColor(r.urbanPct)]);
    if(r.introMin>=8) f.push(['mixed',`opens after ~${r.introMin}min`]);
    if(r.uturns>0) f.push(['bad',`${r.uturns} U-turn${r.uturns>1?'s':''}`]);
    if(r.selfOverlap>0.2) f.push(['bad','back-and-forth']);
    else if(r.selfOverlap>0.12) f.push(['mixed','some overlap']);
    if(r.corridorDoubling>0.3) f.push(['bad','doubles back']);
    if(r.loopiness<0.2) f.push(['bad','barely a loop']);
    if(r.status==='relaxed') f.push(['mixed','relaxed']);
    if(f.length===1) f.push(['ok','country-clean']);
    return f;
  }""", 'verdict')

rep("""  function agg(set){
    const routed=set.routes.filter(isRouted);
    return {
      art: Math.round(mean(routed.map(r=>r.arterialPct))),
      artHeavy: pct(routed.filter(r=>r.arterialPct>=70).length, routed.length),
      curv: mean(routed.map(r=>r.curviness)).toFixed(2),
      ctry: mean(routed.map(r=>r.countryScore)).toFixed(2),
      good: set.routes.filter(r=>verdict(r)==='good').length,
      bad: set.routes.filter(r=>verdict(r)==='bad').length,
      noroute: set.routes.length - routed.length,
    };
  }""",
"""  function agg(set){
    const routed=set.routes.filter(isRouted);
    return {
      urb: Math.round(mean(routed.map(r=>r.urbanPct))),
      urbHeavy: pct(routed.filter(r=>r.urbanPct>=35).length, routed.length),
      art: Math.round(mean(routed.map(r=>r.arterialPct))),
      curv: mean(routed.map(r=>r.curviness)).toFixed(2),
      ctry: mean(routed.map(r=>r.countryScore)).toFixed(2),
      good: set.routes.filter(r=>verdict(r)==='good').length,
      bad: set.routes.filter(r=>verdict(r)==='bad').length,
      noroute: set.routes.length - routed.length,
    };
  }""", 'agg')

rep("""    el.innerHTML =
      row('avg main-road %', D.art+'%', B.art+'%') +
      row('≥70% arterial', D.artHeavy+'%', B.artHeavy+'%') +
      row('avg curviness', D.curv, B.curv, false) +
      row('avg countryness', D.ctry, B.ctry, false) +
      row('rated good', D.good, B.good, false) +
      row('rated bad', D.bad, B.bad) +""",
"""    el.innerHTML =
      row('avg % in town', D.urb+'%', B.urb+'%') +
      row('town-heavy (≥35%)', D.urbHeavy+'%', B.urbHeavy+'%') +
      row('avg main-road %', D.art+'%', B.art+'%') +
      row('avg curviness', D.curv, B.curv, false) +
      row('avg countryness', D.ctry, B.ctry, false) +
      row('rated good', D.good, B.good, false) +
      row('rated bad', D.bad, B.bad) +""", 'sb')

rep("  function metricLine(r){ return isRouted(r)? [`curv ${r.curviness}`,`loop ${r.loopiness}`,`ctry ${r.countryScore}`].join('   ') : (r.status||'no route'); }",
    "  function metricLine(r){ return isRouted(r)? [`curv ${r.curviness}`,`art ${r.arterialPct}%`,`loop ${r.loopiness}`].join('   ') : (r.status||'no route'); }", 'mline')

rep("""        <select id="sort">
          <option value="art">most arterial first</option>""",
"""        <select id="sort">
          <option value="art">most in-town first</option>""", 'sortopt')
rep("      if(sort==='art') return (b.arterialPct??-1)-(a.arterialPct??-1);",
    "      if(sort==='art') return (b.urbanPct??-1)-(a.urbanPct??-1);", 'sortfn')

rep("    const mm=[`${r.durationMin} min · ${r.distanceKm} km`,`main-road ${r.arterialPct}%   countryness ${r.countryScore}`,`curviness ${r.curviness}   loopiness ${r.loopiness}`,`overlap ${r.selfOverlap}   U-turns ${r.uturns}`].join('<br>');",
    "    const mm=[`${r.durationMin} min · ${r.distanceKm} km`,`in town ${r.urbanPct}%   main-road ${r.arterialPct}%`,`curviness ${r.curviness}   countryness ${r.countryScore}`,`opens after ${r.introMin??0} min   U-turns ${r.uturns}`].join('<br>');", 'modal')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('fails:', fails)
