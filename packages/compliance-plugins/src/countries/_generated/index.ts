/**
 * Auto-generated barrel for scaffolded country plugins.
 *
 * Generated on 2026-04-21 by `scripts/generate-country-scaffolds.ts`.
 * Do not hand-edit — rerun the generator instead.
 *
 * Each scaffold is an `ExtendedCountryProfile` with:
 *   - Real ISO currency + language + date-format data.
 *   - Stubbed tax regime (`requiresManualConfiguration: true`).
 *   - Default lease-law and tenant-screening ports.
 *   - Generic payment rails (Stripe / bank / manual).
 *
 * The root country barrel (../index.ts) merges these with the 18 full-fidelity
 * profiles so that `resolvePlugin(<any ISO code>)` always returns a valid
 * plugin. Full-fidelity profiles always win — the barrel never overwrites a
 * hand-authored country.
 */

import type { ExtendedCountryProfile } from '../types.js';

import { andorraScaffoldProfile, andorraScaffoldMetadata } from './ad/index.js';
import { afghanistanScaffoldProfile, afghanistanScaffoldMetadata } from './af/index.js';
import { antiguaAndBarbudaScaffoldProfile, antiguaAndBarbudaScaffoldMetadata } from './ag/index.js';
import { anguillaScaffoldProfile, anguillaScaffoldMetadata } from './ai/index.js';
import { albaniaScaffoldProfile, albaniaScaffoldMetadata } from './al/index.js';
import { armeniaScaffoldProfile, armeniaScaffoldMetadata } from './am/index.js';
import { angolaScaffoldProfile, angolaScaffoldMetadata } from './ao/index.js';
import { antarcticaScaffoldProfile, antarcticaScaffoldMetadata } from './aq/index.js';
import { argentinaScaffoldProfile, argentinaScaffoldMetadata } from './ar/index.js';
import { americanSamoaScaffoldProfile, americanSamoaScaffoldMetadata } from './as/index.js';
import { austriaScaffoldProfile, austriaScaffoldMetadata } from './at/index.js';
import { arubaScaffoldProfile, arubaScaffoldMetadata } from './aw/index.js';
import { landIslandsScaffoldProfile, landIslandsScaffoldMetadata } from './ax/index.js';
import { azerbaijanScaffoldProfile, azerbaijanScaffoldMetadata } from './az/index.js';
import { bosniaAndHerzegovinaScaffoldProfile, bosniaAndHerzegovinaScaffoldMetadata } from './ba/index.js';
import { barbadosScaffoldProfile, barbadosScaffoldMetadata } from './bb/index.js';
import { bangladeshScaffoldProfile, bangladeshScaffoldMetadata } from './bd/index.js';
import { belgiumScaffoldProfile, belgiumScaffoldMetadata } from './be/index.js';
import { burkinaFasoScaffoldProfile, burkinaFasoScaffoldMetadata } from './bf/index.js';
import { bulgariaScaffoldProfile, bulgariaScaffoldMetadata } from './bg/index.js';
import { bahrainScaffoldProfile, bahrainScaffoldMetadata } from './bh/index.js';
import { burundiScaffoldProfile, burundiScaffoldMetadata } from './bi/index.js';
import { beninScaffoldProfile, beninScaffoldMetadata } from './bj/index.js';
import { saintBarthLemyScaffoldProfile, saintBarthLemyScaffoldMetadata } from './bl/index.js';
import { bermudaScaffoldProfile, bermudaScaffoldMetadata } from './bm/index.js';
import { bruneiDarussalamScaffoldProfile, bruneiDarussalamScaffoldMetadata } from './bn/index.js';
import { boliviaScaffoldProfile, boliviaScaffoldMetadata } from './bo/index.js';
import { bonaireSintEustatiusAndSabaScaffoldProfile, bonaireSintEustatiusAndSabaScaffoldMetadata } from './bq/index.js';
import { bahamasScaffoldProfile, bahamasScaffoldMetadata } from './bs/index.js';
import { bhutanScaffoldProfile, bhutanScaffoldMetadata } from './bt/index.js';
import { bouvetIslandScaffoldProfile, bouvetIslandScaffoldMetadata } from './bv/index.js';
import { botswanaScaffoldProfile, botswanaScaffoldMetadata } from './bw/index.js';
import { belarusScaffoldProfile, belarusScaffoldMetadata } from './by/index.js';
import { belizeScaffoldProfile, belizeScaffoldMetadata } from './bz/index.js';
import { cocosKeelingIslandsScaffoldProfile, cocosKeelingIslandsScaffoldMetadata } from './cc/index.js';
import { congoDemocraticRepublicOfTheScaffoldProfile, congoDemocraticRepublicOfTheScaffoldMetadata } from './cd/index.js';
import { centralAfricanRepublicScaffoldProfile, centralAfricanRepublicScaffoldMetadata } from './cf/index.js';
import { congoScaffoldProfile, congoScaffoldMetadata } from './cg/index.js';
import { switzerlandScaffoldProfile, switzerlandScaffoldMetadata } from './ch/index.js';
import { cTeDIvoireScaffoldProfile, cTeDIvoireScaffoldMetadata } from './ci/index.js';
import { cookIslandsScaffoldProfile, cookIslandsScaffoldMetadata } from './ck/index.js';
import { chileScaffoldProfile, chileScaffoldMetadata } from './cl/index.js';
import { cameroonScaffoldProfile, cameroonScaffoldMetadata } from './cm/index.js';
import { chinaScaffoldProfile, chinaScaffoldMetadata } from './cn/index.js';
import { colombiaScaffoldProfile, colombiaScaffoldMetadata } from './co/index.js';
import { costaRicaScaffoldProfile, costaRicaScaffoldMetadata } from './cr/index.js';
import { cubaScaffoldProfile, cubaScaffoldMetadata } from './cu/index.js';
import { caboVerdeScaffoldProfile, caboVerdeScaffoldMetadata } from './cv/index.js';
import { curaAoScaffoldProfile, curaAoScaffoldMetadata } from './cw/index.js';
import { christmasIslandScaffoldProfile, christmasIslandScaffoldMetadata } from './cx/index.js';
import { cyprusScaffoldProfile, cyprusScaffoldMetadata } from './cy/index.js';
import { czechiaScaffoldProfile, czechiaScaffoldMetadata } from './cz/index.js';
import { djiboutiScaffoldProfile, djiboutiScaffoldMetadata } from './dj/index.js';
import { denmarkScaffoldProfile, denmarkScaffoldMetadata } from './dk/index.js';
import { dominicaScaffoldProfile, dominicaScaffoldMetadata } from './dm/index.js';
import { dominicanRepublicScaffoldProfile, dominicanRepublicScaffoldMetadata } from './do/index.js';
import { algeriaScaffoldProfile, algeriaScaffoldMetadata } from './dz/index.js';
import { ecuadorScaffoldProfile, ecuadorScaffoldMetadata } from './ec/index.js';
import { estoniaScaffoldProfile, estoniaScaffoldMetadata } from './ee/index.js';
import { egyptScaffoldProfile, egyptScaffoldMetadata } from './eg/index.js';
import { westernSaharaScaffoldProfile, westernSaharaScaffoldMetadata } from './eh/index.js';
import { eritreaScaffoldProfile, eritreaScaffoldMetadata } from './er/index.js';
import { spainScaffoldProfile, spainScaffoldMetadata } from './es/index.js';
import { ethiopiaScaffoldProfile, ethiopiaScaffoldMetadata } from './et/index.js';
import { finlandScaffoldProfile, finlandScaffoldMetadata } from './fi/index.js';
import { fijiScaffoldProfile, fijiScaffoldMetadata } from './fj/index.js';
import { falklandIslandsMalvinasScaffoldProfile, falklandIslandsMalvinasScaffoldMetadata } from './fk/index.js';
import { micronesiaFederatedStatesOfScaffoldProfile, micronesiaFederatedStatesOfScaffoldMetadata } from './fm/index.js';
import { faroeIslandsScaffoldProfile, faroeIslandsScaffoldMetadata } from './fo/index.js';
import { gabonScaffoldProfile, gabonScaffoldMetadata } from './ga/index.js';
import { grenadaScaffoldProfile, grenadaScaffoldMetadata } from './gd/index.js';
import { georgiaScaffoldProfile, georgiaScaffoldMetadata } from './ge/index.js';
import { frenchGuianaScaffoldProfile, frenchGuianaScaffoldMetadata } from './gf/index.js';
import { guernseyScaffoldProfile, guernseyScaffoldMetadata } from './gg/index.js';
import { ghanaScaffoldProfile, ghanaScaffoldMetadata } from './gh/index.js';
import { gibraltarScaffoldProfile, gibraltarScaffoldMetadata } from './gi/index.js';
import { greenlandScaffoldProfile, greenlandScaffoldMetadata } from './gl/index.js';
import { gambiaScaffoldProfile, gambiaScaffoldMetadata } from './gm/index.js';
import { guineaScaffoldProfile, guineaScaffoldMetadata } from './gn/index.js';
import { guadeloupeScaffoldProfile, guadeloupeScaffoldMetadata } from './gp/index.js';
import { equatorialGuineaScaffoldProfile, equatorialGuineaScaffoldMetadata } from './gq/index.js';
import { greeceScaffoldProfile, greeceScaffoldMetadata } from './gr/index.js';
import { southGeorgiaAndTheSouthSandwichIslandsScaffoldProfile, southGeorgiaAndTheSouthSandwichIslandsScaffoldMetadata } from './gs/index.js';
import { guatemalaScaffoldProfile, guatemalaScaffoldMetadata } from './gt/index.js';
import { guamScaffoldProfile, guamScaffoldMetadata } from './gu/index.js';
import { guineaBissauScaffoldProfile, guineaBissauScaffoldMetadata } from './gw/index.js';
import { guyanaScaffoldProfile, guyanaScaffoldMetadata } from './gy/index.js';
import { hongKongScaffoldProfile, hongKongScaffoldMetadata } from './hk/index.js';
import { heardIslandAndMcdonaldIslandsScaffoldProfile, heardIslandAndMcdonaldIslandsScaffoldMetadata } from './hm/index.js';
import { hondurasScaffoldProfile, hondurasScaffoldMetadata } from './hn/index.js';
import { croatiaScaffoldProfile, croatiaScaffoldMetadata } from './hr/index.js';
import { haitiScaffoldProfile, haitiScaffoldMetadata } from './ht/index.js';
import { hungaryScaffoldProfile, hungaryScaffoldMetadata } from './hu/index.js';
import { indonesiaScaffoldProfile, indonesiaScaffoldMetadata } from './id/index.js';
import { irelandScaffoldProfile, irelandScaffoldMetadata } from './ie/index.js';
import { israelScaffoldProfile, israelScaffoldMetadata } from './il/index.js';
import { isleOfManScaffoldProfile, isleOfManScaffoldMetadata } from './im/index.js';
import { britishIndianOceanTerritoryScaffoldProfile, britishIndianOceanTerritoryScaffoldMetadata } from './io/index.js';
import { iraqScaffoldProfile, iraqScaffoldMetadata } from './iq/index.js';
import { iranIslamicRepublicOfScaffoldProfile, iranIslamicRepublicOfScaffoldMetadata } from './ir/index.js';
import { icelandScaffoldProfile, icelandScaffoldMetadata } from './is/index.js';
import { italyScaffoldProfile, italyScaffoldMetadata } from './it/index.js';
import { jerseyScaffoldProfile, jerseyScaffoldMetadata } from './je/index.js';
import { jamaicaScaffoldProfile, jamaicaScaffoldMetadata } from './jm/index.js';
import { jordanScaffoldProfile, jordanScaffoldMetadata } from './jo/index.js';
import { kyrgyzstanScaffoldProfile, kyrgyzstanScaffoldMetadata } from './kg/index.js';
import { cambodiaScaffoldProfile, cambodiaScaffoldMetadata } from './kh/index.js';
import { kiribatiScaffoldProfile, kiribatiScaffoldMetadata } from './ki/index.js';
import { comorosScaffoldProfile, comorosScaffoldMetadata } from './km/index.js';
import { saintKittsAndNevisScaffoldProfile, saintKittsAndNevisScaffoldMetadata } from './kn/index.js';
import { koreaDemocraticPeopleSRepublicOfScaffoldProfile, koreaDemocraticPeopleSRepublicOfScaffoldMetadata } from './kp/index.js';
import { kuwaitScaffoldProfile, kuwaitScaffoldMetadata } from './kw/index.js';
import { caymanIslandsScaffoldProfile, caymanIslandsScaffoldMetadata } from './ky/index.js';
import { kazakhstanScaffoldProfile, kazakhstanScaffoldMetadata } from './kz/index.js';
import { laoPeopleSDemocraticRepublicScaffoldProfile, laoPeopleSDemocraticRepublicScaffoldMetadata } from './la/index.js';
import { lebanonScaffoldProfile, lebanonScaffoldMetadata } from './lb/index.js';
import { saintLuciaScaffoldProfile, saintLuciaScaffoldMetadata } from './lc/index.js';
import { liechtensteinScaffoldProfile, liechtensteinScaffoldMetadata } from './li/index.js';
import { sriLankaScaffoldProfile, sriLankaScaffoldMetadata } from './lk/index.js';
import { liberiaScaffoldProfile, liberiaScaffoldMetadata } from './lr/index.js';
import { lesothoScaffoldProfile, lesothoScaffoldMetadata } from './ls/index.js';
import { lithuaniaScaffoldProfile, lithuaniaScaffoldMetadata } from './lt/index.js';
import { luxembourgScaffoldProfile, luxembourgScaffoldMetadata } from './lu/index.js';
import { latviaScaffoldProfile, latviaScaffoldMetadata } from './lv/index.js';
import { libyaScaffoldProfile, libyaScaffoldMetadata } from './ly/index.js';
import { moroccoScaffoldProfile, moroccoScaffoldMetadata } from './ma/index.js';
import { monacoScaffoldProfile, monacoScaffoldMetadata } from './mc/index.js';
import { moldovaRepublicOfScaffoldProfile, moldovaRepublicOfScaffoldMetadata } from './md/index.js';
import { montenegroScaffoldProfile, montenegroScaffoldMetadata } from './me/index.js';
import { saintMartinFrenchPartScaffoldProfile, saintMartinFrenchPartScaffoldMetadata } from './mf/index.js';
import { madagascarScaffoldProfile, madagascarScaffoldMetadata } from './mg/index.js';
import { marshallIslandsScaffoldProfile, marshallIslandsScaffoldMetadata } from './mh/index.js';
import { northMacedoniaScaffoldProfile, northMacedoniaScaffoldMetadata } from './mk/index.js';
import { maliScaffoldProfile, maliScaffoldMetadata } from './ml/index.js';
import { myanmarScaffoldProfile, myanmarScaffoldMetadata } from './mm/index.js';
import { mongoliaScaffoldProfile, mongoliaScaffoldMetadata } from './mn/index.js';
import { macaoScaffoldProfile, macaoScaffoldMetadata } from './mo/index.js';
import { northernMarianaIslandsScaffoldProfile, northernMarianaIslandsScaffoldMetadata } from './mp/index.js';
import { martiniqueScaffoldProfile, martiniqueScaffoldMetadata } from './mq/index.js';
import { mauritaniaScaffoldProfile, mauritaniaScaffoldMetadata } from './mr/index.js';
import { montserratScaffoldProfile, montserratScaffoldMetadata } from './ms/index.js';
import { maltaScaffoldProfile, maltaScaffoldMetadata } from './mt/index.js';
import { mauritiusScaffoldProfile, mauritiusScaffoldMetadata } from './mu/index.js';
import { maldivesScaffoldProfile, maldivesScaffoldMetadata } from './mv/index.js';
import { malawiScaffoldProfile, malawiScaffoldMetadata } from './mw/index.js';
import { malaysiaScaffoldProfile, malaysiaScaffoldMetadata } from './my/index.js';
import { mozambiqueScaffoldProfile, mozambiqueScaffoldMetadata } from './mz/index.js';
import { namibiaScaffoldProfile, namibiaScaffoldMetadata } from './na/index.js';
import { newCaledoniaScaffoldProfile, newCaledoniaScaffoldMetadata } from './nc/index.js';
import { nigerScaffoldProfile, nigerScaffoldMetadata } from './ne/index.js';
import { norfolkIslandScaffoldProfile, norfolkIslandScaffoldMetadata } from './nf/index.js';
import { nicaraguaScaffoldProfile, nicaraguaScaffoldMetadata } from './ni/index.js';
import { netherlandsScaffoldProfile, netherlandsScaffoldMetadata } from './nl/index.js';
import { norwayScaffoldProfile, norwayScaffoldMetadata } from './no/index.js';
import { nepalScaffoldProfile, nepalScaffoldMetadata } from './np/index.js';
import { nauruScaffoldProfile, nauruScaffoldMetadata } from './nr/index.js';
import { niueScaffoldProfile, niueScaffoldMetadata } from './nu/index.js';
import { newZealandScaffoldProfile, newZealandScaffoldMetadata } from './nz/index.js';
import { omanScaffoldProfile, omanScaffoldMetadata } from './om/index.js';
import { panamaScaffoldProfile, panamaScaffoldMetadata } from './pa/index.js';
import { peruScaffoldProfile, peruScaffoldMetadata } from './pe/index.js';
import { frenchPolynesiaScaffoldProfile, frenchPolynesiaScaffoldMetadata } from './pf/index.js';
import { papuaNewGuineaScaffoldProfile, papuaNewGuineaScaffoldMetadata } from './pg/index.js';
import { philippinesScaffoldProfile, philippinesScaffoldMetadata } from './ph/index.js';
import { pakistanScaffoldProfile, pakistanScaffoldMetadata } from './pk/index.js';
import { polandScaffoldProfile, polandScaffoldMetadata } from './pl/index.js';
import { saintPierreAndMiquelonScaffoldProfile, saintPierreAndMiquelonScaffoldMetadata } from './pm/index.js';
import { pitcairnScaffoldProfile, pitcairnScaffoldMetadata } from './pn/index.js';
import { puertoRicoScaffoldProfile, puertoRicoScaffoldMetadata } from './pr/index.js';
import { palestineStateOfScaffoldProfile, palestineStateOfScaffoldMetadata } from './ps/index.js';
import { portugalScaffoldProfile, portugalScaffoldMetadata } from './pt/index.js';
import { palauScaffoldProfile, palauScaffoldMetadata } from './pw/index.js';
import { paraguayScaffoldProfile, paraguayScaffoldMetadata } from './py/index.js';
import { qatarScaffoldProfile, qatarScaffoldMetadata } from './qa/index.js';
import { rUnionScaffoldProfile, rUnionScaffoldMetadata } from './re/index.js';
import { romaniaScaffoldProfile, romaniaScaffoldMetadata } from './ro/index.js';
import { serbiaScaffoldProfile, serbiaScaffoldMetadata } from './rs/index.js';
import { russianFederationScaffoldProfile, russianFederationScaffoldMetadata } from './ru/index.js';
import { rwandaScaffoldProfile, rwandaScaffoldMetadata } from './rw/index.js';
import { saudiArabiaScaffoldProfile, saudiArabiaScaffoldMetadata } from './sa/index.js';
import { solomonIslandsScaffoldProfile, solomonIslandsScaffoldMetadata } from './sb/index.js';
import { seychellesScaffoldProfile, seychellesScaffoldMetadata } from './sc/index.js';
import { sudanScaffoldProfile, sudanScaffoldMetadata } from './sd/index.js';
import { swedenScaffoldProfile, swedenScaffoldMetadata } from './se/index.js';
import { saintHelenaAscensionAndTristanDaCunhaScaffoldProfile, saintHelenaAscensionAndTristanDaCunhaScaffoldMetadata } from './sh/index.js';
import { sloveniaScaffoldProfile, sloveniaScaffoldMetadata } from './si/index.js';
import { svalbardAndJanMayenScaffoldProfile, svalbardAndJanMayenScaffoldMetadata } from './sj/index.js';
import { slovakiaScaffoldProfile, slovakiaScaffoldMetadata } from './sk/index.js';
import { sierraLeoneScaffoldProfile, sierraLeoneScaffoldMetadata } from './sl/index.js';
import { sanMarinoScaffoldProfile, sanMarinoScaffoldMetadata } from './sm/index.js';
import { senegalScaffoldProfile, senegalScaffoldMetadata } from './sn/index.js';
import { somaliaScaffoldProfile, somaliaScaffoldMetadata } from './so/index.js';
import { surinameScaffoldProfile, surinameScaffoldMetadata } from './sr/index.js';
import { southSudanScaffoldProfile, southSudanScaffoldMetadata } from './ss/index.js';
import { saoTomeAndPrincipeScaffoldProfile, saoTomeAndPrincipeScaffoldMetadata } from './st/index.js';
import { elSalvadorScaffoldProfile, elSalvadorScaffoldMetadata } from './sv/index.js';
import { sintMaartenDutchPartScaffoldProfile, sintMaartenDutchPartScaffoldMetadata } from './sx/index.js';
import { syrianArabRepublicScaffoldProfile, syrianArabRepublicScaffoldMetadata } from './sy/index.js';
import { eswatiniScaffoldProfile, eswatiniScaffoldMetadata } from './sz/index.js';
import { turksAndCaicosIslandsScaffoldProfile, turksAndCaicosIslandsScaffoldMetadata } from './tc/index.js';
import { chadScaffoldProfile, chadScaffoldMetadata } from './td/index.js';
import { frenchSouthernTerritoriesScaffoldProfile, frenchSouthernTerritoriesScaffoldMetadata } from './tf/index.js';
import { togoScaffoldProfile, togoScaffoldMetadata } from './tg/index.js';
import { thailandScaffoldProfile, thailandScaffoldMetadata } from './th/index.js';
import { tajikistanScaffoldProfile, tajikistanScaffoldMetadata } from './tj/index.js';
import { tokelauScaffoldProfile, tokelauScaffoldMetadata } from './tk/index.js';
import { timorLesteScaffoldProfile, timorLesteScaffoldMetadata } from './tl/index.js';
import { turkmenistanScaffoldProfile, turkmenistanScaffoldMetadata } from './tm/index.js';
import { tunisiaScaffoldProfile, tunisiaScaffoldMetadata } from './tn/index.js';
import { tongaScaffoldProfile, tongaScaffoldMetadata } from './to/index.js';
import { tRkiyeScaffoldProfile, tRkiyeScaffoldMetadata } from './tr/index.js';
import { trinidadAndTobagoScaffoldProfile, trinidadAndTobagoScaffoldMetadata } from './tt/index.js';
import { tuvaluScaffoldProfile, tuvaluScaffoldMetadata } from './tv/index.js';
import { taiwanProvinceOfChinaScaffoldProfile, taiwanProvinceOfChinaScaffoldMetadata } from './tw/index.js';
import { ukraineScaffoldProfile, ukraineScaffoldMetadata } from './ua/index.js';
import { unitedStatesMinorOutlyingIslandsScaffoldProfile, unitedStatesMinorOutlyingIslandsScaffoldMetadata } from './um/index.js';
import { uruguayScaffoldProfile, uruguayScaffoldMetadata } from './uy/index.js';
import { uzbekistanScaffoldProfile, uzbekistanScaffoldMetadata } from './uz/index.js';
import { holySeeVaticanCityStateScaffoldProfile, holySeeVaticanCityStateScaffoldMetadata } from './va/index.js';
import { saintVincentAndTheGrenadinesScaffoldProfile, saintVincentAndTheGrenadinesScaffoldMetadata } from './vc/index.js';
import { venezuelaBolivarianRepublicOfScaffoldProfile, venezuelaBolivarianRepublicOfScaffoldMetadata } from './ve/index.js';
import { virginIslandsBritishScaffoldProfile, virginIslandsBritishScaffoldMetadata } from './vg/index.js';
import { virginIslandsUSScaffoldProfile, virginIslandsUSScaffoldMetadata } from './vi/index.js';
import { vietNamScaffoldProfile, vietNamScaffoldMetadata } from './vn/index.js';
import { vanuatuScaffoldProfile, vanuatuScaffoldMetadata } from './vu/index.js';
import { wallisAndFutunaScaffoldProfile, wallisAndFutunaScaffoldMetadata } from './wf/index.js';
import { samoaScaffoldProfile, samoaScaffoldMetadata } from './ws/index.js';
import { yemenScaffoldProfile, yemenScaffoldMetadata } from './ye/index.js';
import { mayotteScaffoldProfile, mayotteScaffoldMetadata } from './yt/index.js';
import { zambiaScaffoldProfile, zambiaScaffoldMetadata } from './zm/index.js';
import { zimbabweScaffoldProfile, zimbabweScaffoldMetadata } from './zw/index.js';

export const SCAFFOLD_PROFILES: Readonly<Record<string, ExtendedCountryProfile>> =
  Object.freeze({
  AD: andorraScaffoldProfile,
  AF: afghanistanScaffoldProfile,
  AG: antiguaAndBarbudaScaffoldProfile,
  AI: anguillaScaffoldProfile,
  AL: albaniaScaffoldProfile,
  AM: armeniaScaffoldProfile,
  AO: angolaScaffoldProfile,
  AQ: antarcticaScaffoldProfile,
  AR: argentinaScaffoldProfile,
  AS: americanSamoaScaffoldProfile,
  AT: austriaScaffoldProfile,
  AW: arubaScaffoldProfile,
  AX: landIslandsScaffoldProfile,
  AZ: azerbaijanScaffoldProfile,
  BA: bosniaAndHerzegovinaScaffoldProfile,
  BB: barbadosScaffoldProfile,
  BD: bangladeshScaffoldProfile,
  BE: belgiumScaffoldProfile,
  BF: burkinaFasoScaffoldProfile,
  BG: bulgariaScaffoldProfile,
  BH: bahrainScaffoldProfile,
  BI: burundiScaffoldProfile,
  BJ: beninScaffoldProfile,
  BL: saintBarthLemyScaffoldProfile,
  BM: bermudaScaffoldProfile,
  BN: bruneiDarussalamScaffoldProfile,
  BO: boliviaScaffoldProfile,
  BQ: bonaireSintEustatiusAndSabaScaffoldProfile,
  BS: bahamasScaffoldProfile,
  BT: bhutanScaffoldProfile,
  BV: bouvetIslandScaffoldProfile,
  BW: botswanaScaffoldProfile,
  BY: belarusScaffoldProfile,
  BZ: belizeScaffoldProfile,
  CC: cocosKeelingIslandsScaffoldProfile,
  CD: congoDemocraticRepublicOfTheScaffoldProfile,
  CF: centralAfricanRepublicScaffoldProfile,
  CG: congoScaffoldProfile,
  CH: switzerlandScaffoldProfile,
  CI: cTeDIvoireScaffoldProfile,
  CK: cookIslandsScaffoldProfile,
  CL: chileScaffoldProfile,
  CM: cameroonScaffoldProfile,
  CN: chinaScaffoldProfile,
  CO: colombiaScaffoldProfile,
  CR: costaRicaScaffoldProfile,
  CU: cubaScaffoldProfile,
  CV: caboVerdeScaffoldProfile,
  CW: curaAoScaffoldProfile,
  CX: christmasIslandScaffoldProfile,
  CY: cyprusScaffoldProfile,
  CZ: czechiaScaffoldProfile,
  DJ: djiboutiScaffoldProfile,
  DK: denmarkScaffoldProfile,
  DM: dominicaScaffoldProfile,
  DO: dominicanRepublicScaffoldProfile,
  DZ: algeriaScaffoldProfile,
  EC: ecuadorScaffoldProfile,
  EE: estoniaScaffoldProfile,
  EG: egyptScaffoldProfile,
  EH: westernSaharaScaffoldProfile,
  ER: eritreaScaffoldProfile,
  ES: spainScaffoldProfile,
  ET: ethiopiaScaffoldProfile,
  FI: finlandScaffoldProfile,
  FJ: fijiScaffoldProfile,
  FK: falklandIslandsMalvinasScaffoldProfile,
  FM: micronesiaFederatedStatesOfScaffoldProfile,
  FO: faroeIslandsScaffoldProfile,
  GA: gabonScaffoldProfile,
  GD: grenadaScaffoldProfile,
  GE: georgiaScaffoldProfile,
  GF: frenchGuianaScaffoldProfile,
  GG: guernseyScaffoldProfile,
  GH: ghanaScaffoldProfile,
  GI: gibraltarScaffoldProfile,
  GL: greenlandScaffoldProfile,
  GM: gambiaScaffoldProfile,
  GN: guineaScaffoldProfile,
  GP: guadeloupeScaffoldProfile,
  GQ: equatorialGuineaScaffoldProfile,
  GR: greeceScaffoldProfile,
  GS: southGeorgiaAndTheSouthSandwichIslandsScaffoldProfile,
  GT: guatemalaScaffoldProfile,
  GU: guamScaffoldProfile,
  GW: guineaBissauScaffoldProfile,
  GY: guyanaScaffoldProfile,
  HK: hongKongScaffoldProfile,
  HM: heardIslandAndMcdonaldIslandsScaffoldProfile,
  HN: hondurasScaffoldProfile,
  HR: croatiaScaffoldProfile,
  HT: haitiScaffoldProfile,
  HU: hungaryScaffoldProfile,
  ID: indonesiaScaffoldProfile,
  IE: irelandScaffoldProfile,
  IL: israelScaffoldProfile,
  IM: isleOfManScaffoldProfile,
  IO: britishIndianOceanTerritoryScaffoldProfile,
  IQ: iraqScaffoldProfile,
  IR: iranIslamicRepublicOfScaffoldProfile,
  IS: icelandScaffoldProfile,
  IT: italyScaffoldProfile,
  JE: jerseyScaffoldProfile,
  JM: jamaicaScaffoldProfile,
  JO: jordanScaffoldProfile,
  KG: kyrgyzstanScaffoldProfile,
  KH: cambodiaScaffoldProfile,
  KI: kiribatiScaffoldProfile,
  KM: comorosScaffoldProfile,
  KN: saintKittsAndNevisScaffoldProfile,
  KP: koreaDemocraticPeopleSRepublicOfScaffoldProfile,
  KW: kuwaitScaffoldProfile,
  KY: caymanIslandsScaffoldProfile,
  KZ: kazakhstanScaffoldProfile,
  LA: laoPeopleSDemocraticRepublicScaffoldProfile,
  LB: lebanonScaffoldProfile,
  LC: saintLuciaScaffoldProfile,
  LI: liechtensteinScaffoldProfile,
  LK: sriLankaScaffoldProfile,
  LR: liberiaScaffoldProfile,
  LS: lesothoScaffoldProfile,
  LT: lithuaniaScaffoldProfile,
  LU: luxembourgScaffoldProfile,
  LV: latviaScaffoldProfile,
  LY: libyaScaffoldProfile,
  MA: moroccoScaffoldProfile,
  MC: monacoScaffoldProfile,
  MD: moldovaRepublicOfScaffoldProfile,
  ME: montenegroScaffoldProfile,
  MF: saintMartinFrenchPartScaffoldProfile,
  MG: madagascarScaffoldProfile,
  MH: marshallIslandsScaffoldProfile,
  MK: northMacedoniaScaffoldProfile,
  ML: maliScaffoldProfile,
  MM: myanmarScaffoldProfile,
  MN: mongoliaScaffoldProfile,
  MO: macaoScaffoldProfile,
  MP: northernMarianaIslandsScaffoldProfile,
  MQ: martiniqueScaffoldProfile,
  MR: mauritaniaScaffoldProfile,
  MS: montserratScaffoldProfile,
  MT: maltaScaffoldProfile,
  MU: mauritiusScaffoldProfile,
  MV: maldivesScaffoldProfile,
  MW: malawiScaffoldProfile,
  MY: malaysiaScaffoldProfile,
  MZ: mozambiqueScaffoldProfile,
  NA: namibiaScaffoldProfile,
  NC: newCaledoniaScaffoldProfile,
  NE: nigerScaffoldProfile,
  NF: norfolkIslandScaffoldProfile,
  NI: nicaraguaScaffoldProfile,
  NL: netherlandsScaffoldProfile,
  NO: norwayScaffoldProfile,
  NP: nepalScaffoldProfile,
  NR: nauruScaffoldProfile,
  NU: niueScaffoldProfile,
  NZ: newZealandScaffoldProfile,
  OM: omanScaffoldProfile,
  PA: panamaScaffoldProfile,
  PE: peruScaffoldProfile,
  PF: frenchPolynesiaScaffoldProfile,
  PG: papuaNewGuineaScaffoldProfile,
  PH: philippinesScaffoldProfile,
  PK: pakistanScaffoldProfile,
  PL: polandScaffoldProfile,
  PM: saintPierreAndMiquelonScaffoldProfile,
  PN: pitcairnScaffoldProfile,
  PR: puertoRicoScaffoldProfile,
  PS: palestineStateOfScaffoldProfile,
  PT: portugalScaffoldProfile,
  PW: palauScaffoldProfile,
  PY: paraguayScaffoldProfile,
  QA: qatarScaffoldProfile,
  RE: rUnionScaffoldProfile,
  RO: romaniaScaffoldProfile,
  RS: serbiaScaffoldProfile,
  RU: russianFederationScaffoldProfile,
  RW: rwandaScaffoldProfile,
  SA: saudiArabiaScaffoldProfile,
  SB: solomonIslandsScaffoldProfile,
  SC: seychellesScaffoldProfile,
  SD: sudanScaffoldProfile,
  SE: swedenScaffoldProfile,
  SH: saintHelenaAscensionAndTristanDaCunhaScaffoldProfile,
  SI: sloveniaScaffoldProfile,
  SJ: svalbardAndJanMayenScaffoldProfile,
  SK: slovakiaScaffoldProfile,
  SL: sierraLeoneScaffoldProfile,
  SM: sanMarinoScaffoldProfile,
  SN: senegalScaffoldProfile,
  SO: somaliaScaffoldProfile,
  SR: surinameScaffoldProfile,
  SS: southSudanScaffoldProfile,
  ST: saoTomeAndPrincipeScaffoldProfile,
  SV: elSalvadorScaffoldProfile,
  SX: sintMaartenDutchPartScaffoldProfile,
  SY: syrianArabRepublicScaffoldProfile,
  SZ: eswatiniScaffoldProfile,
  TC: turksAndCaicosIslandsScaffoldProfile,
  TD: chadScaffoldProfile,
  TF: frenchSouthernTerritoriesScaffoldProfile,
  TG: togoScaffoldProfile,
  TH: thailandScaffoldProfile,
  TJ: tajikistanScaffoldProfile,
  TK: tokelauScaffoldProfile,
  TL: timorLesteScaffoldProfile,
  TM: turkmenistanScaffoldProfile,
  TN: tunisiaScaffoldProfile,
  TO: tongaScaffoldProfile,
  TR: tRkiyeScaffoldProfile,
  TT: trinidadAndTobagoScaffoldProfile,
  TV: tuvaluScaffoldProfile,
  TW: taiwanProvinceOfChinaScaffoldProfile,
  UA: ukraineScaffoldProfile,
  UM: unitedStatesMinorOutlyingIslandsScaffoldProfile,
  UY: uruguayScaffoldProfile,
  UZ: uzbekistanScaffoldProfile,
  VA: holySeeVaticanCityStateScaffoldProfile,
  VC: saintVincentAndTheGrenadinesScaffoldProfile,
  VE: venezuelaBolivarianRepublicOfScaffoldProfile,
  VG: virginIslandsBritishScaffoldProfile,
  VI: virginIslandsUSScaffoldProfile,
  VN: vietNamScaffoldProfile,
  VU: vanuatuScaffoldProfile,
  WF: wallisAndFutunaScaffoldProfile,
  WS: samoaScaffoldProfile,
  YE: yemenScaffoldProfile,
  YT: mayotteScaffoldProfile,
  ZM: zambiaScaffoldProfile,
  ZW: zimbabweScaffoldProfile,
  });

export interface ScaffoldMetadata {
  readonly status: 'scaffold';
  readonly generatedAt: string;
  readonly promotionGuide: string;
}

export const SCAFFOLD_METADATA: Readonly<Record<string, ScaffoldMetadata>> =
  Object.freeze({
  AD: andorraScaffoldMetadata,
  AF: afghanistanScaffoldMetadata,
  AG: antiguaAndBarbudaScaffoldMetadata,
  AI: anguillaScaffoldMetadata,
  AL: albaniaScaffoldMetadata,
  AM: armeniaScaffoldMetadata,
  AO: angolaScaffoldMetadata,
  AQ: antarcticaScaffoldMetadata,
  AR: argentinaScaffoldMetadata,
  AS: americanSamoaScaffoldMetadata,
  AT: austriaScaffoldMetadata,
  AW: arubaScaffoldMetadata,
  AX: landIslandsScaffoldMetadata,
  AZ: azerbaijanScaffoldMetadata,
  BA: bosniaAndHerzegovinaScaffoldMetadata,
  BB: barbadosScaffoldMetadata,
  BD: bangladeshScaffoldMetadata,
  BE: belgiumScaffoldMetadata,
  BF: burkinaFasoScaffoldMetadata,
  BG: bulgariaScaffoldMetadata,
  BH: bahrainScaffoldMetadata,
  BI: burundiScaffoldMetadata,
  BJ: beninScaffoldMetadata,
  BL: saintBarthLemyScaffoldMetadata,
  BM: bermudaScaffoldMetadata,
  BN: bruneiDarussalamScaffoldMetadata,
  BO: boliviaScaffoldMetadata,
  BQ: bonaireSintEustatiusAndSabaScaffoldMetadata,
  BS: bahamasScaffoldMetadata,
  BT: bhutanScaffoldMetadata,
  BV: bouvetIslandScaffoldMetadata,
  BW: botswanaScaffoldMetadata,
  BY: belarusScaffoldMetadata,
  BZ: belizeScaffoldMetadata,
  CC: cocosKeelingIslandsScaffoldMetadata,
  CD: congoDemocraticRepublicOfTheScaffoldMetadata,
  CF: centralAfricanRepublicScaffoldMetadata,
  CG: congoScaffoldMetadata,
  CH: switzerlandScaffoldMetadata,
  CI: cTeDIvoireScaffoldMetadata,
  CK: cookIslandsScaffoldMetadata,
  CL: chileScaffoldMetadata,
  CM: cameroonScaffoldMetadata,
  CN: chinaScaffoldMetadata,
  CO: colombiaScaffoldMetadata,
  CR: costaRicaScaffoldMetadata,
  CU: cubaScaffoldMetadata,
  CV: caboVerdeScaffoldMetadata,
  CW: curaAoScaffoldMetadata,
  CX: christmasIslandScaffoldMetadata,
  CY: cyprusScaffoldMetadata,
  CZ: czechiaScaffoldMetadata,
  DJ: djiboutiScaffoldMetadata,
  DK: denmarkScaffoldMetadata,
  DM: dominicaScaffoldMetadata,
  DO: dominicanRepublicScaffoldMetadata,
  DZ: algeriaScaffoldMetadata,
  EC: ecuadorScaffoldMetadata,
  EE: estoniaScaffoldMetadata,
  EG: egyptScaffoldMetadata,
  EH: westernSaharaScaffoldMetadata,
  ER: eritreaScaffoldMetadata,
  ES: spainScaffoldMetadata,
  ET: ethiopiaScaffoldMetadata,
  FI: finlandScaffoldMetadata,
  FJ: fijiScaffoldMetadata,
  FK: falklandIslandsMalvinasScaffoldMetadata,
  FM: micronesiaFederatedStatesOfScaffoldMetadata,
  FO: faroeIslandsScaffoldMetadata,
  GA: gabonScaffoldMetadata,
  GD: grenadaScaffoldMetadata,
  GE: georgiaScaffoldMetadata,
  GF: frenchGuianaScaffoldMetadata,
  GG: guernseyScaffoldMetadata,
  GH: ghanaScaffoldMetadata,
  GI: gibraltarScaffoldMetadata,
  GL: greenlandScaffoldMetadata,
  GM: gambiaScaffoldMetadata,
  GN: guineaScaffoldMetadata,
  GP: guadeloupeScaffoldMetadata,
  GQ: equatorialGuineaScaffoldMetadata,
  GR: greeceScaffoldMetadata,
  GS: southGeorgiaAndTheSouthSandwichIslandsScaffoldMetadata,
  GT: guatemalaScaffoldMetadata,
  GU: guamScaffoldMetadata,
  GW: guineaBissauScaffoldMetadata,
  GY: guyanaScaffoldMetadata,
  HK: hongKongScaffoldMetadata,
  HM: heardIslandAndMcdonaldIslandsScaffoldMetadata,
  HN: hondurasScaffoldMetadata,
  HR: croatiaScaffoldMetadata,
  HT: haitiScaffoldMetadata,
  HU: hungaryScaffoldMetadata,
  ID: indonesiaScaffoldMetadata,
  IE: irelandScaffoldMetadata,
  IL: israelScaffoldMetadata,
  IM: isleOfManScaffoldMetadata,
  IO: britishIndianOceanTerritoryScaffoldMetadata,
  IQ: iraqScaffoldMetadata,
  IR: iranIslamicRepublicOfScaffoldMetadata,
  IS: icelandScaffoldMetadata,
  IT: italyScaffoldMetadata,
  JE: jerseyScaffoldMetadata,
  JM: jamaicaScaffoldMetadata,
  JO: jordanScaffoldMetadata,
  KG: kyrgyzstanScaffoldMetadata,
  KH: cambodiaScaffoldMetadata,
  KI: kiribatiScaffoldMetadata,
  KM: comorosScaffoldMetadata,
  KN: saintKittsAndNevisScaffoldMetadata,
  KP: koreaDemocraticPeopleSRepublicOfScaffoldMetadata,
  KW: kuwaitScaffoldMetadata,
  KY: caymanIslandsScaffoldMetadata,
  KZ: kazakhstanScaffoldMetadata,
  LA: laoPeopleSDemocraticRepublicScaffoldMetadata,
  LB: lebanonScaffoldMetadata,
  LC: saintLuciaScaffoldMetadata,
  LI: liechtensteinScaffoldMetadata,
  LK: sriLankaScaffoldMetadata,
  LR: liberiaScaffoldMetadata,
  LS: lesothoScaffoldMetadata,
  LT: lithuaniaScaffoldMetadata,
  LU: luxembourgScaffoldMetadata,
  LV: latviaScaffoldMetadata,
  LY: libyaScaffoldMetadata,
  MA: moroccoScaffoldMetadata,
  MC: monacoScaffoldMetadata,
  MD: moldovaRepublicOfScaffoldMetadata,
  ME: montenegroScaffoldMetadata,
  MF: saintMartinFrenchPartScaffoldMetadata,
  MG: madagascarScaffoldMetadata,
  MH: marshallIslandsScaffoldMetadata,
  MK: northMacedoniaScaffoldMetadata,
  ML: maliScaffoldMetadata,
  MM: myanmarScaffoldMetadata,
  MN: mongoliaScaffoldMetadata,
  MO: macaoScaffoldMetadata,
  MP: northernMarianaIslandsScaffoldMetadata,
  MQ: martiniqueScaffoldMetadata,
  MR: mauritaniaScaffoldMetadata,
  MS: montserratScaffoldMetadata,
  MT: maltaScaffoldMetadata,
  MU: mauritiusScaffoldMetadata,
  MV: maldivesScaffoldMetadata,
  MW: malawiScaffoldMetadata,
  MY: malaysiaScaffoldMetadata,
  MZ: mozambiqueScaffoldMetadata,
  NA: namibiaScaffoldMetadata,
  NC: newCaledoniaScaffoldMetadata,
  NE: nigerScaffoldMetadata,
  NF: norfolkIslandScaffoldMetadata,
  NI: nicaraguaScaffoldMetadata,
  NL: netherlandsScaffoldMetadata,
  NO: norwayScaffoldMetadata,
  NP: nepalScaffoldMetadata,
  NR: nauruScaffoldMetadata,
  NU: niueScaffoldMetadata,
  NZ: newZealandScaffoldMetadata,
  OM: omanScaffoldMetadata,
  PA: panamaScaffoldMetadata,
  PE: peruScaffoldMetadata,
  PF: frenchPolynesiaScaffoldMetadata,
  PG: papuaNewGuineaScaffoldMetadata,
  PH: philippinesScaffoldMetadata,
  PK: pakistanScaffoldMetadata,
  PL: polandScaffoldMetadata,
  PM: saintPierreAndMiquelonScaffoldMetadata,
  PN: pitcairnScaffoldMetadata,
  PR: puertoRicoScaffoldMetadata,
  PS: palestineStateOfScaffoldMetadata,
  PT: portugalScaffoldMetadata,
  PW: palauScaffoldMetadata,
  PY: paraguayScaffoldMetadata,
  QA: qatarScaffoldMetadata,
  RE: rUnionScaffoldMetadata,
  RO: romaniaScaffoldMetadata,
  RS: serbiaScaffoldMetadata,
  RU: russianFederationScaffoldMetadata,
  RW: rwandaScaffoldMetadata,
  SA: saudiArabiaScaffoldMetadata,
  SB: solomonIslandsScaffoldMetadata,
  SC: seychellesScaffoldMetadata,
  SD: sudanScaffoldMetadata,
  SE: swedenScaffoldMetadata,
  SH: saintHelenaAscensionAndTristanDaCunhaScaffoldMetadata,
  SI: sloveniaScaffoldMetadata,
  SJ: svalbardAndJanMayenScaffoldMetadata,
  SK: slovakiaScaffoldMetadata,
  SL: sierraLeoneScaffoldMetadata,
  SM: sanMarinoScaffoldMetadata,
  SN: senegalScaffoldMetadata,
  SO: somaliaScaffoldMetadata,
  SR: surinameScaffoldMetadata,
  SS: southSudanScaffoldMetadata,
  ST: saoTomeAndPrincipeScaffoldMetadata,
  SV: elSalvadorScaffoldMetadata,
  SX: sintMaartenDutchPartScaffoldMetadata,
  SY: syrianArabRepublicScaffoldMetadata,
  SZ: eswatiniScaffoldMetadata,
  TC: turksAndCaicosIslandsScaffoldMetadata,
  TD: chadScaffoldMetadata,
  TF: frenchSouthernTerritoriesScaffoldMetadata,
  TG: togoScaffoldMetadata,
  TH: thailandScaffoldMetadata,
  TJ: tajikistanScaffoldMetadata,
  TK: tokelauScaffoldMetadata,
  TL: timorLesteScaffoldMetadata,
  TM: turkmenistanScaffoldMetadata,
  TN: tunisiaScaffoldMetadata,
  TO: tongaScaffoldMetadata,
  TR: tRkiyeScaffoldMetadata,
  TT: trinidadAndTobagoScaffoldMetadata,
  TV: tuvaluScaffoldMetadata,
  TW: taiwanProvinceOfChinaScaffoldMetadata,
  UA: ukraineScaffoldMetadata,
  UM: unitedStatesMinorOutlyingIslandsScaffoldMetadata,
  UY: uruguayScaffoldMetadata,
  UZ: uzbekistanScaffoldMetadata,
  VA: holySeeVaticanCityStateScaffoldMetadata,
  VC: saintVincentAndTheGrenadinesScaffoldMetadata,
  VE: venezuelaBolivarianRepublicOfScaffoldMetadata,
  VG: virginIslandsBritishScaffoldMetadata,
  VI: virginIslandsUSScaffoldMetadata,
  VN: vietNamScaffoldMetadata,
  VU: vanuatuScaffoldMetadata,
  WF: wallisAndFutunaScaffoldMetadata,
  WS: samoaScaffoldMetadata,
  YE: yemenScaffoldMetadata,
  YT: mayotteScaffoldMetadata,
  ZM: zambiaScaffoldMetadata,
  ZW: zimbabweScaffoldMetadata,
  });

/** ISO-3166 alpha-2 codes this generator currently scaffolds. */
export const SCAFFOLD_COUNTRY_CODES: readonly string[] = Object.freeze(
  Object.keys(SCAFFOLD_PROFILES)
);
