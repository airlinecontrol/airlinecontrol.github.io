# AGENTS.md — AeroSim Airline Manager

## Purpose of this file

This repository is a handoff from a long-running ChatGPT prototyping session to local Codex.

Treat this file as the primary project-context document before changing code. Read the current source completely before making architectural changes. Preserve working behavior unless a task explicitly asks to replace it.

The current prototype source is split into:

- `airline-manager-mvp-v9.2.html`
- `aerosim.css`
- `aerosim.js`

It intentionally remains a plain HTML/CSS/JavaScript prototype without a framework or build step. The next major engineering step can be a controlled refactor to Vite + TypeScript, but do not perform that refactor incidentally while implementing an unrelated feature.

---

# 1. Product vision

AeroSim is a browser-based airline management / operations simulation.

The desired feeling is a combination of:

- FlightRadar24-style live map
- airline tycoon / management game
- operations control center
- aircraft rotation planning
- airport slot management
- real-time disruption management

The core map should feel alive: aircraft move in real time, schedules exist independently of UI rendering, delays propagate through operations, and the player makes operational decisions such as swapping aircraft when one becomes unavailable.

## Important product constraints

### Browser-first

The current single-player game should run in the browser.

There is currently **no game backend/server**.

Internet access is allowed for external presentation/data services such as:

- map tiles
- future live weather APIs
- other public data APIs that do not require a secret server-side key

Do not introduce a required game backend unless explicitly asked.

### Real-world time is the default

The simulation is timestamp-derived rather than frame-derived.

Flights should continue conceptually while the browser is closed. The authoritative position of a flight comes from time:

```text
progress =
    (simulationNow - actualDeparture)
    / (actualArrival - actualDeparture)
```

Do not persist an aircraft position every frame.

Persistent state should contain events/timestamps and the UI should derive current positions from them.

### Accelerated test speeds are intentional

The UI currently supports:

- 1x real time
- 10x
- 60x
- 300x

These are primarily useful for testing long-running scheduling and disruption behavior.

---

# 2. Current technical form

The current prototype uses three browser-native files:

- `airline-manager-mvp-v9.2.html` for the HTML UI
- `aerosim.css` for styling
- `aerosim.js` for state, simulation, and rendering
- Leaflet map integration

External browser dependencies:

- Leaflet 1.9.4 CSS/JS from cdnjs
- CARTO dark map tiles

The map therefore needs internet access, but game state and simulation logic are local.

## Why Leaflet instead of MapLibre right now

The first prototype used MapLibre GL JS.

Opening the game directly via `file://` caused a browser Web Worker cross-origin restriction:

```text
Refused to cross-origin redirects of the top-level worker script
```

Leaflet was selected for the single-file prototype because it works when the HTML file is opened directly from disk.

Long term, once the project is served through a normal Vite/static development server, moving back to MapLibre is desirable for GPU-backed rendering and larger fleets.

Do not interpret the use of Leaflet as a permanent architecture decision.

---

# 3. Persistence and compatibility

Current constants:

```js
const VERSION = 6;
const SAVE_KEY = 'aerosim_mvp_v6';
```

The visible prototype filename has advanced beyond v6, but the state version/save key intentionally remained stable so previous prototype saves could continue loading.

Persistence currently uses:

```js
localStorage
```

The code contains additive migration logic.

Future production-quality persistence should probably use:

- IndexedDB and/or
- OPFS

but preserve compatibility when migrating existing user saves.

---

# 4. Simulation clock

State contains:

```js
clock: {
  realBase,
  simBase,
  speed
}
```

Simulation time is calculated as:

```js
function simNow() {
  return state.clock.simBase
    + (Date.now() - state.clock.realBase)
    * state.clock.speed;
}
```

Changing speed rebases the clock before applying the new multiplier.

This design is deliberate.

Do not replace it with a frame-counting simulation timer.

---

# 5. Current game state model

Approximate root state:

```js
{
  version,
  clock,

  cash,
  home,

  nextAircraft,
  nextFlight,
  nextService,
  nextSlotRight,

  aircraft: [],
  flights: [],
  services: [],
  slotRights: [],

  ops: {
    automaticDisruptions: true
  },

  stats: {
    revenue,
    costs,
    pax,
    completed
  }
}
```

## Important finance caveat

Current header metrics are not a full accounting system.

At present:

- `cash` changes from aircraft/slot purchases and completed-flight profit
- `stats.revenue` is completed passenger-flight revenue
- `stats.costs` is completed flight operating cost
- displayed Net P/L is effectively flight revenue minus flight operating costs

Buying/selling aircraft or slot rights affects cash but does **not** currently affect Revenue or Net P/L.

This confused the user and should eventually be redesigned into clearer accounting metrics, e.g.:

- Cash
- Flight revenue
- Operating profit
- Assets/company value

Potential future simplified accounting:

```text
Revenue
- flight operating costs
- maintenance
- staff
- airport/handling fees
= operating profit

- depreciation
- financing
= net profit
```

Do not treat an aircraft purchase price as an immediate operating expense.

---

# 6. Airports

Current airports:

- FRA — Frankfurt
- LHR — London Heathrow
- JFK — New York JFK
- MAD — Madrid
- AMS — Amsterdam
- CDG — Paris CDG
- FCO — Rome Fiumicino
- DXB — Dubai
- SIN — Singapore
- HND — Tokyo Haneda

Each airport has latitude/longitude.

There is also a simplified operations configuration:

```js
AIRPORT_OPS = {
  airport: {
    slotIntervalMin,
    graceMin
  }
}
```

Current values are generally 10- or 15-minute slot cadences with 8- or 10-minute grace windows.

This is a game abstraction, not a literal representation of real airport coordination rules.

---

# 7. Aircraft types

Current models:

## A320neo

```text
Seats:        186
Speed:        835 km/h
Max range:    6,300 km
Purchase:     €48M
Cost/km:      8.2
```

## A330-900

```text
Seats:        287
Speed:        870 km/h
Max range:    13,300 km
Purchase:     €110M
Cost/km:      15.4
```

Initial fleet:

- D-AS01 — A320neo — FRA
- D-AS02 — A320neo — MAD
- D-AS03 — A330-900 — FRA

Aircraft currently store a physical airport location while on the ground.

Technical defects add:

```js
defectUntil
defectReason
```

---

# 8. Flight model

A flight has planned times:

```js
departure
arrival
```

and operationally derived actual times:

```js
actualDeparture
actualArrival
```

Important delay fields:

```js
handlingDelayMin
technicalDelayMin
enrouteDelayMin
propagatedDelayMin
slotDelayMin

slotMissed
assignedSlot

opsChecked
enrouteChecked
slotLogged
```

Other fields include:

```js
id
aircraftId
from
to
fare
load
pax
revenue
costs
settled
departureLogged

serviceId
serviceLeg // outbound | return
```

## Planned vs actual time

Always preserve the distinction.

Planned timetable:

```js
f.departure
f.arrival
```

Operational timetable:

```js
flightActualDeparture(f)
flightActualArrival(f)
```

Do not overwrite the original planned times when applying delays.

The timeline intentionally displays both.

---

# 9. Flight economics

The current demand/economics model is intentionally lightweight.

Approximate logic:

- great-circle distance
- aircraft seat count
- fare relative to route-derived base fare
- deterministic route factor
- resulting load factor
- passenger count
- ticket revenue
- operating cost from distance + block-time overhead

Important function:

```js
estimateFlight(from, to, aircraft, fare)
```

It returns approximately:

```js
{
  km,
  duration,
  rangeOk,
  load,
  pax,
  revenue,
  costs,
  profit
}
```

This should eventually become a much richer demand model.

Potential future factors:

- city-pair demand
- time of day
- weekday/weekend
- competition
- frequency
- fare
- connections
- airport attractiveness
- airline reputation
- seasonality

---

# 10. Recurring schedules

Recurring schedules are first-class rule definitions.

Current service shape:

```js
{
  id,
  aircraftId,

  from,
  to,

  fare,
  rule,
  turnaroundMin,

  firstDeparture,
  nextDeparture,
  lastGeneratedDeparture,

  originSlotRightId,
  destinationSlotRightId,

  active,
  createdAt
}
```

Current recurrence rules:

- daily
- weekdays
- every 2 days
- weekly

A recurring service currently represents a round trip assigned to one primary aircraft:

```text
FRA -> AMS
turnaround
AMS -> FRA
repeat
```

This was chosen to avoid physically impossible repeated one-way schedules.

## Rolling materialization horizon

Recurring rules are conceptually indefinite, but flight instances are materialized only into a rolling future horizon.

Current horizon:

```text
14 days
```

Function:

```js
ensureRecurringFlights()
```

A guard prevents runaway generation.

This pattern is intentional.

Do not generate an infinite list of future flight objects.

---

# 11. Aircraft substitution

Operational aircraft changes are a major gameplay feature.

There are two concepts:

## Substitute one round trip

A spare aircraft operates only one selected outbound/return pair.

Primary function:

```js
substituteSelectedRotation(flightId, newAircraftId)
```

The recurring service remains owned by its original aircraft for later rotations.

## Permanently change schedule aircraft

Primary function:

```js
changeServiceAircraft(serviceId, newAircraftId)
```

All future unstarted rotations are assigned to the replacement aircraft.

## Replacement constraints

A candidate spare currently must generally:

- be at the schedule base airport
- not be defective
- have enough range
- not already own another active recurring schedule
- have no conflicting flights during the replacement window

Flight Details is the primary UX for switching aircraft.

Clicking a future recurring flight should show a visible:

```text
Switch aircraft for this flight
```

panel with:

- Sub this round trip
- Change future schedule

If no spare is available, explain why instead of silently hiding the feature.

---

# 12. Disruption model

Automatic disruptions can be enabled/disabled.

Current random disruption categories:

## Ground handling

A pre-departure ground-handling delay may be generated.

Examples conceptually include:

- baggage
- catering
- boarding
- cleaning
- fueling
- pushback

These are currently abstracted into:

```js
handlingDelayMin
```

## Technical defect

An aircraft can become unavailable until:

```js
defectUntil
```

Technical delay affects upcoming operations and makes aircraft substitution useful.

## En-route disruption

Airborne flights can gain additional arrival delay:

```js
enrouteDelayMin
```

---

# 13. Delay propagation

Function:

```js
recalculateOperations()
```

is central.

For every aircraft, flights are processed in scheduled order.

The system calculates:

1. planned departure
2. direct handling/technical delay
3. previous flight actual arrival
4. minimum turnaround
5. propagated inbound delay
6. slot grace-window check
7. reassigned slot if original slot is missed
8. actual departure
9. actual arrival
10. en-route delay

Minimum turn currently uses:

```js
MIN_TURN_MIN = 35
```

This is intentionally a simplified global minimum, even though each recurring schedule also has its own planned turnaround.

A desirable future improvement is aircraft/airport-specific minimum turn time.

---

# 14. Operational airport slots

There are two different slot concepts in the game.

Do not merge them accidentally.

## A. Strategic slot-series right

This is an airline-owned recurring timetable asset.

Stored in:

```js
state.slotRights
```

Used by recurring schedules.

## B. Temporary operational replacement slot

If a delayed aircraft misses its planned slot, the operations engine gives it the next simulated departure opportunity.

This is:

```js
f.assignedSlot
f.slotMissed
f.slotDelayMin
```

A temporary recovery slot does NOT become a permanent asset in the airline slot portfolio.

---

# 15. Slot-right portfolio

A recurring round trip requires two rights:

```text
origin departure right
destination return-departure right
```

Service fields:

```js
originSlotRightId
destinationSlotRightId
```

Slot right shape:

```js
{
  id,
  airport,
  minuteOfDay,
  price,
  source,
  acquiredAt
}
```

Sources currently include:

```text
market
grandfathered
```

## Slot market pricing

Current market is an intentionally game-like abstraction.

Pricing varies by:

- airport base value
- airport scarcity multiplier
- peak/off-peak time

Do not present these values as real-world market prices.

## Existing-save migration

When old saves are loaded, existing recurring schedules are granted zero-cost historic/grandfathered rights matching their already-existing timetable.

This prevents upgrades from breaking an airline.

Preserve this migration philosophy.

## Sale

Unused market-acquired rights may currently be sold for:

```text
70% of acquisition price
```

Grandfathered rights are not sold through this simple mechanism.

---

# 16. Slot-aware scheduling

The recurring scheduler determines:

1. requested first departure
2. next valid airport slot grid time at origin
3. outbound duration
4. turnaround
5. next valid slot grid time at destination
6. required origin/destination slot rights

Function:

```js
requiredSlotPlan(...)
```

The scheduler preview shows rights as:

```text
OWNED
NEEDED
```

and can buy missing rights directly.

One-time flights currently remain ad-hoc and do not require buying a recurring slot series.

---

# 17. Slot delay behavior

A flight can depart within an airport-specific grace period around its planned departure opportunity.

If aircraft ready time exceeds the grace period:

```js
slotMissed = true
```

and the next slot is found using:

```js
nextSlotTime(...)
```

This creates cascades such as:

```text
late inbound
-> compressed turnaround
-> late aircraft readiness
-> original slot missed
-> extra slot delay
-> late arrival
-> next rotation affected
```

This cascading behavior is a desired core gameplay mechanic.

---

# 18. Map

Leaflet map occupies the upper portion of the central workspace.

It displays:

- airports
- flight routes
- aircraft markers
- moving aircraft positions

Movement is great-circle interpolated.

Aircraft click:

```text
opens aircraft details
```

Flight route click:

```text
opens flight details
```

Important performance/click fix:

Do NOT call `marker.setIcon()` every animation frame.

An earlier version did this and Leaflet replaced marker DOM elements continuously, causing click failures between pointer-down and pointer-up.

Current behavior computes an icon signature/key and changes the icon only if visual state actually changed.

Preserve this.

Long term, MapLibre/custom GPU layers are likely better for hundreds/thousands of aircraft.

---

# 19. Main layout

Current desktop layout:

```text
LEFT SIDEBAR       CENTER WORKSPACE        RIGHT DETAILS
scheduler          map                     flight/aircraft details
services           ----------------
slot market        draggable splitter
fleet/purchases    ----------------
                   schedule timeline
```

The center workspace starts approximately:

```text
50% map
50% schedule
```

A horizontal draggable splitter lets the user resize it.

The split percentage is stored locally using:

```js
aerosim_center_split_pct
```

Leaflet must receive:

```js
map.invalidateSize(...)
```

after meaningful resizing.

---

# 20. Schedule timeline

The lower central panel is an operational aircraft timeline.

It has:

- one horizontal row per aircraft
- 24-hour and 48-hour views
- previous 12h / Now / next 12h controls
- moving NOW line
- flight blocks
- turnaround/connection lines
- slot markers

Flight blocks are positioned using **actual** operational times.

Delayed flights preserve the original planned position as a dashed ghost block.

A delayed flight therefore shows:

```text
planned ghost
actual shifted flight block
```

Flight blocks show:

```text
S HH:MM-HH:MM
A HH:MM-HH:MM
```

for scheduled vs actual times.

## Slot markers

Timeline legend/states:

```text
SLOT    original planned departure slot
MISSED  original slot was missed
NEW     reassigned operational departure slot
```

Slot markers are clickable and open Flight Details.

## Turnaround/connection lines

Consecutive flights assigned to the same aircraft are connected.

A red mismatch line indicates physical airport discontinuity:

```text
previous.to != next.from
```

This is a valuable debugging/operations signal.

---

# 21. Selection model

There are two selections:

```js
selectedAircraftId
selectedFlightId
```

## Aircraft selection

Clicking an aircraft marker clears flight selection and opens general aircraft details.

## Flight selection

Clicking:

- flight list row
- timeline flight block
- route line
- timeline slot marker

sets:

```js
selectedFlightId
selectedAircraftId
```

and opens the selected flight in the right Details pane.

Flight Details is deliberately the primary home for aircraft substitution.

---

# 22. Right Details pane

When a flight is selected it shows approximately:

- flight ID
- route
- scheduled times
- actual/expected times
- aircraft
- recurring schedule ID
- passengers
- load factor
- departure delay
- arrival delay
- slot state
- airport slot cadence
- owned slot right
- delay breakdown
- aircraft substitution controls

When an aircraft is selected it shows general aircraft/operational information.

---

# 23. Operations testing controls

The right side has an Operations Simulation section.

Current test actions:

```text
+30m handling
Technical defect
```

Technical defect test currently creates approximately 3 hours of aircraft unavailability.

These controls exist to make disruption behavior testable without waiting for random events.

Automatic disruption generation can be toggled.

---

# 24. Operations log

The visible operations log was intentionally removed at the user's request.

Current:

```js
function logEvent() {
  /* operations log intentionally disabled */
}
```

Do not re-add a scrolling log unless explicitly requested.

A better future alternative could be contextual notifications/events rather than a permanent log panel.

---

# 25. Top KPI bar

Current top area contains:

- Cash
- Fleet
- Airborne
- Simulation time
- Simulation speed

Top-right airline overview currently includes:

- Revenue
- Net P/L
- Passengers
- Completed

As noted earlier, Revenue and Net P/L currently represent completed flight operations only.

The user has already noticed this ambiguity.

Consider relabeling or redesigning the finance KPIs before adding more financial systems.

---

# 26. Scheduler UI

Current scheduler includes:

- Schedule type
  - recurring round trip
  - one-time one-way
- departure airport
- destination airport
- aircraft
- actual HH:MM first-departure time input
- fare
- repeat rule
- return turnaround

The old "depart in X minutes" dropdown was intentionally replaced by a real time picker.

The selected time is interpreted in the browser/simulation local clock.

If selected HH:MM already passed, the initial timestamp resolves to the next day.

---

# 27. Critical UI stability rule

THIS SECTION IS IMPORTANT.

A serious bug occurred because the high-frequency simulation refresh rebuilt native form controls approximately every second.

Symptoms:

- combo boxes flickered
- popup menus closed unexpectedly
- selected values appeared not to apply
- departure/destination values could be overwritten

The fix in v9.2 is architectural.

## Never rebuild active form controls in the animation/UI loop

Current structural UI uses signatures:

```js
aircraftSelectSignature
servicesUiSignature
slotPortfolioSignature
```

Functions such as:

```js
refreshAircraftSelect(force=false)
refreshServices(force=false)
refreshSlotPortfolio(force=false)
refreshSelectedPanel(force=false)
```

avoid replacing DOM unless underlying data actually changed.

They also check focus, e.g.:

```js
document.activeElement
```

and refuse to rebuild a panel/control while the user is interacting with it.

## Scheduler route fields

Background refresh must NEVER mutate:

```text
Departure
Destination
```

An earlier bug came from:

```js
refreshAircraftSelect()
```

forcing:

```js
originEl.value = selectedAircraft.location
```

on every refresh.

That side effect was removed.

Only an explicit user change of the Aircraft dropdown may synchronize Departure to the aircraft's current physical location.

Changing aircraft must never change Destination.

If aircraft location does not match selected departure airport, show validation rather than silently rewriting fields.

Do not regress this behavior.

---

# 28. Current refresh strategy

The animation loop updates visual/read-only values frequently.

Structural/form UI is signature/focus guarded.

Conceptually:

```text
frequent:
  aircraft positions
  clock
  timeline NOW marker
  status/read-only displays

only when data changes:
  select option lists
  recurring service cards
  slot portfolio
  replacement-aircraft controls
```

Keep this separation.

A future TypeScript refactor should formalize this into reactive state/events rather than broad `refreshAll()` calls.

---

# 29. Current known architecture limitations

The prototype has grown beyond what one HTML file should reasonably contain.

Known limitations:

## Monolithic source

Simulation, state, persistence, UI, map, scheduling, slots and economics are all in one script.

## One recurring service effectively reserves one primary aircraft

The next major scheduling model should allow proper rotations:

```text
D-AS01

06:00 FRA -> LHR
09:00 LHR -> FRA
12:00 FRA -> AMS
15:00 AMS -> FRA
18:00 FRA -> CDG
21:00 CDG -> FRA
```

rather than one aircraft being bound to only one route definition.

## No true fleet-pool assignment

Future design should distinguish:

```text
route/service timetable
aircraft rotation
flight instance
```

## localStorage

Not ideal as data grows.

## DOM-heavy Leaflet aircraft markers

Not ideal for very large fleets.

## Random disruptions use Math.random()

This makes simulation non-deterministic and difficult to replay/test.

A seeded PRNG/event generator would be preferable.

## Simplified slots

Real slot coordination is more nuanced than the current market/cadence abstraction.

## Simplified finance

No balance sheet, depreciation, financing, maintenance reserves, leasing or company valuation.

---

# 30. Recommended future architecture

When explicitly asked to refactor, recommended target:

```text
aerosim/
├── package.json
├── index.html
├── AGENTS.md
├── src/
│   ├── main.ts
│   │
│   ├── simulation/
│   │   ├── World.ts
│   │   ├── SimulationClock.ts
│   │   ├── EventQueue.ts
│   │   ├── Aircraft.ts
│   │   ├── Flight.ts
│   │   ├── FlightScheduler.ts
│   │   ├── Rotation.ts
│   │   ├── RecurringService.ts
│   │   ├── Disruptions.ts
│   │   ├── AirportSlots.ts
│   │   └── Economy.ts
│   │
│   ├── data/
│   │   ├── airports.ts
│   │   └── aircraftTypes.ts
│   │
│   ├── persistence/
│   │   └── database.ts
│   │
│   ├── map/
│   │   ├── MapController.ts
│   │   ├── AircraftLayer.ts
│   │   └── RouteLayer.ts
│   │
│   └── ui/
│       ├── Scheduler.ts
│       ├── Timeline.ts
│       ├── FleetPanel.ts
│       ├── FlightDetails.ts
│       ├── AircraftDetails.ts
│       └── SlotPortfolio.ts
└── tests/
```

Recommended tooling:

- TypeScript
- Vite
- deterministic simulation core
- Web Worker for authoritative simulation ticks/event processing
- IndexedDB/OPFS persistence
- MapLibre after moving away from direct `file://` execution

A static Vite application hosted on GitHub Pages / Netlify / Cloudflare Pages still satisfies the "no game backend" goal.

---

# 31. Simulation-engine design direction

Long term the simulation engine should be independent of the DOM.

Preferred flow:

```text
UI
  -> commands
Simulation
  -> state/events
Persistence
  -> snapshots/event records

UI
  <- derived view model
```

The map and timeline should render simulation state, not contain business logic.

Potential Web Worker boundary:

```text
main thread:
  UI
  Leaflet/MapLibre
  controls

worker:
  simulation clock
  recurring flight materialization
  disruptions
  rotation propagation
  slot calculations
  economy/events
```

The browser can still animate aircraft smoothly between authoritative updates.

---

# 32. Offline/reopen behavior

Current design philosophy:

Do not simulate every second that the browser was closed.

On reopen:

- derive simulation current time
- materialize missing recurring flights
- reconcile departures/arrivals
- settle completed flights
- update aircraft locations
- process significant events

For a much longer offline duration, a future event queue/aggregation path should avoid iterating huge numbers of tiny ticks.

---

# 33. Weather roadmap

Weather has not yet been integrated.

Desired future behavior:

- browser-accessible public API
- no server-side secret required if possible
- cache results
- airport wind
- route winds
- storms
- delay probability
- flight-time effects
- airport operational effects

Weather should feed the same operations engine rather than becoming a separate animation-only effect.

---

# 34. Passenger connections roadmap

Current timeline "connections" are aircraft operational connections/turnarounds.

Future passenger connection logic could model:

```text
FRA -> AMS
           AMS -> JFK
```

with:

- minimum connection time
- connecting demand
- missed connections from delays
- protected vs unprotected itineraries
- hub attractiveness
- bank structures

This is not currently implemented.

---

# 35. Testing expectations before completing a Codex change

For every meaningful change:

## Static validation

At minimum extract/check the inline JavaScript with Node:

```bash
node --check <extracted-script.js>
```

If refactored to Vite/TypeScript, use appropriate:

```bash
npm test
npm run build
npm run typecheck
```

as available.

## Manual smoke tests

Verify at minimum:

1. page loads with no console errors
2. map loads when internet is available
3. speed selector remains usable
4. aircraft map click opens aircraft details
5. flight list click opens flight details
6. timeline flight click opens flight details
7. scheduler select values remain stable and do not flicker
8. departure and destination do not rewrite each other
9. recurring schedule can be created when slot rights exist
10. missing slot rights can be acquired
11. slot portfolio updates
12. delay can shift actual flight time without modifying planned time
13. missed slot creates NEW operational slot marker
14. substitute-aircraft flow works when a suitable spare exists
15. split-pane resize keeps map valid
16. reload preserves state

## Important regression test

Open a native `<select>` and interact with it for several seconds while simulation is running.

The dropdown must not:

- flicker
- close due to background refresh
- lose its selected value
- have its DOM replaced while focused

---

# 36. Code-change philosophy

When implementing requested features:

- make the smallest coherent architectural change
- preserve existing saves where feasible
- preserve planned vs actual timestamps
- preserve real-time timestamp-derived motion
- avoid introducing a backend
- avoid unnecessary framework migration
- do not silently rewrite user form inputs
- prefer explicit validation over automatic field mutation
- keep physical aircraft continuity meaningful
- keep operational disruptions cascading through rotations
- make failures visible in the timeline/details UI
- keep user controls discoverable rather than hidden behind implicit behavior

---

# 37. Product direction / next high-value features

Likely high-value next work:

1. proper multi-leg aircraft rotation editor
2. separate route/service timetable from aircraft assignment
3. fleet pools / reserve aircraft
4. deterministic disruption event system
5. richer airport slot rules
6. historic slot utilization / use-it-or-lose-it
7. seasonal slot portfolios
8. slot leasing/trading
9. maintenance scheduling
10. crew scheduling
11. airport/handling contracts
12. weather integration
13. demand/competition model
14. route profitability dashboard
15. better financial statements
16. IndexedDB persistence
17. TypeScript/Vite refactor
18. MapLibre GPU map layer for large fleet sizes

Do not assume this list is a command to implement everything. Use it as design context.

---

# 38. User experience priorities established so far

The user prefers:

- highly interactive management UI
- visible real-time operations
- schedules shown spatially/timeline-style rather than only as tables
- drag/resizable workspace behavior
- direct click-through from flights to operational details
- realistic cascading operational problems
- aircraft substitution/spare-aircraft strategy
- airport slot strategy
- scheduled vs actual time visibility
- fewer noisy log-style panels
- stable controls that do not flicker or reset

The current prototype has evolved iteratively from direct user testing. Preserve successful interaction patterns.

---

# 39. Codex first-turn recommendation

Before editing anything, Codex should:

1. read this `AGENTS.md`
2. read `airline-manager-mvp-v9.2.html` completely
3. identify simulation/state/UI boundaries
4. run a JavaScript syntax check
5. open/run the app if practical
6. inspect console errors
7. preserve save compatibility unless explicitly told otherwise

Suggested first prompt:

```text
Read AGENTS.md and the entire current AeroSim source before changing anything.
Treat the existing v9.2 behavior as the baseline.
Run the app and inspect the current architecture.
Do not refactor to a framework unless I explicitly ask.
When making changes, preserve local-save compatibility and the stable-controls refresh rules.
```

---

# 40. Summary

AeroSim is no longer just a visual prototype.

The current code already contains interacting systems for:

- real-time flight motion
- recurring schedules
- aircraft ownership
- aircraft substitution
- disruptions
- technical defects
- delay propagation
- airport slots
- slot portfolio ownership
- schedule timeline
- planned vs actual times
- operational slot misses
- flight/aircraft detail selection
- persistent local state

The biggest engineering risk is now accidental regression caused by the monolithic UI refresh model.

The biggest product opportunity is evolving the current one-route-per-aircraft schedule model into true aircraft rotations while keeping the operational simulation coherent.
