/**
 * Mining-TZ glossary (Wave VP-1).
 *
 * Bilingual EN + SW glossary used by:
 *   - language-pack stop-word + register lists
 *   - translation pipeline domain bias
 *   - document-AI extraction prompts
 *   - LMBM domain-conditioning context
 *
 * @module @borjie/vertical-profile-mining-tz/glossary
 */

import type { GlossaryEntry } from '@borjie/vertical-profiles';

function term(
  term: string,
  en: string,
  sw: string,
  definition: string,
): GlossaryEntry {
  return Object.freeze({
    term,
    translations: Object.freeze({ en, sw }),
    definition,
  });
}

export const MINING_TZ_GLOSSARY: ReadonlyArray<GlossaryEntry> = Object.freeze([
  term('gold', 'gold', 'dhahabu', 'Precious metal, Au; primary export commodity of TZ mining sector.'),
  term('silver', 'silver', 'fedha', 'Precious metal, Ag.'),
  term('copper', 'copper', 'shaba', 'Base metal, Cu.'),
  term('tantalite', 'tantalite', 'tantaliti', 'Tantalum-rich mineral; coltan ore.'),
  term('gemstone', 'gemstone', 'jiwe la thamani', 'Cut stone of commercial value (tanzanite, ruby, emerald, etc.).'),
  term('tanzanite', 'tanzanite', 'tanzanite', 'Blue-violet zoisite gemstone unique to Mererani Hills, TZ.'),
  term('kimberlite', 'kimberlite', 'kimbalaiti', 'Volcanic rock that hosts diamonds.'),
  term('stockpile', 'stockpile', 'lundo la madini', 'Surface inventory of mined material awaiting processing.'),
  term('bench', 'bench', 'ngazi ya mgodi', 'Horizontal step in an open-pit excavation.'),
  term('drift', 'drift', 'mtaro wa chini', 'Horizontal underground tunnel.'),
  term('shaft', 'shaft', 'mtemo wima', 'Vertical underground access tunnel.'),
  term('headframe', 'headframe', 'mnara wa kichwa', 'Above-shaft hoist structure.'),
  term('royalty', 'royalty', 'mrabaha', 'Percentage of production value owed to the State per Mining Act 2010 §86.'),
  term('grade', 'grade', 'daraja', 'Concentration of valuable mineral in ore (e.g. grams per tonne for gold).'),
  term('assay', 'assay', 'uchunguzi wa madini', 'Laboratory determination of mineral content in a sample.'),
  term('pml', 'Primary Mining Licence', 'Leseni ya Madini ya Msingi', 'Small-scale mining licence under Mining Act §8; renewable.'),
  term('pl', 'Prospecting Licence', 'Leseni ya Utafiti wa Madini', 'Exploration licence permitting search but not extraction.'),
  term('sml', 'Special Mining Licence', 'Leseni Maalumu ya Uchimbaji', 'Large-scale mining licence for projects above USD 100M.'),
  term('ml', 'Mining Licence', 'Leseni ya Uchimbaji', 'Standard mining licence for medium-scale operations.'),
  term('smrl', 'Special Mineral Right Licence', 'Leseni Maalumu ya Haki za Madini', 'Special right granted by the Minister for strategic minerals.'),
  term('eia', 'Environmental Impact Assessment', 'Tathmini ya Athari za Kimazingira', 'NEMC-issued environmental clearance per EMA 2004.'),
  term('rca', 'Resolution of Approval', 'Kibali cha Kufanya Kazi', 'NEMC approval certificate following EIA review.'),
  term('blasting', 'blasting', 'ulipuaji', 'Use of explosives for ore extraction; requires standalone permit.'),
  term('ore', 'ore', 'mwamba wenye madini', 'Rock containing economically extractable mineral.'),
  term('tailings', 'tailings', 'taka za uchakataji', 'Waste material remaining after ore beneficiation.'),
  term('mill', 'mill', 'kinu cha kusaga', 'Comminution facility that reduces ore particle size.'),
  term('leach', 'leach', 'kuyeyusha', 'Chemical extraction of metal from crushed ore (typically cyanide for gold).'),
  term('smelter', 'smelter', 'mtambo wa kuyeyusha', 'High-temperature furnace producing metal from concentrate.'),
  term('refinery', 'refinery', 'kiwanda cha kusafisha', 'Facility producing pure metal from rough dore.'),
  term('dore', 'dore bar', 'fito la dhahabu ghafi', 'Semi-pure gold alloy poured at a mine site.'),
  term('bullion', 'bullion', 'metali safi', 'Refined precious-metal bar of standardised purity (e.g. 9999 gold).'),
  term('mineworker', 'mineworker', 'mfanyakazi wa mgodi', 'Workforce member assigned to a mine site.'),
  term('shift', 'shift', 'zamu', 'Work period (day / night / continuous).'),
  term('overman', 'overman', 'msimamizi wa mgodi', 'Underground shift supervisor.'),
  term('msme', 'small-scale miner', 'mchimbaji mdogo', 'Artisanal or small-scale operator holding a PML.'),
  term('tra', 'Tanzania Revenue Authority', 'Mamlaka ya Mapato Tanzania', 'TZ national tax collector; oversees VAT, CIT, PAYE, royalty collection routing.'),
  term('tumemadini', 'Mining Commission', 'Tume ya Madini', 'TZ mining-sector regulator; oversees licensing, royalty, production statistics per Mining Act 2010.'),
  term('nemc', 'National Environment Management Council', 'Baraza la Kitaifa la Hifadhi na Usimamizi wa Mazingira', 'TZ environmental regulator under EMA 2004.'),
  term('bot', 'Bank of Tanzania', 'Benki Kuu ya Tanzania', 'TZ central bank; oversees FX reporting and the gold-window directive.'),
  term('osha-tz', 'OSHA Tanzania', 'Wakala wa Usalama na Afya Mahali pa Kazi', 'TZ workplace safety authority.'),
  term('gepg', 'Government e-Payment Gateway', 'Lango la Malipo la Serikali', 'TZ unified payment gateway for government revenue.'),
]);
