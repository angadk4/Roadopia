# Second-labeler sheet — M4-T03 (owner input)

**What to do:** for each request below, WITHOUT looking at any JSON files, write in plain English what you think the app should understand:

- roughly how long a drive (or "not stated")
- loop or point-to-point (and where to)
- any must-have stops vs nice-to-have stops
- any hard rules (no highways, paved only, avoid somewhere...)
- character (twisty? chill? scenic?)
- and the expected behaviour: **just plan it / ask a question first / refuse / "not our region"**

Sampling rule (deterministic, recorded): every 5th example from DEV and VAL starting at index 2 — 9 DEV + 4 VAL = 13 (~19 % of DEV+VAL).

---

### dev-003

> Half hour of twisty pavement from Belfountain, back where I started

Your reading:

- Duration: 30 min
- Shape: Curvy and twisty
- Stops: None
- Hard rules: Avoid highways, paved only
- Character: Twisty and fun
- Expected behaviour: plan it

---

### dev-008

> Lazy Sunday cruise out of Cobourg along the lake, three hours or so, with somewhere to stretch my legs partway

Your reading:

- Duration: 3 hrs
- Shape: Curvy with straights too
- Stops: 1 stop halfway
- Hard rules: Paved, avoid highways unless along the lake
- Character: Calm and full of views
- Expected behaviour: Ask what kind of stop

---

### dev-013

> 20 minute loop from Milton with three stops - coffee, a lookout, and lunch

Your reading:

- Duration: 20 min
- Shape: doesnt matter
- Stops: coffee shop, nice lookout, fast food
- Hard rules: Paved road, avoid highways
- Character: Fun and laid back
- Expected behaviour: plan it

---

### dev-018

> Hour and a half from Hockley - string together a couple of the great driving roads around there

Your reading:

- Duration: 90 min
- Shape: Twisty and curvy
- Stops: None
- Hard rules: Paved only, avoid highways
- Character: Fun and exciting
- Expected behaviour: Plan it

---

### dev-023

> 45 min loop from Cayuga, twisty as you can make it

Your reading:

- Duration: 45 min
- Shape: Extremely twisty and curvy lots of turns and twists
- Stops: None
- Hard rules: Paved road only, no highways ideally
- Character: Exhilerating
- Expected behaviour: Plan it

---

### dev-028

> Loop from Cayuga, 2 hrs, gravel is fine - kinda prefer it honestly - quiet farm roads

Your reading:

- Duration: 2 hrs
- Shape: Doesnt matter
- Stops: None
- Hard rules: No highways, mix gravel and paved roads
- Character: Calm and very rural
- Expected behaviour: plan it

---

### dev-033

> waterdown to cayuga on backroads, and dodge the construction around downtown hamilton

Your reading:

- Duration: any
- Shape: twisty or straight
- Stops: none
- Hard rules: Backroads only, no main hamilton construction roads
- Character: Quick but fun
- Expected behaviour: ask wehre the construction is

---

### dev-038

> wherever i am right now - 2 hr scenic loop, no ferries

Your reading:

- Duration: 2 hours
- Shape: curvy
- Stops: None
- Hard rules: No ferries, paved road only
- Character: Fun
- Expected behaviour: Plan it

---

### dev-043

> Three hours from Milton: escarpment twisties, coffee AND lunch stops, at least one lookout, all paved, and skip any tolls

Your reading:

- Duration: 3 hours
- Shape: Twisty and curvy
- Stops: 1 coffe stop 1 lunch stop 1 lookout spot stop
- Hard rules: Paved and no tolls
- Character: Fun, road trip, exciting
- Expected behaviour: plan it

---

### val-003

> need to get from Mississauga over to Dundas but make it fun — got maybe 90 min, twisty bits appreciated, skip the 403

Your reading:

- Duration: 90 min
- Shape: Twisty curvy turny
- Stops: None
- Hard rules: No 403, no highways, paved roads
- Character: Fun and exhilerating
- Expected behaviour: Plan it

---

### val-008

> 90 min twisty loop outta Creemore along the river valley roads, coffee in town after would be nice

Your reading:

- Duration: 90 min
- Shape: Twisty
- Stops: Coffee at the end back in Creemore
- Hard rules: No highways, river valley roads only, paved roads
- Character: Fun and twisty and exciting
- Expected behaviour: Plan it

---

### val-013

> Fergus to Owen Sound the pretty way — no rush, we have the whole afternoon, three hours is fine, and old small towns along the route are a bonus

Your reading:

- Duration: 2-3 hrs
- Shape: Curvy
- Stops: SMall town along the route, 1 stop
- Hard rules: No highways, back/country roads only, paved roads
- Character: Calm and fun
- Expected behaviour: Plan it

---

### val-018

> two hour loop with fall colours and a coffee about halfway

Your reading:

- Duration: 2 hrs
- Shape: Curvy and twisty
- Stops: Coffee halfway
- Hard rules: Forest roads, lots of trees, country roads, no hgihways, paved roads
- Character: Fun ASF
- Expected behaviour: Plan it

---

**When done:** paste your answers back in chat; the agent scores agreement (exact on hard fields, band overlap on durations) and adjudicates any differences, per Protocol §7.3.
