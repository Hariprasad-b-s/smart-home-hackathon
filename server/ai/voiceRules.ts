/**
 * Deterministic voice check-in extraction (fallback when Claude is unavailable).
 * Synonym/keyword dictionaries per question role and option label, clause-scoped negation
 * ("no wheezing", "didn't wake up"), number words ("twice", "7 out of 10", "about 6 hours")
 * and feeling words → face-scale options. Weaker matches get lower confidence.
 */
import type { VoiceParsedAnswer } from '../../shared/types/api';
import type { QuestionOption, TrackerDefinition, TrackerQuestion } from '../../shared/types/tracker';
import { clauses, escapeRe, HEDGE_RE, negatedAt, normalize, NUMBER_WORD_RE, truncate, wordToNumber } from './text';

type Confidence = VoiceParsedAnswer['confidence'];
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const minConf = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);

interface Unit {
  /** Original sentence fragment (for evidence quotes). */
  orig: string;
  norm: string;
  parts: string[];
}

interface Hit {
  unit: Unit;
  part: string;
  index: number;
  negated: boolean;
}

function units(transcript: string): Unit[] {
  return transcript
    .split(/[.!?;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((orig) => {
      const norm = normalize(orig);
      return { orig, norm, parts: clauses(norm) };
    })
    .filter((u) => u.norm);
}

function find(us: Unit[], patterns: RegExp[]): Hit[] {
  const hits: Hit[] = [];
  for (const unit of us) {
    for (const part of unit.parts) {
      for (const re of patterns) {
        const g = new RegExp(re.source, 'g');
        for (const m of part.matchAll(g)) hits.push({ unit, part, index: m.index, negated: negatedAt(part, m.index) });
      }
    }
  }
  return hits;
}

const ev = (u: Unit) => truncate(u.orig, 140);
const answer = (questionId: string, value: string | null, confidence: Confidence, evidence?: string): VoiceParsedAnswer =>
  value === null ? { questionId, value: null, confidence: 'low' } : { questionId, value, confidence, ...(evidence ? { evidence } : {}) };

// ───────────────────────────────── yes / no ─────────────────────────────────

interface YesNoDict {
  /** Mention means "yes" (negated → "no"). */
  yes: RegExp[];
  /** Mention means "no" (negated → "yes"), e.g. "went to school", "slept through the night". */
  no?: RegExp[];
  /** Pattern that must also occur in the same clause for `yes` matches to count. */
  context?: RegExp;
}

const YES_NO: Partial<Record<NonNullable<TrackerQuestion['role']>, YesNoDict>> = {
  nightWaking: {
    yes: [/\b(woke|wake|waking|woken|wakes|awake)\b/, /\bup (at|in the|during the|all) night\b/, /\b(couldnt|could not|cant) (get back to )?sleep\b/],
    context: /\b(night|nighttime|midnight|\d+ ?am|coughing|cough|wheez\w*|asthma|breath\w*|chest|inhaler|couldnt sleep|sleep)\b/,
    no: [/\bslept (through|all night|fine|well|great|good|ok|okay|really well)\b/, /\b(good|great|full) nights? sleep\b/],
  },
  missedSchool: {
    yes: [
      /\b(miss|missed|missing|skip|skipped|skipping) (school|class|classes|the school day|first period)\b/,
      /\b(stayed|stay|was|stuck) home( from school| today| all day)?\b/,
      /\b(home from school|out of school|left school early|went home early|sent home|came home early)\b/,
    ],
    no: [/\b(went|go|going|made it|got|was|been) (to |at )?school\b/],
  },
  headache: {
    yes: [/\b(headaches?|migraines?|head (hurt|hurts|hurting|ached|aches|aching|pain|was pounding|is pounding|pounding|throbbing))\b/],
  },
  bloodInStool: {
    yes: [/\b(blood|bloody|bleeding)\b/],
  },
  activityLimitation: {
    yes: [/\b(couldnt|could not|cant|unable to|had to stop|sat out|sit out|had to sit)( \w+){0,2} (play|run|do|gym|pe|sports?|practice|exercise|recess)\b/],
  },
};

function parseYesNo(q: TrackerQuestion, us: Unit[]): VoiceParsedAnswer {
  const dict = q.role ? YES_NO[q.role] : undefined;
  if (!dict) return answer(q.id, null, 'low');
  type Vote = { value: boolean; conf: Confidence; unit: Unit };
  const votes: Vote[] = [];
  for (const h of find(us, dict.yes)) {
    if (dict.context && !dict.context.test(h.part) && !dict.context.test(h.unit.norm)) continue;
    votes.push({ value: !h.negated, conf: 'high', unit: h.unit });
  }
  for (const h of find(us, dict.no ?? [])) votes.push({ value: h.negated, conf: 'medium', unit: h.unit });
  if (!votes.length) return answer(q.id, null, 'low');
  // A "yes" mention outweighs a "no" (e.g. "slept fine but woke up coughing once").
  const yes = votes.find((v) => v.value);
  const pick = yes ?? votes[votes.length - 1];
  const conflicting = votes.some((v) => v.value !== pick.value);
  return answer(q.id, pick.value ? 'true' : 'false', conflicting ? 'low' : pick.conf, ev(pick.unit));
}

// ───────────────────────────────── numbers ─────────────────────────────────

const INHALER_RE = /\b(rescue inhaler|inhaler|inhalers|puffer|puffers|albuterol|ventolin|proair|rescue med\w*|rescue|blue inhaler|nebulizer|nebuliser)\b/;

/** Count in a clause: "twice", "3 times", "a couple of times". */
function countIn(text: string): { n: number; conf: Confidence } | undefined {
  const hedged = HEDGE_RE.test(text);
  let m = text.match(/\b(once|twice|thrice)\b/);
  if (m) return { n: { once: 1, twice: 2, thrice: 3 }[m[1] as 'once' | 'twice' | 'thrice'], conf: hedged ? 'medium' : 'high' };
  m = text.match(new RegExp(`\\b(${NUMBER_WORD_RE}) (times|time|x)\\b`));
  if (m) {
    const n = wordToNumber(m[1]);
    if (n !== undefined) return { n, conf: hedged ? 'medium' : 'high' };
  }
  if (/\b(a )?couple (of )?times\b/.test(text)) return { n: 2, conf: 'low' };
  if (/\ba few times\b/.test(text)) return { n: 3, conf: 'low' };
  return undefined;
}

/** Hours mentions with their position: "6 hours", "an hour and a half", "half an hour", "45 minutes". */
function hoursIn(norm: string): { n: number; index: number; conf: Confidence }[] {
  const out: { n: number; index: number; conf: Confidence }[] = [];
  const hedged = HEDGE_RE.test(norm);
  const conf: Confidence = hedged ? 'medium' : 'high';
  const taken: [number, number][] = [];
  const add = (n: number, index: number, len: number) => {
    if (taken.some(([a, b]) => index < b && index + len > a)) return;
    taken.push([index, index + len]);
    out.push({ n: Math.round(n * 10) / 10, index, conf });
  };
  for (const m of norm.matchAll(/\b(an|one|a) hour and a half\b/g)) add(1.5, m.index, m[0].length);
  for (const m of norm.matchAll(new RegExp(`\\b(${NUMBER_WORD_RE}) and a half hours?\\b`, 'g'))) {
    const n = wordToNumber(m[1]);
    if (n !== undefined) add(n + 0.5, m.index, m[0].length);
  }
  for (const m of norm.matchAll(/\bhalf (an )?hour\b/g)) add(0.5, m.index, m[0].length);
  for (const m of norm.matchAll(new RegExp(`\\b(${NUMBER_WORD_RE}|an|a) (hours?|hrs?)\\b`, 'g'))) {
    const n = wordToNumber(m[1]);
    if (n !== undefined) add(n, m.index, m[0].length);
  }
  for (const m of norm.matchAll(new RegExp(`\\b(${NUMBER_WORD_RE}) (minutes?|mins?)\\b`, 'g'))) {
    const n = wordToNumber(m[1]);
    if (n !== undefined) add(n / 60, m.index, m[0].length);
  }
  return out.sort((a, b) => a.index - b.index);
}

const SLEEP_CTX = /\b(sleep|slept|sleeping|bed|nap|asleep)\b/;
const HEADACHE_CTX = /\b(headache|migraine|lasted|last|head|pain|hurt|hurts|ached|went away|gone)\b/;

/** Distance (chars) from the number to the closest context word in a ±45-char window, or Infinity. */
function ctxDistance(norm: string, index: number, len: number, re: RegExp): number {
  const from = Math.max(0, index - 45);
  const window = norm.slice(from, index + len + 45);
  let best = Infinity;
  for (const m of window.matchAll(new RegExp(re.source, 'g'))) {
    const pos = from + m.index;
    const d = pos < index ? index - (pos + m[0].length) : pos - (index + len);
    best = Math.min(best, Math.max(0, d));
  }
  return best;
}

function hoursFor(us: Unit[], kind: 'sleep' | 'duration'): { n: number; conf: Confidence; unit: Unit } | undefined {
  for (const u of us) {
    for (const h of hoursIn(u.norm)) {
      const sleepD = ctxDistance(u.norm, h.index, 6, SLEEP_CTX);
      const achD = ctxDistance(u.norm, h.index, 6, HEADACHE_CTX);
      if (sleepD === Infinity && achD === Infinity) continue;
      const isSleep = sleepD <= achD;
      if (kind === 'sleep' && isSleep) return { n: h.n, conf: h.conf, unit: u };
      if (kind === 'duration' && !isSleep) return { n: h.n, conf: h.conf, unit: u };
    }
  }
  return undefined;
}

function scaleIn(us: Unit[], q: TrackerQuestion): { n: number; conf: Confidence; unit: Unit } | undefined {
  for (const u of us) {
    let m = u.norm.match(new RegExp(`\\b(${NUMBER_WORD_RE}) ?(?:out of|outta|/) ?(10|ten)\\b`));
    if (m) {
      const n = wordToNumber(m[1]);
      if (n !== undefined) return { n, conf: HEDGE_RE.test(u.norm) ? 'medium' : 'high', unit: u };
    }
    m = u.norm.match(
      new RegExp(
        `\\b(pain|hurt|hurts|hurting|it|headache|migraine|belly|stomach|tummy|cramps?|level|scale|rate it|rated it|id say)\\b(?: \\w+){0,3}? (?:was|is|at|around|about|like|maybe|a|an)(?: (?:a|an|like|about|around|maybe|probably))* (${NUMBER_WORD_RE})\\b(?! (times|time|hours?|hrs?|minutes?|mins?|am|pm|days?|puffs?|stools?|oclock))`,
      ),
    );
    if (m) {
      const n = wordToNumber(m[2]);
      if (n !== undefined) return { n, conf: 'medium', unit: u };
    }
  }
  // "1 = none" scales: an explicit "no (belly) pain" maps to the minimum, with low confidence.
  if (q.min !== undefined && /=\s*none/i.test(q.text)) {
    const hit = find(us, [/\b(pain|hurt|hurts|hurting|ache|aches|cramps?|cramping)\b/]).find((h) => h.negated);
    if (hit) return { n: q.min, conf: 'low', unit: hit.unit };
  }
  return undefined;
}

const STOOL_RE = /\b(bathroom|poop|pooped|pooping|poo|bowel movements?|bms?|stools?|number two|toilet|diarrhea|diarrhoea|went to the toilet)\b/;

function parseNumber(q: TrackerQuestion, us: Unit[]): VoiceParsedAnswer {
  let found: { n: number; conf: Confidence; unit: Unit } | undefined;
  switch (q.role) {
    case 'rescueMedUse': {
      for (const h of find(us, [INHALER_RE])) {
        const unitCount = countIn(h.unit.norm);
        const c = countIn(h.part) ?? (unitCount && { n: unitCount.n, conf: minConf(unitCount.conf, 'medium') });
        if (c) found = { n: c.n, conf: c.conf, unit: h.unit };
        else if (h.negated) found = { n: 0, conf: 'high', unit: h.unit };
        else if (/\b(used|use|using|took|take|needed|need|had to use|puffs?)\b/.test(h.part)) found = { n: 1, conf: 'low', unit: h.unit };
        if (found) break;
      }
      break;
    }
    case 'headacheDurationHours':
      found = hoursFor(us, 'duration');
      break;
    case 'sleepHours':
      found = hoursFor(us, 'sleep');
      break;
    case 'stoolFrequency': {
      for (const u of us) {
        const m = u.norm.match(new RegExp(`\\b(${NUMBER_WORD_RE}) (bowel movements?|bms?|stools?|poops?)\\b`));
        if (m && wordToNumber(m[1]) !== undefined) {
          found = { n: wordToNumber(m[1])!, conf: HEDGE_RE.test(u.norm) ? 'medium' : 'high', unit: u };
          break;
        }
      }
      if (!found) {
        for (const h of find(us, [STOOL_RE])) {
          const c = countIn(h.part) ?? countIn(h.unit.norm);
          if (c) found = { n: c.n, conf: c.conf, unit: h.unit };
          else if (h.negated && /\b(poop|pooped|poo|bowel movements?|bms?|stools?|number two)\b/.test(h.part)) found = { n: 0, conf: 'medium', unit: h.unit };
          if (found) break;
        }
      }
      break;
    }
    case 'painSeverity':
    case 'symptomSeverity':
      found = scaleIn(us, q);
      break;
    default:
      if (q.type === 'scale1to10') found = scaleIn(us, q);
      else if (q.unit) {
        for (const u of us) {
          const m = u.norm.match(new RegExp(`\\b(${NUMBER_WORD_RE}) ${escapeRe(normalize(q.unit))}\\b`));
          if (m && wordToNumber(m[1]) !== undefined) {
            found = { n: wordToNumber(m[1])!, conf: 'medium', unit: u };
            break;
          }
        }
      }
  }
  if (!found) return answer(q.id, null, 'low');
  if ((q.min !== undefined && found.n < q.min) || (q.max !== undefined && found.n > q.max)) return answer(q.id, null, 'low');
  return answer(q.id, String(found.n), found.conf, ev(found.unit));
}

// ───────────────────────────────── feelings ─────────────────────────────────

type Tier = 'great' | 'good' | 'okay' | 'bad' | 'awful';
const TIER_SEVERITY: Record<Tier, number> = { great: 0, good: 0, okay: 1, bad: 2, awful: 3 };
/** Longest phrases first. Phrases carrying their own negation ("not great") are listed explicitly. */
const FEELING_PHRASES: [string, Tier][] = (
  [
    ['not bad at all', 'good'],
    ['could be better', 'okay'],
    ['been better', 'okay'],
    ['fine i guess', 'okay'],
    ['not too bad', 'okay'],
    ['not so bad', 'okay'],
    ['not that bad', 'okay'],
    ['not so good', 'bad'],
    ['not too good', 'bad'],
    ['not very good', 'bad'],
    ['not good', 'bad'],
    ['not well', 'bad'],
    ['not great', 'okay'],
    ['not bad', 'good'],
    ['really really good', 'great'],
    ['really good', 'great'],
    ['super good', 'great'],
    ['so good', 'great'],
    ['very good', 'great'],
    ['really well', 'great'],
    ['pretty good', 'good'],
    ['pretty well', 'good'],
    ['really bad', 'awful'],
    ['very bad', 'awful'],
    ['super bad', 'awful'],
    ['so bad', 'awful'],
    ['really sick', 'awful'],
    ['really rough', 'awful'],
    ['really crappy', 'awful'],
    ['like garbage', 'awful'],
    ['like trash', 'awful'],
    ['the worst', 'awful'],
    ['pretty bad', 'bad'],
    ['kind of bad', 'bad'],
    ['kinda bad', 'bad'],
    ['so so', 'okay'],
    ['all right', 'okay'],
    ['in between', 'okay'],
    ['great', 'great'],
    ['amazing', 'great'],
    ['awesome', 'great'],
    ['fantastic', 'great'],
    ['excellent', 'great'],
    ['perfect', 'great'],
    ['wonderful', 'great'],
    ['good', 'good'],
    ['fine', 'good'],
    ['well', 'good'],
    ['better', 'good'],
    ['nice', 'good'],
    ['happy', 'good'],
    ['okay', 'okay'],
    ['ok', 'okay'],
    ['alright', 'okay'],
    ['meh', 'okay'],
    ['average', 'okay'],
    ['decent', 'okay'],
    ['bad', 'bad'],
    ['rough', 'bad'],
    ['sick', 'bad'],
    ['crummy', 'bad'],
    ['lousy', 'bad'],
    ['crappy', 'bad'],
    ['unwell', 'bad'],
    ['sad', 'bad'],
    ['down', 'bad'],
    ['awful', 'awful'],
    ['terrible', 'awful'],
    ['horrible', 'awful'],
    ['miserable', 'awful'],
    ['dreadful', 'awful'],
  ] as [string, Tier][]
).sort((a, b) => b[0].length - a[0].length);

const FLIP: Record<Tier, Tier> = { great: 'okay', good: 'bad', okay: 'bad', bad: 'good', awful: 'okay' };
const FEEL_STRONG = /\b(feel|feeling|felt|feels)\b/;
const FEEL_WEAK = /\b(im|i am|i was|ive been|been|doing|day (was|is|has been)|today (was|is|has been)|overall|today)\b/;

function feelingIn(us: Unit[]): { tier: Tier; conf: Confidence; unit: Unit } | undefined {
  let last: { tier: Tier; conf: Confidence; unit: Unit } | undefined;
  for (const u of us) {
    for (const part of u.parts) {
      const strong = FEEL_STRONG.test(part);
      if (!strong && !FEEL_WEAK.test(part)) continue;
      let masked = part;
      for (const [phrase, tier] of FEELING_PHRASES) {
        const re = new RegExp(`\\b${escapeRe(phrase)}\\b`);
        const m = masked.match(re);
        if (!m) continue;
        // "bad cough", "good night", "slept well" are not feelings.
        const after = masked.slice(m.index! + m[0].length);
        if (/^ (cough|coughing|wheez\w*|headache|night|sleep|day for|news|at)/.test(after) && !strong) continue;
        if (/\bslept\s*$/.test(masked.slice(0, m.index))) continue;
        const own = phrase.startsWith('not ');
        const t = !own && negatedAt(masked, m.index!) ? FLIP[tier] : tier;
        last = { tier: t, conf: strong ? 'high' : 'medium', unit: u };
        masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + after;
        break;
      }
    }
  }
  return last;
}

function optionFor(options: QuestionOption[], tier: Tier): QuestionOption | undefined {
  const named = options.find((o) => normalize(o.value) === tier || normalize(o.label) === tier);
  if (named) return named;
  const sev = TIER_SEVERITY[tier];
  const same = options.filter((o) => o.severity === sev);
  if (same.length) return tier === 'good' ? same[same.length - 1] : same[0];
  const rated = options.filter((o) => o.severity !== undefined);
  if (!rated.length) return undefined;
  return rated.reduce((best, o) => (Math.abs(o.severity! - sev) < Math.abs(best.severity! - sev) ? o : best));
}

const FEELING_WORDS = new Set(FEELING_PHRASES.map(([p]) => p));

function parseChoice(q: TrackerQuestion, us: Unit[]): VoiceParsedAnswer {
  const options = q.options ?? [];
  // Direct option mention ("partly cloudy", "stormy") for distinctive labels.
  for (const o of options) {
    for (const name of new Set([normalize(o.value), normalize(o.label)])) {
      if (!name || FEELING_WORDS.has(name)) continue;
      const hit = find(us, [new RegExp(`\\b${escapeRe(name)}\\b`)]).find((h) => !h.negated);
      if (hit) return answer(q.id, o.value, name.includes(' ') ? 'high' : 'medium', ev(hit.unit));
    }
  }
  if (q.role !== 'overallFeeling') return answer(q.id, null, 'low');
  const f = feelingIn(us);
  if (!f) return answer(q.id, null, 'low');
  const o = optionFor(options, f.tier);
  return o ? answer(q.id, o.value, f.conf, ev(f.unit)) : answer(q.id, null, 'low');
}

// ───────────────────────────────── checkboxes ─────────────────────────────────

/** Synonyms per option (key = normalized option value). */
const OPTION_SYNONYMS: Record<string, RegExp[]> = {
  // Asthma symptoms
  coughing: [/\b(cough|coughs|coughing|coughed)\b/],
  wheezing: [/\b(wheeze|wheezes|wheezing|wheezed|wheezy|whistl\w* when i breathe|whistling)\b/],
  'tight chest': [/\bchest( \w+){0,2} (tight|tightness|squeez\w*|heavy|pressure)\b/, /\b(tight|tightness in|tightness of|pressure in) (my |the )?chest\b/, /\btight chest\b/],
  'shortness of breath': [
    /\b(short of breath|shortness of breath|out of breath|breathless|winded)\b/,
    /\b(hard|tough|difficult) to breathe\b/,
    /\b(trouble|difficulty|problems?) breathing\b/,
    /\b(catch|get) my breath\b/,
  ],
  'activity limitations': [
    /\b(couldnt|could not|cant|unable to|had to stop|sat out|sit out|had to sit out|had to take breaks)( \w+){0,3} (play|run|running|do|gym|pe|sports?|practice|exercise|recess|game|keep up)\b/,
    /\b(sat out|sit out|sitting out)\b/,
    /\bactivity limit\w*\b/,
  ],
  // IBD symptoms
  cramping: [/\b(cramp|cramps|cramping|crampy)\b/],
  urgency: [/\b(urgency|urgent|had to rush|rush to the (bathroom|toilet)|run to the (bathroom|toilet)|ran to the (bathroom|toilet)|couldnt hold it|barely made it)\b/],
  nausea: [/\b(nausea|nauseous|nauseated|queasy|sick to my stomach|felt like (throwing up|puking|vomiting)|like i (was|am) going to (throw up|puke))\b/],
  fatigue: [/\b(tired|fatigue|fatigued|exhausted|wiped out|worn out|no energy|low energy|sleepy|drained)\b/],
  'joint pain': [/\b(joint pain|joints? (hurt|hurts|ache|aches|achy|sore)|achy joints|(knees?|ankles?|wrists?|elbows?) (hurt|hurts|ache|aches|are sore))\b/],
  // Asthma triggers
  exercise: [/\b(exercise|exercising|gym|pe|p e|running|ran|run|soccer|basketball|football|sports?|practice|workout|working out|track|swim\w*|dance|recess)\b/],
  'cold air': [/\bcold (air|outside|weather|wind|morning|day)\b/, /\b(freezing|chilly)( outside| out)?\b/],
  pollen: [/\b(pollen|allergies|allergy|hay fever|grass|trees|flowers|ragweed|seasonal)\b/],
  smoke: [/\b(smoke|smoky|smoking|campfire|bonfire|cigarettes?|vape|vaping|fireplace|wildfire)\b/],
  pets: [/\b(dogs?|cats?|pets?|puppy|puppies|kittens?|hamsters?|rabbits?|horses?)\b/],
  'illness cold': [/\b(have|had|got|getting|caught|catching|has) (a |the )?(cold|flu|virus|bug|stomach bug)\b/, /\b(runny nose|stuffy nose|sore throat|fever|congested|sniffles)\b/],
  // Migraine triggers
  stress: [/\b(stress|stressed|stressful|anxious|anxiety|worried|nervous|test|tests|exam|exams|quiz|pressure)\b/],
  'poor sleep': [/\b(poor|bad|not enough|little|no|terrible) sleep\b/, /\b(didnt|couldnt|did not|could not) sleep( well| much| enough| at all)?\b/, /\bbarely slept\b/, /\bstayed up (late|all night)\b/, /\bslept (badly|poorly|late)\b/],
  'skipped meal': [/\b(skipped|skip|missed|forgot) (my )?(breakfast|lunch|dinner|a meal|meals|eating)\b/, /\b(didnt|did not) eat( breakfast| lunch| dinner| anything)?\b/, /\bforgot to eat\b/],
  'screen time': [/\b(screens?|phone|video games?|gaming|computer|tablet|ipad|tv|television|laptop|tiktok|youtube)\b/],
  'bright light': [/\b(bright lights?|sunlight|sun|glare|flashing lights?|lights were bright)\b/],
  'weather change': [/\b(weather|storm|stormy|rain|rainy|barometric|humid|humidity)\b/],
  dehydration: [/\b(dehydrated|dehydration|thirsty)\b/, /\b(didnt|did not|forgot to|not enough) (drink|water)( enough| much)?( water)?\b/, /\bnot enough water\b/],
};

const NONE_BY_ROLE: Partial<Record<NonNullable<TrackerQuestion['role']>, RegExp[]>> = {
  symptoms: [
    /\b(no|zero|not any|dont have any|didnt have any|havent had any|not having any|havent got any|without any) ((asthma|tummy|stomach|belly|ibd|real) )?symptoms\b/,
    /\bnone of (these|those|them|the symptoms)\b/,
    /\bno (problems|issues) (at all|today)\b/,
    /\bsymptom free\b/,
  ],
  triggers: [/\b(no|zero|not any|didnt have any|dont have any) triggers?\b/, /\bnothing (really )?(triggered|set) (it|them|me|anything) (off)?\b/, /\bnothing triggered\b/, /\bno triggers\b/],
};

function parseCheckbox(q: TrackerQuestion, us: Unit[]): VoiceParsedAnswer {
  const options = q.options ?? [];
  const none = options.find((o) => o.isNone);
  const picked: { o: QuestionOption; conf: Confidence; unit: Unit }[] = [];
  for (const o of options) {
    if (o.isNone) continue;
    const key = normalize(o.value);
    const labelRe = new RegExp(`\\b${escapeRe(normalize(o.label))}\\b`);
    const syn = OPTION_SYNONYMS[key] ?? OPTION_SYNONYMS[normalize(o.label)] ?? [];
    const hits = [...find(us, [labelRe]).map((h) => ({ h, conf: 'high' as Confidence })), ...find(us, syn).map((h) => ({ h, conf: 'medium' as Confidence }))];
    const positive = hits.find((x) => !x.h.negated);
    if (positive) picked.push({ o, conf: q.role === 'triggers' ? minConf(positive.conf, 'medium') : positive.conf, unit: positive.h.unit });
  }
  if (picked.length) {
    const conf = picked.map((p) => p.conf).reduce(minConf);
    const evidence = [...new Set(picked.map((p) => ev(p.unit)))].join(' … ');
    return answer(q.id, JSON.stringify(picked.map((p) => p.o.value)), conf, truncate(evidence, 160));
  }
  const nonePatterns = (q.role && NONE_BY_ROLE[q.role]) ?? [];
  if (none && nonePatterns.length) {
    const hit = find(us, nonePatterns)[0];
    if (hit) return answer(q.id, JSON.stringify([none.value]), 'high', ev(hit.unit));
  }
  return answer(q.id, null, 'low');
}

// ───────────────────────────────── entry point ─────────────────────────────────

/** Rule-based extraction: one answer per question, in question order. */
export function ruleExtract(tracker: TrackerDefinition, transcript: string): VoiceParsedAnswer[] {
  const us = units(transcript);
  return [...tracker.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => {
      switch (q.type) {
        case 'yesNo':
          return parseYesNo(q, us);
        case 'number':
        case 'scale1to10':
          return parseNumber(q, us);
        case 'faceScale':
        case 'iconChoice':
        case 'singleChoice':
          return parseChoice(q, us);
        case 'checkbox':
          return parseCheckbox(q, us);
        default:
          return answer(q.id, null, 'low'); // spirometry (device), free text
      }
    });
}
