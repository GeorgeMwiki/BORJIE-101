# USER PRIMARY SOURCE 03 — Session directives & meta-instructions

> Captured verbatim from the founder on **2026-05-17**. These are the meta-level instructions about *how* Boji should be built, not what features it should contain. The engineering and AI teams must keep these in view whenever a decision touches architecture, intelligence cadence, or surface design.
>
> **Status: primary source. Do not edit.**

---

## Directive 01 — Project framing (turn 1)

> "Okay, so we are looking to expand into this idea deeply, okay? And the way we want to expand it is, one, we want to make it a little bit more detailed, does not talk about fleet. Like, I'm doing a mining business, I'm gonna deal with a fleet of all different kinds at some point, you know, how do I get strategic advice on that and coordination alongside the entire business operation? So we're not detailed enough, so we need to do very, very deep research online on how we can literally expand this idea and make everything that is mentioned there more detailed, okay? Give a concrete, very detailed analysis here, okay? Very, very detailed analysis on how we can expand this logic.
>
> For example, the whole idea here is the same to what we have on Bossnyumba, okay? We have this almost central intelligent manager that spoils juniors or has junior logic, spawns juniors who are experts in certain fields which go to the workers and they assist them and they teach them and they bring back information to the main, the main synthesizes. So we are literally using the same Bosnyumba logic here of juniors and full intelligence, and this is how you have to, like you have to do deep research. You don't want to have limitations, okay? What AI limitations, deep research, because we understand that the business of mining is highly affected by things like documentation, literally, every, the user needs to be in control of all actions, but every action, every interaction, every decision has penalties and possible costs in this business. For example, just a miss in exchange rates because only, you are not allowed to receive money in dollar, but you're getting in dollar. A miss in exchange rates in planning and when the exchange rates go down, you will lose money, okay? Or you will remain with the product for months until the exchange rates go back up to the favourable positions. The same when you're buying and when you're selling, the same for materials, the same for what. So you need to be intelligent and understand, oh, if we're dealing in USD, but we can only receive in Tanzanian shillings, you have to be strategic about that too. So the AI is intelligent. It can go search online. It can learn and understand things, just deep intelligence, just like Litfin and Bosnumba. It, like, essentially, it can do unit economics. It can follow up unit economics. It can, you know, it can understand all these complex, deep logic and workings, okay? The goal is very intelligent, strategic advisory, and execution. Like, it can literally advise you and it can execute and it can, like, just like Bosnumba or Bosnumba can do, okay? It can handle the entire business end-to-end on its own. It can structure it from scratch if you had no structure to give it. It can, like, literally, that is the level of intelligence we are building. We're building a brain that outputs a very superb mind when it comes to mining, okay? So deep research on that. How do we handle all of this? How are we, like, what is the most strategical approach that we can, we can look here to make ourselves set of the art best in the world mining intelligence in the world? What are some of the articles, some of deep researches, peer-reviewed or non-peer-reviewed that talks about mining and the strategies and ways we can be better? Like, every time we need to go search online, look at our memory, look at, like, we can only output the best results only, but only tell it to what? Do this it. So who's been here? The precision, full speed, we need to cover everything all at once. We need to cover everything all at once, and we need to do very deep research on all agents. Output here a very deep analysis, okay? Output here a very deep analysis of this idea, end-to-end business, and output it here."

### Directive 01 — extracted requirements

* **Build the BossNyumba pattern, faithfully.** Master AI + Junior expert agents that go to workers, teach them, bring data back, master synthesises.
* **Fleet strategy is a first-class concern from day one,** even if a current user starts with one machine. The owner intends to grow.
* **No AI limitations on research.** Boji's brain must keep searching, learning, expanding online.
* **Penalty-aware reasoning.** Every action has documentation, FX, regulatory, and time-of-decision cost — Boji must surface this proactively.
* **FX strategy is operational.** USD-priced minerals + TZS-only domestic receipts = the AI must reason about timing of sale and stockpile as a currency decision.
* **Unit economics is core.** Like Litfin / BossNyumba, Boji must compute and follow up unit economics constantly.
* **End-to-end execution, not just advisory.** The product should be able to *run* a mining business from scratch if asked.
* **State of the art in the world.** Benchmark must be the global best.
* **Precision + full speed + cover everything at once.** Parallel multi-agent deep research is the default working mode.

---

## Directive 02 — Spec output expectations (turn 1, second half)

> "Okay? Look at the BossNyumba logic, think how we can tailor this idea into a BossNyumba but for mining intelligence after, and then output that analysis, okay? And then, you will find a project folder that is called Boji, okay? On the same lines, on the same desktop folder as BossNyumba, okay? You'll find a documents folder or project folder called Boji AI, okay? Boji AI. Boji AI. B-O-J-I. Boji AI. You should create a very, very detailed spec and output it there, okay? Create a very, very detailed spec and output it there on that folder of Boji Ai. Also in mining, we have other information about mining strategies and processes, and we want to also do deep research, like literally do deep research in everything that has been mentioned here. We need you to be the best in the art intelligence. Not only should eBojiAI be the best world-class state-of-the-art intelligence when it comes to mining for all businesses, small or large, it should also be the most intelligent mining platform ever. It can do research online, and it can also think on its own, and it can output values like the best mining intelligence in the world. I will add a snippet here of further research that we have done. Right now, we're not dealing, like, we will put the integrations ready, but we'll not be integrating with any government software. So a lot of these processes will not be end-to-end, but you'll have to be able to explain to a person who's looking to do this process end-to-end, okay? So we'll not be dealing with governments and other things that we have not integrated, but at the same time, the entire process flow remains the same. The only thing is some things will have to be manual, okay? So, but we need us to be the best intelligence in that. I will add two more documents to you here. Again, best in the world in intelligence on mining. I will add two more documents. Read those documents, look at everything that I've said here. Do deep research, multiple agents, deep, deep, deep, deep research. Output very detailed analysis, okay? We're looking for a boss nyumba, but for mining, looking at what we have outputted here. So we are telling all of that boss nyumba's good, interesting logic into mining logic, okay? Into mining logic. Like, same powerful intelligence, but now it's no longer focusing on real estate or for lead in case. It's no longer focusing on credit. It's now focusing on what? Mining."

### Directive 02 — extracted requirements

* **Spec lives in the Boji AI project folder** on the same desktop as BossNyumba (resolved: `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs/`).
* **No government-software integration in MVP.** Boji explains every government step to the owner; the platform never depends on a regulator API to function. But the integration points must be designed so they can be plugged in later.
* **Process flow is end-to-end even when execution is manual.** Owner sees the same workflow whether Boji files it electronically or just generates the pack for the owner to walk to the office.
* **Best in the world.** Not regional, not "Africa-ready" — globally best.

---

## Directive 03 — App surface architecture (turn 4)

> "Okay, so for this, we only have the owner, okay, or admin, and we have the workers, okay? We have the owners or admin and the workers. We don't really deal with the customers here. For Boji, we don't deal with the customers, okay? For a state manager, we do. So we only have one more app, essentially, which is for the workers. We don't really have any other apps, okay, other than the one app that we have. Like we have two app structures. We have two mobile apps. We have one mobile app for the worker, one for the admin or owner, and then we have the web app for the owner, and then we have the internal platform that is for ourselves, okay? We have the internal platform. So we have two web apps, one for the owner, one for the for the for the one, two web apps, one for the owner, one for our own internal Boji uh internal Boji management, okay, for for the Boji project or for the Boji platform. And then we have the two mobile apps, one is for the workers, okay, and another one is for the owners so that they can have flexibility and insights and whatever, okay? So we need very deep insights. We need very interesting forecasting logic. We need, like, yeah, I guess you understand where I'm going with this. Keep building from what you are building right now, but we need, like, like we need to think about this intelligently, okay? So it's not like we are hard-coded on, well, it's like we're always learning. We're always updating ourselves. We're always getting better. Like, we are a brain. Do you understand where I'm going with this?"

### Directive 03 — extracted requirements

* **No customer / tenant surface.** This is the single biggest deviation from the BossNyumba persona model.
* **Exactly four surfaces:**
  1. **Owner / Admin mobile app** — flexibility, insights, decision capture in the field.
  2. **Worker mobile app** — the supervisor / driver / officer / stores-keeper / geologist field-data-capture surface.
  3. **Owner / Admin web app** — the strategic cockpit, document chat, board/investor reports.
  4. **Boji internal-platform web app** — Boji team's own management surface for the whole multi-tenant platform.
* **No hard-coded behaviour.** Always learning, always updating, always getting better — the brain pattern.
* **Deep insights, deep forecasting** is a non-negotiable user-facing promise.

---

## Directive 04 — Preserve every byte of local intelligence (turn 4)

> "I GAVE YOU SO MUCH LOCAL INFO DONT WASTE ANY OF IT IN BUILDING THIS DETAILDE SPEC FOR THIS PROJECT, SAVE ALL ANALYS4S, RESEARCH, DOCS LINKS TO GAIN ITEWLLINGCE ETC IN THE BOJI PROJECT WE WILL NEED IT FOR INTELLIGENCE LOGIC"

### Directive 04 — extracted requirements

* **Persist every research artefact** (the six dossiers, the user's own briefs, every URL citation, every framework) inside the Boji project folder — not in chat history alone.
* **These artefacts are the intelligence corpus Boji ships with on day one.** The Document Agent ingests them at install time, the Compliance Agent reads from them every time it cites a rule, the Geology Agent uses them as priors for confidence scoring.
* **Treat the `Docs/` folder as Boji's bootstrap brain.** Anything we write here will be retrievable, citable, and continuously learnable.

---

## How Boji's runtime uses these primary sources

Implementation guidance for the engineering team:

1. At first-boot of a tenant, the **Document Agent** ingests this `primary_sources/` directory and the `research/` directory into the tenant's vector store with provenance tags (`source: founder | research_brief | mining_act | nemc_guideline | etc.`). Tags are immutable.
2. Every junior agent's tool surface includes a `lookup_intelligence_corpus(query, agent_role)` that does RAG over the corpus, returning passages with provenance.
3. When the Master Brain produces a recommendation that cites a regulation, an FX rule, or a strategic principle, it **must** name the source (e.g., "per *Mining (Local Content) Regulations 2018* as amended by GN 563/2025") and provide the supporting passage. The Auditor Agent rejects recommendations without provenance.
4. Updates to regulations or research enter the corpus through a versioned ingestion job; the weekly prompt-compile loop tests every change against the golden set before promoting it.
5. The Boji internal-platform web app exposes the corpus to the Boji team for editing, supersession, and audit.

This file pattern is itself the answer to Directive 04.
