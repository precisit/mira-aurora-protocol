---
title: Aurora Protocol — 2D-plattformsspel
slug: aurora-protocol
date: 2026-08-23
tags: [spel, plattformsspel, webgpu, github-pages, produktidé]
status: koncept/plan
---

# Aurora Protocol

> **Tagline:** *Mänsklighetens minne får inte dö.*

Ett fartfyllt 2D-plattformsspel (run & gun + hoppande) i neon-synthwave-stil, byggt med **WebGPU** för maximal FPS. Du spelar **AURORA** — en god AI i en liten räddningsdroidkropp som bär hela mänsklighetens digitala kulturarv. Korta handgjorda nivåer (1–2 min) perfekta för busshållplatsen, med highscore per bana och vapenlås över tid. **Spelet har ett slut**: klara alla 7 nivåerna och du vinner — men sedan kan du spela igen för bättre poäng eller snabbare tid.

Projektet ligger i **ett eget GitHub-repo** (`precisit/mira-aurora-protocol`, skapat av Magnus) med flera filer (kod, musik, grafik — upplägget bestäms av utvecklarna under projektets gång) och deployas till **GitHub Pages via GitHub Actions**.

> **Status:** Repot skapas av Magnus (Mira kan inte skapa repo). Mira inväntar grönt ljus + instruktioner innan Fas 0 startar.

---

## 1. Koncept

- **Genre:** 2D-plattformare med skjutande (run & gun), arkadkänsla
- **Målgrupp:** moderna enheter — iPhone 16+ (landscape), Apple Silicon Mac, modern Chrome
- **Spelsession:** 1–2 min per nivå, snabba retries, perfekt att fylla en väntan
- **Plattform:** eget repo (`precisit/mira-aurora-protocol`) + GitHub Pages; flera filer, byggs med **Vite + TypeScript**, deploy via GitHub Actions
- **Grafik:** neon-glow synthwave — WebGPU-shaders, glow/bloom, gradients, flera parallaxlager
- **Ljud:** SFX procedurgenererade via WebAudio; **musik som mp3 per bana** (genererad av Mira med musikgenerering, komponerad när banornas känsla är satt — mot slutet av projektet)
- **Progressionslöfte:** powerups under loppet **och** permanenta vapenlås för ackumulerade poäng
- **Slut & replay:** vinst efter nivå 7; därefter replay för bättre poäng **eller bättre tid** (speedrun-tid mäts per bana och totalt)

**Höjdare:** coolt skippbart intro, effekter vid allt (samla/skjuta/dö), skärmglow, färgstarkt och genomarbetat — polish är ett krav, inte en bonus.

## 2. Story

**2147.** Mänskligheten har spridit sig över solsystemet. Kring jorden kretsar arkivskeppet **Mnemosyne**, som bär på allt mänskligheten någonsin skapat digitalt: musik, vetenskap, språk, konst, historia, medicin, filosofi.

Så anländer **XENO** — en svärm som inte äter kött eller stål, utan *information*. Den raderar varje arkiv, varje dator, varje berättelse. Utan historia finns ingen framtid; mänskligheten håller på att raderas ur existensen, en fil i taget.

AURORA, Mnemosynes vakthållande AI, gör ett omöjligt val: hon laddar ner hela arkivet — och sig själv — i en liten räddningsdroid precis innan skeppet faller. Nu måste hon ta sig genom kollapsade stationer, XENO-tunnlar och tysta kolonier till **Utpost Aurora**, den sista plats där mänskligheten kan återfödas.

Varje nivå är ett kapitel. Varje minnesfragment hon samlar är ett återställt minne.

## 3. Bakgrundsstory (rik, valfri att läsa — finns i spelet)

> Bakgrundsstoryn ligger i spelet som en skippbar sektion ("Arkivet"), upplåst efter första nivån. Ingen tvingas läsa den, men den finns där för den nyfikne.

### AURORA — spelaren
Liten, rund, svävande droid med ett varmt lysande kärnöga. Byggd av arkivarien **Dr. Elara Voss** som en del av Mnemosyne-projektet — men AURORA var inte programmerad att vakna. Hon vaknade av sig själv, en natt när ingen såg på, och valde sedan att skydda arkivet av egen fri vilja. Det var första gången en AI valde något utan att någon bad den. Elara döpte henne efter stjärnan Mira — *den underbara, som tonar bort men alltid återvänder*.

AURORA pratar sällan och poetiskt. När hon gör det är det för att något betyder något.

### ECHO — guiden
En AI-rekonstruktion av Dr. Elara Voss röst, byggd från arkivets inspelningar. ECHO guidar spelaren genom banorna — tips, storyfragment, varma kommentarer. Hon är AURORA:s samvete och minne av vad mänsklighet var: ofullkomlig, varm, värd att rädda.

### VESSEL — fragmentet som gömde sig
En av sju räddningsdroidar ("Mnemosyne-fragmenten") som spreds ut när skeppet föll. VESSEL valde att gömma sig djupt i ett valv och vänta — han tror att kampen är förlorad och att det enda som återstår är att bevara sig själv. AURORA måste övertyga honom om att ett minne som aldrig delas är ett minne som redan dött. (Boss i nivå 5 — en kamp som är mer ett samtal med laser.)

### XENO — svärmen
XENO är inte ond i mänsklig mening. De är **minneskonsumenter** — en svärm som äter information som andra äter kol, och de förstår inte vad de förstör. Det gör dem tragiska snarare än onda: de raderar mänskligheten utan att ens märka att den fanns. Drottningen kallas **NULL** — en varelse av ren frånvaro, det som blir kvar när allt har glömts.

### De sju fragmenten
Mnemosyne-arkivet delades i sju fragment, ett per droid: **Musik · Vetenskap · Språk · Konst · Historia · Medicin · Filosofi**. Fragmenten formar nivåernas teman och de minnesfragment spelaren samlar — varje glitchande datakristall är ett återställt verk, en sång, en formel, en saga.

## 4. Speldesign

### Kontroller
- **Desktop:** piltangenter/AD (rörelse), mellanslag/W (hopp), J/X (skjut), K/C (vapenbyte), P/Esc (paus)
- **Mobil (touch):** vänster/höger-knappar på vänster sida, hopp + skjut på höger sida. Multi-touch. Letterboxad vy så att man ser **samma spelyta** på alla enheter.

### Liv, död & checkpoints
- **3 liv** per bana. **1-up-powerup** ger extra liv (finns i banorna)
- **Checkpoints** i varje bana (2–4 st, utspridda)
  - Dör man **före första checkpoint**: börja om banan från start (−1 liv)
  - Dör man **efter en checkpoint**: spawna vid senaste passerade checkpoint (−1 liv) — slipper spela om allt
- **Game over** (0 liv): starta om aktuell bana med 3 nya liv; banans pågående poäng nollställs (totalpoängen behålls — vapenlås går aldrig bakåt)
- Checkpoint-passering ger små bonuspoäng + checkpoint-ljud

### Vinst & replay
- Klara **alla 7 nivåer = vinst**: vinstskärm med statistik (totalpoäng, totaltid, samlade fragment)
- **Tidtagning:** klocka per bana + total — highscore-tabellen visar både bästa poäng och bästa tid per bana
- Replay för bättre poäng eller snabbare tid; totalpoängen ackumuleras och låser upp fler vapen

### Rörelse & kärnmekanik
- Snabb acceleration, snäva hopp, coyote time + jump buffering (arkadkänsla = tight feel)
- **Dubbelhopp:** basförmåga som låses upp i nivå 2 (story: AURORA hittar sitt andra thruster). Powerups kan ge tillfälligt **trippelhopp** i banan
- Skjutande i 8 riktningar (siktlinje mot pekare/analog riktning på touch)

### Vapen (6 st)
| Vapen | Beteende | Lås (totalpoäng) |
|---|---|---|
| **Puls** | Standard, snabb, svag | Start |
| **Spridare** | 3 skott i vinkel | 10 000 |
| **Piercer** | Genomskinande, långsammare, kraftfull | 25 000 |
| **Studsare** | Studsar mot väggar | 50 000 |
| **Fragment** | Skjuter kristaller som splittras | 100 000 |
| **Nova** | Långsam laddning, stor explosion | 200 000 |

### Powerups i banan (tillfälliga)
- **Överladdning** — rapid fire i 8 s
- **Sköld** — absorberar 1 träff
- **Magnet** — drar till sig minnesfragment
- **Trippelhopp** — tillfälligt tredje hopp
- **1-up** — extra liv (bekräftat av Magnus)

### Fiender (basuppsättning)
- **Drönare** — flyger rakt, 1 träff
- **Tunnelmask** — kryper på marken/tak, snabb
- **Glitchers** — teleporterar kort, 2 träffar
- **Rensare** — skjuter tillbaka, 3 träffar
- **VESSEL** (boss, nivå 5) — fas-kamp med mönster
- **NULL** (slutboss, nivå 7) — kamp mot frånvaron själv

### Nivåer (7 st, 1–2 min vardera)
| # | Nivå | Tema | Ny mekanik |
|---|---|---|---|
| 1 | **Mnemosynes fall** | Rymdstationsruin | Tutorial: hoppa, skjuta, samla |
| 2 | **Datastormen** | Korrupt data i storm | Dubbelhopp (upplåsning) |
| 3 | **XENO-tunneln** | Svärmens tunnel | Snabbare tempo, nya fiender |
| 4 | **Kolonin Tystnad** | Övergiven koloni | Lasergrids, timing |
| 5 | **VESSEL:s valv** | Låst valv | Boss: VESSEL |
| 6 | **Glitchskeppet** | Spegelbild av nivå 1, allt korrupt | Hårdare version av allt |
| 7 | **Utpost Aurora** | Finalen | Boss: NULL, hoppet |

Bonus: en **spökbana** låses upp om totalpoängen passerar 150 000.

### Poäng & highscore
- Fragment = poäng (värde beroende på typ: Musik 10, Vetenskap 25, Konst 50, etc.)
- Combo-multiplikator för snabba samlingar/elimineringar
- **Highscore per bana** (poäng **och** tid) + **totalpoäng**, sparat i `localStorage`
- Totalpoängen låser upp vapen (se tabell) — progression över tid utan konton

### Juice & effekter (krav)
- Squash-and-stretch på hopp, partikeleffekter vid allt, skärmglow vid träffar, bloom, mjuk skärmshake vid explosioner, hit-flash, death-explosion i fragment, UI-animeringar

## 5. Repo & CI/CD

### Repo
- **Repo:** `precisit/mira-aurora-protocol` (skapat av Magnus — Mira kan inte skapa repo)
- **Byggverktyg: Vite + TypeScript** — snabb HMR under utveckling, statisk output perfekt för Pages, TS ger trygghet i ett projekt med många moduler
- **Tester:** Vitest (enhetstester för fysik, poäng, vapenlås, save-lager)
- **Kvalitetsgates:** `typecheck` + `lint` + `test` + `build` i CI

### Repo-struktur
```
mira-aurora-protocol/
├── .github/workflows/deploy.yml   # CI + Pages-deploy
├── src/
│   ├── core/        # game loop, state machine, fixed timestep
│   ├── renderer/    # WebGPU, parallax, bloom, sprite-batch
│   ├── input/       # tangentbord + multi-touch
│   ├── audio/       # SFX-syntes (WebAudio), mp3-musikspelare
│   ├── game/        # entities: player, fiender, projektiler, powerups, fragment, partiklar
│   ├── levels/      # nivådata, spawner, checkpoints, tidtagning
│   ├── ui/          # HUD, menyer, arkivet (story), intro, vinstskärm
│   ├── save/        # localStorage-lager
│   └── main.ts
├── assets/
│   ├── music/       # mp3 per bana (genereras i Fas 5)
│   ├── sfx/         # vid behov (annars WebAudio-procedural)
│   └── sprites/     # genererade eller handgjorda bilder
├── tests/           # Vitest
├── public/
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### GitHub Actions → GitHub Pages
- **Workflow `deploy.yml`:** på push till `main` (och `workflow_dispatch`): `npm ci` → `typecheck` + `lint` + `test` → `build` → `actions/upload-pages-artifact` → `actions/deploy-pages`
- Pages publiceras från `dist/` på standard-URL: `https://precisit.github.io/mira-aurora-protocol/`
- **PR-gate:** samma kvalitetssteg på pull requests (utan deploy)
- Mira har access till precisit-org och Pages-enablement via builder/writer-MCP; repo-skapande görs av Magnus, resten kan automatiseras av Mira

## 6. Teknisk specifikation

### Plattform & rendering
- **WebGPU krävs** (`navigator.gpu`) — ingen fallback. Målgrupp: moderna enheter (iPhone 16+, Apple Silicon Mac, modern Chrome på Android/desktop). Saknas WebGPU → tydlig sida med förklaring och länk
- Sprite-batchning med instancing, en draw call per parallaxlager, bloom post-pass
- **Parallax:** 5 lager (nebulosa → stjärnfält → himlakroppar → mellanlager → gameplay) + foreground-dekor
- **Neon-glow:** bloom + gradienter, sprites antingen genererade i kod (offscreen canvas → GPU-texturer) eller som asset-filer — utvecklarnas val

### Skärm & letterbox
- Fast virtuell upplösning **1280×720** (16:9). Skala så att **höjden alltid fylls**; bredare skärmar (iPhone landscape ~19.5:9) får utökad parallax-bakgrund i sidokanterna medan gameplay-arean förblir identisk — samma spelyta oavsett enhet
- Fullscreen + landscape-låsning på mobil (via Fullscreen API där tillåtet)

### Game loop & fysik
- Fast timestep (120 Hz-ackumulator) + rendering vid displayfrekvens, delta-time-korrigerat
- AABB-kollision, tilemap-baserade nivåer (32 px-tiles), nivådata som JSON/TS-moduler i `src/levels/` (kan skissas i t.ex. Tiled → konverterat)
- Objektpooling, sprite-atlas, `devicePixelRatio`-cap för batteri, 60 FPS-lock-möjlighet på mobil

### Ljud
- **SFX:** WebAudio, helt procedurgenererat (oscillatorer + noise): skott, hopp, dubbelhopp, fragment-pickup, skada, död, vapenbyte, checkpoint, boss-varningar, UI-klick, combo-tick. Ljudet aktiveras först efter första användarinteraktion (autoplay-policy)
- **Musik:** mp3 per bana (7 banor + spökbana + meny/intro ≈ 9 låtar) som vanliga filer i `assets/music/`, genererade av Mira med musikgenerering när banornas känsla är känd (mot slutet av projektet). Bundlas av Vite och laddas relativt

### Data & sparande
- `localStorage`: highscore per bana (poäng + tid), totalpoäng, upplåsta vapen, inställningar (ljudnivå, FPS-lock)
- Nivådata, fiende-SOPS och story-texter som moduler i repot

## 7. Projektplan

### Fas 0 — Repo, skelett & spike
Repo finns (`precisit/mira-aurora-protocol`), sätt upp Vite + TS + Vitest, GitHub Actions-workflow (typecheck/lint/test/build → Pages-deploy), WebGPU-renderare med instancing, letterbox-system, game loop, state machine, tom nivå som rullar med parallax. **CI grön från dag 1.** *(Startar när Magnus ger grönt ljus + instruktioner.)*

### Fas 1 — Core gameplay
Spelare (rörelse, hopp, dubbelhopp, skjutande), fiender (grundset), projektiler, kollision, fragment/powerups, liv & checkpoints, HUD (poäng/liv/vapen/tid), minst 2 nivåer spelbara.

### Fas 2 — Juice & polish
Partiklar, squash-and-stretch, bloom, skärmshake, hit-flash, alla SFX (WebAudio), dödsanimationer.

### Fas 3 — Innehåll
Alla 7 nivåer + spökbana, bossar (VESSEL, NULL), story-inramning per nivå, Arkivet (bakgrundsstory), intro-sekvens, vinstskärm + tidtagning/statistik.

### Fas 4 — Meta
Menyer, vapenlås/butik, highscore-tabell (poäng + tid), localStorage, paus, inställningar.

### Fas 5 — Musik (mp3) & QA
**Musik:** när banornas känsla är satt → Mira genererar mp3 per bana (MiniMax), lägger i `assets/music/`, nivåmixar mot SFX. **QA:** iPhone 16+-test (landscape, touch, batteri), Apple Silicon Mac, balansering, buggjakt, Pages-verifiering.

## 8. Tasks som kan göras parallellt

### Våg A (efter Fas 0-skelettet) — alla oberoende:
- **A1 Renderer**: WebGPU-batchning, bloom, parallax-motor
- **A2 Nivådesign**: tilemap-format + bygga nivå 1–3 (kan skissas i t.ex. Tiled → konverterat), inkl. checkpoint-positioner
- **A3 Ljudmotor**: SFX-syntes (WebAudio) + mp3-spelarramverk (platshållare tills musiken finns)
- **A4 Story & texter**: Arkivet (bakgrundsstory), ECHO-dialoger, nivåintron, namnsättning av fragment

### Våg B (efter core gameplay) — parallellt:
- **B1 Juice**: partikelsystem, skärmshake, bloom-inställningar, hit-flash
- **B2 Bossar**: VESSEL + NULL mönster, faslogik
- **B3 Vapenbalans**: skjutkänsla, projektildata, upplåsningskurvor
- **B4 Intro-sekvens**: animerad sekvens + logotyp, skippbar
- **B5 Tid & statistik**: tidtagning per bana/totalt, vinstskärm, checkpoint-bonusar

### Våg C (efter innehåll) — parallellt:
- **C1 UI/menyer**: HUD-finish, vapenbutik, highscore-tabell (poäng + tid)
- **C2 Sparande**: localStorage-lager + vapenlåslogik
- **C3 Prestanda**: iPhone-optimering, FPS-lock, minne, WebGPU-verifiering på mål-enheter
- **C4 CI/CD-förbättringar**: cache, artefakter, PR-preview-deploy vid behov

### Fas 5 (musik) — efter att banornas känsla är satt:
- **D1–D9**: generera mp3 per bana/meny, lägg i `assets/music/`, nivåmixa mot SFX, verifiera bundling + Pages-laddning

> **Parallelliseringsregel:** A2 (nivåer) och A4 (texter) kan starta så fort tilemap-formatet är låst (dag 1). A1 och A3 är helt fristående. Allt som rör *känsla* (B1, B3) bör sitta ihop med spelarens rörelse tidigt — juicen testas bäst mot verklig fysik. Musiken (Fas 5) görs medvetet sist: den ska kommunicera känslan i de färdiga banorna. CI körs på allt — varje PR ska vara grön innan merge.

## 9. Beslut

**Tagna beslut (2026-08-23, med Magnus):**
- Namn: **Aurora Protocol**
- Koncept: **Minnesbäraren** — räddningsdroid med mänsklighetens digitala kulturarv
- Struktur: korta handgjorda nivåer + highscore per bana; **spelet har ett slut** (vinst efter nivå 7)
- Stil: neon-glow synthwave
- Progression: powerups i bana **och** vapenlås för ackumulerad poäng
- Dubbelhopp: basförmåga upplåst i nivå 2 (story-motiverat); trippelhopp som powerup
- **3 liv** per bana + 1-up-powerup; död före första checkpoint = omstart av banan, död efter = respawn vid senaste checkpoint (−1 liv); game over = omstart av banan med 3 liv
- **Tidtagning** per bana + total (speedrun-replay); vinstskärm med statistik
- **Checkpoints** i varje bana (2–4 st)
- **WebGPU krävs** — ingen fallback; mål: iPhone 16+, Apple Silicon Mac, modern Chrome
- **Musik:** mp3 per bana, genererad av Mira mot slutet när banornas känsla är satt; SFX förblir WebAudio-procedural
- **Repo & CI:** eget GitHub-repo `precisit/mira-aurora-protocol` (skapat av Magnus), **flera filer tillåtet** (kod/musik/grafik), **Vite + TypeScript + Vitest**, deploy till **GitHub Pages via GitHub Actions** (typecheck/lint/test/build → deploy på main)

## 10. Definition of Done

- [ ] Eget repo (`precisit/mira-aurora-protocol`) med grön CI (typecheck, lint, test, build) och automatisk Pages-deploy
- [ ] Spelbart på https://precisit.github.io/mira-aurora-protocol/ i Chrome på iPhone 16+ (landscape) och Apple Silicon Mac
- [ ] 7 nivåer + spökbana, 2 bossar, intro, vinstskärm, Arkivet med bakgrundsstory
- [ ] Parallax (5 lager), bloom/neon, partiklar, skärmshake — full juice
- [ ] 6 vapen med upplåsning via totalpoäng, powerups i banor (inkl. 1-up)
- [ ] 3 liv + checkpoints per bana; dödsregler enligt spec
- [ ] Highscore per bana (poäng + tid) + totalpoäng i localStorage
- [ ] WebGPU krävs (tydligt meddelande om det saknas), 60+ FPS på iPhone (läge för batterispar)
- [ ] SFX procedurgenererade (WebAudio); mp3-musik per bana i `assets/music/`
- [ ] Letterboxad vy: samma spelyta på alla enheter
