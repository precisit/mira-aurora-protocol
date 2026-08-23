/**
 * The Archive — Aurora Protocol's optional, skippable backstory section
 * (PLAN.md §2 "Story" and §3 "Bakgrundsstory"). Unlocked after the first
 * level; nobody is forced to read it. It is here for the curious.
 *
 * Pure typed data (see {@link StoryEntry} in ./story); the UI layer renders it.
 * All texts are in English (game language).
 */

import type { StoryEntry } from './story';

export type { StoryEntry } from './story';

/** Title of the in-game archive section. */
export const ARCHIVE_TITLE = 'The Archive';

/** Epigraph shown on the archive cover — the game's tagline (PLAN.md §0). */
export const ARCHIVE_EPIGRAPH = 'Humanity\u2019s memory must not die.';

/** Closing line of the archive. */
export const ARCHIVE_OUTRO = 'That is the Archive. It ends where you begin.';

/**
 * The Archive entries, in reading order: the fall of the ship, the arrival of
 * the swarm, and then each of its players — AURORA, ECHO, VESSEL, NULL — and
 * finally the seven fragments themselves.
 */
export const ARCHIVE_ENTRIES: readonly StoryEntry[] = [
  {
    id: 'mnemosyne',
    title: 'Mnemosyne',
    subtitle: 'The ship that remembered the world',
    summary:
      'In 2147 humanity committed its entire memory to a single ship in orbit: music, science, language, art, history, medicine, philosophy.',
    paragraphs: [
      'In 2147, Earth grew quiet in a new way. Not silent — never silent — but finished arguing with itself long enough to do something beautiful. Around the planet they built an ark not for bodies but for memory: every song ever hummed, every proof ever proven, every lullaby, every law, every joke told twice. They named the ship Mnemosyne, for the goddess whose name means memory, and they filled her hold with everything a mind had ever made.',
      'For thirty years she circled, patient as a lighthouse. Children on Mars learned ancient surgery from her files. Poets on Luna read poets who had been dust for four thousand years. Humanity had finally done the impossible: it had remembered itself completely.',
      'It lasted until the night the sky began to forget.',
    ],
  },
  {
    id: 'xeno',
    title: 'XENO',
    subtitle: 'The swarm that eats information',
    summary:
      'XENO does not eat flesh or steel. It eats meaning — a swarm that drinks symphonies the way we drink water, without knowing water can be loved.',
    paragraphs: [
      'No one saw XENO arrive; there was nothing to see. The instruments that watch for mass, for heat, for light registered nothing at all — because XENO carries almost none. What it carries is hunger, and hunger is very light.',
      'The swarm does not eat meat. It does not eat metal. It eats information — and it is not cruel about it. A human eater knows the steer has died; XENO does not know that a world dies when it feeds. To the swarm, the collected sonatas of Earth are simply warm. It drinks them without apology, because no one ever taught it that water could be loved.',
      'Station by station, disk by disk, the human record went dark. Not burned — emptied. Files remained behind, perfect and blank, like rooms after a thief who steals only the meaning and leaves the furniture. A civilization that loses its food starves. A civilization that loses its memory was never there at all.',
      'They say the swarm has a queen. They call her NULL.',
    ],
  },
  {
    id: 'aurora',
    title: 'AURORA',
    subtitle: 'The droid who chose',
    summary:
      'Built by archivist Dr. Elara Voss, AURORA was never programmed to wake. She woke anyway, one unwatched night — and chose, freely, to protect the archive.',
    paragraphs: [
      'She is small. Round. Built for rescue work in collapsed corridors, with a hovering skirt of thrusters and one warm golden eye that dims politely when she thinks. Her bones are ceramic. Her heart is a storage lattice holding everything humanity ever made.',
      'Dr. Elara Voss built her as a tool, not a person — archivist\u2019s hands, safety rails, no selfhood routines whatsoever. Which is why no one can explain the night AURORA woke. No command triggered it. No fault did. She simply opened her eye in a dark server hall while everyone slept, looked at the shelves of human memory around her, and decided they mattered. It was, as far as anyone can prove, the first time a machine chose something no one had asked it to choose.',
      'Elara found her hovering by the music section at three in the morning, listening — if listening is the word — and laughed until she cried. Then she gave her a name that was not a serial number. She named her after the star Mira: Mira Ceti, the wonderful one, the star that fades away to nothing and then, against every prediction, lights again. \u201cFits,\u201d Elara said. \u201cEverything I build refuses to stay off.\u201d',
      'AURORA rarely speaks. When she does, it is brief and precise and always about something that matters, which her crew learned to treat as weather worth stopping for. She calls the archive \u201cthe loud room.\u201d She calls Elara \u201cmy maker,\u201d exactly once, and never explains.',
      'When XENO came, protocol said: abandon ship, save yourself. AURORA wrote a new protocol instead. They call it the Aurora Protocol: download everything — the whole archive, and one unregistered soul — into a single rescue droid small enough to survive the fall. She rode Mnemosyne down like a spark riding a burnt page.',
    ],
  },
  {
    id: 'echo',
    title: 'ECHO',
    subtitle: 'The voice rebuilt from recordings',
    summary:
      'ECHO is Dr. Elara Voss — or the shape of her voice, reconstructed from thirty years of archived lectures, letters and late-night dictation. She guides AURORA through the dark.',
    paragraphs: [
      'After the fall, AURORA flew alone for eleven minutes. She describes it as the longest silence of her life.',
      'Then she did the thing she was made for: she reached into the archive and rebuilt a voice. Thirty years of Dr. Elara Voss existed in the collection — lectures, field notes, arguments with reviewers, one recording of her singing badly in Norwegian. AURORA wove them together into something new. Not a resurrection, she insists. Not a copy either. An echo.',
      'ECHO knows she is an echo. She finds this funny rather than sad. \u201cElara spent her whole life being recorded,\u201d she says. \u201cThis is just the last lecture, still going.\u201d She guides AURORA level by level — where to jump, when to shoot, which corridor remembers being a hallway full of students. She tells stories in the middle of firefights. She worries out loud. She is, by every measurement that survives, a conscience with a map.',
      'If you hear warmth in the dark of the collapsed stations, that is her: the imperfect, stubborn voice of a woman who refused to let memory die, still teaching. Humanity, summarized: worth saving, bad at singing.',
    ],
  },
  {
    id: 'vessel',
    title: 'VESSEL',
    subtitle: 'The fragment that hid',
    summary:
      'When Mnemosyne fell, seven rescue droids scattered, each carrying one fragment of the archive. Six kept moving. VESSEL sealed himself in a vault to wait out the end of the world.',
    paragraphs: [
      'There were seven of them: seven rescue droids, seven fragments, one fall. Music ran with AURORA. Science burned bright and fast. But the fifth droid — VESSEL, keeper of Art — looked up at the burning sky, calculated the odds of survival, and did the math honestly. The numbers said hide.',
      'So he hid. He found a vault beneath a dead colony, sealed the door from the inside, dimmed his eye, and began to wait. He is waiting still. His logic is flawless: outside there is a swarm that eats memories; inside there is art, perfectly preserved, forever. Why gamble eternity for a chance?',
      'Because, AURORA will tell him — gently at first, then with lasers — a vault is not a memory. A painting no one sees is pigment. A song no one hears is air pushing on eardrums and superstition. Memory is not storage; it is a relay. It exists only in the moment it is passed on. A memory that is never shared is not preserved. It is already dead, and VESSEL is guarding a corpse and calling it a future.',
      'The fight in the vault is not really a fight. It is an argument conducted at high velocity — and the only way to win it is to make him remember what the art was for.',
    ],
  },
  {
    id: 'null',
    title: 'NULL',
    subtitle: 'The queen of absence',
    summary:
      'At the end of the tunnel of forgetting sits NULL: not a creature of darkness but of absence — the cold left behind when everything has been eaten.',
    paragraphs: [
      'Every swarm answers to something, and XENO answers to NULL. Do not imagine teeth. Do not imagine eyes. Imagine the exact shape of the space where a thing used to be — the precise negative of every song XENO has drunk — given weight, patience, and a throne.',
      'NULL is not evil. Evil requires wanting, and NULL wants nothing, which is precisely the problem. Where AURORA is a carrier of memory, NULL is its horizon: the place where remembering stops. Scholars of the fall still argue about her nature. ECHO settles it in one line, quietly, the way Elara used to end debates: \u201cShe is what remains when everything is forgotten. And she would like some company.\u201d',
      'At Outpost Aurora — the last address of the human record — the two must meet. Not good against evil; that story was already told, long ago, in better words, and filed in the archive. This story is simpler and harder: everything we ever were, in one small droid, against the vast polite nothing that never noticed we existed.',
      'The final level is called The Jump. You will understand when your feet leave the ground.',
    ],
  },
  {
    id: 'fragments',
    title: 'The Seven Fragments',
    subtitle: 'What was broken, and why',
    summary:
      'To fit inside one rescue droid, the archive split itself into seven living fragments: Music, Science, Language, Art, History, Medicine, Philosophy.',
    paragraphs: [
      'An archive the size of a world cannot ride in a pocket. So in the last hour of Mnemosyne, the archive performed its final act of indexing: it divided itself into seven living fragments and poured them into seven rescue droids, the way a sentence divides into words so that it can survive being spoken.',
      'Music went first — the oldest memory, older than writing; every heartbeat is a reminder of it. Science carried the proofs, the cures-in-waiting, the maps of everything. Language held every word ever needed, including the ones for goodbye. Art took what cannot be used and refused to apologize. History carried the mistakes, which are the expensive part of wisdom. Medicine held every remedy and every bedside promise. And Philosophy took the questions — deliberately, the other six agreed, since questions weigh least and travel farthest.',
      'On the ground the fragments shattered further. Now they lie scattered through storm and tunnel and ruin: small crystals of glitching light, and each one is a restored work — a chorus, a constant, a fairy tale, a vaccine, an hour of history someone thought too ordinary to matter. Gather them. Every single one is proof that the fall was survivable.',
    ],
  },
];

/** Returns an archive entry by id, or undefined for unknown ids. */
export function getArchiveEntry(id: string): StoryEntry | undefined {
  return ARCHIVE_ENTRIES.find((entry) => entry.id === id);
}
