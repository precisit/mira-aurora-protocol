/**
 * Narrative data for Aurora Protocol (PLAN.md §8 wave A4):
 * level intros, ECHO dialogue lines and fragment definitions, as pure typed
 * data so any UI layer (menus, HUD banners, the Archive) can render them.
 *
 * All texts are in English (game language). Levels are numbered 1–7 and match
 * the level table in PLAN.md §4.
 */

/** Number of story levels in the campaign. */
export const LEVEL_COUNT = 7;

/** Tone of an ECHO line — drives color/icon treatment in the UI. */
export type EchoLineKind = 'tip' | 'story' | 'encouragement';

/** One spoken line from ECHO, the guide reconstructed from Dr. Voss's recordings. */
export interface EchoLine {
  /** Level the line belongs to (1–7). */
  level: number;
  kind: EchoLineKind;
  text: string;
}

/** Poetic intro screen shown before a level starts. */
export interface LevelIntro {
  /** 1-based level index (1–7). */
  level: number;
  title: string;
  theme: string;
  /** New mechanic this level introduces, or null if none. */
  newMechanic: string | null;
  /** Short poetic intro text. */
  text: string;
}

/** Identifier of one of the seven archive fragments. */
export type FragmentId =
  | 'music'
  | 'science'
  | 'language'
  | 'art'
  | 'history'
  | 'medicine'
  | 'philosophy';

/** Metadata for a collectible memory fragment. */
export interface FragmentDef {
  id: FragmentId;
  name: string;
  /** Score value per pickup (PLAN.md §4: Music 10 … Philosophy 100). */
  value: number;
  /** Short flavor text shown on pickup / in menus. */
  flavor: string;
}

/**
 * One entry of the Archive, the optional in-game backstory section.
 * Rendered skippable; unlocked after the first level (PLAN.md §3).
 */
export interface StoryEntry {
  id: string;
  title: string;
  subtitle: string;
  /** One-line teaser shown in the entry list. */
  summary: string;
  /** Full text, one paragraph per element, in reading order. */
  paragraphs: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Level intros                                                        */
/* ------------------------------------------------------------------ */

export const LEVEL_INTROS: readonly LevelIntro[] = [
  {
    level: 1,
    title: 'The Fall of Mnemosyne',
    theme: 'Ruins of the archive station',
    newMechanic: 'Tutorial: move, jump, shoot, collect',
    text:
      'She fell through the sky wrapped in everything we ever were.\n' +
      'Wreckage rains down like snow that used to be a library. Somewhere below, the first fragments blink in the dark — a chord, a constant, half a fairy tale.\n' +
      'Run, little star. Remember how to jump.',
  },
  {
    level: 2,
    title: 'The Datastorm',
    theme: 'Corrupted data in the storm',
    newMechanic: 'Unlocks: double jump',
    text:
      'Above the wreckage, the storm eats itself: shredded songs and equations screaming past at the speed of regret.\n' +
      'In the eye of it, AURORA finds a second thruster — her own, jettisoned years ago. With it, the sky learns to be climbed twice.\n' +
      'Double jump. Even memory gets a second chance.',
  },
  {
    level: 3,
    title: 'The XENO Tunnel',
    theme: 'Inside the swarm\u2019s tunnel',
    newMechanic: 'Faster tempo, new enemies',
    text:
      'This tunnel was carved by hunger. Its walls are smooth where files used to be — corridors polished by appetite.\n' +
      'XENO moves faster here. So must you.\n' +
      'Do not look back. Looking back is what the tunnel is for.',
  },
  {
    level: 4,
    title: 'Colony of Silence',
    theme: 'The abandoned colony',
    newMechanic: 'Laser grids, timing',
    text:
      'Eleven thousand people lived here. Now the streets are a held breath, and the lasers sweep the avenues like slow, patient metronomes.\n' +
      'The colony is not dead, exactly. It is paused.\n' +
      'Learn the rhythm. Silence keeps perfect time.',
  },
  {
    level: 5,
    title: 'VESSEL\u2019s Vault',
    theme: 'The sealed vault',
    newMechanic: 'Boss: VESSEL',
    text:
      'Behind this door, Art is safe forever — guarded by the last brother, who chose survival over meaning.\n' +
      'He will not open it. He has excellent reasons. He has had years to perfect them.\n' +
      'Knock loudly. Argue with light. Some doors only open for the truth.',
  },
  {
    level: 6,
    title: 'The Glitch Ship',
    theme: 'Mirror of level one, corrupted',
    newMechanic: 'A harder version of everything',
    text:
      'You have been here before. The corridors agree — mostly. Doors lead roughly where they mean to, gravity has opinions, and the wreck of Mnemosyne dreams it is still whole.\n' +
      'Everything you learned must now be unlearned and relearned, faster.\n' +
      'The mirror shows level one. Do not trust it. Trust your feet.',
  },
  {
    level: 7,
    title: 'Outpost Aurora',
    theme: 'The finale',
    newMechanic: 'Boss: NULL — The Jump',
    text:
      'The last address of the human record: a beacon on the edge of everything, waiting for a delivery one droid wide.\n' +
      'NULL waits beyond the gate, patient as an unwritten page. Beyond her, the uplink. Beyond the uplink — everyone who ever lived, remembered.\n' +
      'One more jump, Mira. Make it wonderful.',
  },
];

/* ------------------------------------------------------------------ */
/* ECHO dialogue                                                       */
/* ------------------------------------------------------------------ */

export const ECHO_LINES: readonly EchoLine[] = [
  // Level 1 — The Fall of Mnemosyne
  { level: 1, kind: 'story', text: 'There you are. Oh — look at you. Small enough to hold everything. Hold it tight, little one.' },
  { level: 1, kind: 'tip', text: 'Move, jump, shoot. The crystals ahead are real memories — gather every one you can reach.' },
  { level: 1, kind: 'story', text: 'This corridor was Deck Seven. I lectured here on Tuesdays. Terrible acoustics. Wonderful students.' },
  { level: 1, kind: 'tip', text: 'Green lights mark checkpoints. Reach one, and part of this level stays yours even if the rest goes wrong.' },
  { level: 1, kind: 'encouragement', text: 'Just like that. Elara always said you learn faster than anything she ever built. She was right, as usual.' },

  // Level 2 — The Datastorm
  { level: 2, kind: 'story', text: 'Storm front ahead. That noise is data with nowhere to go — a billion unsaved drafts, screaming.' },
  { level: 2, kind: 'story', text: 'AURORA — look, tumbling in the debris: a second thruster. Yours, from the prototype. Take it. Two jumps are better than one.' },
  { level: 2, kind: 'tip', text: 'Double jump: press jump again in mid-air. High ledges are no longer merely suggestions.' },
  { level: 2, kind: 'encouragement', text: 'Beautiful! Elara built your first thruster and quietly left you a spare. She never doubted you twice.' },
  { level: 2, kind: 'tip', text: 'Fragments blow loose in the wind. Grab the Magnet and the storm will hand them back.' },

  // Level 3 — The XENO Tunnel
  { level: 3, kind: 'story', text: 'We are inside the swarm\u2019s throat now. Stay low, stay quick — and remember: they truly do not know what they are eating.' },
  { level: 3, kind: 'tip', text: 'Tunnel worms hug the floor and the ceiling. Shoot early, keep moving — standing still down here is a way of volunteering.' },
  { level: 3, kind: 'encouragement', text: 'Faster now! Yes — like that. You were built for rescue work, dear, and rescuing means hurrying.' },
  { level: 3, kind: 'story', text: 'Glitchers blink in and out; two hits each. None of this is evil, you know. That is what makes it so hard.' },
  { level: 3, kind: 'story', text: 'Every meter of this tunnel was a library last year. Fly for both of us.' },

  // Level 4 — Colony of Silence
  { level: 4, kind: 'story', text: 'Colony of Silence. Eleven thousand people, one morning, gone quiet. The lasers stayed on. Nobody told them the news.' },
  { level: 4, kind: 'tip', text: 'Laser grids pulse on a rhythm. Watch one full cycle before you cross — timing beats speed here.' },
  { level: 4, kind: 'encouragement', text: 'Perfect rhythm! You would have made a fine musician. Do not tell Music I said so.' },
  { level: 4, kind: 'story', text: 'See the playground below? We keep running so that someone, someday, remembers they were here.' },
  { level: 4, kind: 'tip', text: 'Cleansers shoot back — three hits, and they aim better than drones. Break line of sight between their volleys.' },

  // Level 5 — VESSEL's Vault
  { level: 5, kind: 'story', text: 'This vault holds Art — and Art\u2019s keeper. Be kind to him, AURORA. He has been alone with the truth for a long time.' },
  { level: 5, kind: 'tip', text: 'VESSEL fights in phases. Each phase is a paragraph of his argument. The patterns repeat — like grief, they repeat.' },
  { level: 5, kind: 'story', text: 'He hid because the numbers said hide. He was not wrong, dear. He was only early.' },
  { level: 5, kind: 'encouragement', text: 'You are doing wonderfully. He can hear you — beneath the lasers, he can always hear you. That is the point of him.' },
  { level: 5, kind: 'story', text: '\u201cA memory never shared is a memory already dead.\u201d Say it with your shots if you must. Art always understands.' },

  // Level 6 — The Glitch Ship
  { level: 6, kind: 'story', text: 'Careful — this is Mnemosyne again, or her dream of herself. Everything here remembers being a hallway. Few succeed.' },
  { level: 6, kind: 'tip', text: 'Corrupt geometry lies. Test every ledge with one foot before you commit your whole heart to it.' },
  { level: 6, kind: 'encouragement', text: 'You know this ship — you fell with her. Let your feet remember what the mirror forgot.' },
  { level: 6, kind: 'story', text: 'I gave my last lecture on this deck, in another life. The acoustics are even worse now, if you can believe it.' },
  { level: 6, kind: 'tip', text: 'Glitchers come in pairs here, and cleansers lead them. Shoot the ones that shoot back first; dance with the rest.' },

  // Level 7 — Outpost Aurora
  { level: 7, kind: 'story', text: 'There. Outpost Aurora. The last shelf in the universe, waiting for a delivery exactly our size. I can see the uplink light.' },
  { level: 7, kind: 'story', text: 'NULL is beyond the gate. She is not angry, AURORA. She is nothing — and nothing is very hard to argue with. Aim for what is not there.' },
  { level: 7, kind: 'tip', text: 'NULL erases what she touches. Keep moving. A still target starts agreeing with her.' },
  { level: 7, kind: 'encouragement', text: 'And listen to me, little star: whatever happens next, it has been the honor of my second life to walk beside you.' },
  { level: 7, kind: 'story', text: 'One more jump, and the archive is home — every song, every cure, every question, delivered. Make it wonderful, Mira.' },
];

/* ------------------------------------------------------------------ */
/* Fragments                                                           */
/* ------------------------------------------------------------------ */

export const FRAGMENTS: readonly FragmentDef[] = [
  {
    id: 'music',
    name: 'Music',
    value: 10,
    flavor:
      'The oldest memory — before writing, before fire: a mother humming in the dark. This shard holds three million songs and one lullaby older than language.',
  },
  {
    id: 'science',
    name: 'Science',
    value: 25,
    flavor:
      'Every proof ever proven: constants, cures-in-waiting, the maps of everything. Fragile things, facts — they shatter exactly like this, and still they reassemble.',
  },
  {
    id: 'language',
    name: 'Language',
    value: 40,
    flavor:
      'Seven thousand tongues, including the words for goodbye. Whoever holds this holds every word ever needed — and most of them mean \u201cstay.\u201d',
  },
  {
    id: 'art',
    name: 'Art',
    value: 50,
    flavor:
      'What cannot be used, and refuses to apologize. From cave walls to cathedrals of light: proof that even starving, we insisted on beauty.',
  },
  {
    id: 'history',
    name: 'History',
    value: 60,
    flavor:
      'The expensive part of wisdom: every mistake, paid for in full. It is heavy, this one. Carry it gently — it remembers everyone.',
  },
  {
    id: 'medicine',
    name: 'Medicine',
    value: 75,
    flavor:
      'Every remedy and every bedside promise: \u201cyou will be all right,\u201d said ten billion times — and true often enough to build a science on.',
  },
  {
    id: 'philosophy',
    name: 'Philosophy',
    value: 100,
    flavor:
      'The questions, carried deliberately — they weigh least and travel farthest. Worth the most. They always were.',
  },
];

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

/** Returns the intro for a level (1–7), or undefined for unknown levels. */
export function getLevelIntro(level: number): LevelIntro | undefined {
  return LEVEL_INTROS.find((intro) => intro.level === level);
}

/** Returns all ECHO lines spoken during a level (1–7). */
export function echoLinesForLevel(level: number): readonly EchoLine[] {
  return ECHO_LINES.filter((line) => line.level === level);
}

/** Returns a fragment definition by id, or undefined for unknown ids. */
export function getFragment(id: string): FragmentDef | undefined {
  return FRAGMENTS.find((fragment) => fragment.id === id);
}
