/** Friendly "Here's what to tell us" prompts for speak mode, built from any tracker's questions. */
import type { TrackerDefinition, TrackerQuestion } from '@shared/types/tracker';
import { sortedQuestions } from './encode';

const ROLE_PROMPT: Partial<Record<NonNullable<TrackerQuestion['role']>, string>> = {
  overallFeeling: "How you're feeling today",
  nightWaking: 'Did you wake up at night?',
  missedSchool: 'Did you miss school?',
  activityLimitation: 'Did it stop you doing things?',
  rescueMedUse: 'How many times you used your rescue inhaler',
  headache: 'Did you have a headache?',
  headacheDurationHours: 'How many hours it lasted',
  painSeverity: 'How bad the pain was, from 1 to 10',
  symptomSeverity: 'How bad it was, from 1 to 10',
  stoolFrequency: 'How many times you pooped today',
  bloodInStool: 'Did you see any blood?',
  sleepHours: 'How many hours you slept',
};

function listLabels(q: TrackerQuestion, max = 3): string {
  const labels = (q.options ?? []).filter((o) => !o.isNone).map((o) => o.label.toLowerCase());
  if (!labels.length) return '';
  return ` (${labels.slice(0, max).join(', ')}${labels.length > max ? '…' : ''})`;
}

export function promptFor(q: TrackerQuestion): string | null {
  if (q.type === 'spirometry') return null; // done with the device, not by voice
  if (q.role === 'symptoms') return `Any symptoms${listLabels(q)}`;
  if (q.role === 'triggers') return `What might have set it off${listLabels(q)}`;
  if (q.role && ROLE_PROMPT[q.role]) return ROLE_PROMPT[q.role]!;
  if (q.type === 'checkbox') return `${q.shortLabel}${listLabels(q)}`;
  if (q.type === 'text') return 'Anything else you want your care team to know';
  return q.text.replace(/\s*\(.*\)\s*$/, '');
}

export function speakPrompts(t: TrackerDefinition): string[] {
  return sortedQuestions(t)
    .map(promptFor)
    .filter((x): x is string => !!x);
}

const EXAMPLES: Record<string, string> = {
  asthma:
    '"I\'m feeling okay. I\'ve been coughing a bit and my chest feels tight. I didn\'t wake up at night, I went to school, and I used my rescue inhaler twice."',
  migraine: '"I had a headache after lunch, about a 6 out of 10. It lasted 3 hours. I think screen time set it off. I slept 7 hours."',
  ibd: '"I went 4 times today, no blood. My belly pain was about a 3. I felt tired but I went to school."',
};

export function exampleSentence(t: TrackerDefinition): string {
  return EXAMPLES[t.condition] ?? '"Today I felt okay. My symptoms were mild and I went to school."';
}
