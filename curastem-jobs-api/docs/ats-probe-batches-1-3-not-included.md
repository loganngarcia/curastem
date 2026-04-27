# Job sources we did not add (probe lists, batches 1–3)

We ran three rounds of checks against public “jobs board” APIs (the same hiring tools our ingest already supports). This note lists **only real gaps or judgement calls**. If a company’s board was **already in our source list** and working, it is **not** listed here.

**How to read this**

| Situation | What it means |
|-----------|----------------|
| **No API match** | We could not find a public feed for that company using the tools we check. They may use Workday, a careers page only, or something else we do not ingest yet. |
| **Found a board, did not add** | The script returned a board, but we chose not to add it (wrong company, too vague, or we skipped it on purpose). |

Batch 4 (nonprofit and civic orgs) is **not** in this file.

For long “no match” lists, the **reason is the same for every name** and is written once under the heading.

**Source data:** the three JSON outputs under `scripts/` (`ats-probe-output.json`, `ats-probe-batch2-output.json`, `ats-probe-batch3-output.json`). Approved sources are listed in the seed file `src/shared/db/migrate.ts`.

---

## Batch 1 — AI lab list (233 companies)

### No API match (94)

**Reason:** None of the supported public job feeds returned listings for this name. We do not cover Workday or plain “careers page only” sites in this check.

| Organization |
|---|
| .txt |
| /dev/agents |
| 11x |
| AUI |
| Adaline |
| Adept AI |
| Adopt AI |
| AgentSmyth |
| Altan |
| Alterego |
| Anaconda |
| Archetype |
| Artificial Intelligence Underwriting Company |
| Artificial Societies |
| Augment Code |
| Brightwave |
| Browser Use |
| Ceramic |
| CoPlane |
| Cogent |
| Cove |
| Decart |
| Dedalus Labs |
| Doubleword |
| Fastino |
| Fireflies |
| Fixie |
| Flank |
| Flapping Airplanes |
| Floqer |
| Good Start Labs |
| Gradium |
| Humans& |
| Inception |
| Instill AI |
| Interhuman |
| Internet Backyard |
| Keycard |
| LGND |
| LLMArena |
| Lemni |
| Liminal |
| Liminary |
| Loti |
| Luma AI |
| Magic |
| Mail0 |
| Medra |
| Model ML |
| Modular |
| Moonvalley |
| Music AI |
| Nace AI |
| Nexad |
| Nuraline |
| Osmosis |
| Parahelp |
| Particle |
| Phota Labs |
| Pienso |
| Please |
| Podqi |
| Radical AI |
| Reflection |
| Replicate |
| Reworkd |
| Ricursive Intelligence |
| Runware |
| Sanas |
| Sonatic |
| Sonder |
| StackAI |
| Subtle Computing |
| Subtrate |
| Supersonik |
| Tensormesh |
| Tera AI |
| Tessl |
| Tezi |
| The General Intelligence Company |
| The Interaction Company of California |
| The Sentience Company |
| TinyFish |
| Town |
| Trigger.dev |
| Unconventional AI |
| V7 |
| Vulcan Technologies |
| Wayfaster |
| Wordware |
| Wrtn |
| You |
| ai.work |
| alphaXiv |

### API match found, but we did not add a source row (14)

These are cases where the script found *a* board, but we did not add it to our source list when we merged batch 1 (wrong brand, too vague, or left out on purpose).

| Company | Why we skipped it |
|---------|-------------------|
| Ada | Personio board might not be the Ada you mean; not added. |
| AMI Labs | Ashby board found; not added when batch 1 was merged (unclear match or oversight). |
| Beside | Ashby board found; not added when batch 1 was merged. |
| Cake AI | Greenhouse board found; not added when batch 1 was merged. |
| General Intuition | The board we got was tied to a very generic name (“general”) and is almost certainly the wrong company. |
| New Generation | Same problem with a generic board name (“new”); not reliable. |
| OpenHands | Ashby board found; not added when batch 1 was merged. |
| Paradigm | Board name “paradigm” matches many different companies; too ambiguous. |
| Peec AI | Personio feed found; not added when batch 1 was merged. |
| Sesame AI | Lever board “sesame” could be a different Sesame; not added. |
| Slingshot AI | Ashby board found; not added when batch 1 was merged. |
| Surge | Recruitee board found; not added when batch 1 was merged. |
| TensorZero | Ashby board found; not added when batch 1 was merged. |
| Veris AI | Recruitee board found; not added when batch 1 was merged. |

*(Exact URLs are in `scripts/ats-probe-output.json` if you need them.)*

---

## Batch 2 — design, robotics, retail, health list (184 companies)

### No API match (91)

**Reason:** Same as batch 1. No supported public feed turned up for this name.

| Organization |
|---|
| 222 |
| Alta |
| Amie |
| Aniva |
| Apothékary |
| Arcol |
| Arya Health |
| Astrus |
| Atoms |
| Birches Health |
| Born |
| BuildForever |
| Cartwheel |
| Chronicle |
| Claim (Acquired by GrubHub) |
| ClarityCare |
| Clone |
| Common Knowledge |
| Contra |
| Debut |
| Dupe |
| Ease |
| Eraser |
| Fabric |
| Felt |
| Female Invest |
| Flexion Robotics |
| Function Health |
| Hanomi |
| Headlight |
| Heidi Health |
| Hera |
| Hippocratic AI |
| Humanoid |
| InHouse |
| Italic |
| Kaedim |
| Keychain |
| Kive |
| Lightpage |
| MavenPosh |
| Medallion |
| Miro |
| MoldCo |
| Motif |
| Neko |
| Optura |
| Orchid |
| Orchids |
| Orion |
| Osmind |
| Pacagen |
| Paper |
| Perch |
| Plenful |
| Podimo |
| Pogo |
| Polycam |
| Power |
| PrismaX |
| Prophetic |
| RadiantGraph |
| Rayon |
| Redo |
| Relume |
| Rive |
| Rodeo |
| Rosie |
| Silna |
| Sitch |
| Skild AI |
| Spline |
| Stan |
| Stride |
| Subframe |
| SuperHi |
| Teal |
| Teton |
| Things |
| Third Dimension AI |
| Throne |
| Tolans |
| Variant |
| Viam |
| Wabi |
| Wand |
| WellTheory |
| Wonder |
| Yellow |
| Yuzu |
| mymind |

### API match found, but we did not add a source row (10)

| Company | Why we skipped it |
|---------|-------------------|
| Anterior | Ashby board found; not added when batch 2 was merged. |
| Bedrock Robotics | The “bedrock” board points at a different Bedrock than robotics; skipped on purpose. |
| Daydream | Looked like the wrong org for the name we had; skipped. |
| Ghost | This is the Ghost **CMS** job board, not a different company named Ghost. |
| Outsmart | Ashby board found; not added when batch 2 was merged. |
| Pitch | We already ingest Pitch through **Workable**, not Personio. |
| Series | Ashby board found; not added when batch 2 was merged. |
| Sesame | Lever board found; not added when batch 2 was merged (separate from “Sesame AI” in batch 1). |
| Sunrise Robotics | “Sunrise” board is too easy to confuse with other companies; skipped. |
| Zoo | Match looked weak or wrong; not added. |

---

## Batch 3 — large startup list (703 companies)

### No API match (308)

**Reason:** Same as above. No supported public feed for this name.

| Organization |
|---|
| 1Money |
| Accrual |
| Acctual |
| Activeloop |
| Adfin |
| Agno |
| Agora |
| Air |
| Alix |
| Also |
| Anvil |
| Arc |
| Arize |
| Assembled |
| Astral |
| AstroForge |
| Astromech |
| Auger |
| Augment |
| Augment Market |
| Aurasell |
| BRM |
| Backline |
| Bardeen |
| BaseHub |
| Basedash |
| Beacons |
| Beehiiv |
| Better Auth |
| Better Stack |
| Bezi |
| Bindwell |
| Blackbird |
| Blaze |
| Blok |
| Bluefish |
| Board |
| Boardy |
| Boxo |
| Brainfish |
| Bridge |
| Bronto |
| Bun |
| Buster |
| Cake Equity |
| Caro |
| Carry |
| Catalyx Space |
| Central |
| Chalk |
| Charm |
| Chroma |
| Circle |
| Cloaked |
| CloudX |
| Clover Security |
| Cometeer |
| Comfy |
| Common Paper |
| Composer |
| Conifer |
| Converge Bio |
| Convex |
| Convictional |
| Convoke |
| Copper |
| Cortical Labs |
| Count |
| Courier |
| Craft |
| Crux |
| CuspAI |
| Daffy |
| Dagster |
| Datalane |
| Day |
| Daylit |
| Daytona |
| Defacto |
| Definite |
| Density |
| Depot |
| Digits |
| Dimension Labs |
| Dirac |
| Distributional |
| Divine |
| Doorstep |
| Dotwork |
| Draftwise |
| Driver |
| DualBird |
| Dub |
| Eco |
| Edera |
| Edison |
| Einride |
| Encord |
| Endeavor |
| Entire |
| Eon |
| Epiminds |
| Equals |
| Era |
| Eve |
| Every |
| FERMÀT |
| Fabric |
| Feltsense |
| Fern |
| Finmid |
| Finofo |
| Flare |
| Fly.io |
| Folk |
| Footprint |
| Fora |
| Format |
| Fractional |
| Fragment |
| Framework |
| Froda |
| GC AI |
| Garden |
| Goodword |
| Gordian Software |
| Grain |
| Graza |
| Great Question |
| GreenLite |
| Greenly |
| Guru |
| Gym Class |
| Hadrian |
| Halycon |
| HappyRobot |
| Heirloom |
| Helcim |
| Highscore |
| Humble |
| Hummingbird |
| Hyphen |
| Index |
| Instant |
| Interfere |
| Jam |
| Jasper |
| Kaizen |
| Kick |
| Kite |
| Koi |
| Lago |
| Lavender |
| Layercode |
| Leen |
| Legend |
| Lettuce |
| Lightyear |
| Loonen |
| Luma |
| Lunos |
| M0 |
| Mage |
| Mainframe |
| Mangrove |
| Mantle |
| Marco |
| Marqo |
| Martian |
| Mastra |
| MavenPosh |
| Meow |
| MeritFirst |
| Midday |
| Moderne |
| Monk |
| Mura |
| Mynt |
| Mytra |
| Narmi |
| Native |
| Natural |
| Nectar |
| Ngrok |
| Nile |
| Nilus |
| Nomba |
| Nominal |
| Normal |
| Northstar |
| Northwood |
| ORO |
| OpenPay |
| Operate |
| Ordo |
| Origin |
| Outerbase |
| Outverse |
| Oway |
| Oxide Computer Company |
| Pace |
| Paid |
| Parable |
| Parabol |
| Parabola |
| Parrot Finance |
| Pave |
| Payload |
| Payman |
| Peach |
| Perle |
| Pipedream |
| Planhat |
| Pliant |
| Podcastle |
| Pomerium |
| Popcorn |
| Port IO |
| Privy |
| Puzzle |
| Pyn |
| Pythagora |
| Qdrant |
| Quo |
| Rainforest |
| Rainmaker |
| Rally |
| Rapider AI |
| Rebellions |
| Response |
| Retool |
| Roadway |
| RockFi |
| Round Treasury |
| Rove |
| Rows (Acquired by Superhuman) |
| Rox |
| Rune |
| Safara |
| San Francisco Compute Company |
| Sauron Systems |
| Science |
| Sequel.io |
| Seso |
| Shinkei |
| Shortcut |
| Shortwave |
| Simulate |
| Slash |
| Slope |
| Spellbook |
| Spur |
| Stainless |
| Stash |
| Stilla |
| Stoke |
| Story |
| Strawberry |
| Structify |
| Stuut |
| Sublime Security |
| Sundial |
| Sunflower Labs |
| Superlinked |
| Supermemory |
| Supper |
| Sybill |
| TELO |
| Taara |
| Tana |
| Tank Payments |
| Tatem |
| Tekeskope |
| Terradot |
| The Mobile-First Company |
| The Network |
| The Nmbr Company |
| The Routing Company |
| Theo |
| TigerEye (Acquired by Lennar) |
| Tilde |
| Tofu |
| Traceloop |
| Trunk |
| Twill |
| Unstructured |
| Upstash |
| Upwind |
| Varda |
| VoidZero |
| Volt |
| Volta |
| Vulture |
| Walrus |
| Warmly |
| Willow |
| Wiza |
| Xano |
| YieldClub |
| Yonder |
| Zama |
| Zeal |
| Zenlytic |
| ZeroEntropy |
| Zo Computer |
| autone |
| justt |
| nsave |

### API match found, but we did not add a row this time (31)

**How batch 3 was filtered**

- If the board showed **only one** open role (and it was not SmartRecruiters), we skipped it so we do not ingest tiny or stale boards.
- **Special cases** (Ghost CMS, Clay already covered elsewhere, two names sharing one board) are called out in the last column.
- Companies whose board was **already in the seed file** are omitted from this doc entirely.

| Company | Hiring tool | Account | Open roles | Why no new row |
|---------|-------------|---------|------------|----------------|
| Airbound | ashby | airbound | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Anyscale | lever | anyscale | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Autopilot | recruitee | autopilot | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Bonfire Studios | greenhouse | bonfirestudios | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Cal.com | personio | cal | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Civic Roundtable | recruitee | civic | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Clay | recruitee | clay | 16 | Clay is already covered by another board (Ashby); we skipped this Recruitee duplicate. |
| Clockwise | recruitee | clockwise | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Codex | ashby | codex | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Composite | ashby | composite | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Default | recruitee | default | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Ditto (Words) | ashby | ditto | 13 | Same board as **Ditto** above; only the first name in the list was kept. |
| Ethos | greenhouse | ethos | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Flow Computing | personio | flow | 21 | Same board as **Flow** above; only the first name in the list was kept. |
| Ghost | greenhouse | ghost | 7 | This is the Ghost **CMS** board, not a different company named Ghost. |
| Impulse Labs | ashby | impulse | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| iyo | ashby | iyo | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Jeeves | recruitee | jeeves | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Keel | ashby | keel | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Loyal | greenhouse | loyal | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Mem | ashby | mem | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Neon Pay | lever | neon | 17 | Same board as **Neon** above; only the first name in the list was kept. |
| Orbio | ashby | orb | 17 | Same board as **Orb** above; only the first name in the list was kept. |
| Paragon | ashby | paragon | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Pinwheel | smartrecruiters | Pinwheel | 1 | Same board as **Pin** above; only the first name in the list was kept. |
| Rutter | ashby | rutter | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Spoke | workable | spoke | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Stable Sea | ashby | stable | 10 | Same board as **Stable** above; only the first name in the list was kept. |
| Vega | greenhouse | vega | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Welcome to the Jungle | recruitee | welcome | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |
| Worksome | personio | worksome | 1 | Only one open role; we want at least two for this hiring tool (except SmartRecruiters). |

### Added from batch 3 (210)

Those companies **are** in our source list now. In `src/shared/db/migrate.ts` look for the section titled **Startup list cohort (batch 3 probe, 2026-03)**.
