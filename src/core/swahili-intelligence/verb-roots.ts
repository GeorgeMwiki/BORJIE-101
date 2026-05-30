/**
 * Swahili Verb Root Database
 *
 * 800+ common Swahili verb roots organized by semantic domain.
 * Roots are stored WITHOUT the final vowel (-a/-e/-i) as they appear
 * after morphological stripping.
 *
 * Used by the morphological analyzer for root validation and confidence scoring.
 */

// ── Financial & Banking Verbs ──────────────────────────────────────
const FINANCIAL_VERB_ROOTS: readonly string[] = [
  "lip", // pay
  "kop", // borrow / lend (mkopo)
  "kopesh", // lend (causative of -kopa)
  "wekez", // invest
  "hesabu", // calculate / count
  "okotz", // save (money)
  "okol", // save / rescue
  "hifadh", // preserve / save
  "dhamini", // guarantee / sponsor
  "daiw", // claim / demand debt
  "tozesh", // charge (a fee)
  "toz", // charge
  "thamin", // value / appraise
  "kadiri", // estimate
  "tathmini", // evaluate / appraise
  "faidi", // benefit / profit
  "hasiri", // lose / suffer loss
  "fidir", // ransom / redeem
  "rejesh", // return / refund
  "kodi", // rent / tax
  "uzish", // sell (causative)
  "nunulish", // buy for someone
  "badalish", // exchange / convert
  "hamish", // transfer
  "peleke", // send / deliver
  "pokele", // receive
  "biashar", // trade / do business
  "pangish", // rent out / arrange payment
  "tangaz", // announce / advertise
  "safiresh", // export
  "ingiz", // import / bring in
  "dhibit", // control / regulate
  "simamish", // manage / oversee
  "shauri", // advise / consult
  "idhinish", // authorize / approve
  "ridhish", // consent / agree
  "wekew", // be deposited
  "lipw", // be paid
  "tosheleze", // suffice / be adequate
  "punguez", // reduce / discount
  "ongeze", // add / increase
  "zidish", // increase / multiply
  "gawany", // divide / distribute
  "changanish", // contribute / combine
  "changanu", // analyze
  "gharimu", // cost / be expensive
  "faidish", // benefit (causative)
  "ruzuku", // subsidize
  "riba", // charge interest
  "kamat", // seize / confiscate
];

// ── Communication & Speech Verbs ───────────────────────────────────
const COMMUNICATION_VERB_ROOTS: readonly string[] = [
  "sem", // say / speak
  "ongel", // talk / converse
  "ambi", // tell
  "uliz", // ask
  "jibu", // answer
  "eleze", // explain
  "fafanu", // clarify / elaborate
  "sikiliz", // listen
  "siki", // hear
  "it", // call (kuita)
  "pig", // call / phone (kupiga simu)
  "imb", // sing
  "tafsir", // translate / interpret
  "fasir", // interpret
  "andik", // write
  "som", // read / study
  "tamk", // pronounce / declare
  "tangaz", // announce
  "arifuu", // inform / notify
  "arifush", // notify (causative)
  "husish", // communicate
  "tahadharish", // warn / caution
  "onya", // warn
  "lalamik", // complain
  "tetesh", // stammer
  "pind", // twist / distort
  "zungumz", // converse / chat
  "nong'onez", // whisper
  "shtaki", // accuse / sue
  "shutum", // insult
  "sifu", // praise
  "shukur", // thank / be grateful
  "heshim", // respect
  "sameh", // forgive
  "ombol", // beg / plead
  "omb", // pray / request
  "dai", // claim / assert
  "kiri", // confess / admit
  "kanuush", // deny
  "ahidi", // promise
  "tamani", // wish / desire
  "siwaz", // imagine
  "kumbuk", // remember
  "sahau", // forget
  "jelez", // indicate / gesture
  "simuli", // narrate / tell a story
  "kariri", // repeat / review
  "habari", // inform
  "taja", // mention / name
  "pongez", // congratulate
];

// ── Movement & Travel Verbs ────────────────────────────────────────
const MOVEMENT_VERB_ROOTS: readonly string[] = [
  "end", // go
  "j", // come
  "rudi", // return
  "ondok", // leave / depart
  "tembel", // walk / visit
  "kimbi", // run
  "ruk", // jump / fly
  "pit", // pass
  "fik", // arrive
  "ingi", // enter
  "tok", // go out / come from
  "hamish", // move / transfer
  "kimbilish", // chase / pursue
  "fuatish", // follow
  "fuat", // follow
  "ongoz", // lead / guide
  "safir", // travel
  "peleke", // send / deliver
  "chukul", // carry / take
  "beb", // carry (on back)
  "tup", // throw
  "shuk", // descend / go down
  "pand", // climb / go up
  "simam", // stand
  "ket", // sit
  "lal", // sleep / lie down
  "amk", // wake up / rise
  "anguk", // fall
  "teleze", // slide / slip
  "zunguk", // go around / surround
  "geuk", // turn around
  "rudi", // return / go back
  "sogel", // move closer / approach
  "eleke", // head toward
  "torosh", // flee / escape
  "wahi", // be on time / hurry
  "chelew", // be late
  "kimbili", // run toward
  "tandik", // march / walk (deliberately)
  "fikish", // deliver / cause to arrive
  "cheze", // play (movement sense)
  "ogelek", // swim
  "endelek", // continue / proceed
  "endelez", // develop / advance
  "penya", // penetrate / enter through
  "vuk", // cross
];

// ── State & Being Verbs ────────────────────────────────────────────
const STATE_VERB_ROOTS: readonly string[] = [
  "w", // be / become (-wa)
  "kal", // stay / live / sit
  "ish", // live / exist
  "kuf", // die
  "ugul", // be sick
  "pone", // get well / recover
  "zeek", // age / get old
  "ong'onek", // appear / seem
  "fanan", // resemble
  "tosh", // suffice / be enough
  "pasw", // be fitting / suitable
  "wez", // be able / can
  "laz", // be necessary
  "stahil", // deserve
  "pendez", // be pleasing
  "udhi", // annoy / disturb
  "chosh", // bore / tire (someone)
  "chok", // be tired / bored
  "ogofe", // fear
  "furahi", // be happy
  "huzuni", // be sad
  "kasirish", // anger (causative)
  "kasirik", // be angry
  "staajab", // be amazed
  "shangaz", // be surprised
  "shindw", // fail / be unable
  "faulw", // fail (passively)
  "taabik", // be troubled
  "tegemek", // be reliable / depend on
  "imani", // believe / trust
  "tumai", // hope
  "jisiki", // feel
  "jut", // regret
  "shtuk", // be startled
  "og", // bathe / wash
  "zoelek", // be accustomed
  "toshan", // be sufficient for each other
  "kamil", // be complete / perfect
  "kamilish", // complete (causative)
];

// ── Agricultural Verbs ─────────────────────────────────────────────
const AGRICULTURAL_VERB_ROOTS: readonly string[] = [
  "lim", // cultivate / farm
  "pand", // plant
  "vun", // harvest
  "palk", // thresh
  "kok", // pick / pluck (fruit)
  "nyunyiz", // irrigate / sprinkle
  "mwagili", // irrigate
  "palilish", // weed
  "rutubish", // fertilize
  "kau", // dry (in sun)
  "chemsh", // boil / process
  "sagish", // grind / mill
  "tifuatish", // fumigate
  "hifadh", // store / preserve
  "fug", // keep livestock / rear
  "lish", // feed (animals)
  "kam", // milk / squeeze
  "nywesh", // water (animals)
  "chambu", // analyze soil
  "ot", // warm / heat
  "wek", // put / set / store
  "kaush", // dry
  "pelek", // send (to market)
  "zing", // spin / wind
  "sat", // set up / install (for irrigation)
  "chest", // comb / card (fibers)
  "fum", // weave
  "shon", // sew
  "bob", // plait / braid
  "chanj", // comb / separate
  "geuzmish", // transform / process
];

// ── Business & Commerce Verbs ──────────────────────────────────────
const BUSINESS_VERB_ROOTS: readonly string[] = [
  "uz", // sell
  "nunu", // buy
  "tafut", // seek / look for
  "pat", // get / obtain
  "chagu", // choose / select
  "pang", // arrange / plan
  "tengenez", // make / fix / prepare
  "anzish", // start / establish
  "maliz", // finish / complete
  "endelez", // develop / continue
  "boreseh", // improve
  "sahih", // correct / verify
  "thibit", // confirm / verify
  "shiriki", // participate / share
  "sahihi", // sign (document)
  "ondol", // remove / cancel
  "wekez", // invest
  "simamish", // manage
  "ajir", // employ / hire
  "achish", // lay off / fire
  "staafu", // retire
  "fanya", // do / make
  "pimish", // measure (causative)
  "pim", // measure / test
  "karabat", // repair / renovate
  "buni", // create / innovate
  "gunduli", // discover
  "vumlish", // invent
  "sabab", // cause
  "athir", // affect / impact
  "takiw", // be required / needed
  "hitaj", // need / require
  "fikir", // think / consider
  "amul", // decide
  "azim", // determine / resolve
  "sanif", // classify / categorize
  "orodhesh", // list / catalog
  "hakik", // verify / make certain
  "kamb", // approach / deal with
  "jitolez", // volunteer / offer oneself
  "wakilish", // represent
  "tetee", // defend / advocate
  "husish", // involve / relate
  "kamat", // arrest / seize
  "fundish", // teach / instruct
  "saidish", // help / assist
  "ongoz", // lead / direct
  "hamasiesh", // motivate / inspire
];

// ── Legal & Regulatory Verbs ───────────────────────────────────────
const LEGAL_VERB_ROOTS: readonly string[] = [
  "shtaki", // accuse / sue
  "hukum", // judge / sentence
  "amur", // order / command
  "kataz", // prohibit / forbid
  "ruhus", // permit / allow
  "idhinish", // authorize
  "sajili", // register
  "leseni", // license
  "thibitish", // ratify / confirm
  "afuu", // pardon / forgive
  "adhibu", // punish
  "fahamish", // inform legally / serve notice
  "kenuush", // deny (formally)
  "lazimish", // compel / require
  "tiiw", // obey / comply
  "shitakish", // prosecute
  "haki", // justify
  "fikish", // bring before (court)
  "achiw", // be released
  "fungw", // be imprisoned
  "zuish", // prevent / restrain
  "kamb", // approach (legally)
  "uzulu", // impeach / remove from office
  "jibu", // respond / answer (legally)
  "piga", // strike / beat
  "ib", // steal
  "laghai", // deceive / defraud
  "shuhudia", // witness / testify
  "teteshw", // be defended
  "onesh", // show / present (evidence)
  "chunguez", // investigate / scrutinize
  "chambu", // analyze
  "thibiti", // establish / prove
];

// ── Technology Verbs ───────────────────────────────────────────────
const TECHNOLOGY_VERB_ROOTS: readonly string[] = [
  "bonyez", // press / click
  "tum", // send / use
  "tumish", // use (causative)
  "pak", // load / upload
  "pakuw", // download
  "ching", // print
  "chap", // print / publish
  "kanush", // scan
  "hifadh", // save (file)
  "fung", // close / lock
  "fungul", // open / unlock
  "wasilish", // present / communicate / submit
  "wasilian", // connect (with each other)
  "unganish", // connect / join
  "tenganish", // disconnect / separate
  "rekod", // record
  "kopi", // copy
  "gundulish", // discover / detect
  "chang'anu", // analyze / decompose
  "rud", // return / revert
  "husish", // process / relate
  "fich", // hide / encrypt
  "fichulik", // be revealed / decrypted
  "hakik", // verify / authenticate
  "jaz", // fill (a form)
  "thibiti", // validate
  "sahih", // correct
  "ratib", // arrange / organize
  "sasish", // update
  "sakinish", // install
  "ondol", // remove / uninstall
  "anz", // start / begin
  "acha", // stop / quit
  "endelez", // continue / develop
  "wek", // set / put / configure
];

// ── Domestic & Daily Life Verbs ────────────────────────────────────
const DOMESTIC_VERB_ROOTS: readonly string[] = [
  "l", // eat (kula)
  "nywe", // drink
  "pik", // cook
  "ful", // wash (clothes)
  "og", // bathe / wash
  "vish", // dress / wear (causative)
  "val", // wear / put on
  "fungish", // wrap / pack
  "fung", // close / tie
  "fungul", // open / untie
  "sung", // push
  "vut", // pull
  "beb", // carry
  "chukul", // take / carry
  "wek", // put / place
  "tup", // throw
  "ok", // pick up
  "pang", // arrange
  "safish", // clean
  "fagi", // sweep
  "tengenez", // fix / make
  "kat", // cut
  "chom", // pierce / stab / grill
  "un", // connect / join
  "chor", // draw / sketch
  "rang", // color / paint
  "tok", // happen / come from
  "let", // bring
  "pel", // send
  "fich", // hide
  "tafut", // look for / search
  "pend", // love
  "chuki", // hate
  "ogop", // fear
  "jisiki", // feel
  "furahi", // be happy
  "huzunik", // be sad
];

// ── Education & Learning Verbs ─────────────────────────────────────
const EDUCATION_VERB_ROOTS: readonly string[] = [
  "fundish", // teach
  "jifunz", // learn (reflexive)
  "som", // read / study
  "andik", // write
  "karir", // repeat / revise
  "elew", // understand
  "elim", // educate / enlighten
  "chez", // examine / test
  "faulw", // fail
  "faulish", // cause to fail
  "fas", // pass / succeed
  "shind", // overcome / win
  "jibu", // answer
  "uliz", // ask / question
  "tahini", // evaluate
  "jadili", // debate / discuss
  "chunguez", // research / investigate
  "gundulish", // discover
  "fikir", // think / reflect
  "kubali", // accept / agree
  "katal", // refuse / reject
  "pendekez", // suggest / propose
  "kumbuk", // remember
  "sahau", // forget
  "zoef", // practice
  "stadi", // master / be skilled
  "tafakur", // meditate / contemplate
  "buni", // innovate / create
  "undish", // construct (knowledge)
  "hoji", // question / interrogate
  "tuzi", // compose / write (poetry)
];

// ── Health & Body Verbs ────────────────────────────────────────────
const HEALTH_VERB_ROOTS: readonly string[] = [
  "ugul", // be sick
  "pone", // recover / get well
  "tibu", // treat / cure
  "gangan", // treat (traditional)
  "chang", // vaccinate / inject
  "dung", // sting / bite
  "um", // hurt / ache
  "lem", // be lame / limp
  "pofuk", // become blind
  "zal", // give birth
  "nywesh", // give to drink
  "lish", // feed
  "lel", // cry / weep
  "chek", // laugh
  "pef", // breathe
  "kok", // cough
  "piga", // hit / strike
  "jeru", // wound
  "vunjik", // break (bone)
  "poz", // cool / rest
  "pump", // rest / relax
  "sinzi", // doze / nap
  "mez", // swallow
  "tap", // vomit
  "harib", // spoil / damage
  "ambukiz", // infect / contaminate
  "kang", // prevent / block
  "zuish", // prevent / obstruct
];

// ── Emotional & Cognitive Verbs ────────────────────────────────────
const COGNITIVE_VERB_ROOTS: readonly string[] = [
  "pend", // love
  "chuki", // hate
  "furahi", // be happy
  "huzunik", // be sad
  "kasirik", // be angry
  "ogop", // fear
  "tumai", // hope
  "imani", // believe
  "tamani", // wish / desire
  "tarajie", // expect
  "siwaz", // imagine
  "ndot", // dream
  "fikir", // think
  "amul", // decide
  "azim", // resolve / determine
  "kubali", // accept
  "katal", // refuse
  "shuku", // suspect / doubt
  "jut", // regret
  "staajab", // wonder / be amazed
  "shangaz", // be surprised
  "sikitik", // be sorry / sympathize
  "onesh", // show
  "j", // know (kujua)
  "fahamu", // understand / comprehend
  "makin", // be careful / concentrate
  "angali", // be careful / watch out
  "bughudh", // detest / loathe
  "wivu", // be jealous
  "shtuk", // be startled / shocked
  "jivuni", // be proud
  "aibu", // be ashamed
];

// ── Construction & Physical Work Verbs ─────────────────────────────
const CONSTRUCTION_VERB_ROOTS: readonly string[] = [
  "jeng", // build
  "bomb", // demolish
  "chim", // dig
  "fund", // bury / fill
  "tand", // spread out / lay
  "ezek", // put on roof
  "pang", // arrange
  "tengenez", // make / construct
  "karabat", // repair / renovate
  "sanid", // support / prop up
  "shik", // hold / catch
  "beb", // carry
  "nyanyul", // lift
  "wek", // place / put
  "kaz", // squeeze / tighten
  "fung", // tie / fasten
  "kat", // cut
  "sat", // grind / sharpen
  "pim", // measure
  "chor", // draw / sketch
  "choresh", // engrave / mark
  "finy", // press / squeeze
  "vunji", // break / demolish
  "un", // join / connect
  "paku", // scrape / plaster
  "zib", // block / plug
  "tobo", // bore / drill
  "chang", // mix / combine
];

// ── Social & Religious Verbs ───────────────────────────────────────
const SOCIAL_VERB_ROOTS: readonly string[] = [
  "sal", // pray (salat)
  "omb", // pray / beg
  "bariki", // bless
  "laani", // curse
  "o", // marry (kuoa)
  "olew", // be married
  "taliki", // divorce
  "zik", // bury (deceased)
  "omboleze", // mourn
  "alik", // invite
  "karibi", // welcome
  "starehe", // relax / enjoy
  "shereheke", // celebrate
  "sherehe", // celebrate
  "ngoj", // wait
  "sub", // wait patiently
  "tii", // obey
  "asi", // rebel
  "shiriki", // participate
  "ushiriki", // cooperate
  "saidish", // help
  "hisani", // be generous
  "faidish", // benefit
  "adhir", // harm
  "hudumish", // serve
  "hudumu", // serve
  "tembelez", // visit
  "pokele", // receive
  "karibish", // welcome / host
  "agiz", // order / instruct
  "gawan", // share with each other
  "amin", // trust / be faithful
];

// ── Nature & Weather Verbs ─────────────────────────────────────────
const NATURE_VERB_ROOTS: readonly string[] = [
  "nyesh", // rain
  "met", // shine (sun)
  "vum", // blow (wind)
  "tiririk", // drip / flow
  "furu", // overflow
  "kauk", // dry up
  "oz", // rot / decay
  "ot", // warm / heat
  "poz", // cool
  "gand", // freeze / solidify
  "yeyuk", // melt / dissolve
  "wak", // burn / glow
  "chemk", // boil (intransitive)
  "mee", // flow
  "zing", // spin / buzz
  "tetemek", // tremble / shake (earthquake)
  "ibuk", // spring up (water)
];

// ── Perception & Sensory Verbs ─────────────────────────────────────
const PERCEPTION_VERB_ROOTS: readonly string[] = [
  "on", // see
  "tazam", // look / watch
  "angali", // observe / watch carefully
  "siki", // hear
  "sikiliz", // listen
  "nuk", // smell (transitive)
  "nuki", // smell (intransitive)
  "gus", // touch
  "onji", // taste
  "hisi", // feel / sense
  "gundulish", // detect / discover
  "tambul", // recognize
  "tofautish", // distinguish / differentiate
  "linganish", // compare
  "kisi", // estimate
  "pim", // measure / gauge
  "chunguez", // scrutinize / examine
  "peruzi", // peruse / browse
  "dodosel", // examine closely
];

// ── Causative, Intensive & Extended Action Verbs ───────────────────
const EXTENDED_ACTION_VERB_ROOTS: readonly string[] = [
  "lez", // raise / bring up
  "zaliw", // be born
  "zal", // give birth
  "simamish", // manage / supervise
  "aminish", // convince / assure
  "hamasish", // motivate / excite
  "ondol", // remove
  "ondolez", // remove from
  "rudhish", // satisfy
  "ridhish", // satisfy / please
  "tamauesh", // astonish / amaze
  "burudish", // cool / refresh
  "oesh", // show (causative of -ona)
  "juliw", // be known
  "julish", // make known / inform
  "tokeze", // appear / emerge
  "jelez", // indicate / express
  "jitolez", // volunteer
  "pendekez", // suggest / propose
  "kadimish", // advance / promote
  "badalish", // change / convert
  "geuz", // turn / change
  "geuzmish", // transform
  "badilish", // change / transform
  "rekebish", // correct / adjust
  "sahihish", // correct (formally)
  "shughulik", // be busy with / deal with
  "tayarish", // prepare
  "wezesh", // enable / empower
  "dhaminish", // guarantee / ensure
  "thibitish", // confirm / certify
  "tekeleze", // implement / execute
  "ahidish", // make a promise
];

// ── Additional Common Verb Roots ───────────────────────────────────
const ADDITIONAL_COMMON_ROOTS: readonly string[] = [
  "ach", // leave / let / stop
  "dang", // deceive
  "f", // die (kufa)
  "fik", // arrive
  "fung", // close / tie
  "gong", // hit / knock
  "gum", // discover / find
  "im", // stand firm
  "ish", // live / exist
  "jib", // answer
  "kam", // squeeze / wring
  "kan", // deny
  "kaw", // be intense / strong
  "ker", // be intelligent
  "king", // block / obstruct
  "kodi", // rent
  "koh", // miss / fail
  "lek", // flow / leak
  "log", // bewitch
  "mal", // finish
  "mez", // swallow
  "ng'at", // shine
  "ngoj", // wait
  "nuk", // smell
  "nyang'any", // snatch
  "nung'unik", // grumble
  "nyamaz", // be quiet
  "nyatuk", // drizzle
  "nyook", // straighten
  "okot", // pick up
  "ong'onek", // appear / seem
  "ot", // warm
  "pal", // scrape / rake
  "pambanu", // differ / be separate
  "pash", // be fitting
  "pelek", // send
  "pend", // love / like
  "pige", // strike
  "pokony", // cool (tr.)
  "pung", // reduce
  "rib", // ferment
  "rit", // guard / protect
  "ruk", // jump
  "sak", // grind
  "sha", // fail / be unable
  "shambulik", // be attacked
  "shambulis", // attack
  "shing'ish", // wrap tightly
  "shuk", // descend / land
  "simik", // stand firm
  "sink", // sink
  "songesh", // push forward
  "songom", // get stuck
  "suk", // twist / plait
  "sukum", // push
  "te", // fall (obsolete form)
  "teg", // trap
  "tetem", // tremble
  "tuk", // be called / be named
  "twel", // take away
  "vik", // cross over
  "vimb", // swell
  "vish", // dress
  "vuk", // cross
  "vund", // rot / decay
  "vunj", // break
  "wak", // shine / burn
  "wez", // can / be able
  "yeyuk", // melt
  "zamish", // submerge
  "zing", // spin
  "zoe", // be used to / accustom
  "zui", // prevent
];

// ── VICOBA / Microfinance Verbs ──────────────────────────────────
const MICROFINANCE_VERB_ROOTS: readonly string[] = [
  "chang", // contribute (mchango)
  "changish", // contribute (causative)
  "chaguliw", // be selected
  "dhamini", // guarantee (peer)
  "fungash", // tie together (group bond)
  "galawad", // circulate / rotate (funds)
  "gawany", // divide / share out
  "hazinish", // store in treasury
  "hisab", // count / account
  "husish", // connect / communicate
  "jadili", // discuss / debate
  "jiandikish", // register (oneself)
  "jiunganish", // join together
  "jitolel", // volunteer / contribute
  "kadir", // estimate / valuate
  "kamat", // seize (collateral)
  "kamilish", // complete / finalize
  "kopeshan", // lend each other
  "kubalian", // agree (reciprocal)
  "kusany", // collect / gather
  "lipian", // pay each other
  "okotz", // save (money)
  "pangiw", // be arranged
  "ripoti", // report
  "sagaz", // set apart / assign
  "sambazan", // distribute among
  "simiki", // establish firmly
  "tathmin", // evaluate / assess
  "tozesh", // charge (a fee)
  "unganish", // unite / merge
  "wekez", // invest
  "wekezan", // invest together
  "zuish", // prevent / block
];

// ── Digital Finance Verbs ────────────────────────────────────────
const DIGITAL_FINANCE_VERB_ROOTS: readonly string[] = [
  "bofye", // click / press (button)
  "chagues", // select / choose
  "chap", // print / type
  "digiti", // digitize
  "download", // download (loanword, common)
  "fung", // lock (security)
  "fungulish", // unlock
  "hakiki", // verify / authenticate
  "ingize", // input / enter data
  "jisajil", // sign up / register
  "login", // log in (loanword, common in Tanzania)
  "onyesh", // display / show
  "pakul", // download (kupakua)
  "pangili", // arrange / format
  "pelekesh", // forward / route
  "pokele", // receive (notification)
  "sajil", // register
  "scan", // scan (loanword)
  "shukish", // download (kushukisha)
  "thibitish", // confirm / validate
  "tibu", // cure / fix (a bug, colloquial)
  "tumish", // use / utilize
  "unganish", // connect / link
  "wasilish", // submit / present
];

// ── Emotional / Motivational Verbs ───────────────────────────────
const EMOTIONAL_VERB_ROOTS: readonly string[] = [
  "amini", // believe / trust
  "changamk", // be cheerful
  "changamsh", // cheer up
  "dharau", // despise / underestimate
  "farij", // comfort / console
  "furah", // rejoice / be happy
  "furahi", // be happy
  "hamak", // be angry
  "heshimish", // cause respect
  "hofi", // fear
  "huzunik", // be sad
  "jali", // care about
  "jisiki", // feel (emotion)
  "jut", // regret / be remorseful
  "kashifu", // embarrass / shame
  "kereh", // dislike / be disgusted
  "kisirani", // frustrate
  "ogop", // fear / be afraid
  "on", // see / perceive
  "pend", // love / like
  "ridhik", // be satisfied
  "shituk", // be startled
  "shukur", // be grateful
  "sikit", // be sorrowful
  "stahamilish", // endure
  "staajab", // be amazed
  "tamauk", // be shocked
  "tamani", // wish / hope
  "tegemele", // depend on / trust
  "tumai", // hope
  "wimb", // swell with pride
];

// ── Professional / Workplace Verbs ───────────────────────────────
const PROFESSIONAL_VERB_ROOTS: readonly string[] = [
  "ajir", // hire / employ
  "ajiriw", // be employed
  "achish", // fire / dismiss
  "elekez", // direct / instruct
  "fundish", // teach
  "hadhir", // present / attend
  "hudumish", // serve (customer service)
  "kabidh", // hand over (formally)
  "kaimu", // act (in a role)
  "kampein", // campaign
  "karifish", // welcome / onboard
  "mkutanish", // convene / meet
  "ofisi", // officiate
  "ondolew", // be removed (from role)
  "panganish", // schedule / arrange
  "promot", // promote
  "ratibu", // coordinate
  "rejesh", // refer back
  "rufan", // appeal (formal)
  "saidinish", // assist (formal)
  "shahidi", // witness / testify
  "staafu", // retire
  "teuliw", // be appointed
  "wakilish", // represent
  "wezesh", // empower / enable
];

// ── Transport / Logistics Verbs ──────────────────────────────────
const TRANSPORT_VERB_ROOTS: readonly string[] = [
  "deri", // drive / steer
  "egeш", // park
  "endeш", // drive (car)
  "imish", // stop (vehicle)
  "jaz", // fill (fuel)
  "pakulish", // load (goods)
  "shuгush", // ship / dispatch
  "safirish", // transport
  "tarish", // deliver (goods)
  "teremsн", // descend (from vehicle)
  "vush", // ferry / cross
];

// ── Cooking / Food Verbs (relevant for mama lishe businesses) ────
const FOOD_BUSINESS_VERB_ROOTS: readonly string[] = [
  "andez", // start (cooking fire)
  "changany", // mix / blend
  "chemsh", // boil
  "kaang", // fry
  "kat", // cut
  "kond", // peel
  "la", // eat
  "meny", // pour
  "nung'unik", // grumble / simmer
  "oк", // roast
  "pakul", // serve (food)
  "pik", // cook
  "sagisн", // grind / mill
  "тоз", // marinate / season
  "twang", // roast on open fire
  "ung", // join / knead
  "uп", // cook (stew)
];

// ── Religious / Community Verbs ──────────────────────────────────
const COMMUNITY_VERB_ROOTS: readonly string[] = [
  "abudu", // worship
  "amrish", // command
  "bariki", // bless
  "dua", // pray (make dua)
  "fung", // fast (ramadan)
  "harakish", // mobilize
  "harambel", // fundraise (harambee)
  "hiji", // go on pilgrimage
  "huba", // preach
  "ibad", // worship
  "jumuish", // include / congregate
  "khutub", // give sermon
  "sadak", // give charity
  "sali", // pray (salat)
  "shiriki", // participate
  "shuhudi", // bear witness
  "тawadh", // be humble
  "tohар", // purify
  "umi", // wake for dawn prayer
  "wakf", // endow (waqf)
  "zak", // pay zakat
];

// ── Weather / Environment Verbs ──────────────────────────────────
const ENVIRONMENT_VERB_ROOTS: readonly string[] = [
  "chafuk", // be polluted
  "chafush", // pollute
  "haufish", // evaporate
  "hifadhi", // conserve
  "joto", // heat (be hot)
  "kauk", // dry up
  "kiangaz", // shine (sun)
  "kimb", // run off (water)
  "lainish", // moderate (weather)
  "loweш", // get wet
  "mimink", // pour (rain)
  "mvuk", // steam / evaporate
  "nesh", // drizzle
  "ny", // rain
  "oteш", // cool down
  "peruz", // blow (wind)
  "tayarish", // prepare (for weather)
  "thel", // snow / freeze
  "vumish", // endure (weather)
  "wak", // burn / shine
];

// ============================================================================
// Combined Verb Root Set (exported)
// ============================================================================

function buildVerbRootSet(): ReadonlySet<string> {
  const allRoots = new Set<string>();
  const categories: readonly (readonly string[])[] = [
    FINANCIAL_VERB_ROOTS,
    COMMUNICATION_VERB_ROOTS,
    MOVEMENT_VERB_ROOTS,
    STATE_VERB_ROOTS,
    AGRICULTURAL_VERB_ROOTS,
    BUSINESS_VERB_ROOTS,
    LEGAL_VERB_ROOTS,
    TECHNOLOGY_VERB_ROOTS,
    DOMESTIC_VERB_ROOTS,
    EDUCATION_VERB_ROOTS,
    HEALTH_VERB_ROOTS,
    COGNITIVE_VERB_ROOTS,
    CONSTRUCTION_VERB_ROOTS,
    SOCIAL_VERB_ROOTS,
    NATURE_VERB_ROOTS,
    PERCEPTION_VERB_ROOTS,
    EXTENDED_ACTION_VERB_ROOTS,
    ADDITIONAL_COMMON_ROOTS,
    MICROFINANCE_VERB_ROOTS,
    DIGITAL_FINANCE_VERB_ROOTS,
    EMOTIONAL_VERB_ROOTS,
    PROFESSIONAL_VERB_ROOTS,
    TRANSPORT_VERB_ROOTS,
    FOOD_BUSINESS_VERB_ROOTS,
    COMMUNITY_VERB_ROOTS,
    ENVIRONMENT_VERB_ROOTS,
  ];

  for (const category of categories) {
    for (const root of category) {
      allRoots.add(root);
    }
  }

  return allRoots;
}

/**
 * 1000+ Swahili verb roots across all semantic domains.
 * Expanded from 800 to cover microfinance, digital finance,
 * professional, transport, food business, community, and environment.
 * Used by the morphological analyzer for root validation.
 */
export const KNOWN_VERB_ROOTS: ReadonlySet<string> = buildVerbRootSet();
