# Project boundary

**This repository is BORJIE only.**

- **BORJIE** = this repo. Mining estate planning, management, and intelligence
  operating system for Tanzanian (and pan-African) artisanal-to-mid-tier
  mining. Hard-fork of BossNyumba's brain layer wrapped around a mining
  domain (sites, licences, drill-holes, ore parcels, FX/treasury, TZ
  regulatory rules).
- **BossNyumba** = the **parent project** at
  `/Cursor Projects/BOSSNYUMBA101/`. Property management SaaS — different
  codebase, different product, different repo. Reference-only (read).
- **Pongezi** / **LITFIN** = unrelated sibling projects. Different repos,
  different products. Not in this repo.

Do **not**:
- Refer to BossNyumba property entities (buildings, units, leases, occupancy,
  arrears, tenants-as-renters) in Borjie code, docs, or config.
- Copy code or docs from BossNyumba into Borjie unless it is generic AI-OS
  infrastructure that survives the property-domain trim (per
  `$BORJIE_MINING_CORPUS_PATH/build/BOJI_BUILD_PLAN.md` Phase 1).
- Conflate Borjie's "tenant" (multi-tenant SaaS organisation =
  mining company group) with BossNyumba's "tenant" (renting occupant).
- Refer to Pongezi or LITFIN in Borjie code, docs, or config.

All work in this repo applies to Borjie only.
