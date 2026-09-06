/* AeroSim catalogs, shared utilities, state migration, and local persistence. */

const VERSION = 6;
const SAVE_KEY = 'aerosim_mvp_v6';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const Management = window.AeroManagement;

const AIRPORTS = {
  FRA:{iata:'FRA',name:'Frankfurt',lat:50.0379,lon:8.5622},
  LHR:{iata:'LHR',name:'London Heathrow',lat:51.4700,lon:-0.4543},
  JFK:{iata:'JFK',name:'New York JFK',lat:40.6413,lon:-73.7781},
  MAD:{iata:'MAD',name:'Madrid',lat:40.4983,lon:-3.5676},
  AMS:{iata:'AMS',name:'Amsterdam',lat:52.3105,lon:4.7683},
  CDG:{iata:'CDG',name:'Paris CDG',lat:49.0097,lon:2.5479},
  FCO:{iata:'FCO',name:'Rome Fiumicino',lat:41.8003,lon:12.2389},
  DXB:{iata:'DXB',name:'Dubai',lat:25.2532,lon:55.3657},
  SIN:{iata:'SIN',name:'Singapore',lat:1.3644,lon:103.9915},
  HND:{iata:'HND',name:'Tokyo Haneda',lat:35.5494,lon:139.7798},

  // Global network expansion.
  IST:{iata:'IST',name:'Istanbul',lat:41.274874,lon:28.732136},
  MUC:{iata:'MUC',name:'Munich',lat:48.353802,lon:11.7861},
  ZRH:{iata:'ZRH',name:'Zurich',lat:47.458056,lon:8.548056},
  BCN:{iata:'BCN',name:'Barcelona',lat:41.2971,lon:2.07846},
  DUB:{iata:'DUB',name:'Dublin',lat:53.428713,lon:-6.262121},
  CPH:{iata:'CPH',name:'Copenhagen',lat:55.618023,lon:12.650762},
  VIE:{iata:'VIE',name:'Vienna',lat:48.110298,lon:16.5697},
  LIS:{iata:'LIS',name:'Lisbon',lat:38.7742,lon:-9.1342},
  OSL:{iata:'OSL',name:'Oslo',lat:60.193901,lon:11.1004},
  ARN:{iata:'ARN',name:'Stockholm Arlanda',lat:59.651901,lon:17.9186},
  HEL:{iata:'HEL',name:'Helsinki',lat:60.3172,lon:24.9633},
  BRU:{iata:'BRU',name:'Brussels',lat:50.901401,lon:4.48444},
  WAW:{iata:'WAW',name:'Warsaw Chopin',lat:52.165699,lon:20.9671},
  PRG:{iata:'PRG',name:'Prague',lat:50.1008,lon:14.26},
  ATH:{iata:'ATH',name:'Athens',lat:37.936401,lon:23.9445},
  ATL:{iata:'ATL',name:'Atlanta',lat:33.6367,lon:-84.428101},
  ORD:{iata:'ORD',name:"Chicago O'Hare",lat:41.9786,lon:-87.9048},
  DFW:{iata:'DFW',name:'Dallas/Fort Worth',lat:32.896801,lon:-97.038002},
  DEN:{iata:'DEN',name:'Denver',lat:39.8561,lon:-104.6737},
  LAX:{iata:'LAX',name:'Los Angeles',lat:33.942501,lon:-118.407997},
  SFO:{iata:'SFO',name:'San Francisco',lat:37.6213,lon:-122.379},
  BOS:{iata:'BOS',name:'Boston Logan',lat:42.3656,lon:-71.0096},
  IAD:{iata:'IAD',name:'Washington Dulles',lat:38.9531,lon:-77.4565},
  MIA:{iata:'MIA',name:'Miami',lat:25.796011,lon:-80.289751},
  MEX:{iata:'MEX',name:'Mexico City',lat:19.4361,lon:-99.0719},
  YYZ:{iata:'YYZ',name:'Toronto Pearson',lat:43.675935,lon:-79.629421},
  ICN:{iata:'ICN',name:'Seoul Incheon',lat:37.469101,lon:126.450996},
  HKG:{iata:'HKG',name:'Hong Kong',lat:22.31184,lon:113.914862},
  PVG:{iata:'PVG',name:'Shanghai Pudong',lat:31.1434,lon:121.805},
  CAN:{iata:'CAN',name:'Guangzhou Baiyun',lat:23.3924,lon:113.2988},
  DEL:{iata:'DEL',name:'Delhi',lat:28.55563,lon:77.09519},
  BOM:{iata:'BOM',name:'Mumbai',lat:19.0896,lon:72.8656},
  BKK:{iata:'BKK',name:'Bangkok Suvarnabhumi',lat:13.6811,lon:100.747002},
  TPE:{iata:'TPE',name:'Taipei Taoyuan',lat:25.0797,lon:121.2342},
  DOH:{iata:'DOH',name:'Doha Hamad',lat:25.273056,lon:51.608056},
  ADD:{iata:'ADD',name:'Addis Ababa',lat:8.9779,lon:38.7993},
  CAI:{iata:'CAI',name:'Cairo',lat:30.1219,lon:31.4056},
  NBO:{iata:'NBO',name:'Nairobi Jomo Kenyatta',lat:-1.3192,lon:36.9278},
  JNB:{iata:'JNB',name:'Johannesburg O.R. Tambo',lat:-26.140081,lon:28.246801},
  CPT:{iata:'CPT',name:'Cape Town',lat:-33.9715,lon:18.6021},
  BOG:{iata:'BOG',name:'Bogota El Dorado',lat:4.7016,lon:-74.1469},
  EZE:{iata:'EZE',name:'Buenos Aires Ezeiza',lat:-34.8222,lon:-58.5358},
  SCL:{iata:'SCL',name:'Santiago',lat:-33.3928,lon:-70.7858},
  GRU:{iata:'GRU',name:'São Paulo Guarulhos',lat:-23.431274,lon:-46.469954},
  SYD:{iata:'SYD',name:'Sydney',lat:-33.946098,lon:151.177002},
  MEL:{iata:'MEL',name:'Melbourne',lat:-37.6733,lon:144.8433},
  AKL:{iata:'AKL',name:'Auckland',lat:-37.0082,lon:174.785},

  // Operational alternates for diversion and recovery gameplay.
  EWR:{iata:'EWR',name:'Newark Liberty',lat:40.6894,lon:-74.170545},
  LGW:{iata:'LGW',name:'London Gatwick',lat:51.148744,lon:-0.185739},
  ORY:{iata:'ORY',name:'Paris Orly',lat:48.729499,lon:2.358963},
  NRT:{iata:'NRT',name:'Tokyo Narita',lat:35.76858,lon:140.388714},
  AUH:{iata:'AUH',name:'Abu Dhabi',lat:24.440966,lon:54.649237},
  MXP:{iata:'MXP',name:'Milan Malpensa',lat:45.6306,lon:8.72811},
  DUS:{iata:'DUS',name:'Düsseldorf',lat:51.289501,lon:6.76678},
  KUL:{iata:'KUL',name:'Kuala Lumpur',lat:2.74558,lon:101.709999}
};

// Local synthetic market profiles, normalized to 0–1. They describe the metropolitan market,
// not live airport statistics, and keep demand explainable and deterministic offline.
const AIRPORT_MARKETS = {
  FRA:{size:.92,business:.94,tourism:.62,wealth:.86,hub:.98,region:'Europe',season:'summer'},
  LHR:{size:1.00,business:.98,tourism:.82,wealth:.92,hub:.96,region:'Europe',season:'summer'},
  JFK:{size:1.00,business:.94,tourism:.90,wealth:.92,hub:.91,region:'North America',season:'summer'},
  MAD:{size:.78,business:.68,tourism:.91,wealth:.73,hub:.68,region:'Europe',season:'summer'},
  AMS:{size:.82,business:.87,tourism:.84,wealth:.87,hub:.84,region:'Europe',season:'summer'},
  CDG:{size:.96,business:.90,tourism:.97,wealth:.86,hub:.92,region:'Europe',season:'summer'},
  FCO:{size:.76,business:.58,tourism:1.00,wealth:.72,hub:.58,region:'Europe',season:'summer'},
  DXB:{size:.93,business:.90,tourism:.96,wealth:.91,hub:1.00,region:'Middle East',season:'winter'},
  SIN:{size:.89,business:.97,tourism:.86,wealth:.96,hub:.97,region:'Asia',season:'winter'},
  HND:{size:1.00,business:1.00,tourism:.84,wealth:.96,hub:.94,region:'Asia',season:'spring'},
  IST:{size:.94,business:.85,tourism:.88,wealth:.76,hub:.99,region:'Europe',season:'summer'},
  MUC:{size:.78,business:.91,tourism:.72,wealth:.90,hub:.83,region:'Europe',season:'summer'},
  ZRH:{size:.70,business:.96,tourism:.70,wealth:.98,hub:.79,region:'Europe',season:'summer'},
  BCN:{size:.82,business:.68,tourism:.98,wealth:.77,hub:.65,region:'Europe',season:'summer'},
  DUB:{size:.68,business:.82,tourism:.78,wealth:.87,hub:.70,region:'Europe',season:'summer'},
  CPH:{size:.72,business:.88,tourism:.78,wealth:.92,hub:.82,region:'Europe',season:'summer'},
  VIE:{size:.76,business:.84,tourism:.88,wealth:.86,hub:.78,region:'Europe',season:'summer'},
  LIS:{size:.72,business:.70,tourism:.96,wealth:.73,hub:.72,region:'Europe',season:'summer'},
  OSL:{size:.64,business:.82,tourism:.78,wealth:.95,hub:.69,region:'Europe',season:'summer'},
  ARN:{size:.74,business:.89,tourism:.76,wealth:.93,hub:.78,region:'Europe',season:'summer'},
  HEL:{size:.62,business:.82,tourism:.68,wealth:.90,hub:.74,region:'Europe',season:'summer'},
  BRU:{size:.72,business:.90,tourism:.74,wealth:.88,hub:.62,region:'Europe',season:'summer'},
  WAW:{size:.78,business:.80,tourism:.70,wealth:.70,hub:.82,region:'Europe',season:'summer'},
  PRG:{size:.66,business:.66,tourism:.94,wealth:.72,hub:.55,region:'Europe',season:'summer'},
  ATH:{size:.70,business:.60,tourism:1.00,wealth:.66,hub:.62,region:'Europe',season:'summer'},
  ATL:{size:.99,business:.90,tourism:.62,wealth:.87,hub:1.00,region:'North America',season:'summer'},
  ORD:{size:.96,business:.93,tourism:.72,wealth:.91,hub:.98,region:'North America',season:'summer'},
  DFW:{size:.95,business:.90,tourism:.64,wealth:.89,hub:.99,region:'North America',season:'summer'},
  DEN:{size:.88,business:.86,tourism:.78,wealth:.90,hub:.94,region:'North America',season:'winter'},
  LAX:{size:.99,business:.92,tourism:.98,wealth:.95,hub:.94,region:'North America',season:'summer'},
  SFO:{size:.90,business:.98,tourism:.86,wealth:.98,hub:.82,region:'North America',season:'summer'},
  BOS:{size:.82,business:.94,tourism:.82,wealth:.95,hub:.78,region:'North America',season:'summer'},
  IAD:{size:.80,business:.94,tourism:.72,wealth:.94,hub:.83,region:'North America',season:'summer'},
  MIA:{size:.85,business:.82,tourism:.99,wealth:.90,hub:.76,region:'North America',season:'winter'},
  MEX:{size:.96,business:.88,tourism:.86,wealth:.68,hub:.92,region:'North America',season:'winter'},
  YYZ:{size:.90,business:.95,tourism:.80,wealth:.93,hub:.91,region:'North America',season:'summer'},
  ICN:{size:.93,business:.95,tourism:.81,wealth:.95,hub:.98,region:'Asia',season:'spring'},
  HKG:{size:.92,business:.97,tourism:.91,wealth:.96,hub:.98,region:'Asia',season:'winter'},
  PVG:{size:.98,business:.96,tourism:.80,wealth:.91,hub:.96,region:'Asia',season:'spring'},
  CAN:{size:.97,business:.92,tourism:.78,wealth:.84,hub:.95,region:'Asia',season:'spring'},
  DEL:{size:.98,business:.89,tourism:.87,wealth:.75,hub:.95,region:'Asia',season:'winter'},
  BOM:{size:.96,business:.94,tourism:.82,wealth:.78,hub:.91,region:'Asia',season:'winter'},
  BKK:{size:.91,business:.72,tourism:1.00,wealth:.74,hub:.91,region:'Asia',season:'winter'},
  TPE:{size:.84,business:.92,tourism:.84,wealth:.91,hub:.88,region:'Asia',season:'spring'},
  DOH:{size:.82,business:.91,tourism:.88,wealth:.94,hub:.98,region:'Middle East',season:'winter'},
  ADD:{size:.72,business:.76,tourism:.68,wealth:.54,hub:.89,region:'Africa',season:'winter'},
  CAI:{size:.82,business:.72,tourism:.96,wealth:.62,hub:.76,region:'Africa',season:'winter'},
  NBO:{size:.68,business:.76,tourism:.82,wealth:.58,hub:.76,region:'Africa',season:'winter'},
  JNB:{size:.76,business:.84,tourism:.76,wealth:.71,hub:.79,region:'Africa',season:'summer'},
  CPT:{size:.66,business:.72,tourism:1.00,wealth:.70,hub:.55,region:'Africa',season:'summer'},
  BOG:{size:.82,business:.82,tourism:.74,wealth:.63,hub:.86,region:'South America',season:'winter'},
  EZE:{size:.78,business:.78,tourism:.88,wealth:.64,hub:.70,region:'South America',season:'summer'},
  SCL:{size:.76,business:.84,tourism:.82,wealth:.73,hub:.78,region:'South America',season:'summer'},
  GRU:{size:.96,business:.91,tourism:.88,wealth:.77,hub:.93,region:'South America',season:'winter'},
  SYD:{size:.91,business:.94,tourism:.96,wealth:.95,hub:.88,region:'Oceania',season:'winter'},
  MEL:{size:.87,business:.90,tourism:.94,wealth:.93,hub:.78,region:'Oceania',season:'winter'},
  AKL:{size:.66,business:.80,tourism:.98,wealth:.89,hub:.73,region:'Oceania',season:'summer'},
  EWR:{size:.91,business:.91,tourism:.72,wealth:.92,hub:.89,region:'North America',season:'summer'},
  LGW:{size:.78,business:.70,tourism:.90,wealth:.85,hub:.68,region:'Europe',season:'summer'},
  ORY:{size:.73,business:.72,tourism:.92,wealth:.84,hub:.58,region:'Europe',season:'summer'},
  NRT:{size:.87,business:.90,tourism:.86,wealth:.93,hub:.91,region:'Asia',season:'spring'},
  AUH:{size:.73,business:.90,tourism:.86,wealth:.95,hub:.89,region:'Middle East',season:'winter'},
  MXP:{size:.76,business:.86,tourism:.87,wealth:.86,hub:.73,region:'Europe',season:'summer'},
  DUS:{size:.68,business:.88,tourism:.57,wealth:.89,hub:.66,region:'Europe',season:'summer'},
  KUL:{size:.84,business:.85,tourism:.92,wealth:.82,hub:.91,region:'Asia',season:'winter'}
};

const AIRPORT_OPS = {
  FRA:{slotIntervalMin:15,graceMin:10}, LHR:{slotIntervalMin:10,graceMin:8},
  JFK:{slotIntervalMin:15,graceMin:10}, MAD:{slotIntervalMin:15,graceMin:10},
  AMS:{slotIntervalMin:10,graceMin:8}, CDG:{slotIntervalMin:10,graceMin:8},
  FCO:{slotIntervalMin:15,graceMin:10}, DXB:{slotIntervalMin:15,graceMin:10},
  SIN:{slotIntervalMin:10,graceMin:8}, HND:{slotIntervalMin:10,graceMin:8},
  IST:{slotIntervalMin:10,graceMin:8}, MUC:{slotIntervalMin:15,graceMin:10},
  ZRH:{slotIntervalMin:15,graceMin:10}, BCN:{slotIntervalMin:15,graceMin:10},
  DUB:{slotIntervalMin:15,graceMin:10}, CPH:{slotIntervalMin:15,graceMin:10},
  VIE:{slotIntervalMin:15,graceMin:10}, LIS:{slotIntervalMin:15,graceMin:10},
  OSL:{slotIntervalMin:15,graceMin:10}, ARN:{slotIntervalMin:15,graceMin:10},
  HEL:{slotIntervalMin:15,graceMin:10}, BRU:{slotIntervalMin:15,graceMin:10},
  WAW:{slotIntervalMin:15,graceMin:10}, PRG:{slotIntervalMin:15,graceMin:10},
  ATH:{slotIntervalMin:15,graceMin:10}, ATL:{slotIntervalMin:10,graceMin:8},
  ORD:{slotIntervalMin:10,graceMin:8}, DFW:{slotIntervalMin:10,graceMin:8},
  DEN:{slotIntervalMin:10,graceMin:8}, LAX:{slotIntervalMin:10,graceMin:8},
  SFO:{slotIntervalMin:10,graceMin:8}, BOS:{slotIntervalMin:15,graceMin:10},
  IAD:{slotIntervalMin:15,graceMin:10}, MIA:{slotIntervalMin:15,graceMin:10},
  MEX:{slotIntervalMin:10,graceMin:8}, YYZ:{slotIntervalMin:10,graceMin:8},
  ICN:{slotIntervalMin:10,graceMin:8}, HKG:{slotIntervalMin:10,graceMin:8},
  PVG:{slotIntervalMin:10,graceMin:8}, CAN:{slotIntervalMin:10,graceMin:8},
  DEL:{slotIntervalMin:10,graceMin:8}, BOM:{slotIntervalMin:10,graceMin:8},
  BKK:{slotIntervalMin:10,graceMin:8}, TPE:{slotIntervalMin:15,graceMin:10},
  DOH:{slotIntervalMin:10,graceMin:8}, ADD:{slotIntervalMin:15,graceMin:10},
  CAI:{slotIntervalMin:15,graceMin:10}, NBO:{slotIntervalMin:15,graceMin:10},
  JNB:{slotIntervalMin:15,graceMin:10}, CPT:{slotIntervalMin:15,graceMin:10},
  BOG:{slotIntervalMin:15,graceMin:10}, EZE:{slotIntervalMin:15,graceMin:10},
  SCL:{slotIntervalMin:15,graceMin:10}, GRU:{slotIntervalMin:10,graceMin:8},
  SYD:{slotIntervalMin:10,graceMin:8}, MEL:{slotIntervalMin:15,graceMin:10},
  AKL:{slotIntervalMin:15,graceMin:10},
  EWR:{slotIntervalMin:10,graceMin:8}, LGW:{slotIntervalMin:10,graceMin:8},
  ORY:{slotIntervalMin:15,graceMin:10}, NRT:{slotIntervalMin:10,graceMin:8},
  AUH:{slotIntervalMin:15,graceMin:10}, MXP:{slotIntervalMin:15,graceMin:10},
  DUS:{slotIntervalMin:15,graceMin:10}, KUL:{slotIntervalMin:15,graceMin:10}
};
const MIN_TURN_MIN = 35;
const FUEL_MARKET_STEP = 6 * HOUR;
const FUEL_MARKET_BASE_EUR_GAL = 2.45;
const PERSONNEL = {
  captains:{label:'Captains',salary:11_500},
  firstOfficers:{label:'First officers',salary:7_500},
  cabinCrew:{label:'Cabin crew',salary:3_500},
  groundHandling:{label:'Ground handling',salary:3_200},
  operations:{label:'Operations & dispatch',salary:4_800},
  customerService:{label:'Customer service',salary:3_600}
};
const FUEL_KG_PER_US_GAL = 3.04;
const CO2_KG_PER_KG_FUEL = 3.16;
const CARBON_PRICE_EUR_PER_KG = .085;

const AIRPORT_COSTS = {
  FRA:{landingPerTonne:12.5,passengerFee:25,securityFee:7,handlingBase:2200,handlingPerPax:7,parkingHour:180},
  LHR:{landingPerTonne:18,passengerFee:38,securityFee:10,handlingBase:3200,handlingPerPax:10,parkingHour:320},
  JFK:{landingPerTonne:15,passengerFee:31,securityFee:11,handlingBase:3000,handlingPerPax:10,parkingHour:260},
  MAD:{landingPerTonne:9,passengerFee:18,securityFee:6,handlingBase:1700,handlingPerPax:6,parkingHour:130},
  AMS:{landingPerTonne:15,passengerFee:29,securityFee:9,handlingBase:2600,handlingPerPax:9,parkingHour:230},
  CDG:{landingPerTonne:14,passengerFee:27,securityFee:9,handlingBase:2500,handlingPerPax:9,parkingHour:220},
  FCO:{landingPerTonne:9,passengerFee:20,securityFee:6,handlingBase:1800,handlingPerPax:6,parkingHour:140},
  DXB:{landingPerTonne:11,passengerFee:23,securityFee:7,handlingBase:2300,handlingPerPax:8,parkingHour:180},
  SIN:{landingPerTonne:12,passengerFee:24,securityFee:7,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  HND:{landingPerTonne:16,passengerFee:30,securityFee:9,handlingBase:2800,handlingPerPax:9,parkingHour:250},
  IST:{landingPerTonne:12,passengerFee:23,securityFee:7,handlingBase:2300,handlingPerPax:8,parkingHour:180},
  MUC:{landingPerTonne:13.5,passengerFee:26,securityFee:8,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  ZRH:{landingPerTonne:17,passengerFee:32,securityFee:9,handlingBase:2700,handlingPerPax:9,parkingHour:260},
  BCN:{landingPerTonne:10,passengerFee:21,securityFee:7,handlingBase:1900,handlingPerPax:7,parkingHour:150},
  DUB:{landingPerTonne:12,passengerFee:24,securityFee:8,handlingBase:2100,handlingPerPax:8,parkingHour:170},
  CPH:{landingPerTonne:13,passengerFee:26,securityFee:8,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  VIE:{landingPerTonne:12,passengerFee:24,securityFee:8,handlingBase:2200,handlingPerPax:8,parkingHour:180},
  LIS:{landingPerTonne:10,passengerFee:21,securityFee:7,handlingBase:1900,handlingPerPax:7,parkingHour:150},
  OSL:{landingPerTonne:14,passengerFee:28,securityFee:9,handlingBase:2500,handlingPerPax:9,parkingHour:220},
  ARN:{landingPerTonne:13,passengerFee:26,securityFee:8,handlingBase:2400,handlingPerPax:8,parkingHour:200},
  HEL:{landingPerTonne:13,passengerFee:25,securityFee:8,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  BRU:{landingPerTonne:13,passengerFee:25,securityFee:8,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  WAW:{landingPerTonne:10,passengerFee:20,securityFee:7,handlingBase:1900,handlingPerPax:7,parkingHour:145},
  PRG:{landingPerTonne:9,passengerFee:19,securityFee:6,handlingBase:1800,handlingPerPax:6,parkingHour:140},
  ATH:{landingPerTonne:9,passengerFee:20,securityFee:7,handlingBase:1900,handlingPerPax:7,parkingHour:150},
  ATL:{landingPerTonne:12,passengerFee:24,securityFee:9,handlingBase:2500,handlingPerPax:8,parkingHour:210},
  ORD:{landingPerTonne:14,passengerFee:28,securityFee:10,handlingBase:2800,handlingPerPax:9,parkingHour:240},
  DFW:{landingPerTonne:12,passengerFee:24,securityFee:9,handlingBase:2500,handlingPerPax:8,parkingHour:210},
  DEN:{landingPerTonne:13,passengerFee:26,securityFee:9,handlingBase:2600,handlingPerPax:8,parkingHour:220},
  LAX:{landingPerTonne:15,passengerFee:31,securityFee:10,handlingBase:3000,handlingPerPax:10,parkingHour:270},
  SFO:{landingPerTonne:16,passengerFee:32,securityFee:10,handlingBase:3000,handlingPerPax:10,parkingHour:280},
  BOS:{landingPerTonne:14,passengerFee:29,securityFee:10,handlingBase:2700,handlingPerPax:9,parkingHour:240},
  IAD:{landingPerTonne:13,passengerFee:27,securityFee:9,handlingBase:2600,handlingPerPax:9,parkingHour:230},
  MIA:{landingPerTonne:12,passengerFee:26,securityFee:9,handlingBase:2500,handlingPerPax:8,parkingHour:210},
  MEX:{landingPerTonne:10,passengerFee:22,securityFee:8,handlingBase:2200,handlingPerPax:8,parkingHour:170},
  YYZ:{landingPerTonne:14,passengerFee:29,securityFee:9,handlingBase:2700,handlingPerPax:9,parkingHour:230},
  ICN:{landingPerTonne:14,passengerFee:27,securityFee:8,handlingBase:2600,handlingPerPax:9,parkingHour:220},
  HKG:{landingPerTonne:16,passengerFee:31,securityFee:9,handlingBase:2900,handlingPerPax:10,parkingHour:270},
  PVG:{landingPerTonne:13,passengerFee:25,securityFee:8,handlingBase:2500,handlingPerPax:8,parkingHour:210},
  CAN:{landingPerTonne:12,passengerFee:23,securityFee:8,handlingBase:2400,handlingPerPax:8,parkingHour:200},
  DEL:{landingPerTonne:10,passengerFee:19,securityFee:7,handlingBase:2000,handlingPerPax:7,parkingHour:150},
  BOM:{landingPerTonne:10,passengerFee:20,securityFee:7,handlingBase:2100,handlingPerPax:7,parkingHour:155},
  BKK:{landingPerTonne:9,passengerFee:18,securityFee:6,handlingBase:1900,handlingPerPax:7,parkingHour:140},
  TPE:{landingPerTonne:12,passengerFee:24,securityFee:8,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  DOH:{landingPerTonne:12,passengerFee:24,securityFee:7,handlingBase:2400,handlingPerPax:8,parkingHour:190},
  ADD:{landingPerTonne:8,passengerFee:16,securityFee:6,handlingBase:1700,handlingPerPax:6,parkingHour:120},
  CAI:{landingPerTonne:8,passengerFee:17,securityFee:6,handlingBase:1800,handlingPerPax:6,parkingHour:130},
  NBO:{landingPerTonne:8,passengerFee:16,securityFee:6,handlingBase:1700,handlingPerPax:6,parkingHour:120},
  JNB:{landingPerTonne:9,passengerFee:17,securityFee:6,handlingBase:1800,handlingPerPax:6,parkingHour:130},
  CPT:{landingPerTonne:8,passengerFee:17,securityFee:6,handlingBase:1800,handlingPerPax:6,parkingHour:130},
  BOG:{landingPerTonne:9,passengerFee:18,securityFee:6,handlingBase:1900,handlingPerPax:7,parkingHour:140},
  EZE:{landingPerTonne:9,passengerFee:19,securityFee:6,handlingBase:1900,handlingPerPax:7,parkingHour:145},
  SCL:{landingPerTonne:10,passengerFee:20,securityFee:7,handlingBase:2000,handlingPerPax:7,parkingHour:150},
  GRU:{landingPerTonne:10,passengerFee:21,securityFee:7,handlingBase:2200,handlingPerPax:7,parkingHour:170},
  SYD:{landingPerTonne:15,passengerFee:30,securityFee:9,handlingBase:2800,handlingPerPax:9,parkingHour:240},
  MEL:{landingPerTonne:14,passengerFee:28,securityFee:9,handlingBase:2600,handlingPerPax:9,parkingHour:220},
  AKL:{landingPerTonne:12,passengerFee:25,securityFee:8,handlingBase:2300,handlingPerPax:8,parkingHour:180},
  EWR:{landingPerTonne:15,passengerFee:31,securityFee:11,handlingBase:3000,handlingPerPax:10,parkingHour:260},
  LGW:{landingPerTonne:14,passengerFee:29,securityFee:9,handlingBase:2600,handlingPerPax:9,parkingHour:230},
  ORY:{landingPerTonne:11,passengerFee:23,securityFee:8,handlingBase:2100,handlingPerPax:7,parkingHour:170},
  NRT:{landingPerTonne:15,passengerFee:29,securityFee:9,handlingBase:2700,handlingPerPax:9,parkingHour:240},
  AUH:{landingPerTonne:11,passengerFee:22,securityFee:7,handlingBase:2200,handlingPerPax:8,parkingHour:175},
  MXP:{landingPerTonne:11,passengerFee:23,securityFee:7,handlingBase:2100,handlingPerPax:7,parkingHour:170},
  DUS:{landingPerTonne:12,passengerFee:24,securityFee:8,handlingBase:2200,handlingPerPax:8,parkingHour:180},
  KUL:{landingPerTonne:10,passengerFee:20,securityFee:6,handlingBase:2100,handlingPerPax:7,parkingHour:160}
};

function nightRule(timeZone,mode='noise',options={}){
  const defaults={
    open:{label:'24h operations',start:'00:00',end:'00:00',capacityFactor:1,delayMin:0,spreadMin:0,detail:'No nightly passenger stop modeled; noise abatement may still apply.'},
    noise:{label:'Night noise procedures',start:'23:00',end:'06:00',capacityFactor:.94,delayMin:0,spreadMin:6,detail:'Airport remains open with night noise procedures and reduced flexibility.'},
    quota:{label:'Night quota window',start:'23:00',end:'06:00',capacityFactor:.82,delayMin:8,spreadMin:12,detail:'Night movements are quota or slot controlled; unplanned operations can wait.'},
    curfew:{label:'Night curfew',start:'23:00',end:'06:00',capacityFactor:.35,delayMin:0,spreadMin:0,detail:'Scheduled passenger movements are not planned in the core curfew window.'}
  }[mode]||{};
  return {timeZone,mode,...defaults,...options};
}

const AIRPORT_NIGHT_RULES = {
  FRA:nightRule('Europe/Berlin','curfew',{start:'23:00',end:'05:00',shoulderStart:'22:00',shoulderEnd:'06:00',detail:'Core night curfew; late-evening and early-morning shoulder periods are constrained.'}),
  LHR:nightRule('Europe/London','quota',{start:'23:30',end:'06:00',shoulderStart:'23:00',shoulderEnd:'07:00',detail:'Night quota period with wider night restrictions around it.'}),
  JFK:nightRule('America/New_York','noise'),
  MAD:nightRule('Europe/Madrid','noise'),
  AMS:nightRule('Europe/Amsterdam','quota',{start:'23:00',end:'07:00',delayMin:7,detail:'Night operations require appropriate night-slot capacity.'}),
  CDG:nightRule('Europe/Paris','quota',{start:'00:00',end:'05:30',delayMin:6,detail:'Night departures and arrivals are constrained by local noise-slot rules.'}),
  FCO:nightRule('Europe/Rome','noise'),
  DXB:nightRule('Asia/Dubai','open'),
  SIN:nightRule('Asia/Singapore','open'),
  HND:nightRule('Asia/Tokyo','noise',{start:'23:00',end:'06:00',capacityFactor:.90}),
  IST:nightRule('Europe/Istanbul','open'),
  MUC:nightRule('Europe/Berlin','quota',{start:'22:00',end:'06:00',delayMin:8,detail:'Night movements are tightly quota controlled.'}),
  ZRH:nightRule('Europe/Zurich','curfew',{start:'23:30',end:'06:00',shoulderStart:'23:00',shoulderEnd:'23:30',detail:'Strict night curfew; the 23:00-23:30 shoulder is mainly for delay recovery.'}),
  BCN:nightRule('Europe/Madrid','noise',{start:'23:00',end:'06:00',capacityFactor:.92}),
  DUB:nightRule('Europe/Dublin','noise'),
  CPH:nightRule('Europe/Copenhagen','noise',{capacityFactor:.92}),
  VIE:nightRule('Europe/Vienna','noise'),
  LIS:nightRule('Europe/Lisbon','noise',{capacityFactor:.91}),
  OSL:nightRule('Europe/Oslo','noise',{capacityFactor:.90}),
  ARN:nightRule('Europe/Stockholm','noise',{capacityFactor:.90}),
  HEL:nightRule('Europe/Helsinki','noise',{capacityFactor:.90}),
  BRU:nightRule('Europe/Brussels','quota',{start:'23:00',end:'06:00',delayMin:6,detail:'Night movements are noise and slot constrained.'}),
  WAW:nightRule('Europe/Warsaw','noise'),
  PRG:nightRule('Europe/Prague','noise'),
  ATH:nightRule('Europe/Athens','noise',{capacityFactor:.93}),
  ATL:nightRule('America/New_York','open'),
  ORD:nightRule('America/Chicago','open'),
  DFW:nightRule('America/Chicago','open'),
  DEN:nightRule('America/Denver','open'),
  LAX:nightRule('America/Los_Angeles','noise',{start:'00:00',end:'06:30',capacityFactor:.88,delayMin:3,spreadMin:8}),
  SFO:nightRule('America/Los_Angeles','noise',{start:'00:00',end:'06:00',capacityFactor:.86,delayMin:4,spreadMin:10}),
  BOS:nightRule('America/New_York','noise',{start:'23:30',end:'06:00',capacityFactor:.88,delayMin:3,spreadMin:8}),
  IAD:nightRule('America/New_York','open'),
  MIA:nightRule('America/New_York','open'),
  MEX:nightRule('America/Mexico_City','quota',{start:'23:00',end:'06:00',delayMin:5,detail:'Night movements are congestion and noise constrained.'}),
  YYZ:nightRule('America/Toronto','noise',{capacityFactor:.90}),
  ICN:nightRule('Asia/Seoul','open'),
  HKG:nightRule('Asia/Hong_Kong','open'),
  PVG:nightRule('Asia/Shanghai','open'),
  CAN:nightRule('Asia/Shanghai','open'),
  DEL:nightRule('Asia/Kolkata','open'),
  BOM:nightRule('Asia/Kolkata','open'),
  BKK:nightRule('Asia/Bangkok','open'),
  TPE:nightRule('Asia/Taipei','noise',{capacityFactor:.92}),
  DOH:nightRule('Asia/Qatar','open'),
  ADD:nightRule('Africa/Addis_Ababa','open'),
  CAI:nightRule('Africa/Cairo','open'),
  NBO:nightRule('Africa/Nairobi','open'),
  JNB:nightRule('Africa/Johannesburg','open'),
  CPT:nightRule('Africa/Johannesburg','noise',{capacityFactor:.92}),
  BOG:nightRule('America/Bogota','noise',{capacityFactor:.90}),
  EZE:nightRule('America/Argentina/Buenos_Aires','open'),
  SCL:nightRule('America/Santiago','noise',{capacityFactor:.92}),
  GRU:nightRule('America/Sao_Paulo','open'),
  SYD:nightRule('Australia/Sydney','curfew',{start:'23:00',end:'06:00',detail:'Core airport curfew; limited exceptional and shoulder movements only.'}),
  MEL:nightRule('Australia/Melbourne','open'),
  AKL:nightRule('Pacific/Auckland','open'),
  EWR:nightRule('America/New_York','noise'),
  LGW:nightRule('Europe/London','quota',{start:'23:30',end:'06:00',shoulderStart:'23:00',shoulderEnd:'07:00',detail:'Night quota period with wider night restrictions around it.'}),
  ORY:nightRule('Europe/Paris','curfew',{start:'23:30',end:'06:00',detail:'Hard overnight curfew modeled for scheduled passenger movements.'}),
  NRT:nightRule('Asia/Tokyo','curfew',{start:'00:00',end:'06:00',shoulderStart:'23:00',shoulderEnd:'00:00',detail:'Overnight curfew with late-evening shoulder constraints.'}),
  AUH:nightRule('Asia/Dubai','open'),
  MXP:nightRule('Europe/Rome','noise'),
  DUS:nightRule('Europe/Berlin','curfew',{start:'00:00',end:'05:00',shoulderStart:'22:00',shoulderEnd:'06:00',detail:'Core night stop with constrained late-evening and early-morning movements.'}),
  KUL:nightRule('Asia/Kuala_Lumpur','open')
};

const nightFormatters=new Map();
function timeToMinute(value){
  const [hours,minutes]=String(value||'00:00').split(':').map(Number);
  return ((hours||0)*60+(minutes||0))%1440;
}
function minuteInWindow(minute,start,end){
  start=timeToMinute(start); end=timeToMinute(end);
  if(start===end) return false;
  return start<end ? minute>=start&&minute<end : minute>=start||minute<end;
}
function localTimeParts(timeZone,timestamp){
  if(!nightFormatters.has(timeZone)){
    nightFormatters.set(timeZone,new Intl.DateTimeFormat('en-GB',{
      timeZone,hourCycle:'h23',weekday:'short',hour:'2-digit',minute:'2-digit'
    }));
  }
  const values={};
  for(const part of nightFormatters.get(timeZone).formatToParts(new Date(timestamp))){
    if(part.type!=='literal') values[part.type]=part.value;
  }
  return {weekday:values.weekday||'',hour:Number(values.hour)||0,minute:Number(values.minute)||0};
}
function stableCatalogUnit(seed){
  let hash=2166136261;
  for(const char of String(seed)){
    hash^=char.charCodeAt(0);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)/4294967295;
}
function airportNightStatus(airportCode,timestamp){
  const rule=AIRPORT_NIGHT_RULES[airportCode]||nightRule('UTC','open');
  const local=localTimeParts(rule.timeZone,timestamp);
  const minute=local.hour*60+local.minute;
  const inCore=minuteInWindow(minute,rule.start,rule.end);
  const inShoulder=rule.shoulderStart&&rule.shoulderEnd&&minuteInWindow(minute,rule.shoulderStart,rule.shoulderEnd)&&!inCore;
  const closed=rule.mode==='curfew'&&inCore;
  const restricted=!closed&&(inCore||inShoulder)&&rule.mode!=='open';
  const period=Math.floor(timestamp/(3*HOUR));
  const variable=Math.round(stableCatalogUnit(`${airportCode}:${period}:night`)*(rule.spreadMin||0));
  const delayMin=closed?0:restricted?(rule.delayMin||0)+variable:0;
  const nextOpenAt=closed?nextAirportNightOpenTime(airportCode,timestamp):timestamp;
  return {
    airport:airportCode,rule,status:closed?'closed':restricted?'restricted':'open',
    label:closed?'Night curfew active':restricted?rule.label:'Open overnight',
    detail:rule.detail,localTime:`${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}`,
    localWeekday:local.weekday,nextOpenAt,delayMin,capacityFactor:closed?rule.capacityFactor:restricted?rule.capacityFactor:1
  };
}
function nextAirportNightOpenTime(airportCode,timestamp){
  for(let step=5;step<=36*60;step+=5){
    const candidate=timestamp+step*MIN;
    const rule=AIRPORT_NIGHT_RULES[airportCode];
    const local=localTimeParts(rule?.timeZone||'UTC',candidate);
    const minute=local.hour*60+local.minute;
    if(!(rule?.mode==='curfew'&&minuteInWindow(minute,rule.start,rule.end))) return candidate;
  }
  return timestamp+6*HOUR;
}
function flightNightRestriction(flight,proposedDeparture=flight.departure){
  const duration=Number.isFinite(flight.operationalDurationMs)?flight.operationalDurationMs:(flight.arrival-flight.departure);
  const destination=flight.diversionAirport||flight.to;
  let departure=proposedDeparture;
  let closedDelay=0;
  let closedStatus=null;
  const reasons=[];
  for(let i=0;i<6;i++){
    const depStatus=airportNightStatus(flight.from,departure);
    if(depStatus.status==='closed'){
      closedStatus=depStatus;
      const wait=depStatus.nextOpenAt-departure;
      closedDelay+=wait; departure+=wait;
      reasons.push(`${flight.from} opens ${depStatus.localWeekday} ${depStatus.rule.end}`);
      continue;
    }
    const arrival=departure+duration+(Number(flight.enrouteDelayMin)||0)*MIN;
    const arrStatus=airportNightStatus(destination,arrival);
    if(arrStatus.status==='closed'){
      closedStatus=arrStatus;
      const wait=arrStatus.nextOpenAt-arrival;
      closedDelay+=wait; departure+=wait;
      reasons.push(`${destination} opens ${arrStatus.localWeekday} ${arrStatus.rule.end}`);
      continue;
    }
    break;
  }
  const depStatus=airportNightStatus(flight.from,departure);
  const arrStatus=airportNightStatus(destination,departure+duration+(Number(flight.enrouteDelayMin)||0)*MIN);
  const advisoryDelay=Math.max(depStatus.status==='restricted'?depStatus.delayMin:0,arrStatus.status==='restricted'?arrStatus.delayMin:0);
  const delayMin=Math.ceil(closedDelay/MIN)+advisoryDelay;
  const active=[depStatus,arrStatus].filter(status=>status.status!=='open');
  return {
    delayMin,nextDeparture:departure+advisoryDelay*MIN,
    status:closedDelay?'closed':active.length?'restricted':'open',
    departure:depStatus,arrival:arrStatus,
    closedStatus,
    reason:closedDelay?`Night curfew: ${reasons.slice(-1)[0]||'next opening'}`:
      active.length?`Night restrictions at ${active.map(status=>status.airport).join('/')}`:'Night operations clear'
  };
}

function validateAirportCatalogs(){
  const required={
    markets:[AIRPORT_MARKETS,['size','business','tourism','wealth','hub','region','season']],
    operations:[AIRPORT_OPS,['slotIntervalMin','graceMin']],
    costs:[AIRPORT_COSTS,['landingPerTonne','passengerFee','securityFee','handlingBase','handlingPerPax','parkingHour']],
    nightRules:[AIRPORT_NIGHT_RULES,['timeZone','mode','label','start','end','capacityFactor','delayMin','detail']]
  };
  const airportCodes=Object.keys(AIRPORTS);
  for(const [catalogName,[catalog,fields]] of Object.entries(required)){
    const extras=Object.keys(catalog).filter(code=>!AIRPORTS[code]);
    if(extras.length) throw new Error(`Airport ${catalogName} contains unknown codes: ${extras.join(', ')}`);
    for(const code of airportCodes){
      if(!catalog[code]) throw new Error(`${code} is missing its airport ${catalogName} profile.`);
      const missing=fields.filter(field=>catalog[code][field]===undefined);
      if(missing.length) throw new Error(`${code} airport ${catalogName} profile is missing: ${missing.join(', ')}`);
    }
  }
  return true;
}
validateAirportCatalogs();

const MODELS = {
  'ATR 42-600':{manufacturer:'ATR',segment:'Regional turboprop',seats:48,speedKmh:535,maxRangeKm:1345,price:18_000_000,costPerKm:2.6},
  'ATR 72-600':{manufacturer:'ATR',segment:'Regional turboprop',seats:72,speedKmh:500,maxRangeKm:1370,price:24_000_000,costPerKm:3.2},

  'E170':{manufacturer:'Embraer',segment:'Regional jet · used market',seats:72,speedKmh:870,maxRangeKm:3982,price:18_000_000,costPerKm:4.7},
  'E175':{manufacturer:'Embraer',segment:'Regional jet',seats:78,speedKmh:870,maxRangeKm:4074,price:32_000_000,costPerKm:4.9},
  'E190':{manufacturer:'Embraer',segment:'Regional jet · used market',seats:100,speedKmh:870,maxRangeKm:4537,price:24_000_000,costPerKm:5.3},
  'E195':{manufacturer:'Embraer',segment:'Regional jet · used market',seats:116,speedKmh:870,maxRangeKm:4260,price:27_000_000,costPerKm:5.7},
  'E190-E2':{manufacturer:'Embraer',segment:'Regional jet',seats:106,speedKmh:870,maxRangeKm:5278,price:42_000_000,costPerKm:5.4},
  'E195-E2':{manufacturer:'Embraer',segment:'Regional jet',seats:132,speedKmh:870,maxRangeKm:4537,price:45_000_000,costPerKm:5.9},

  'CRJ200':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:50,speedKmh:785,maxRangeKm:3045,price:7_000_000,costPerKm:4.1},
  'CRJ700':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:70,speedKmh:829,maxRangeKm:2553,price:12_000_000,costPerKm:4.7},
  'CRJ900':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:90,speedKmh:829,maxRangeKm:2871,price:16_000_000,costPerKm:5.2},
  'CRJ1000':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:100,speedKmh:829,maxRangeKm:2761,price:18_000_000,costPerKm:5.5},

  'A220-100':{manufacturer:'Airbus',segment:'Small narrowbody',seats:110,speedKmh:870,maxRangeKm:6670,price:44_000_000,costPerKm:5.8},
  'A220-300':{manufacturer:'Airbus',segment:'Small narrowbody',seats:145,speedKmh:870,maxRangeKm:6300,price:50_000_000,costPerKm:6.5},
  'A319neo':{manufacturer:'Airbus',segment:'Narrowbody',seats:140,speedKmh:835,maxRangeKm:6760,price:45_000_000,costPerKm:6.9},
  'A320neo':{manufacturer:'Airbus',segment:'Narrowbody',seats:180,speedKmh:835,maxRangeKm:6300,price:48_000_000,costPerKm:8.2},
  'A321neo':{manufacturer:'Airbus',segment:'Large narrowbody',seats:206,speedKmh:835,maxRangeKm:6500,price:62_000_000,costPerKm:9.4},
  'A321XLR':{manufacturer:'Airbus',segment:'Long-range narrowbody',seats:206,speedKmh:835,maxRangeKm:8700,price:72_000_000,costPerKm:10.1},
  'A330-800':{manufacturer:'Airbus',segment:'Widebody',seats:248,speedKmh:870,maxRangeKm:15090,price:105_000_000,costPerKm:14.3},
  'A330-900':{manufacturer:'Airbus',segment:'Widebody',seats:287,speedKmh:870,maxRangeKm:13330,price:110_000_000,costPerKm:15.4},
  'A350-900':{manufacturer:'Airbus',segment:'Long-range widebody',seats:325,speedKmh:903,maxRangeKm:15370,price:155_000_000,costPerKm:15.8},
  'A350-1000':{manufacturer:'Airbus',segment:'Large long-range widebody',seats:375,speedKmh:903,maxRangeKm:16100,price:180_000_000,costPerKm:18.1},
  'A380-800':{manufacturer:'Airbus',segment:'Very large widebody · used market',seats:555,speedKmh:903,maxRangeKm:14800,price:125_000_000,costPerKm:29.0},

  '737-7':{manufacturer:'Boeing',segment:'Narrowbody',seats:150,speedKmh:839,maxRangeKm:7040,price:48_000_000,costPerKm:7.2},
  '737-8':{manufacturer:'Boeing',segment:'Narrowbody',seats:178,speedKmh:839,maxRangeKm:6480,price:55_000_000,costPerKm:8.4},
  '737-9':{manufacturer:'Boeing',segment:'Large narrowbody',seats:185,speedKmh:839,maxRangeKm:6110,price:59_000_000,costPerKm:8.9},
  '737-10':{manufacturer:'Boeing',segment:'Large narrowbody',seats:200,speedKmh:839,maxRangeKm:5740,price:63_000_000,costPerKm:9.3},
  '787-8':{manufacturer:'Boeing',segment:'Long-range widebody',seats:242,speedKmh:903,maxRangeKm:14820,price:132_000_000,costPerKm:13.8},
  '787-9':{manufacturer:'Boeing',segment:'Long-range widebody',seats:290,speedKmh:903,maxRangeKm:15370,price:145_000_000,costPerKm:15.1},
  '787-10':{manufacturer:'Boeing',segment:'Large widebody',seats:330,speedKmh:903,maxRangeKm:13890,price:155_000_000,costPerKm:16.8},
  '777-200ER':{manufacturer:'Boeing',segment:'Widebody · used market',seats:313,speedKmh:905,maxRangeKm:13080,price:58_000_000,costPerKm:19.5},
  '777-200LR':{manufacturer:'Boeing',segment:'Ultra-long-range widebody · used market',seats:317,speedKmh:905,maxRangeKm:15843,price:72_000_000,costPerKm:20.6},
  '777-300ER':{manufacturer:'Boeing',segment:'Large widebody · used market',seats:396,speedKmh:905,maxRangeKm:13650,price:82_000_000,costPerKm:23.2}
};
const CABIN_CLASSES = {
  economy:{label:'Economy',space:1,baseFareMultiplier:1,demandScale:1,elasticity:.9},
  business:{label:'Business',space:2,baseFareMultiplier:2.6,demandScale:.72,elasticity:.55},
  first:{label:'First',space:3,baseFareMultiplier:5,demandScale:.42,elasticity:.42}
};
const AIRCRAFT_FAMILIES=[...new Set(Object.keys(MODELS).map(Management.aircraftFamily))];

const money = n => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const num = n => new Intl.NumberFormat('en-IE').format(Math.round(n));
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const rad = d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
function defaultCabin(modelName){ return {economy:MODELS[modelName]?.seats||0,business:0,first:0}; }
function cabinForAircraft(ac){ return ac?.cabin||defaultCabin(ac?.model); }
function cabinSeatCount(ac){ return Object.values(cabinForAircraft(ac)).reduce((total,seats)=>total+(Number(seats)||0),0); }
function normalizeFares(value){
  if(value && typeof value==='object') return {
    economy:clamp(Number(value.economy)||140,20,3000),
    business:clamp(Number(value.business)||350,50,6000),
    first:clamp(Number(value.first)||700,100,12000)
  };
  const economy=clamp(Number(value)||140,20,3000);
  return {economy,business:Math.round(economy*2.5),first:Math.round(economy*5)};
}

function distanceKm(a,b){
  const R=6371, dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function bearing(a,b){
  const y=Math.sin(rad(b.lon-a.lon))*Math.cos(rad(b.lat));
  const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lon-a.lon));
  return (deg(Math.atan2(y,x))+360)%360;
}
function interpolateGreatCircle(a,b,t){
  t=clamp(t,0,1);
  const φ1=rad(a.lat), λ1=rad(a.lon), φ2=rad(b.lat), λ2=rad(b.lon);
  const d=2*Math.asin(Math.sqrt(Math.sin((φ2-φ1)/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ2-λ1)/2)**2));
  if(d<1e-9) return {lat:a.lat,lon:a.lon};
  const A=Math.sin((1-t)*d)/Math.sin(d), B=Math.sin(t*d)/Math.sin(d);
  const x=A*Math.cos(φ1)*Math.cos(λ1)+B*Math.cos(φ2)*Math.cos(λ2);
  const y=A*Math.cos(φ1)*Math.sin(λ1)+B*Math.cos(φ2)*Math.sin(λ2);
  const z=A*Math.sin(φ1)+B*Math.sin(φ2);
  return {lat:deg(Math.atan2(z,Math.sqrt(x*x+y*y))),lon:deg(Math.atan2(y,x))};
}
function routeCoords(a,b,steps=64){
  const out=[]; for(let i=0;i<=steps;i++){const p=interpolateGreatCircle(a,b,i/steps);out.push([p.lon,p.lat]);} return out;
}
function flightDurationMs(origin,dest,model){
  const km=distanceKm(origin,dest);
  return (0.65 + km/model.speedKmh) * HOUR; // taxi/climb/descent + cruise
}
function formatDuration(ms){
  const m=Math.max(0,Math.round(ms/MIN)); const h=Math.floor(m/60), mm=m%60;
  return h ? `${h}h ${String(mm).padStart(2,'0')}m` : `${m}m`;
}
function formatTime(ms){
  return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'short'}).format(new Date(ms));
}
function hhmm(ms){
  const d=new Date(ms);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function nextTimestampForClock(value, fromTs=simNow()){
  const m=/^(\d{2}):(\d{2})$/.exec(value||'');
  if(!m) return null;
  const h=Number(m[1]), min=Number(m[2]);
  if(h>23 || min>59) return null;
  const d=new Date(fromTs);
  d.setHours(h,min,0,0);
  if(d.getTime() <= fromTs + 30_000) d.setDate(d.getDate()+1);
  return d.getTime();
}
function minuteOfDay(ts){
  const d=new Date(ts);
  return d.getHours()*60+d.getMinutes();
}
function hhmmFromMinute(minute){
  minute=((Math.round(minute)%1440)+1440)%1440;
  return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
}
function alignTimestampToAirportSlot(ts,airportCode){
  const interval=AIRPORT_OPS[airportCode]?.slotIntervalMin||15;
  const d=new Date(ts);
  const total=d.getHours()*60+d.getMinutes();
  const aligned=Math.ceil(total/interval)*interval;
  if(aligned>=1440){
    d.setDate(d.getDate()+1); d.setHours(0,0,0,0);
  }else{
    d.setHours(Math.floor(aligned/60),aligned%60,0,0);
  }
  return d.getTime();
}
function timestampAtMinuteAfter(readyTs,minute){
  const d=new Date(readyTs);
  d.setHours(Math.floor(minute/60),minute%60,0,0);
  if(d.getTime()<readyTs) d.setDate(d.getDate()+1);
  return d.getTime();
}
function slotRightAt(airportCode,ts){
  const minute=minuteOfDay(ts);
  return state.slotRights.find(r=>r.airport===airportCode&&r.minuteOfDay===minute)||null;
}
function slotRightById(id){
  return state.slotRights.find(r=>r.id===id)||null;
}
function slotAssignedService(rightId){
  return state.services.find(s=>s.active&&(s.originSlotRightId===rightId||s.destinationSlotRightId===rightId))||null;
}
function requestSlotRight(airportCode,ts,{silent=false,source='operations request',force=false}={}){
  const aligned=alignTimestampToAirportSlot(ts,airportCode);
  const existing=slotRightAt(airportCode,aligned);
  if(existing) return existing;
  if(!force&&(state.resourceRequests||[]).some(item=>item.status==='pending'&&item.kind==='slot'&&item.payload?.airport===airportCode&&item.payload?.timestamp===aligned)) return null;
  if(!force&&typeof resourceAvailability==='function'&&typeof queueResourceRequest==='function'){
    const key=String(new Date(aligned).getHours());
    const supply=resourceAvailability('slot',key,airportCode);
    if(!supply.available){
      queueResourceRequest('slot',{key,location:airportCode,airport:airportCode,timestamp:aligned},supply);
      return null;
    }
  }
  const right={
    id:'SL'+state.nextSlotRight++,
    airport:airportCode,
    minuteOfDay:minuteOfDay(aligned),
    price:0,source:source==='market'?'requested':source,acquiredAt:simNow()
  };
  state.slotRights.push(right);
  save();
  return right;
}
function requiredSlotPlan(from,to,ac,fare,departure,turnaroundMin){
  const out=estimateFlight(from,to,ac,fare);
  const outboundDeparture=alignTimestampToAirportSlot(departure,from);
  const earliestReturn=outboundDeparture+out.duration+turnaroundMin*MIN;
  const returnDeparture=alignTimestampToAirportSlot(earliestReturn,to);
  return {
    outboundDeparture,
    returnDeparture,
    originRight:slotRightAt(from,outboundDeparture),
    destinationRight:slotRightAt(to,returnDeparture)
  };
}
function randomTail(i){return 'D-AS'+String(i).padStart(2,'0');}

function aircraftFuelPerformance(model){
  const turboprop=model.segment.includes('turboprop');
  const widebody=model.segment.includes('widebody');
  const regional=model.segment.includes('Regional jet');
  const burnGalPerHour=turboprop
    ? model.seats*2.5+50
    : widebody
      ? model.seats*4.1+300
      : regional
        ? model.seats*3.2+120
        : model.seats*3.7+150;
  const fuelCapacityGal=Math.round(burnGalPerHour*(model.maxRangeKm/model.speedKmh+1.4));
  return {burnGalPerHour:Math.round(burnGalPerHour),fuelCapacityGal};
}

function aircraftOperatingProfile(model){
  const fuel=aircraftFuelPerformance(model);
  const turboprop=model.segment.includes('turboprop');
  const widebody=model.segment.includes('widebody');
  const regional=model.segment.includes('Regional jet');
  const mtowTonnes=Math.round(model.seats*(widebody ? .62 : turboprop ? .48 : regional ? .52 : .50)+12);
  const maintenanceReserveHour=Math.round((turboprop?900:widebody?4_800:regional?1_650:2_300)+model.seats*8);
  const insuranceHour=Math.round(280+model.price/250_000);
  return {...fuel,mtowTonnes,maintenanceReserveHour,insuranceHour};
}

function calculateFlightEconomics({from,to,model,distanceKm,duration,pax,fare,ticketRevenue:providedRevenue,fuelGallons,fuelPrice}){
  const profile=aircraftOperatingProfile(model);
  const origin=AIRPORT_COSTS[from],destination=AIRPORT_COSTS[to];
  const hours=duration/HOUR;
  const ticketRevenue=Math.round(providedRevenue??pax*fare);
  const fuel=Math.round(fuelGallons*fuelPrice);
  const landingFees=Math.round(profile.mtowTonnes*destination.landingPerTonne);
  const passengerFees=Math.round(pax*(origin.passengerFee+origin.securityFee));
  const groundHandling=Math.round(origin.handlingBase+destination.handlingBase+pax*(origin.handlingPerPax+destination.handlingPerPax));
  const navigation=Math.round(distanceKm*.72*Math.sqrt(profile.mtowTonnes/50));
  const emissions=Math.round(fuelGallons*FUEL_KG_PER_US_GAL*CO2_KG_PER_KG_FUEL*CARBON_PRICE_EUR_PER_KG);
  const insurance=Math.round(hours*profile.insuranceHour);
  const parking=Math.round(destination.parkingHour*Math.max(1,MIN_TURN_MIN/60));
  const economics={
    ticketRevenue,fuel,landingFees,passengerFees,groundHandling,navigation,emissions,
    maintenanceReserve:0,unscheduledMaintenance:0,insurance,parking
  };
  economics.totalCost=flightEconomicsTotal(economics);
  economics.operatingProfit=ticketRevenue-economics.totalCost;
  return economics;
}

function flightEconomicsTotal(economics){
  return ['fuel','landingFees','passengerFees','groundHandling','navigation','emissions','maintenanceReserve','unscheduledMaintenance','weatherOps','insurance','parking','legacyOperating']
    .reduce((total,key)=>total+(Number(economics[key])||0),0);
}

function refreshEconomicsTotals(f){
  if(!f.economics) return;
  f.economics.totalCost=flightEconomicsTotal(f.economics);
  f.economics.operatingProfit=(f.economics.ticketRevenue||f.revenue||0)-f.economics.totalCost;
  f.revenue=f.economics.ticketRevenue;
  f.costs=f.economics.totalCost;
}

function flightFuelPlan(from,to,ac){
  const model=MODELS[ac.model];
  const performance=aircraftFuelPerformance(model);
  const duration=flightDurationMs(AIRPORTS[from],AIRPORTS[to],model);
  const tripAndTaxiGal=performance.burnGalPerHour*(duration/HOUR);
  const reserveGal=performance.burnGalPerHour*.75;
  const requiredGal=Math.min(performance.fuelCapacityGal,Math.ceil(tripAndTaxiGal+reserveGal));
  return {...performance,requiredGal,tripBurnGal:Math.ceil(tripAndTaxiGal),reserveGal:Math.ceil(reserveGal)};
}

function updateFuelMarket(t=simNow()){
  const market=state.fuelMarket;
  if(!market) return false;
  const elapsed=Math.floor((t-market.updatedAt)/FUEL_MARKET_STEP);
  if(elapsed<=0) return false;
  const steps=Math.min(elapsed,1000);
  for(let i=0;i<steps;i++){
    const meanPull=(FUEL_MARKET_BASE_EUR_GAL-market.pricePerGallon)*.045;
    const shock=(Math.random()-.5)*.12;
    market.pricePerGallon=clamp(market.pricePerGallon+meanPull+shock,1.55,4.25);
  }
  market.pricePerGallon=Math.round(market.pricePerGallon*100)/100;
  market.updatedAt+=elapsed*FUEL_MARKET_STEP;
  return true;
}

function monthlyPayroll(){
  return Object.entries(state.personnel.assignments||{}).reduce((total,[,roles])=>
    total+Object.entries(PERSONNEL).reduce((airportTotal,[role,config])=>airportTotal+(roles[role]||0)*config.salary,0),0
  );
}

function leaseMonthlyFee(modelName,termMonths){
  const months=clamp(Math.round(Number(termMonths)||60),12,120);
  const monthlyRate=.0105-((months-12)/108)*.003;
  return Math.round(MODELS[modelName].price*monthlyRate/1000)*1000;
}

function processLeasePayments(t=simNow()){
  let changed=false;
  for(const ac of state.aircraft){
    if(ac.acquisitionType!=='lease'||!Number.isFinite(ac.leasePaidThrough)) continue;
    let guard=0;
    while(t>=ac.leasePaidThrough&&guard<240){
      postTransaction(-ac.leaseMonthlyFee,'Aircraft lease',`${ac.tail} monthly lease payment`,ac.id);
      state.stats.leaseCosts+=ac.leaseMonthlyFee;
      ac.leasePaidThrough+=30*DAY;
      guard++; changed=true;
    }
  }
  return changed;
}

function staffAt(airport,role){ return Math.max(0,Math.floor(state.personnel.assignments?.[airport]?.[role]||0)); }
function changeStaff(airport,role,delta){
  if(!state.personnel.assignments[airport]) state.personnel.assignments[airport]={};
  state.personnel.assignments[airport][role]=Math.max(0,staffAt(airport,role)+delta);
}
function qualificationAt(airport,role,family){
  return Math.max(0,Math.floor(state.personnel.qualifications?.[airport]?.[role]?.[family]||0));
}
function qualifiedStaffAt(airport,role,family){
  return qualificationAt(airport,role,'Multi-fleet')+qualificationAt(airport,role,family);
}
function changeQualification(airport,role,family,delta){
  if(!['captains','firstOfficers'].includes(role)) return;
  state.personnel.qualifications??={};
  state.personnel.qualifications[airport]??={};
  state.personnel.qualifications[airport][role]??={};
  const current=qualificationAt(airport,role,family);
  state.personnel.qualifications[airport][role][family]=Math.max(0,current+delta);
}
function qualificationTransferMix(airport,role,amount){
  if(!['captains','firstOfficers'].includes(role)) return {};
  let remaining=amount;
  const mix={};
  const ratings=Object.entries(state.personnel.qualifications?.[airport]?.[role]||{}).sort((a,b)=>b[1]-a[1]);
  for(const [family,count] of ratings){
    const moved=Math.min(remaining,Math.max(0,Number(count)||0));
    if(moved){ mix[family]=moved; remaining-=moved; }
    if(!remaining) break;
  }
  return remaining?null:mix;
}

function flightPersonnelTransferCount(flightId){
  return (state.personnelTransfers||[]).reduce((total,transfer)=>
    total+(transfer.status!=='cancelled'&&transfer.method==='own'&&transfer.flightId===flightId?transfer.amount:0),0
  );
}

function externalTransferPlan(from,to,amount,t=simNow()){
  const km=distanceKm(AIRPORTS[from],AIRPORTS[to]);
  const departure=t+2*HOUR;
  const arrival=departure+(.65+km/800)*HOUR;
  return {km,cost:0,departure,arrival};
}

function processPersonnelTransfers(t=simNow()){
  let changed=false;
  for(const transfer of state.personnelTransfers||[]){
    if(transfer.status!=='scheduled') continue;
    if(transfer.method==='own'){
      const flight=state.flights.find(f=>f.id===transfer.flightId&&!f.cancelled);
      if(!flight){
        changeStaff(transfer.from,transfer.role,transfer.amount);
        for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(transfer.from,transfer.role,family,count);
        transfer.status='cancelled'; transfer.cancelledAt=t; changed=true;
        continue;
      }
      transfer.departure=flightActualDeparture(flight);
      transfer.arrival=flightActualArrival(flight);
    }
    if(t>=transfer.arrival){
      const flight=transfer.method==='own'&&state.flights.find(f=>f.id===transfer.flightId);
      const arrivalAirport=flight?flightOperationalDestination(flight):transfer.to;
      transfer.actualTo=arrivalAirport;
      changeStaff(arrivalAirport,transfer.role,transfer.amount);
      for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(arrivalAirport,transfer.role,family,count);
      transfer.status='completed'; transfer.completedAt=transfer.arrival; changed=true;
      logEvent(`${transfer.id}: ${transfer.amount} ${PERSONNEL[transfer.role].label.toLowerCase()} arrived at ${arrivalAirport}.`);
    }
  }
  return changed;
}

function processPersonnelPayroll(t=simNow()){
  const days=Math.floor((t-state.personnel.lastPayrollAt)/DAY);
  if(days<=0) return false;
  const cost=Math.round(monthlyPayroll()/30*days);
  postTransaction(-cost,'Payroll',`${days} day${days===1?'':'s'} of personnel payroll`);
  state.stats.staffCosts+=cost;
  state.personnel.lastPayrollAt+=days*DAY;
  return true;
}

function newState(){
  const real=Date.now();
  const sim=real;
  const s={
    version:VERSION,
    clock:{realBase:real,simBase:sim,speed:1},
    cash:0,
    home:'FRA',
    nextAircraft:1,
    nextFlight:1,
    nextService:1,
    nextSlotRight:1,
    nextTransaction:2,
    nextPersonnelTransfer:1,
    nextIncident:1,
    nextResourceRequest:1,
    nextExternalRequest:1,
    nextResourceAssignment:1,
    incidentExerciseIndex:0,
    slotRights:[],
    aircraft:[],
    flights:[],
    services:[],
    incidents:[],
    coordinationTasks:[],
    externalRequests:[],
    resourceAssignments:[],
    crewDuties:[],
    transactions:[],
    personnelTransfers:[],
    resourceRequests:[],
    fuelMarket:{pricePerGallon:FUEL_MARKET_BASE_EUR_GAL,updatedAt:sim},
    personnel:{assignments:{},lastPayrollAt:sim},
    ops:{automaticDisruptions:true},
    management:{cycleStart:sim,reviews:[]},
    stats:{revenue:0,costs:0,staffCosts:0,leaseCosts:0,transferCosts:0,cancellationCosts:0,scheduledMaintenanceCosts:0,cancelled:0,pax:0,completed:0},
  };
return s;
}

function migrateState(parsed){
  if(!parsed || parsed.version!==VERSION) return newState();
  if(!Array.isArray(parsed.services)) parsed.services=[];
  if(!Array.isArray(parsed.flights)) parsed.flights=[];
  if(!Array.isArray(parsed.aircraft)) parsed.aircraft=[];
  if(!Array.isArray(parsed.slotRights)) parsed.slotRights=[];
  if(!Array.isArray(parsed.incidents)) parsed.incidents=[];
  if(!Array.isArray(parsed.coordinationTasks)) parsed.coordinationTasks=[];
  const removedIncidentIds=new Set(parsed.incidents.filter(incident=>incident.type==='connection_risk').map(incident=>incident.id));
  if(removedIncidentIds.size){
    parsed.incidents=parsed.incidents.filter(incident=>!removedIncidentIds.has(incident.id));
    parsed.coordinationTasks=parsed.coordinationTasks.filter(task=>!removedIncidentIds.has(task.incidentId));
  }
  for(const incident of parsed.incidents){
    if(Array.isArray(incident.impacts)) incident.impacts=incident.impacts.filter(impact=>impact.type!=='connection_risk');
  }
  if(!Array.isArray(parsed.externalRequests)) parsed.externalRequests=[];
  if(!Array.isArray(parsed.resourceAssignments)) parsed.resourceAssignments=[];
  if(!Array.isArray(parsed.crewDuties)) parsed.crewDuties=[];
  if(!Number.isFinite(parsed.nextExternalRequest)) parsed.nextExternalRequest=parsed.externalRequests.length+1;
  if(!Number.isFinite(parsed.nextResourceAssignment)) parsed.nextResourceAssignment=parsed.resourceAssignments.length+1;
  if(!Array.isArray(parsed.resourceRequests)) parsed.resourceRequests=[];
  if(!Number.isFinite(parsed.nextResourceRequest)) parsed.nextResourceRequest=parsed.resourceRequests.length+1;
  if(!Number.isFinite(parsed.nextIncident)) parsed.nextIncident=parsed.incidents.length+1;
  if(!Number.isFinite(parsed.incidentExerciseIndex)) parsed.incidentExerciseIndex=0;
  for(const incident of parsed.incidents){
    if(!incident.status) incident.status=incident.resolvedAt?'resolved':'open';
    if(!Number.isFinite(incident.detectedAt)) incident.detectedAt=parsed.clock?.simBase||Date.now();
    if(!Number.isFinite(incident.deadline)) incident.deadline=incident.detectedAt+30*MIN;
    if(incident.blocking===undefined) incident.blocking=incident.status==='open';
    if(incident.training===undefined) incident.training=false;
    if(incident.selectedAction===undefined) incident.selectedAction='';
    if(incident.outcome===undefined) incident.outcome='';
    if(incident.technicalContext===undefined) incident.technicalContext=null;
    if(incident.classification===undefined) incident.classification='incident';
    if(incident.workflowCreatedAt===undefined) incident.workflowCreatedAt=0;
    if(incident.overdue===undefined) incident.overdue=false;
    if(incident.affectedRole===undefined) incident.affectedRole=incident.type==='crew_sick'?'captains':'';
    if(incident.recoveryPlan===undefined) incident.recoveryPlan='';
    if(!Number.isFinite(incident.recoveryPlanAt)) incident.recoveryPlanAt=0;
    if(incident.source===undefined) incident.source=incident.training?'training':'legacy';
    if(incident.sourceKey===undefined) incident.sourceKey='';
    if(incident.context===undefined) incident.context=null;
    if(!Number.isFinite(incident.lastDetectedAt)) incident.lastDetectedAt=incident.detectedAt;
    if(!Array.isArray(incident.impacts)) incident.impacts=[];
  }
  for(const task of parsed.coordinationTasks){
    if(task.branch===undefined) task.branch='';
    if(task.strategies===undefined) task.strategies=null;
    if(task.required===undefined) task.required=true;
    if(task.action===undefined) task.action='';
    if(task.strategyOptions===undefined) task.strategyOptions=null;
  }
  if(!Array.isArray(parsed.transactions)){
    parsed.transactions=[{id:'TX1',timestamp:parsed.clock?.simBase||Date.now(),amount:parsed.cash||0,category:'Opening',description:'Balance brought forward from existing save',balanceAfter:parsed.cash||0}];
  }
  if(!Number.isFinite(parsed.nextTransaction)) parsed.nextTransaction=parsed.transactions.length+1;
  if(!Array.isArray(parsed.personnelTransfers)) parsed.personnelTransfers=[];
  for(const transfer of parsed.personnelTransfers){
    if(!transfer.qualifications&&transfer.qualification) transfer.qualifications={[transfer.qualification]:transfer.amount||1};
  }
  if(!Number.isFinite(parsed.nextPersonnelTransfer)) parsed.nextPersonnelTransfer=1;
  if(!parsed.fuelMarket || !Number.isFinite(parsed.fuelMarket.pricePerGallon))
    parsed.fuelMarket={pricePerGallon:FUEL_MARKET_BASE_EUR_GAL,updatedAt:parsed.clock?.simBase||Date.now()};
  if(!Number.isFinite(parsed.fuelMarket.updatedAt)) parsed.fuelMarket.updatedAt=parsed.clock?.simBase||Date.now();
  if(!parsed.stats) parsed.stats={revenue:0,costs:0,pax:0,completed:0};
  if(!parsed.personnel) parsed.personnel={};
  if(!parsed.personnel.assignments){
    const homeRoles={};
    for(const role of Object.keys(PERSONNEL)) homeRoles[role]=Math.max(0,Math.floor(Number(parsed.personnel[role])||0));
    parsed.personnel.assignments={[parsed.home||'FRA']:homeRoles};
  }
  for(const roles of Object.values(parsed.personnel.assignments))
    for(const role of Object.keys(PERSONNEL)) roles[role]=Math.max(0,Math.floor(Number(roles[role])||0));
  if(!parsed.personnel.qualifications){
    parsed.personnel.qualifications={};
    for(const [airport,roles] of Object.entries(parsed.personnel.assignments)){
      parsed.personnel.qualifications[airport]={
        captains:{'Multi-fleet':Math.max(0,Math.floor(Number(roles.captains)||0))},
        firstOfficers:{'Multi-fleet':Math.max(0,Math.floor(Number(roles.firstOfficers)||0))}
      };
    }
  }
  if(!Number.isFinite(parsed.personnel.lastPayrollAt)) parsed.personnel.lastPayrollAt=parsed.clock?.simBase||Date.now();
  if(!Number.isFinite(parsed.stats.staffCosts)) parsed.stats.staffCosts=0;
  if(!Number.isFinite(parsed.stats.leaseCosts)) parsed.stats.leaseCosts=0;
  if(!Number.isFinite(parsed.stats.transferCosts)) parsed.stats.transferCosts=0;
  if(!Number.isFinite(parsed.nextSlotRight)) parsed.nextSlotRight=1;
  if(!parsed.ops) parsed.ops={automaticDisruptions:true};
  parsed.ops.automaticDisruptions=true;
  for(const ac of parsed.aircraft){
    if(!ac.acquisitionType) ac.acquisitionType='requested';
    if(ac.acquisitionType!=='requested'){
      ac.resourceSource=ac.resourceSource||'legacy save';
      ac.acquisitionType='requested';
    }
    if(!Number.isFinite(ac.acquiredAt)) ac.acquiredAt=parsed.clock?.simBase||Date.now();
    if(ac.defectUntil===undefined) ac.defectUntil=0;
    if(ac.defectReason===undefined) ac.defectReason='';
    if(!Number.isFinite(ac.condition)) ac.condition=100;
    if(!Number.isFinite(ac.flightHours)) ac.flightHours=0;
    if(!Number.isFinite(ac.cycles)) ac.cycles=0;
    if(!Number.isFinite(ac.fuelGallons)) ac.fuelGallons=0;
    if(!Number.isFinite(ac.issueAcknowledgedAt)) ac.issueAcknowledgedAt=0;
    if(ac.issueAcknowledgedKey===undefined) ac.issueAcknowledgedKey='';
    if(!Array.isArray(ac.melItems)) ac.melItems=[];
    if(!ac.cabin) ac.cabin=defaultCabin(ac.model);
  }
  for(const f of parsed.flights){
    for(const k of ['handlingDelayMin','technicalDelayMin','staffingDelayMin','incidentDelayMin','enrouteDelayMin','liveWeatherDelayMin','propagatedDelayMin','slotDelayMin','turnaroundRecoveryMin','slotPriorityMin','nightRestrictionDelayMin','nightRestrictionConflictDelayMin','taxiOutDelayMin','taxiInDelayMin','deicingCompletedAt','deicingHoldoverUntil','nightRecoveryApprovedAt'])
      if(f[k]===undefined) f[k]=0;
    if(!Array.isArray(f.taxiDelayCauses)) f.taxiDelayCauses=[];
    for(const k of ['airportDelayMin','airspaceDelayMin']) if(f[k]===undefined) f[k]=0;
    if(f.nightRestrictionLabel===undefined) f.nightRestrictionLabel='';
    if(f.nightRestrictionConflictLabel===undefined) f.nightRestrictionConflictLabel='';
    if(f.nightRecoveryDecision===undefined) f.nightRecoveryDecision='';
    if(f.nightRecoverySourceKey===undefined) f.nightRecoverySourceKey='';
    if(f.constraintChecked===undefined) f.constraintChecked=Boolean(f.departureLogged);
    if(f.airportConstraintLabel===undefined) f.airportConstraintLabel='';
    if(f.airspaceConstraintLabel===undefined) f.airspaceConstraintLabel='';
    if(f.connectionPax===undefined) f.connectionPax=0;
    if(f.connectionCriticalPax===undefined) f.connectionCriticalPax=0;
    if(f.connectionAtRiskPax===undefined) f.connectionAtRiskPax=0;
    if(f.connectionMissedPax===undefined) f.connectionMissedPax=0;
    if(f.crewAugmented===undefined) f.crewAugmented=false;
    if(f.crewDutyId===undefined) f.crewDutyId='';
    if(f.crewDutySplit===undefined) f.crewDutySplit=false;
    if(!Number.isFinite(f.crewSwappedAt)) f.crewSwappedAt=0;
    if(!f.crewRoleSwaps || typeof f.crewRoleSwaps!=='object') f.crewRoleSwaps={};
    if(!f.incidentChecks || typeof f.incidentChecks!=='object') f.incidentChecks={};
    if(f.staffingBlocked===undefined) f.staffingBlocked=false;
    if(f.staffingShortage===undefined) f.staffingShortage='';
    if(f.handlingDelayCause===undefined) f.handlingDelayCause='';
    if(f.slotMissed===undefined) f.slotMissed=false;
    if(f.opsChecked===undefined) f.opsChecked=Boolean(f.departureLogged);
    if(f.enrouteChecked===undefined) f.enrouteChecked=Boolean(f.departureLogged);
    if(!f.weatherLiveChecks || typeof f.weatherLiveChecks!=='object') f.weatherLiveChecks={};
    if(f.weatherRouteHazard===undefined) f.weatherRouteHazard='';
    if(f.weatherCause===undefined) f.weatherCause=null;
    if(f.slotLogged===undefined) f.slotLogged=false;
    if(f.baseCosts===undefined) f.baseCosts=f.costs||0;
    if(f.fueled===undefined) f.fueled=Boolean(f.settled||f.departureLogged);
    if(f.fuelGallons===undefined) f.fuelGallons=0;
    if(f.fuelPurchasedGallons===undefined) f.fuelPurchasedGallons=f.fuelGallons||0;
    if(f.tripFuelGallons===undefined) f.tripFuelGallons=0;
    if(f.fuelRequiredGallons===undefined) f.fuelRequiredGallons=0;
    if(f.fuelCost===undefined) f.fuelCost=0;
    if(f.fuelPricePerGallon===undefined) f.fuelPricePerGallon=0;
    if(f.maintenanceCost===undefined) f.maintenanceCost=0;
    if(f.weatherCost===undefined) f.weatherCost=0;
    if(f.defectSeverity===undefined) f.defectSeverity='';
    if(!f.fares) f.fares=normalizeFares(f.fare);
    if(!f.classPax) f.classPax={economy:f.pax||0,business:0,first:0};
    if(!f.classLoads) f.classLoads={economy:f.load||0,business:0,first:0};
    if(!f.economics){
      f.economics={ticketRevenue:f.revenue||0,fuel:f.fuelCost||0,legacyOperating:f.baseCosts||0,unscheduledMaintenance:f.maintenanceCost||0};
      refreshEconomicsTotals(f);
    }
  }

  Management.ensureState(parsed,parsed.clock?.simBase||Date.now());

  // Existing recurring services get zero-cost grandfathered slot rights.
  for(const svc of parsed.services){
    if(!svc.active) continue;
    if(!svc.fares) svc.fares=normalizeFares(svc.fare);
    const out=parsed.flights.filter(f=>f.serviceId===svc.id&&f.serviceLeg==='outbound').sort((a,b)=>a.departure-b.departure)[0];
    const ret=parsed.flights.filter(f=>f.serviceId===svc.id&&f.serviceLeg==='return').sort((a,b)=>a.departure-b.departure)[0];

    if(out&&!svc.originSlotRightId){
      let right=parsed.slotRights.find(r=>r.airport===svc.from&&r.minuteOfDay===minuteOfDay(out.departure));
      if(!right){
        right={id:'SL'+parsed.nextSlotRight++,airport:svc.from,minuteOfDay:minuteOfDay(out.departure),price:0,source:'grandfathered',acquiredAt:Date.now()};
        parsed.slotRights.push(right);
      }
      svc.originSlotRightId=right.id;
    }
    if(ret&&!svc.destinationSlotRightId){
      let right=parsed.slotRights.find(r=>r.airport===svc.to&&r.minuteOfDay===minuteOfDay(ret.departure));
      if(!right){
        right={id:'SL'+parsed.nextSlotRight++,airport:svc.to,minuteOfDay:minuteOfDay(ret.departure),price:0,source:'grandfathered',acquiredAt:Date.now()};
        parsed.slotRights.push(right);
      }
      svc.destinationSlotRightId=right.id;
    }
  }
  return parsed;
}
function loadState(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return newState();
    return migrateState(JSON.parse(raw));
  }catch(e){ return newState(); }
}
let state=loadState();
let selectedAircraftId=null;
let selectedFlightId=null;

const SPLIT_KEY='aerosim_center_split_pct';
const LEFT_SIDEBAR_SPLIT_KEY='aerosim_left_sidebar_width';
const RIGHT_SIDEBAR_SPLIT_KEY='aerosim_right_sidebar_width';
const WORKSPACE_UI_KEY='aerosim_occ_ui_v1';
const WORKSPACE_WIDGETS={
  'context-workbench':{views:['occ'],defaultOpen:true},
  'dispatch-control':{views:['occ'],defaultOpen:false},
  'crew-control':{views:['occ'],defaultOpen:false},
  'maintenance-control':{views:['occ'],defaultOpen:false},
  'station-operations':{views:['occ'],defaultOpen:false},
  'flight-operations':{views:['occ'],defaultOpen:true},
  'flight-planning':{views:['occ'],defaultOpen:false},
  'my-aircraft':{views:['occ'],defaultOpen:true},
  'management-cycle':{views:['occ'],defaultOpen:false},
  'network-support':{views:['occ'],defaultOpen:false},
  weather:{views:['occ'],defaultOpen:false},
  'personnel-relocation':{views:['occ'],defaultOpen:false}
};
function loadWorkspaceUi(){
  try{
    const parsed=JSON.parse(localStorage.getItem(WORKSPACE_UI_KEY)||'{}');
    return {activeView:'occ',collapsed:parsed.collapsed||{occ:{}},scheduleRanges:{occ:Number(parsed.scheduleRanges?.occ)||24},nextDeskPanels:parsed.nextDeskPanels||{}};
  }catch(_){ return {activeView:'occ',collapsed:{occ:{}},scheduleRanges:{occ:24},nextDeskPanels:{}}; }
}
let workspaceUi=loadWorkspaceUi();
let activeWorkspaceView=workspaceUi.activeView;
let restoreSidebarWidthsForView=()=>{};
let restoreCenterSplitForView=()=>{};
let scheduleWindowOffsetHours=-2;
let scheduleRangeHours=24;
let lastScheduleSignature='';
let lastScheduleRenderAt=0;
let aircraftSelectSignature='';
let occSignature='';
let managementSignature='';
let maintenanceSignature='';
let weatherSignature='';
function postTransaction(amount,category,description,reference=''){
  return null;
}

function simNow(){
  return state.clock.simBase + (Date.now()-state.clock.realBase)*state.clock.speed;
}
function rebaseClock(newSpeed){
  const now=simNow();
  state.clock={realBase:Date.now(),simBase:now,speed:newSpeed};
  save();
}
function save(){ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }

function setResetControlsDisabled(disabled){
  document.querySelectorAll('#resetBtn,#resetTopbarBtn').forEach(button=>{ button.disabled=disabled; });
}
function setResetStatus(message){
  const resetStatus=document.getElementById('resetStatus');
  if(resetStatus) resetStatus.textContent=message;
}
function resetLocalSave(){
  setResetControlsDisabled(true);
  setResetStatus('Resetting local airline data…');
  const blank=newState();
  try{
    // Write the replacement immediately so the periodic save and beforeunload
    // handlers can only persist the new blank state from this point onward.
    state=blank;
    localStorage.setItem(SAVE_KEY,JSON.stringify(blank));
    localStorage.removeItem(WORKSPACE_UI_KEY);
    localStorage.removeItem(SPLIT_KEY);
    localStorage.removeItem(`${SPLIT_KEY}_occ`);
    localStorage.removeItem(`${SPLIT_KEY}_management`);
    localStorage.removeItem(LEFT_SIDEBAR_SPLIT_KEY);
    localStorage.removeItem(RIGHT_SIDEBAR_SPLIT_KEY);
    localStorage.removeItem('aerosim_next_center_split_pct');
    workspaceUi=loadWorkspaceUi();
  }catch(error){
    console.error('AeroSim reset failed',error);
    setResetControlsDisabled(false);
    setResetStatus('Reset failed because browser storage is unavailable.');
    toast('Reset failed: browser storage is unavailable.');
    return;
  }

  try{
    selectedAircraftId=null;
    selectedFlightId=null;
    scheduleWindowOffsetHours=-2;
    lastScheduleSignature='';
    lastScheduleRenderAt=0;
    aircraftSelectSignature='';
    routeSignature='';

    document.getElementById('speed').value='1';
    aircraftMarkers.clear();
    aircraftLayer.clearLayers();
    routeLayer.clearLayers();
    refreshAll();
    map.setView([49.5,8.5],4,{animate:false});
  }catch(error){
    // The blank state is already safely stored. A reload is the most reliable
    // recovery if any stale renderer fails while clearing the old UI.
    console.error('AeroSim reset render failed; reloading blank save',error);
    setResetStatus('Data cleared. Reloading the blank airline…');
    window.location.reload();
    return;
  }

  try{
    const persisted=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    if(!persisted || persisted.aircraft.length || persisted.flights.length || persisted.services.length || persisted.slotRights.length){
      throw new Error('Blank state verification failed');
    }
  }catch(error){
    console.error('AeroSim reset verification failed',error);
    setResetControlsDisabled(false);
    setResetStatus('Reset could not be verified.');
    toast('Reset could not be verified. Reload and try again.');
    return;
  }
  setResetControlsDisabled(false);
  setResetStatus('Reset complete · 0 aircraft · 0 flights · 0 slot rights');
  toast('Local save reset. Your airline is empty.');
}
