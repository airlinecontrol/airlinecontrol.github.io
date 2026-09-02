# AGENTS.md — AeroSim Airline Manager

## Purpose of this file

This repository is a handoff from a long-running ChatGPT prototyping session to local Codex.

Treat this file as the primary project-context document before changing code. Read the current source completely before making architectural changes. Preserve working behavior unless a task explicitly asks to replace it.

The current prototype source is split into:

- `airline-manager-mvp-v9.2.html`
- `aerosim.css`
- `js/management.js`
- `js/core.js`
- `js/ground-operations.js`
- `js/operational-intelligence.js`
- `js/operational-workflows.js`
- `js/simulation.js`
- `js/ui.js`
- `js/map.js`

It intentionally remains a plain HTML/CSS/JavaScript prototype without a framework or build step. The next major engineering step can be a controlled refactor to Vite + TypeScript, but do not perform that refactor incidentally while implementing an unrelated feature.

---

# 1. Product vision

AeroSim is a browser-based airline operations-control simulation.

The desired feeling is a combination of:

- FlightRadar24-style live map
- operations control center
- aircraft rotation planning
- airport slot management
- real-time disruption management

The current game direction is operational, not financial. The player wins through readiness,
punctuality, completion, recovery decisions, and resilient rotations rather than money.

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

The current prototype uses browser-native HTML, CSS, and classic JavaScript files:

- `airline-manager-mvp-v9.2.html` for the HTML UI
- `aerosim.css` for styling
- `js/management.js` for pure management-domain calculations
- `js/core.js` for catalog data, utilities, state, migration, and persistence
- `js/ground-operations.js` for pure timestamp-derived pre-flight, turnaround, and post-flight task models
- `js/simulation.js` for schedules, flights, demand, costs, staffing, and operations
- `js/ui.js` for DOM references, rendering, controls, and layout behavior
- `js/map.js` for Leaflet, aircraft markers, map overlays, and application bootstrap
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

The active OCC state keeps the timestamp-derived clock, aircraft, flights, recurring services,
slot coordination, personnel, maintenance, operational statistics, and incident records.

Incident state is first-class and persistent. Each record stores its type, flight and aircraft,
airport, detection time, coordination deadline, blocking/severity state, training flag, workflow
classification, resolution time, and outcome. Supported types are crew_sick, mel_defect,
atc_restriction, gate_conflict, and destination_closure. Incident execution is persisted separately
in `coordinationTasks`, `externalRequests`, and `resourceAssignments`. Those records are additive
save migrations and use simulation timestamps, so a report, inspection, or external reply continues
while the browser is closed.

Older saves can still contain cash, transactions, prices, fares, revenue, costs, leases, and salary
configuration. Those fields are retained only for additive migration and compatibility with the
existing demand/economics calculations. They are not an active game objective: the current UI has
no cash, finance, price, payroll, aircraft purchase/lease, or sales surface, and postTransaction()
intentionally does not mutate state.

New and reset saves start with no aircraft, flights, schedules, slots, or personnel. Operators
request the resources they need from the top-bar Request resources menu.

# 6. Airports

The airport catalog now contains 38 airports. The original network is:

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

The 20-airport global expansion is:

- IST — Istanbul
- MUC — Munich
- ZRH — Zurich
- BCN — Barcelona
- DUB — Dublin
- ATL — Atlanta
- ORD — Chicago O'Hare
- DFW — Dallas/Fort Worth
- LAX — Los Angeles
- MIA — Miami
- YYZ — Toronto Pearson
- ICN — Seoul Incheon
- HKG — Hong Kong
- PVG — Shanghai Pudong
- DEL — Delhi
- BKK — Bangkok Suvarnabhumi
- DOH — Doha Hamad
- JNB — Johannesburg O.R. Tambo
- GRU — São Paulo Guarulhos
- SYD — Sydney

Eight additional airports provide useful alternates and secondary gateways:

- EWR — Newark Liberty
- LGW — London Gatwick
- ORY — Paris Orly
- NRT — Tokyo Narita
- AUH — Abu Dhabi
- MXP — Milan Malpensa
- DUS — Düsseldorf
- KUL — Kuala Lumpur

Every airport has the same complete data surface: IATA/name and latitude/longitude in `AIRPORTS`,
a deterministic demand profile in `AIRPORT_MARKETS`, slot cadence/grace in `AIRPORT_OPS`, and
landing/passenger/security/handling/parking values in `AIRPORT_COSTS`. A startup invariant checks
that these catalogs remain synchronized. Coordinates are based on the public OurAirports dataset;
market profiles and operational/cost values are deliberately synthetic game abstractions.

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

The local catalogue contains 33 variants across ATR, Embraer, CRJ/MHI, Airbus, and Boeing families.
Catalogue performance fields consumed by the simulation include seats, speed, range, and legacy
cost estimates. The cost fields remain internal compatibility inputs and are not shown to players.

Aircraft are operational resources, not financial assets. The Request resources menu's Airplane page lets the
operator configure the three-class cabin and immediately assigns the requested aircraft to the
operations pool at the home airport. Requested aircraft persist with acquisitionType "requested"
and resourceSource "operations pool".

Existing owned/leased save records migrate to the same operational behavior without charging,
paying, selling, or returning contracts. An unassigned aircraft can be released from the pool;
release is blocked while an active service or unfinished flight uses it.

Model seats represent economy-seat-equivalent cabin space: economy uses one unit, business two,
and first three. First and business use sliders; economy is derived from the remaining capacity.
Old saves migrate to an all-economy cabin.

Aircraft store their physical airport while on the ground plus persistent condition, hours,
cycles, fuel inventory, defects, and maintenance state.

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

# 9. Passenger demand and capacity

The demand model is a synthetic offline market simulation rather than live booking data. It uses
great-circle distance, cabin capacity, route characteristics, airport market profiles, weekday,
departure time, season, and same-day directional capacity. Existing bookings consume the daily
class pools, so extra frequency dilutes demand.

The scheduler derives internal class values from the route instead of exposing player-controlled
fares. One controlled random demand roll per created flight (approximately plus or minus 8%) is
persisted; refreshing or reopening must never reroll passengers. Each flight retains class seats,
passengers, loads, and demand factors so the planner and flight details can show operational load
information.

Legacy fare, revenue, cost, and economics fields remain in flight records because the established
demand estimator and old saves depend on them. They must not be surfaced as money, profit, or a
financial win condition. Current top-level performance is operational: on-time performance,
average delay, completion, passenger load, and open incidents.

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

# 12. Disruption and incident model

Automatic operations continue in the background. Routine handling, weather, staffing,
maintenance, positioning, fuel, and en-route effects still feed the delay-propagation engine.
Technical pre-departure findings enter the MEL incident lifecycle instead of immediately applying
an opaque repair result.

## Decision incidents

The five supported lifecycle incidents are:

- crew sick call
- MEL technical defect
- ATC flow restriction
- gate conflict
- destination closure

An incident is detected against an eligible future flight, persisted, shown as a dedicated labeled
incident tile under Attention required (for example, `Crew sick call`), and treated as a blocking
departure-readiness gate until resolved. Selecting the affected
flight opens Flight details; selecting its aircraft opens Aircraft details. Both detail panes show
the open case and its departmental task chain. Attention itself remains a compact selection and
acknowledgment queue and never embeds incident decisions. Passing a simulation-time deadline marks
the case overdue and continues holding the affected flight; it never chooses an automatic fallback.

The player acts as the integrated OCC duty manager. Work is executed through four separate
department widgets while Context workbench remains the case/flight overview:

- Dispatch & Flight Watch — flight release, ATC flow coordination, alternate selection, flight-deck
  recommendations, and diversion clearance monitoring
- Crew Control — qualified personnel-pool allocation followed by timestamp-derived reporting and briefing
- Maintenance Control — engineering inspection followed by repair or MEL disposition
- Station Operations — stand requests, towing/bussing coordination, and alternate handling acceptance

Case steps start blocked or available, then move through in-progress, waiting-external, and complete
states. Active work always exposes a timestamp-derived progress bar. ATC, the captain/flight deck,
airport stand control, and alternate handlers are modeled as external counterparties with persisted
request and reply times. The case closes only after every required task is complete; there is no
one-click generic incident resolution API or UI.

The supported chains are deliberately different: sick calls require real qualified pool allocation,
reporting, then an amended release; MEL findings require inspection, disposition, then technical
release review; ATC restrictions require flow coordination and release update; gate conflicts require
airport stand response and ground coordination; destination closures require alternate evaluation,
captain acceptance, ATC clearance, alternate handling, and an amended operational plan. Diversions
change only the operational destination/duration; the planned destination and timetable remain intact.
Map routes, aircraft position, timeline details, and later positioning checks use the operational destination.

Only open incidents are rendered. Resolved incident history remains persisted for simulation
accounting but is not shown in Attention or either detail pane. Attention includes a training button
that cycles through all five scenario types using the next eligible future flight. Do not add a
separate incident overview; operational issues and incidents intentionally share one queue.

## Personnel resources

Personnel are requested, not hired. Requests immediately add the selected role and cockpit family
qualification to the chosen airport pool. A captain, first officer, and cabin crew may continue
onto consecutive returned-to-base rotations when the preceding crew has returned to that airport
and the combined duty remains at most 12 hours. Overlapping flights, an away-from-base crew, or a
longer combined duty need another team; after a duty, the pooled crew needs ten hours of rest.
Ground handling, operations, and customer service remain departure-window resources rather than
full-duty resources. No salary or payroll is shown or charged. Own-flight relocations reserve
non-revenue seats; external positioning uses only travel time and no financial transaction.

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
4. dependency-aware ground-operation readiness and minimum turnaround
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

## Ground-operation task model

Every flight derives two task phases from authoritative timestamps:

- departure preparation, classified as first-flight preparation or a connected turnaround
- post-arrival servicing, including the final flight of a rotation when no next leg exists

Passenger departure phases model dispatch release, walkaround, cabin preparation or cleaning,
catering where applicable, fueling, baggage work, boarding, load closeout, and pushback clearance.
Post-arrival phases model deboarding, baggage unloading, cabin reset, inspection, and technical
handover. Ferry flights use a smaller task set. Dependencies prevent downstream tasks such as
boarding, closeout, and pushback from starting before their prerequisites.

Task progress is calculated from simulation time and task start/end timestamps. It is not persisted
per animation frame. Handling exceptions deterministically identify an affected task and feed the
phase ready time into `recalculateOperations()`, preserving the planned timetable while allowing
late task completion to propagate into missed slots and later rotations. Flight details always show
both departure and arrival phases with per-task progress bars. Aircraft details show the current or
next relevant phase. The high-frequency UI loop updates progress-bar values directly rather than
rebuilding the details DOM.

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

# 15. Slot coordination portfolio

A recurring round trip still needs two strategic slot series: one at the origin and one for the
return departure. The persistent record shape and existing-save grandfathering remain compatible.

Slot series are now requested from airport coordination and assigned immediately. There is no
market price, purchase, sale value, or cash gate. Unused non-grandfathered series may be released.
Temporary recovery slots created after a missed departure opportunity remain operational events
and never become portfolio resources.

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
ASSIGNED
NEEDED
```

and can request missing series directly.

One-time flights remain ad-hoc and do not require a recurring slot series.

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

# 19. Unified OCC layout

The application now has one operations-control workspace over the live simulation and save. The
Airline Planning / OCC / All Panels switch was removed. There is no finance workspace.

~~~text
TOP BAR            REQUEST RESOURCES MENU
operations KPIs    airplane / slots / personnel

LEFT SIDEBAR       CENTER WORKSPACE        RIGHT SIDEBAR
flight operations  live map                context workbench
  attention        ----------------        operating week
  active           draggable splitter      network support
  upcoming         ----------------          one row per airport
plan/position      operations timeline     weather
fleet                                       personnel relocation
                                            dispatch & flight watch
                                            crew control
                                            maintenance control
                                            station operations
~~~

Requests for airplanes, slot series, and personnel live in the top-bar `Request resources` menu.
It behaves like a compact operating-system context menu: the first-level category list drops down
below the button, and hovering or clicking a category opens the complete request form in an adjacent
submenu to its right. It has no backdrop or full dialog surface.

Flight planning is a collapsed dashboard widget. One shared planner creates recurring passenger
round trips, one-time passenger flights, and non-revenue ferry/positioning flights. Ferry mode locks
the origin to the selected aircraft's physical location and uses the normal range, itinerary, and
staffing validation. Successful scheduling closes the planner widget.

Attention, Active flights, and Upcoming flights are shaded sections inside one expanded Flight
operations widget. The selection-driven Context workbench is expanded on first use and switches
between flight, aircraft, and unselected network overview content. The four department widgets are
collapsed by default. Opening a case task focuses its owning widget while preserving the Context
workbench as the source overview; department widgets own execution and progress, not duplicate case
summaries. Network support is grouped by
airport: every airport occupies one row containing its personnel roster, slot-series rights,
grounded aircraft and maintenance state, pending resource requests, and personnel transfers.
Context and problem airports sort first. Weather is a separate dashboard widget, and Personnel
relocation is a separate widget containing the relocation form and active transfers. Maintenance
attention opens Network support; weather attention opens Weather.
Individual collapse preferences persist under the dedicated aerosim_occ_ui_v1 local-storage key.
Sidebar widths and the center split remain UI-only local preferences and never enter the airline save.

WORKSPACE_WIDGETS remains the single registry for dashboard widgets; the top resource menu is
intentionally outside it. Do not add scattered view checks or
reintroduce parallel planning/finance modes. Active contains only airborne movements and shows live
progress. Upcoming contains the remaining 24-hour queue. Both flight queues and the fleet show
compact reason badges whenever a problem exists. Rows remain visually neutral rather than receiving
red backgrounds, side rails, or red problem dots; cyan is reserved for selection and semantic color
is concentrated in the compact badges. Attention includes staffing, delay, slot, defect,
maintenance, positioning, weather, and unresolved incidents. Every attention item owns its
acknowledgment button. Selecting an affected flight or aircraft opens its detail pane; incident task
links live at the top of the detail pane, their actual controls live in the owning department widget,
and neither decisions nor generic flight controls ever expand inside Attention.
The three-pane resizable layout, compact fleet list, unified context workbench, and Leaflet
invalidation rules remain in force.

Outer sidebar widgets are the primary visual containers. Do not create repeated rounded, outlined
cards inside them. Internal groups, queue entries, metrics, readiness gates, incident context, and
detail sections use flat shaded bands, one-pixel separators, or a narrow semantic accent rail.
Borders and rounded shapes are reserved mainly for parent widgets and interactive controls.

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

Slot markers are clickable and open Flight Details. A selected flight block receives a strong
highlight and its complete aircraft timeline row receives a coordinated background highlight.
Selections originating outside the timeline align the schedule window when necessary and scroll
the selected block/row into view.

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

Clicking an aircraft marker or fleet row clears flight selection and opens aircraft context inside
the Context workbench at the top of the right sidebar. The matching fleet row
stays highlighted but never expands inline.

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

and opens flight context inside the Context workbench at the top of the right sidebar. The matching fleet
row remains highlighted but does not expand or disrupt the fleet scroll position.

The flight pane is the primary home for readiness, OCC actions, delay/fuel/cabin detail, aircraft
substitution, and schedule management. Removing a schedule deactivates its service and removes
flights that have not actually departed; an airborne flight is allowed to finish.

---

# 22. Flight and aircraft details

Flight and aircraft context share one selection-driven right-side Context workbench. The fleet
remains a compact selection list; it never embeds either detail view. Aircraft context shows location, cabin, range,
fuel, condition, utilization, maintenance, current/next flight links, and resource-pool release
controls. Selecting a current/next flight link switches to Flight details.

Selecting a flight from the map, Attention required, or schedule opens flight context in that
workbench. Its top level stays concise and ordered for action: identity/route, problem anchors,
open operational cases with their task chains, pre-departure controls, then one non-duplicated
overview containing scheduled/expected times, primary delay cause, and readiness. When a flight has
operational problems, a compact
`Problems` navigation strip appears below the heading. Its anchor links scroll directly to each
owning detail section. Open incidents affecting either a flight or aircraft are shown with their
description, deadline, operational context, workflow progress, and departmental task links in the
relevant details pane. Actual task controls appear only in the matching department widget. Resolved
incidents are not rendered anywhere.
There is no standalone Operational response or Recovery decision section. A resolution appears
directly beside the problem it owns: crew decisions under Dispatch, expediting under Ground
operations, connection protection under Passenger connections, aircraft recovery under Aircraft or
Recurring schedule, and incident execution in its department widget. Unaffected flights do not show
generic hold or continue-plan choices. Fueling and cancellation remain separate flight controls.
Readiness states and list badges use explicit outcomes or causes (for example,
`Aircraft at LHR`, `Fuel top-up pending`, or `Potential delay`) rather than internal category names.
The former separate readiness-exception panel and delay-breakdown section were removed: they repeated
the same facts already shown by the overview, problem anchors, and owning domain section. Information
sections remain visible rather than individually collapsible:

- flight ID
- route
- passengers and cabin
- fuel
- operational/slot detail
- aircraft substitution and recurring-schedule controls

Closing either pane clears selection. Selecting the highlighted fleet row switches from flight
context to the dedicated aircraft pane.

---

# 23. Background operations simulation

Operations simulation runs automatically in the background. The former right-side controls
for manual handling delays, technical defects, and the automatic-disruptions toggle are not
shown. Save migration forces `ops.automaticDisruptions` on so older local saves also use the
background simulation.

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

The header is OCC-only. It shows fleet count, airborne count, open incidents, simulation time,
and speed. The former Performance widget was removed; its six 30-day operational KPIs now live in
the top bar: on-time performance, completion, load factor, average delay, utilization, and completed
flights/cancellations. Do not reintroduce cash, fuel price, forecast, margin, or profit KPIs.

# 26. Scheduler UI

The scheduler is the collapsed Plan / position flight dashboard widget. It includes:

- Schedule type
  - recurring round trip
  - one-time one-way
  - ferry / positioning flight
- departure airport
- destination airport
- aircraft
- actual HH:MM first-departure time input
- repeat rule
- return turnaround

The live preview shows distance, block/cycle time, range, aircraft-itinerary fit, slot-series
status, demand factors, and projected class loads. It contains no fare or financial controls.

The planner is closed by default. The left sidebar keeps both flight queues, Attention required,
and the fleet list open. Clicking a fleet card opens its aircraft-level operational details. After
a one-time, recurring, or ferry flight is successfully scheduled, the planner closes automatically.

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

## Legacy accounting fields

Old financial fields remain for save and demand-model compatibility, but current gameplay has no
financial objective or UI. Remove them only through a deliberate state migration.

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

# 33. Weather system and roadmap

Weather is currently a deterministic local six-hour airport outlook. It supplies wind,
visibility/storm conditions, an expected delay, and an airport-capacity factor. Pre-departure
weather checks can delay flights, require handling/de-icing responses, and lengthen recovery-slot
cadence. The OCC weather widget prioritizes airports used in the next 24 hours.

A future version can replace the local generator with cached public weather data and add route
winds. External weather must continue to feed the same operations engine rather than becoming a
separate animation-only effect.

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
9. recurring schedule can be created when slot series are assigned
10. missing slot series can be requested
11. slot portfolio updates
12. delay can shift actual flight time without modifying planned time
13. missed slot creates NEW operational slot marker
14. substitute-aircraft flow works when a suitable spare exists
15. split-pane resize keeps map valid
16. reload preserves state
17. all five incident types expose valid decisions and persist their outcomes
18. aircraft and personnel requests are assigned immediately
19. all unified OCC panels are visible and initially expanded on a fresh UI preference key

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
8. maintenance scheduling
9. crew scheduling
10. airport/handling coordination
11. weather integration
12. demand/competition model
13. richer incident chains and recovery consequences
14. IndexedDB persistence
15. TypeScript/Vite refactor
16. MapLibre GPU map layer for large fleet sizes

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

# 40. Unified OCC and incident lifecycle (v11)

The current prototype adds:

- one OCC workspace with all panels open by default
- persistent incident records, deadlines, departmental tasks, external requests, resource assignments, and history
- multi-step coordination paths for sick calls, MEL findings, ATC restrictions, gate conflicts, and closures
- incident-aware flight readiness and attention queues
- diversion-aware maps, aircraft positions, details, and positioning constraints
- capacity-limited aircraft, personnel, and slot-series requests with persistent allocation lead times
- removal of all finance, money, pricing, payroll, purchase, lease, and sale surfaces
- an end-to-end browser fixture covering all five incident types and resource requests

Legacy economic fields and management helpers are retained only where removing them would break
old saves or the current demand model. They are not part of current gameplay.

# 41. Summary

The current prototype is a browser-first airline operations-control simulation with:

- a persistent timestamp-derived clock
- live aircraft movement and a delay-aware timeline
- recurring round-trip schedules with rolling materialization
- timestamp-derived pre-flight, turnaround, and post-flight task models with dependency progress
- strategic slot coordination and temporary recovery slots
- staffing, maintenance, weather, fuel, and positioning constraints
- a persistent, actionable five-type incident lifecycle with no automatic deadline fallback
- separate Dispatch, Crew Control, Maintenance Control, and Station Operations task widgets
- timestamp-derived departmental work and simulated external captain, ATC, airport, and handler responses
- aircraft substitution, diversions, cancellations, and recovery flights
- capacity-limited operational resource requests with persistent lead times
- dispatch releases with alternates, crew-duty legality, airport flow, airspace restrictions, and MEL restrictions
- split-duty round trips and augmented long-haul crews with contextual recovery actions
- passenger connection risk and protection decisions
- contextual recovery actions with downstream delay and misconnection consequences
- seven-day OCC objectives and scoring
- one unified OCC workspace with no financial game

Preserve planned versus actual timestamps, physical aircraft continuity, additive save migration,
and control stability during refreshes. Treat operational decisions and cascading disruption as
the core game loop.
