# Airport Data

## Regional expansion, reviewed 2026-09-14

Sixteen of the proposed 24 airports are included. Each has an entry in the
location, market, operations, cost, night-rule, and weather catalogs. The other
eight are deferred below, not silently assigned unrestricted operating hours.

### Facts versus simulation assumptions

- IATA codes and coordinates: [OurAirports public-domain dataset](https://ourairports.com/data/), retrieved 2026-09-14. Coordinates identify the operating airport, not the city centre.
- Night windows: local airport time, using the airport's IANA timezone. Thai AIP UTC hours were converted to local time. DST is handled by the existing timezone engine.
- Markets, seasonal demand, slot cadence, grace periods, costs, and climate wind/risk coefficients are **game-balancing estimates**, not published tariffs, slots, traffic statistics, or live weather. New regional airports use the existing 15-minute slot/10-minute grace model.
- Ground-provider capacity and initial personnel are derived by the existing station/resource services. Catalog additions do not give the airline free crew or guarantee external handling at every station. Small stations may require the player to position/request resources.
- This remains the existing simplified airport model: it does not implement runway-performance limits, aircraft-type noise exemptions, rescue categories, customs hours, live NOTAMs, or per-service weekly opening calendars. An airport in the catalog is not a claim that every aircraft model may use it in real life.
- A `curfew` profile also represents normal published overnight operating stops. Exceptional extensions require real-world permission and are not granted automatically in the game.

### Added airports

Windows below are **closed periods**, in airport-local time; `open` means no nightly stop is modeled.

| IATA | Airport | Timezone | Modeled closed window | Operating-hours source and interpretation |
| --- | --- | --- | --- | --- |
| FDH | Friedrichshafen | Europe/Berlin | 22:00-06:00 | [Airport operator](https://www.bodensee-airport.eu/oeffnungszeiten/): normal flight operations 06:00-22:00. Delay extensions to 23:30 are excluded. |
| PAD | Paderborn/Lippstadt | Europe/Berlin | open | [Airport facts](https://www.airport-pad.com/en/enterprise/paderborn-lippstadt-airport/facts-figures-around-the-airport/): 24/7 opening. |
| GRZ | Graz | Europe/Vienna | 23:30-06:00 | [Airport operator](https://graz-airport.at/unternehmen/): daily operating hours 06:00-23:30. |
| BOO | Bodo | Europe/Oslo | open | [Avinor operational hours, AIRAC 03 SEP 2026](https://aim-prod.avinor.no/no/OperationalHours/View/Index/82/ops_hrs.html): ATS and category-7 rescue coverage H24. Individual service hours differ. Uses the current airport, not its planned replacement. |
| AVL | Asheville | America/New_York | open | [Airport FAQ](https://www2.flyavl.com/faqs/about-airport): airport open continuously. |
| BGR | Bangor | America/New_York | open | [Airport-owned FBO](https://fbo.flybangor.com/fbo-information/): round-the-clock handling, refueling, and tower. Temporary September 2026 maintenance closures are not permanent night rules. |
| BLI | Bellingham | America/Los_Angeles | open | [Port airport rules, section 8.3](https://www.portofbellingham.com/DocumentCenter/View/7899/Rules-and-Regulations-2025): public use at all times, subject to operational restrictions. Not inferred from terminal hours. |
| CJC | Calama / El Loa | America/Santiago | open | [Chile DGAC IFIS](https://aipchile.dgac.gob.cl/index.php/designador/SCCF): runway and ATS H24. |
| ZCO | Temuco / La Araucania | America/Santiago | open | [Chile DGAC IFIS](https://aipchile.dgac.gob.cl/designador/SCQP): runway and ATS H24. Uses SCQP, not the old Maquehue airport. |
| USM | Koh Samui | Asia/Bangkok | 22:00-06:00 | [CAAT AIP VTSM AD 2.3, 03 SEP 2026](https://aip.caat.or.th/2026-09-03-AIRAC/html/eAIP/VT-AD-2.VTSM-en-GB.html): operator/ATS 23:00-15:00 UTC, equivalent to 06:00-22:00 local. |
| LPT | Lampang | Asia/Bangkok | 19:30-07:30 | [CAAT AIP VTCL AD 2.3, 03 SEP 2026](https://aip.caat.or.th/2026-09-03-AIRAC/html/eAIP/VT-AD-2.VTCL-en-GB.html): operator/ATS 00:30-12:30 UTC. Fuel outside its shorter ordinary hours is on request. |
| MYJ | Matsuyama | Asia/Tokyo | 22:00-07:00 | [Japan MLIT airport operating rules](https://www.cab.mlit.go.jp/wcab/file/5f7fcb292642ef566fd0084b9a605a36e8c69567.pdf): normal operation 07:00-22:00. Exceptional extensions excluded. |
| KCZ | Kochi Ryoma | Asia/Tokyo | 21:00-07:00 | [Japan MLIT airport operating rules](https://www.cab.mlit.go.jp/wcab/file/pdf/kochi_200305%20%281%29.pdf): normal operation 07:00-21:00. Exceptional extensions excluded. |
| CFS | Coffs Harbour | Australia/Sydney | open | [Local charter operator](https://www.air-charter-australia.com/?page_id=1484) describes curfew-free operations; consistent with the [Australian government curfew list](https://www.infrastructure.gov.au/infrastructure-transport-vehicles/aviation/aviation-safety/aircraft-noise/airport-curfews). This does not imply all ground services are staffed continuously. |
| DBO | Dubbo | Australia/Sydney | open | [Airport operator](https://www.dubboairport.com.au/Home/about): continuous operation, no curfew. |
| ZQN | Queenstown | Pacific/Auckland | 22:00-07:00 | [Airport master plan, page 43](https://www.queenstownairport.co.nz/media/cn4jroxx/2024-queenstown-airport-master-plan-summary.pdf): aerodrome 06:00-22:00, scheduled flights not before 07:00. The game conservatively uses the scheduled-flight window for all movements; the earlier non-scheduled exception is not modeled. |

### Deferred candidates

These are valid airports, but not yet accepted as complete additions under this
task's data-quality condition. Absence of a verified curfew is not proof of H24
operation.

| IATA | Airport | Remaining gap |
| --- | --- | --- |
| YLW | Kelowna | Located official terminal/security hours and aircraft-operation directives, but not a sufficiently clear current aerodrome night policy. Do not turn terminal closing times into a flight curfew. |
| IBE | Ibague / Perales | Public copies of the AIP and secondary operating-hour records need reconciliation with the current official publication; reported weekday/weekend hours differ. |
| IGR | Puerto Iguazu | Confirm current aerodrome/service hours. The retrieved ANAC table was a 2020 COVID-era service plan, unsuitable as a current baseline. |
| NPE | Napier / Hawke's Bay | Operator conditions of use do not establish a verified nightly movement window; check current AIP restrictions. |
| GRJ | George | Retrieved ACSA documents have inconsistent operational hours and weekday/weekend variation; reconcile against current AIP before encoding. |
| MQP | Kruger Mpumalanga | [Operator fuel-service hours](https://www.kmiairport.co.za/fuel-handling/) vary by weekday and allow call-out. These are not proof of aerodrome opening hours. |
| MUB | Maun | Could not establish a current authoritative movement window separate from administrative hours. |
| KIS | Kisumu | Retrieved official immigration and health-service hours differ and do not establish the aerodrome's movement window. Current AIP/airport operating hours still required. |

No new network calls are made by the game; all accepted profiles are bundled.

## Further expansion, reviewed 2026-09-14

All 50 airports from the subsequent two lists are added. The 22-airport list was
PIT, RIC, CHS, ALB, YVR, YYC, YHZ, BDA, HAM, BER, BRS, EDI, BGO, SVG, PEK, SZX,
HGH, XMN, KIX, FUK, CNX and HKT. The 28-airport extension was CLE, CMH, CVG, IND,
MCI, STL, MKE, MEM, SDF, JAX, PNS, PWM, BUF, SYR, SMF, RNO, BOI, GEG, YUL, YOW,
YQB, YWG, YEG, YYJ, MTY, GDL, CUN and SJD. The eight deferred candidates above
are not part of these two lists and remain deferred.

Every addition has explicit coordinates, market/demand parameters, slot/grace
parameters, costs, timezone/night policy and a climate profile. Coordinates use
the same OurAirports dataset. The facts-versus-assumptions and model limitations
above apply to this batch too: costs are not real tariffs, slot intervals are
not published runway capacities, and weather coefficients are not measured
climatology. The simulation remains offline and does not fetch AIPs or NOTAMs.

### United States

PIT, RIC, CHS, ALB, CLE, CMH, CVG, IND, MCI, STL, MKE, MEM, SDF, JAX, PNS, PWM,
BUF, SYR, SMF, RNO, BOI and GEG use `open`, with no mandatory nightly stop
modeled. Source baseline: [FAA NASR, effective 03 SEP 2026](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-09-03/),
APT_BASE, APT_ATT and APT_RMK in the [airport CSV package](https://nfdc.faa.gov/webContent/28DaySub/extra/03_Sep_2026_APT_CSV.zip).
Runway-specific closures, military apron access, training restrictions and
voluntary noise procedures are not turned into whole-airport flight curfews.
The model does not enforce these more granular restrictions.

The FAA attendance field is not an airport curfew: PWM's 06:00-22:00 attendance
entry is checked against the [operator's 24-hour opening statement](https://portlandjetport.org/faqs)
and [overnight runway-work explanation](https://portlandjetport.org/taxiway),
which explicitly describes traffic using the other runway overnight.
Other operator cross-checks include [PIT](https://flypittsburgh.com/pittsburgh-international-airport/contact-us/pit-faqs/),
[RIC airfield information](https://flyrichmond.com/airport-information/),
[CHS](https://iflychs.com/business/contact-us/) and [CVG's 24/7 operations](https://www.cvgairport.com/business/business-opportunities/air-service/air-cargo/).

Timezone coverage distinguishes Eastern, Central, Pacific and Mountain time.
In particular, PNS is Central rather than Florida's more common Eastern time;
IND uses America/Indiana/Indianapolis, SDF America/Kentucky/Louisville, and BOI
America/Boise. January/July offsets are regression tested independently of the
catalog values.

### Canada and Bermuda

| IATA | Airport | Modeled night policy | Source and interpretation |
| --- | --- | --- | --- |
| YVR | Vancouver | noise 00:00-06:00 | [Operator night-operations guidance](https://www.yvr.ca/en/about-yvr/noise-management/noise-faqs/night-time-operations): airport open 24h, with approval required for jet departures above 34 tonnes during this window. No universal closure. |
| YYC | Calgary | open | [Operator FAQ](https://www.yyc.com/en-us/at-the-airport/faqs): continuous operation. |
| YHZ | Halifax | open | [Operator facts](https://halifaxstanfield.ca/airport-authority/media-centre/airport-facts-and-stats/) and [operator economic report](https://halifaxstanfield.ca/news-releases/halifax-stanfield-even-more-powerful-economic-engine/): round-the-clock operation. |
| YUL | Montreal Trudeau | noise 00:00-07:00 | [ADM current night rules](https://www.admtl.com/en-CA/community/soundscape-management/soundscape-management-action-plan/nighttime-operations/current-situation): restrictions for aircraft above 45 tonnes, departures 00:00-07:00 and arrivals 01:00-07:00. Proposed future rules are not treated as current. |
| YOW | Ottawa | open | [Operator AVOP study package, July 2023](https://yow-website.files.svdcdn.com/production/documents/AVOP/yow_avop_study_package_vol_1_eng_july_2023.pdf%3Fdm%3D1721395620): 24h VFR/IFR operations. |
| YQB | Quebec City | open | [Operator annual report 2024](https://www.aeroportdequebec.com/sites/default/files/2025-05/AQi%20Annual%20Report%202024.pdf): continuous operation. |
| YWG | Winnipeg | open | [Operator annual report 2020](https://www.waa.ca/assets/pages/2020_Annual-Report_FINAL-WEB.pdf): 24/7/365 operation. |
| YEG | Edmonton | open | [Operator annual report 2019](https://flyeia.com/wp-content/uploads/EIA-2019_AR-FINAL.pdf): explicitly open 24/7 without curfews. This is a published baseline, not a live operating-status feed. |
| YYJ | Victoria | open baseline | [Operator 2025 report](https://yyj.ca/en/2025-annual-report/) describes around-the-clock airfield operations, and [noise guidance](https://yyj.ca/en/environment-sustainability/noise-management/) accounts for night movements. No blanket flight stop is inferred from the different terminal-door hours. Exact aircraft-specific night permissions are not verified or modeled. |
| BDA | Bermuda L.F. Wade | normal-service stop 23:00-07:00 | [Bermuda AIP TXKF, AD 2.3 and 2.15](https://www.airportauthority.bm/eaip/27-Nov-2025-A/2025-11-27-AIRAC/html/eAIP/TX-AD-2.TXKF-en-GB.html): normal ATC/ARFF 07:00-23:00 local, with overnight arrangements for exceptional operations. This is a service window, not a claim that emergencies are prohibited. |

YVR and YUL are deliberately soft restrictions in this model. It has no
movement-direction/aircraft-weight approval engine, so it neither enforces the
real heavy-aircraft ban nor exempts lighter aircraft precisely. The in-game
detail names that limitation. Do not describe these profiles as exact legal
eligibility checks. BDA's exceptional overnight permission is not granted by
the simplified model.

### Europe and Asia

| IATA | Airport | Modeled night policy | Source and interpretation |
| --- | --- | --- | --- |
| HAM | Hamburg | stop 23:00-06:00 | [Operator night rules](https://www.hamburg-airport.de/de/info-laermschutzprogramm-3686): scheduled movements 06:00-23:00. Unavoidable delays to midnight and exceptional permissions are not automatically available. |
| BER | Berlin Brandenburg | stop 23:30-05:30 | [Operator night guidance](https://corporate.berlin-airport.de/en/nachhaltigkeit/umwelt/fluglaerm/hinweise-zum-nachtflug.html): scheduled-flight window; the narrower 00:00-05:00 core ban and exceptional shoulders are simplified. |
| BRS | Bristol | quota 23:30-06:00 | [Operator night-flying policy](https://www.bristolairport.co.uk/corporate/environment/aircraft-noise/night-flying/): airport open 24h; night movement/noise quotas are represented by the existing restricted-capacity model, not a closure. |
| EDI | Edinburgh | open | [CAA airport fact sheet, April 2026](https://www.caa.co.uk/media/kypphyik/edinburgh-april-2026.pdf): 24h operations. |
| BGO, SVG | Bergen, Stavanger | open | [Avinor operational hours, AIRAC 03 SEP 2026](https://aim-prod.avinor.no/no/OperationalHours/View/Index/82/ops_hrs.html): H24 ATS coverage. Office opening hours and temporary runway work are not permanent night stops. |
| PEK | Beijing Capital | open | CAAC AIP ZBAA AD 2.3, [public copy](https://yinlei.org/x-plane10/doc/ZBAA.pdf): H24. This is PEK, not Beijing Daxing. |
| SZX | Shenzhen Baoan | open | CAAC AIP ZGSZ AD 2.3, [public copy](https://yinlei.org/x-plane10/doc/ZGSZ.pdf): H24 (2025 edition). |
| HGH | Hangzhou Xiaoshan | open | CAAC AIP ZSHC AD 2.3, [public copy](https://yinlei.org/x-plane10/doc/ZSHC.pdf): H24 (2025 edition). |
| XMN | Xiamen Gaoqi | open | CAAC AIP ZSAM AD 2.3, [public copy](https://yinlei.org/x-plane10/doc/ZSAM.pdf): H24 (2025 edition). Uses Gaoqi, not the future Xiang'an airport. |
| KIX | Osaka Kansai | open | [Operator business information](https://www.kansai-airports.co.jp/en/business/for-business-kix/): 24h international operations. Not the operating rules of Osaka Itami. |
| FUK | Fukuoka | stop 22:00-07:00 | [Operator service regulations, effective April 2025, article 1](https://www.fukuoka-airport.jp/en/uploads/2025/03/Fukuoka_Airport_Service_Regulations.pdf): normal movements 07:00-22:00, timetable cutoff 21:55. The separate five-minute filing buffer and exceptional extensions are not modeled. |
| CNX | Chiang Mai | open | [AOT annual report 2023](https://corporate.airportthai.co.th/storage/2024/01/One-Report-2023-%E0%B8%AD%E0%B8%B1%E0%B8%87%E0%B8%81%E0%B8%A4%E0%B8%A9.pdf): H24 from November 2023, corroborated by the [Thai government's announcement](https://thailand.prd.go.th/en/content/category/detail/id/2078/iid/229270). The obsolete 06:00-midnight window is not used. |
| HKT | Phuket | open | [CAAT AIP VTSP AD 2.3, 03 SEP 2026](https://aip.caat.or.th/2026-09-03-AIRAC/html/eAIP/VT-AD-2.VTSP-en-GB.html): operator, ATS, handling and fuel H24. |

The Chinese AIPs above are CAAC-authored material accessed through public
mirrors/indexed excerpts, not a direct current-cycle CAAC subscription. They
establish a simulation baseline, not current NOTAM or dispatch authority.

### Mexico

| IATA | Airport | Modeled night policy | Source and interpretation |
| --- | --- | --- | --- |
| MTY | Monterrey | open | [OMA operator release, June 2026](https://news.oma.aero/news/the-infrastructure-behind-a-global-welcome-monterrey-welcomes-the-world-with-a-more-connected-secure-and-innovative-airport-a0f1c-f8d04.html): uninterrupted 24h operations. |
| GDL | Guadalajara | open | [GAP operator runway announcement](https://aeropuertosgap.com.mx/es/comunicados-generales.html?layout=blog&start=576): normal 24h runway operation restored after temporary work. The old work-related stop is not carried into the permanent profile. |
| CUN | Cancun | open | [ASUR's airport-owned FBO](https://www.asur.com.mx/cancun-servicios-fbo): continuous traffic, dispatch and ramp service; open operational baseline, not inferred from car-park hours. |
| SJD | Los Cabos | normal-service stop 21:00-07:00 | GAP [2025 Form 20-F](https://content-archive.fast-edgar.com/20260417/AT2BA62DZZ2R9ZZ222TQ2ZYKSWENZZ22D282/): scheduled service 07:00-21:00, with capability to extend to 24h by arrangement. The paid extension is not modeled. Not the separate Cabo San Lucas airport. |

MTY, GDL, CUN and SJD use America/Monterrey, America/Mexico_City,
America/Cancun and America/Mazatlan respectively. Tests verify unchanged
January/July offsets in 2026; these airports do not inherit US daylight saving.
