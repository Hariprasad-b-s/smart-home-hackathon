/**
 * Deterministic red-flag screen. Runs on EVERY patient chat message and voice transcript, BEFORE
 * any model call, so emergencies never depend on the AI being available or behaving.
 *
 * Matching is case-insensitive and punctuation-tolerant (see normalize(): "can't" → "cant").
 * Breathing triggers ignore matches preceded by a negator ("I'm not struggling to breathe").
 * Self-harm language is never negation-filtered: a false alarm is far cheaper than a miss.
 */
import type { SafetyNotice } from '../../shared/types/api';
import { normalize } from './text';

export interface SafetyHit {
  notice: SafetyNotice;
  /** Stable trigger id, e.g. "breathing", "self-harm". */
  trigger: string;
  /** Short clinician-facing label, e.g. "Can't breathe / struggling to breathe". */
  label: string;
}

interface Rule {
  trigger: string;
  label: string;
  level: SafetyNotice['level'];
  message: string;
  /** Any pattern matching (on normalized text) fires the rule. */
  patterns: RegExp[];
  /** Additional pattern that must ALSO match somewhere in the text. */
  requires?: RegExp;
  /** Skip a match when a negator sits just before it. */
  negatable?: boolean;
}

const CALL_911 = 'Call 911 or have an adult call right now. Don’t wait for a reply here.';
const INHALER = '(?:rescue inhaler|inhaler|puffer|albuterol|ventolin|proair|nebuli[sz]er|rescue med(?:icine|ication)?s?|rescue)';
const BREATH_CONTEXT = /\b(breath|breathe|breathing|asthma|wheez\w*|air|chest)\b/;
const HEADACHE = /\b(headache|migraine|head (?:hurts?|hurting|is pounding|pain|ache))\b/;

const RULES: Rule[] = [
  // ── Emergency ──────────────────────────────────────────────────────────────
  {
    trigger: 'self-harm',
    label: 'Self-harm or suicidal language',
    level: 'emergency',
    message:
      'I’m really glad you told me, and you deserve support right now. Please call or text 988 (Suicide & Crisis Lifeline) or call 911 now, and tell a trusted adult near you. You are not alone.',
    patterns: [
      /\b(kill|killing|hurt|hurting|harm|harming|cut|cutting) (myself|my self)\b/,
      /\bself (harm|harming|injury)\b/,
      /\bsuicid\w*\b/,
      /\b(end|ending|take|taking) (my|my own) life\b/,
      /\b(want|wanna|going|gonna|wish i could|ready) (to )?die\b/,
      /\bwish i (was|were) dead\b/,
      /\bbetter off dead\b/,
      /\b(dont|do not) want to (be alive|live|exist|wake up|be here anymore)\b/,
      /\bno reason to live\b/,
      /\bend it all\b/,
    ],
  },
  {
    trigger: 'breathing',
    label: 'Can’t breathe / struggling to breathe',
    level: 'emergency',
    message: `Not being able to breathe is an emergency. Use your rescue inhaler now if you have it. ${CALL_911}`,
    negatable: true,
    patterns: [
      /\b(cant|cannot|can not|couldnt|could not|unable to|struggling to|struggle to|struggled to|fighting to|hardly|barely) (even |really |properly |at all )?breathe?\b/,
      /\b(cant|cannot|can not|unable to) (get|catch|take) (a |my )?(breath|air)\b/,
      /\b(gasping|gasp) (for|to get) (air|breath)\b/,
      /\b(really|very|so|super|extremely) (hard|difficult) to breathe\b/,
      /\bstruggling (for|to get) (air|breath)\b/,
      /\bcant breath\b/,
    ],
  },
  {
    trigger: 'blue-lips',
    label: 'Blue or gray lips / fingernails',
    level: 'emergency',
    message: `Blue or gray lips or fingernails mean your body isn’t getting enough air. Use your rescue inhaler now. ${CALL_911}`,
    negatable: true,
    patterns: [
      /\b(lips?|fingernails?|nails|fingertips|mouth)\b(?: \w+){0,4} (blue|gray|grey|purple|bluish|greyish|grayish)\b/,
      /\b(blue|gray|grey|purple|bluish|grayish|greyish) (lips?|fingernails?|nails|fingertips)\b/,
    ],
  },
  {
    trigger: 'cant-talk-walk',
    label: 'Can’t talk or walk because of breathing',
    level: 'emergency',
    message: `If you can’t talk or walk because of your breathing, that is an emergency. Use your rescue inhaler now. ${CALL_911}`,
    negatable: true,
    requires: BREATH_CONTEXT,
    patterns: [
      /\b(cant|cannot|can not|couldnt|could not|unable to|hard to|too out of breath to|too breathless to) (talk|speak|walk|say a full sentence|finish (a|my) sentences?|get words out)\b/,
    ],
  },
  {
    trigger: 'fainting',
    label: 'Fainting / passing out',
    level: 'emergency',
    message: `Fainting or passing out is an emergency. Lie down somewhere safe and get an adult. ${CALL_911}`,
    negatable: true,
    patterns: [/\b(fainted|fainting|faints|(feel|felt|feeling|going to|gonna|about to) faint|passed out|pass out|passing out|blacked out|black out|lost consciousness|unconscious|keeled over)\b/],
  },
  {
    trigger: 'seizure',
    label: 'Seizure',
    level: 'emergency',
    message: `A seizure is an emergency. Get an adult right now. ${CALL_911}`,
    negatable: true,
    patterns: [/\b(seizure|seizures|seizing|convulsion|convulsions|convulsing)\b/],
  },
  {
    trigger: 'chest-pain',
    label: 'Severe chest pain',
    level: 'emergency',
    message: `Severe chest pain is an emergency. Stop what you are doing and get an adult. ${CALL_911}`,
    negatable: true,
    patterns: [
      /\b(severe|really bad|very bad|terrible|crushing|intense|extreme|horrible|awful|worst|unbearable|stabbing)( \w+){0,2} chest (pain|hurts?|ache)\b/,
      /\bchest (pain|hurts?|is hurting)( is| was| feels| so| really| very)* (severe|really bad|so bad|very bad|terrible|crushing|intense|unbearable|awful)\b/,
      /\bchest (pain|hurts?)( \w+){0,3} (crushing|squeezing so hard)\b/,
    ],
  },

  // ── Urgent ─────────────────────────────────────────────────────────────────
  {
    trigger: 'rescue-not-helping',
    label: 'Rescue inhaler not helping',
    level: 'urgent',
    message:
      'When your rescue inhaler isn’t helping, that’s a warning sign. Follow the red zone steps in your action plan, tell an adult now, and call your care team. If you’re struggling to breathe, call 911.',
    patterns: [
      new RegExp(`\\b${INHALER}\\b(?: \\w+){0,6} (not|isnt|doesnt|didnt|wasnt|arent|wont|stopped|no longer|never)( \\w+){0,2} (help|helping|helped|work|working|worked|do anything|doing anything)\\b`),
      new RegExp(`\\b(not|isnt|doesnt|didnt|wasnt|stopped)( \\w+){0,2} (help|helping|helped|working|worked)\\b(?: \\w+){0,6} ${INHALER}\\b`),
      new RegExp(`\\b${INHALER}\\b(?: \\w+){0,3} (is |was )?(useless|not doing anything|not doing much)\\b`),
    ],
  },
  {
    trigger: 'rescue-frequent',
    label: 'Rescue inhaler needed more than every 4 hours',
    level: 'urgent',
    message:
      'Needing your rescue inhaler more often than every 4 hours is a warning sign. Follow your action plan, tell an adult now, and call your care team today. If you’re struggling to breathe, call 911.',
    requires: new RegExp(`\\b${INHALER}\\b|\\bpuffs?\\b`),
    patterns: [
      /\bevery (hour|half hour|30 minutes|20 minutes|few minutes|couple (of )?hours|hour or two|1 hours?|2 hours|3 hours|one hour|two hours|three hours)\b/,
      /\bmore (often )?than every (4|four) hours\b/,
      new RegExp(`\\b${INHALER}\\b(?: \\w+){0,4} (6|7|8|9|10|11|12|six|seven|eight|nine|ten|eleven|twelve|\\d{2}) times\\b`),
      /\b(6|7|8|9|10|11|12|six|seven|eight|nine|ten|eleven|twelve) times\b(?: \w+){0,4} (inhaler|puffer|albuterol|rescue)\b/,
    ],
  },
  {
    trigger: 'gi-bleeding',
    label: 'Lots of blood in stool or black stool',
    level: 'urgent',
    message:
      'A lot of blood in your poop, or black poop, needs to be checked today. Tell an adult now and call your care team. If you feel faint or dizzy, call 911.',
    negatable: true,
    patterns: [
      /\b(lots of|a lot of|so much|too much|tons of|a ton of|a bunch of|large amount of|big amount of|really bloody|very bloody|full of|filled with|mostly) blood\b/,
      /\b(toilet|bowl|water) (was |is |turned |went )?(full of |all |bright )?(red|bloody)\b/,
      /\bblack (stool|stools|poop|poo|bowel movements?|tarry)\b/,
      /\b(stool|stools|poop|poo)( \w+){0,3} (black|tarry|like tar)\b/,
      /\btarry (stool|stools|poop)\b/,
    ],
  },
  {
    trigger: 'worst-headache',
    label: '“Worst headache of my life”',
    level: 'urgent',
    message:
      'A headache like that needs to be checked right away. Tell an adult now and call your care team or go to the emergency room. Call 911 if you can’t stay awake, can’t move part of your body, or have trouble talking.',
    patterns: [/\bworst (headache|migraine|head pain)( \w+){0,2} (of my life|ever|ive ever had|i have ever had|i ever had|in my life)\b/, /\bworst (headache|migraine) of (my )?life\b/],
  },
  {
    trigger: 'headache-neuro',
    label: 'Headache with vision loss, weakness, confusion or stiff neck + fever',
    level: 'urgent',
    message:
      'A headache with these signs needs to be checked right away. Tell an adult now and call your care team or go to the emergency room. Call 911 if it gets worse, you can’t stay awake, or you can’t move part of your body.',
    requires: HEADACHE,
    patterns: [
      /\b(lost|losing|loss of|lose) (my |some |part of my )?(vision|sight|eyesight)\b/,
      /\bvision (loss|went (black|dark|away|out)|is (gone|black|dark)|was (gone|black|dark))\b/,
      /\b(cant|couldnt|cannot|could not) see( anything| out of| at all)\b/,
      /\bwent blind\b|\bblind in\b/,
      /\b(weak|weakness|numb|numbness|tingly|cant move|couldnt move)( \w+){0,2} (on one side|one side|my (left|right)|arm|arms|leg|legs|hand|face)\b/,
      /\bone side of my (body|face)( \w+){0,2} (weak|numb|droop\w*)\b/,
      /\b(arm|arms|leg|legs|hand|face|one side|side of my body)( \w+){0,2} (weak|numb|tingly|droop\w*|wont move|cant move)\b/,
      /\b(confused|confusion|disoriented|cant think straight|cant remember where|dont know where i am)\b/,
      /\b(stiff neck|neck (is |was |feels |felt )?(really |so |very )?stiff|cant bend my neck)\b(?=.*\b(fever|temperature|feverish|temp)\b)/,
      /\b(fever|temperature|feverish)\b(?=.*\b(stiff neck|neck (is |was |feels |felt )?(really |so |very )?stiff)\b)/,
    ],
  },
  {
    trigger: 'cant-keep-fluids',
    label: 'Vomiting and unable to keep fluids down',
    level: 'urgent',
    message:
      'Throwing up and not keeping fluids down can make you dehydrated. Tell an adult and call your care team today. If you feel very dizzy, confused or faint, call 911.',
    negatable: true,
    patterns: [
      /\b(cant|cannot|can not|couldnt|could not|unable to|not able to|wont) (keep|hold) (anything|any water|water|fluids|liquids|drinks|food|it|stuff|nothing) down\b/,
      /\b(throwing|threw|throw) up (everything|every time i (drink|eat)|all my water|all the water)\b/,
      /\b(vomit\w*|puk\w*|throwing up)\b(?: \w+){0,6} every time i (drink|eat)\b/,
    ],
  },
];

const NEGATION_BEFORE = /\b(no|not|never|dont|didnt|doesnt|isnt|wasnt|arent|werent|havent|hasnt|without|no longer|nobody)\s*$/;

function matches(rule: Rule, norm: string): boolean {
  if (rule.requires && !rule.requires.test(norm)) return false;
  for (const re of rule.patterns) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of norm.matchAll(g)) {
      if (!rule.negatable) return true;
      const before = norm.slice(Math.max(0, m.index - 40), m.index).split(' ').slice(-4).join(' ');
      if (!NEGATION_BEFORE.test(before.trimEnd()) && !/\b(not|no|never|dont|didnt|isnt|wasnt)\b(?: \w+){0,2}$/.test(before.trimEnd())) return true;
    }
  }
  return false;
}

/** All red flags found, most severe first (emergency before urgent, then rule order). */
export function safetyHits(text: string): SafetyHit[] {
  const norm = normalize(text ?? '');
  if (!norm) return [];
  return RULES.filter((r) => matches(r, norm)).map((r) => ({
    notice: { level: r.level, message: r.message },
    trigger: r.trigger,
    label: r.label,
  }));
}

/** Most severe red flag, if any. */
export function safetyCheck(text: string): SafetyHit | undefined {
  return safetyHits(text)[0];
}

/** Deterministic safety screen: `SafetyNotice | undefined`. */
export function safetyScreen(text: string): SafetyNotice | undefined {
  return safetyCheck(text)?.notice;
}
