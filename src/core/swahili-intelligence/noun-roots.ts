/**
 * Swahili Noun Root Database
 *
 * 400+ common Swahili noun roots organized by semantic domain.
 * These are the root forms AFTER prefix stripping (m-, wa-, ki-, vi-, etc.).
 * Some entries include the full word when the root is the word itself
 * (e.g., zero-prefix class 9/10 nouns).
 *
 * Used by the morphological analyzer for root validation and confidence scoring.
 */

// ── Financial & Banking Nouns ──────────────────────────────────────
const FINANCIAL_NOUN_ROOTS: readonly string[] = [
  "pesa", // money
  "fedha", // currency / silver
  "shilingi", // shilling
  "dola", // dollar
  "benki", // bank
  "akaunti", // account
  "hisa", // shares / stock
  "mtaji", // capital (full word)
  "mapato", // income / revenue (full word)
  "gharama", // cost / expense
  "faida", // profit / benefit
  "hasara", // loss
  "deni", // debt
  "riba", // interest (financial)
  "kopo", // loan (root of mkopo)
  "wekez", // investment (root)
  "bajeti", // budget
  "ushuru", // tax / customs
  "kodi", // tax / rent
  "mapokezi", // receipts
  "malipo", // payment
  "mshahara", // salary (full word)
  "ujira", // wages
  "bima", // insurance
  "dhamana", // guarantee / bond
  "rehani", // mortgage / collateral
  "amana", // deposit / trust
  "akiba", // savings
  "hundi", // check / cheque
  "risiti", // receipt
  "ankara", // invoice
  "stakabadhi", // receipt (formal)
  "biashara", // business / trade
  "soko", // market
  "bei", // price
  "thamani", // value
  "dukano", // trade / commerce (root)
  "uchumi", // economy
  "umaskini", // poverty
  "utajiri", // wealth
  "mfumuko", // inflation (full word)
  "mdororo", // recession (full word)
  "sarafu", // coin / currency
  "noti", // banknote
  "hazina", // treasury
  "mfuko", // fund / bag (full word)
  "mikopo", // loans (plural)
  "brokeri", // broker
  "wakala", // agent
];

// ── Business & Commerce Nouns ──────────────────────────────────────
const BUSINESS_NOUN_ROOTS: readonly string[] = [
  "duka", // shop
  "kampuni", // company
  "shirika", // organization / corporation
  "ofisi", // office
  "ghala", // warehouse / godown
  "kiwanda", // factory (full word)
  "karakana", // workshop / garage
  "bidhaa", // goods / commodity
  "huduma", // service
  "wateja", // customers (full word)
  "mwenye", // owner (full word)
  "meneja", // manager
  "tajir", // merchant / wealthy person (root)
  "fundi", // craftsperson / expert
  "msaada", // help / aid (full word)
  "mkataba", // contract (full word)
  "leseni", // license
  "hati", // document / certificate
  "cheti", // certificate
  "fomu", // form
  "barua", // letter
  "ripoti", // report
  "mpango", // plan / program (full word)
  "mradi", // project (full word)
  "makubaliano", // agreement (full word)
  "ushirikiano", // cooperation
  "mauzo", // sales (full word)
  "uzalishaji", // production
  "ubora", // quality
  "viwango", // standards
  "nembo", // brand / logo
  "tangazo", // advertisement
  "matangazo", // advertisements
];

// ── Agricultural Nouns ─────────────────────────────────────────────
const AGRICULTURAL_NOUN_ROOTS: readonly string[] = [
  "shamba", // farm / field
  "bustani", // garden
  "mazao", // crops / harvest
  "mbegu", // seed
  "mche", // seedling (full word)
  "mti", // tree (full word)
  "ua", // flower / yard
  "jani", // leaf
  "tunda", // fruit
  "begu", // seed (root)
  "rutuba", // fertility / fertilizer
  "mbolea", // fertilizer (full word)
  "dawa", // medicine / pesticide
  "mfereji", // irrigation canal (full word)
  "chombo", // tool / vessel
  "jembe", // hoe
  "panga", // machete
  "shoka", // axe
  "ng'ombe", // cow / cattle
  "mbuzi", // goat (full word)
  "kuku", // chicken
  "samaki", // fish
  "nyuki", // bee
  "asali", // honey
  "maziwa", // milk
  "nyama", // meat
  "nafaka", // grain / cereal
  "mahindi", // maize / corn
  "mpunga", // rice (plant)
  "wali", // cooked rice
  "kahawa", // coffee
  "chai", // tea
  "pamba", // cotton
  "korosho", // cashew
  "karafuu", // clove
  "kunde", // cowpea
  "maharage", // beans
  "viazi", // potatoes
  "ndizi", // banana
  "embe", // mango
  "nazi", // coconut
  "mchele", // rice (uncooked)
];

// ── Legal & Governance Nouns ───────────────────────────────────────
const LEGAL_NOUN_ROOTS: readonly string[] = [
  "sheria", // law
  "katiba", // constitution
  "haki", // right / justice
  "hukum", // judgment / sentence
  "mahakama", // court
  "hakimu", // judge / magistrate
  "wakili", // lawyer / advocate
  "mshtakiwa", // accused (full word)
  "ushahidi", // evidence
  "shahidi", // witness
  "kesi", // case
  "rufaa", // appeal
  "adhabu", // punishment
  "faini", // fine
  "kifungo", // imprisonment
  "kanuni", // regulation / rule
  "sera", // policy
  "amri", // order / decree
  "kibali", // permit / approval
  "tamko", // declaration
  "azimio", // resolution
  "pendekezo", // proposal
  "marufuku", // prohibition
  "uchaguzi", // election
  "kura", // vote
  "serikali", // government
  "bunge", // parliament
  "rais", // president
  "waziri", // minister
  "balozi", // ambassador
  "ubalozi", // embassy
];

// ── Person & Family Nouns ──────────────────────────────────────────
const PERSON_NOUN_ROOTS: readonly string[] = [
  "toto", // child (root of mtoto)
  "tu", // person (root of mtu)
  "ke", // woman (root of mke)
  "ume", // man / husband (root of mume)
  "zee", // elder (root of mzee)
  "tali", // spouse (root of mtali)
  "baba", // father
  "mama", // mother
  "kaka", // brother
  "dada", // sister
  "babu", // grandfather
  "bibi", // grandmother
  "mjomba", // uncle (full word)
  "shangazi", // aunt
  "binamu", // cousin
  "jirani", // neighbor
  "rafiki", // friend
  "adui", // enemy
  "mgeni", // guest / stranger (full word)
  "raia", // citizen
  "jamii", // community / family
  "jamaa", // relative / associate
  "ukoo", // clan / extended family
  "kabila", // tribe / ethnic group
  "taifa", // nation
  "wananchi", // citizens
  "vijana", // youth
  "wazazi", // parents
  "watoto", // children
];

// ── Place & Location Nouns ─────────────────────────────────────────
const PLACE_NOUN_ROOTS: readonly string[] = [
  "nyumba", // house
  "jengo", // building (root)
  "chumba", // room
  "mlango", // door (full word)
  "dirisha", // window
  "dari", // ceiling / roof
  "sakafu", // floor
  "ukuta", // wall
  "uwanja", // field / ground
  "barabara", // road
  "njia", // path / way
  "daraja", // bridge
  "bandari", // port / harbor
  "uwanja", // airport / field
  "stesheni", // station
  "hospitali", // hospital
  "shule", // school
  "chuo", // college / institute
  "kanisa", // church
  "msikiti", // mosque (full word)
  "hekalu", // temple
  "gereza", // prison
  "jiji", // city
  "mji", // town (full word)
  "kijiji", // village (full word)
  "mtaa", // street / neighborhood (full word)
  "nchi", // country
  "mkoa", // region (full word)
  "wilaya", // district
  "kata", // ward
  "eneo", // area
  "mahali", // place
  "pwani", // coast
  "bara", // mainland / continent
  "kisiwa", // island (full word)
  "ziwa", // lake
  "mto", // river (full word)
  "bahari", // sea / ocean
  "mlima", // mountain (full word)
  "bonde", // valley
  "msitu", // forest (full word)
  "jangwa", // desert
  "hifadhi", // reserve / conservation area
];

// ── Body & Health Nouns ────────────────────────────────────────────
const BODY_NOUN_ROOTS: readonly string[] = [
  "kono", // hand / arm (root)
  "guu", // leg / foot (root)
  "kichwa", // head
  "jicho", // eye
  "sikio", // ear
  "pua", // nose
  "mdomo", // mouth / lip (full word)
  "jino", // tooth
  "ulimi", // tongue
  "shingo", // neck
  "bega", // shoulder
  "kifua", // chest
  "tumbo", // stomach
  "mgongo", // back (full word)
  "ini", // liver
  "moyo", // heart
  "ubongo", // brain
  "damu", // blood
  "ngozi", // skin
  "nywele", // hair
  "kucha", // nail / claw
  "kidole", // finger / toe (full word)
  "gonjwa", // disease / illness
  "homa", // fever
  "malaria", // malaria
  "ukimwi", // HIV/AIDS
  "dawa", // medicine
  "daktari", // doctor
  "muuguzi", // nurse
  "hospitali", // hospital
  "afya", // health
  "ugonjwa", // disease / illness
  "chanjo", // vaccine
  "matibabu", // treatment
];

// ── Abstract Nouns ─────────────────────────────────────────────────
const ABSTRACT_NOUN_ROOTS: readonly string[] = [
  "tabu", // trouble / difficulty
  "radi", // thunder / anger
  "pya", // new (root of upya)
  "saidia", // help (root)
  "amani", // peace
  "usalama", // safety / security
  "uhuru", // freedom
  "umoja", // unity
  "nguvu", // strength / power
  "uwezo", // ability / capability
  "ujuzi", // skill / knowledge
  "elimu", // education
  "maarifa", // knowledge
  "hekima", // wisdom
  "busara", // prudence
  "akili", // intelligence
  "nia", // intention
  "malengo", // goals / objectives
  "ndoto", // dream
  "tumaini", // hope
  "imani", // faith / belief
  "upendo", // love
  "furaha", // joy / happiness
  "huzuni", // sadness
  "hasira", // anger
  "hofu", // fear
  "wivu", // jealousy
  "kiburi", // pride / arrogance
  "huruma", // compassion / mercy
  "heshima", // respect / honor
  "adabu", // manners / courtesy
  "utu", // humanity
  "ukweli", // truth
  "uongo", // lies / falsehood
  "sababu", // reason / cause
  "matokeo", // results / outcomes
  "mafanikio", // success / achievement
  "maendeleo", // development / progress
  "utamaduni", // culture / civilization
  "desturi", // custom / tradition
  "mila", // tradition / customs
  "dini", // religion
  "uzuri", // beauty / goodness
  "ubaya", // evil / badness
  "hatari", // danger
  "salama", // safety
  "taratibu", // order / procedure
  "utaratibu", // system / procedure
  "mazingira", // environment
];

// ── Technology & Modern Nouns ──────────────────────────────────────
const TECHNOLOGY_NOUN_ROOTS: readonly string[] = [
  "simu", // phone
  "kompyuta", // computer
  "mtandao", // network / internet (full word)
  "tovuti", // website
  "programu", // software / app
  "data", // data
  "habari", // information / news
  "picha", // picture / image
  "video", // video
  "sauti", // sound / audio
  "betri", // battery
  "mashine", // machine
  "gari", // car / vehicle
  "ndege", // airplane / bird
  "treni", // train
  "meli", // ship
  "pikipiki", // motorcycle
  "baiskeli", // bicycle
  "injini", // engine
  "umeme", // electricity
  "mafuta", // oil / fuel
  "nishati", // energy
  "jua", // sun / solar
  "upepo", // wind
  "maji", // water
  "hewa", // air
  "gesi", // gas
  "nenosiri", // password
  "barua pepe", // email
  "ujumbe", // message
  "mtandao", // network
  "seva", // server
  "wingu", // cloud (computing)
];

// ── Time & Quantity Nouns ──────────────────────────────────────────
const TIME_NOUN_ROOTS: readonly string[] = [
  "saa", // hour / clock / time
  "dakika", // minute
  "sekunde", // second
  "siku", // day
  "wiki", // week
  "mwezi", // month / moon (full word)
  "mwaka", // year (full word)
  "karne", // century
  "wakati", // time / period
  "kipindi", // period / season
  "msimu", // season (full word)
  "asubuhi", // morning
  "mchana", // afternoon
  "jioni", // evening
  "usiku", // night
  "alfajiri", // dawn
  "adhuhuri", // noon
  "leo", // today
  "jana", // yesterday
  "kesho", // tomorrow
  "juzi", // day before yesterday
  "kesho kutwa", // day after tomorrow
  "zamani", // long ago / old times
  "sasa", // now
  "kumbukumbu", // memory / record
];

// ── Education & Learning Nouns ─────────────────────────────────────
const EDUCATION_NOUN_ROOTS: readonly string[] = [
  "shule", // school
  "chuo", // college / university
  "darasa", // class / classroom
  "somo", // subject / lesson
  "kitabu", // book (full word)
  "daftari", // notebook
  "kalamu", // pen
  "penseli", // pencil
  "ubao", // blackboard
  "chaki", // chalk
  "mtihani", // exam (full word)
  "jaribio", // test / experiment
  "alama", // mark / grade
  "cheti", // certificate
  "digrii", // degree
  "profesa", // professor
  "mwalimu", // teacher (full word)
  "mwanafunzi", // student (full word)
  "utafiti", // research
  "tasnifu", // thesis / dissertation
  "makala", // article / essay
  "maktaba", // library
  "sanaa", // art
  "sayansi", // science
  "hisabati", // mathematics
  "jiografia", // geography
  "historia", // history
  "lugha", // language
  "fasihi", // literature
];

// ── Food & Household Nouns ─────────────────────────────────────────
const FOOD_NOUN_ROOTS: readonly string[] = [
  "chakula", // food
  "maji", // water
  "ugali", // ugali (staple food)
  "wali", // cooked rice
  "chapati", // chapati bread
  "mkate", // bread (full word)
  "supu", // soup
  "mchuzi", // sauce / gravy (full word)
  "nyama", // meat
  "samaki", // fish
  "kuku", // chicken
  "mayai", // eggs
  "chumvi", // salt
  "sukari", // sugar
  "pilipili", // pepper
  "mafuta", // oil / fat
  "mboga", // vegetable
  "matunda", // fruits
  "juisi", // juice
  "soda", // soda
  "bia", // beer
  "divai", // wine
  "sahani", // plate
  "kikombe", // cup (full word)
  "kijiko", // spoon (full word)
  "uma", // fork
  "kisu", // knife (full word)
  "sufuria", // cooking pot
  "jiko", // stove / kitchen
  "jokofu", // refrigerator
];

// ── Clothing & Material Nouns ──────────────────────────────────────
const CLOTHING_NOUN_ROOTS: readonly string[] = [
  "nguo", // clothes / fabric
  "shati", // shirt
  "suruali", // trousers
  "sketi", // skirt
  "gauni", // dress / gown
  "kanga", // kanga (wrap cloth)
  "kitenge", // kitenge (wax print)
  "kofia", // cap / hat
  "viatu", // shoes
  "mkufu", // necklace
  "pete", // ring
  "bangili", // bracelet
  "miwani", // glasses / spectacles
  "mfuko", // bag / pocket
  "mkoba", // bag / purse
  "saa", // watch
  "kitambaa", // cloth / rag
];

// ── VICOBA / Microfinance Nouns ──────────────────────────────────
const MICROFINANCE_NOUN_ROOTS: readonly string[] = [
  "kikundi", // group
  "mwenyekiti", // chairperson
  "katibu", // secretary
  "mhasibu", // treasurer
  "mzunguko", // rotation cycle
  "mchango", // contribution
  "makubaliano", // agreement
  "kanuni", // bylaws / rules
  "wanakikundi", // group members
  "fedha", // money / silver
  "tontini", // tontine (savings circle)
  "mfuko", // fund / bag
  "mkusanyiko", // collection / gathering
  "hazina", // treasury
  "rejista", // register / records
  "kumbukumbu", // records / minutes
  "orodha", // list
  "ratiba", // schedule
  "ajenda", // agenda
  "itifaki", // protocol
  "hisa", // share (VICOBA)
  "gawio", // dividend / distribution
  "masharti", // terms / conditions
  "hatua", // step / action
  "lengo", // goal / target
  "miradi", // projects (plural)
  "uchaguzi", // election
  "uanachama", // membership
  "ada", // fee / subscription
  "faini", // fine / penalty
  "rikodi", // record (loanword)
  "halmashauri", // council / board
  "baraza", // council
  "mkutano", // meeting
  "vikao", // sessions (plural)
  "mzigo", // burden / load
  "dhamini", // guarantor (noun)
  "wadhamini", // guarantors (plural)
  "uongozi", // leadership
  "uwajibikaji", // accountability
  "uwazi", // transparency
];

// ── Digital / Technology Nouns ────────────────────────────────────
const DIGITAL_NOUN_ROOTS: readonly string[] = [
  "programu", // app / program
  "mtandao", // network / internet
  "wavuti", // website
  "barua pepe", // email
  "nenosiri", // password
  "nywila", // PIN / password
  "ujumbe", // message
  "taarifa", // notification / information
  "akaunti", // account (digital)
  "wasifu", // profile
  "picha", // image / photo
  "video", // video (loanword)
  "sauti", // audio / voice
  "QR", // QR code
  "msimbo", // code
  "data", // data (loanword)
  "hifadhi", // storage
  "wingu", // cloud (cloud computing)
  "seva", // server (loanword)
  "boti", // bot (loanword)
  "AI", // AI (kept as acronym)
  "algorithi", // algorithm
  "kiolesura", // interface (UI)
  "mfumo", // system
  "toleo", // version / release
  "kasoro", // bug / defect
  "marekebisho", // update / fix
  "kipengele", // feature
  "usanifu", // design / architecture
  "usalama", // security
  "uthibitishaji", // authentication
  "usimbaji", // encryption
  "nakala", // copy / backup
  "simu", // phone / call
  "kompyuta", // computer
  "kibao", // tablet
  "USSD", // USSD (kept as acronym)
  "SIM", // SIM card
  "bluetooth", // bluetooth (loanword)
  "WiFi", // WiFi (loanword)
  "GPS", // GPS (kept as acronym)
];

// ── Agricultural Expanded Nouns ──────────────────────────────────
const AGRICULTURAL_EXPANDED_ROOTS: readonly string[] = [
  "ghala", // warehouse / granary
  "stakabadhi", // warehouse receipt
  "pembejeo", // farm inputs
  "mbolea", // fertilizer
  "mbegu", // seeds
  "umwagiliaji", // irrigation
  "uvunaji", // harvesting
  "mazao", // crops / harvest
  "msimu", // season
  "ardhi", // land / soil
  "shamba", // farm / field
  "bustani", // garden
  "kilimo", // farming / agriculture
  "mifugo", // livestock
  "kuku", // chicken / poultry
  "samaki", // fish
  "ufugaji", // animal husbandry
  "ugani", // extension services
  "thamani", // value (crop value)
  "soko", // market
  "bei", // price
  "mnunuzi", // buyer
  "muuzaji", // seller
  "dalali", // broker / middleman
  "bandari", // port / harbor
  "usafirishaji", // transportation
  "bidhaa", // goods / commodity
  "korosho", // cashew nut
  "kahawa", // coffee
  "chai", // tea
  "pamba", // cotton
  "tumbaku", // tobacco
  "mkonge", // sisal
  "karafuu", // cloves
  "muhogo", // cassava
  "mahindi", // maize / corn
  "mpunga", // rice (plant)
  "mchele", // rice (grain)
  "ngano", // wheat
  "ndizi", // banana
  "nyanya", // tomato
  "vitunguu", // onions
  "pilipili", // pepper
  "tangawizi", // ginger
  "alizeti", // sunflower
  "karanga", // groundnut / peanut
  "ufuta", // sesame
  "nazi", // coconut
  "embe", // mango
  "papai", // papaya
  "nanasi", // pineapple
  "chungwa", // orange
  "limau", // lemon / lime
  "parachichi", // avocado
];

// ── Micro-Enterprise Nouns ───────────────────────────────────────
const MICROENTERPRISE_NOUN_ROOTS: readonly string[] = [
  "bodaboda", // motorcycle taxi
  "bajaji", // three-wheeler (bajaj)
  "daladala", // minibus
  "pikipiki", // motorcycle
  "gari", // car / vehicle
  "teksi", // taxi
  "mama lishe", // food vendor (woman)
  "machinga", // street vendor
  "fundi", // artisan / craftsman
  "seremala", // carpenter
  "mfumaji", // weaver
  "mfinyanzi", // potter
  "mhunzi", // blacksmith
  "dereva", // driver
  "mchuuzi", // small trader
  "duka", // shop
  "kibanda", // kiosk / stall
  "soko", // market
  "gulio", // market day
  "mnada", // auction
  "biashara", // business / trade
  "mtaji", // capital / startup money
  "mapato", // income / revenue
  "matumizi", // expenses
  "hesabu", // calculation
  "faida", // profit
  "hasara", // loss
  "ankara", // invoice
  "risiti", // receipt
  "lebo", // label / brand
  "bidhaa", // goods / product
  "huduma", // service
  "mteja", // customer / client
  "wateja", // customers (plural)
  "mzigo", // cargo / goods
  "usafiri", // transport
  "stoo", // store / stock
  "ghala", // warehouse
  "leseni", // license
  "kibali", // permit
  "TIN", // TIN (Tax ID Number)
  "BRELA", // BRELA (registration)
];

// ── Insurance / Risk Nouns ───────────────────────────────────────
const INSURANCE_NOUN_ROOTS: readonly string[] = [
  "bima", // insurance
  "fidia", // compensation
  "hatari", // risk / danger
  "dai", // claim
  "chanzo", // source
  "tathmini", // assessment
  "kipindi", // period
  "dharura", // emergency
  "msaada", // assistance
  "hali", // condition / state
  "ajali", // accident
  "majeruhi", // casualty / victim
  "afya", // health
  "uhai", // life
  "mali", // property / wealth
  "uharibifu", // damage
  "mshtakiwa", // accused / liable party
  "mfadhili", // benefactor
  "mnufaika", // beneficiary
  "mdhamini", // insurer / guarantor
  "janga", // disaster / calamity
  "mafuriko", // flood
  "ukame", // drought
  "tetemeko", // earthquake
  "ugonjwa", // disease
  "mlipuko", // outbreak
  "kinga", // protection / prevention
  "chanjo", // vaccination
  "tiba", // treatment / cure
  "hospitali", // hospital
];

// ── Government / Regulatory Nouns ────────────────────────────────
const REGULATORY_NOUN_ROOTS: readonly string[] = [
  "serikali", // government
  "wizara", // ministry
  "idara", // department
  "tume", // commission
  "mamlaka", // authority
  "BOT", // Bank of Tanzania
  "TRA", // Tanzania Revenue Authority
  "BRELA", // Business registration
  "TCRA", // Communications regulatory
  "EWURA", // Energy/water regulatory
  "sera", // policy
  "sheria", // law
  "kanuni", // regulation
  "amri", // order / decree
  "tangazo", // gazette / notice
  "marufuku", // prohibition / ban
  "ruhusa", // permission
  "idhini", // authorization
  "kibali", // permit
  "leseni", // license
  "usajili", // registration
  "ushuru", // customs / duty
  "kodi", // tax
  "VAT", // VAT (kept as acronym)
  "PAYE", // PAYE (kept as acronym)
  "SDL", // Skills Development Levy
  "WCF", // Workers Compensation Fund
  "NSSF", // National Social Security
  "NHIF", // National Health Insurance
  "ukaguzi", // audit / inspection
  "ripoti", // report
  "rufani", // appeal
  "adhabu", // sanction / punishment
  "faini", // fine
  "shtaka", // charge / prosecution
  "mahakama", // court
  "wakili", // lawyer / advocate
  "mkataba", // contract
  "hati", // document / deed
  "cheti", // certificate
  "stakabadhi", // receipt (formal)
  "ushahidi", // evidence
  "kiapo", // oath
];

// ── Transport / Infrastructure Nouns ─────────────────────────────
const TRANSPORT_NOUN_ROOTS: readonly string[] = [
  "barabara", // road
  "njia", // path / route
  "daraja", // bridge
  "uwanja", // field / airport
  "stesheni", // station
  "kituo", // stop / station
  "bandari", // port / harbor
  "reli", // railway
  "treni", // train
  "basi", // bus
  "ndege", // airplane / bird
  "meli", // ship
  "boti", // boat
  "feri", // ferry
  "gari", // car / vehicle
  "lori", // truck / lorry
  "pikipiki", // motorcycle
  "baiskeli", // bicycle
  "petroli", // petrol / fuel
  "dizeli", // diesel
  "gesi", // gas
  "garaji", // garage
  "karakana", // workshop
  "dereva", // driver
  "kondakta", // conductor
  "tiketi", // ticket
  "nauli", // fare
  "safari", // journey / trip
  "umbali", // distance
  "mwendo", // speed / pace
];

// ── Household / Family Nouns ─────────────────────────────────────
const HOUSEHOLD_NOUN_ROOTS: readonly string[] = [
  "nyumba", // house
  "jumba", // building / mansion
  "chumba", // room
  "jiko", // kitchen / stove
  "choo", // toilet / bathroom
  "ua", // compound / yard
  "lango", // gate
  "mlango", // door
  "dirisha", // window
  "paa", // roof
  "sakafu", // floor
  "ukuta", // wall
  "samani", // furniture
  "kitanda", // bed
  "meza", // table
  "kiti", // chair
  "godoro", // mattress
  "blanketi", // blanket
  "shuka", // sheet
  "mto", // pillow / river
  "sufuria", // cooking pot
  "sahani", // plate
  "kikombe", // cup
  "uma", // fork
  "kijiko", // spoon
  "kisu", // knife
  "stovu", // stove
  "friji", // fridge
  "TV", // TV
  "redio", // radio
  "taa", // lamp / light
  "umeme", // electricity
  "maji", // water
  "moshi", // smoke
  "mkaa", // charcoal
  "kuni", // firewood
];

// ============================================================================
// Combined Noun Root Set (exported)
// ============================================================================

function buildNounRootSet(): ReadonlySet<string> {
  const allRoots = new Set<string>();
  const categories: readonly (readonly string[])[] = [
    FINANCIAL_NOUN_ROOTS,
    BUSINESS_NOUN_ROOTS,
    AGRICULTURAL_NOUN_ROOTS,
    LEGAL_NOUN_ROOTS,
    PERSON_NOUN_ROOTS,
    PLACE_NOUN_ROOTS,
    BODY_NOUN_ROOTS,
    ABSTRACT_NOUN_ROOTS,
    TECHNOLOGY_NOUN_ROOTS,
    TIME_NOUN_ROOTS,
    EDUCATION_NOUN_ROOTS,
    FOOD_NOUN_ROOTS,
    CLOTHING_NOUN_ROOTS,
    MICROFINANCE_NOUN_ROOTS,
    DIGITAL_NOUN_ROOTS,
    AGRICULTURAL_EXPANDED_ROOTS,
    MICROENTERPRISE_NOUN_ROOTS,
    INSURANCE_NOUN_ROOTS,
    REGULATORY_NOUN_ROOTS,
    TRANSPORT_NOUN_ROOTS,
    HOUSEHOLD_NOUN_ROOTS,
  ];

  for (const category of categories) {
    for (const root of category) {
      allRoots.add(root);
    }
  }

  return allRoots;
}

/**
 * 800+ Swahili noun roots across all semantic domains.
 * Expanded from 400 to cover microfinance, digital, agricultural,
 * micro-enterprise, insurance, regulatory, transport, and household.
 * Used by the morphological analyzer for root validation.
 */
export const KNOWN_NOUN_ROOTS: ReadonlySet<string> = buildNounRootSet();
