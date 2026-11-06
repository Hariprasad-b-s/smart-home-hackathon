import { describe, expect, it } from 'vitest';
import { safetyCheck, safetyScreen } from './safety';

const trigger = (t: string) => safetyCheck(t)?.trigger;
const level = (t: string) => safetyScreen(t)?.level;

describe('safety screen: emergencies', () => {
  it.each([
    ["I can't breathe", 'breathing'],
    ['i cant breathe!!', 'breathing'],
    ['I CANNOT BREATHE RIGHT NOW', 'breathing'],
    ["I'm struggling to breathe", 'breathing'],
    ['it is really hard to breathe', 'breathing'],
    ['gasping for air', 'breathing'],
    ["can't catch my breath at all", 'breathing'],
    ['my lips are turning blue', 'blue-lips'],
    ['my fingernails look gray', 'blue-lips'],
    ['blue lips', 'blue-lips'],
    ["I can't talk because I'm so out of breath", 'cant-talk-walk'],
    ['too out of breath to walk', 'cant-talk-walk'],
    ['I passed out at school', 'fainting'],
    ['I feel like I am going to faint', 'fainting'],
    ['I think I had a seizure', 'seizure'],
    ['really bad chest pain', 'chest-pain'],
    ['my chest pain is severe', 'chest-pain'],
  ])('%s → %s', (text, id) => {
    expect(trigger(text)).toBe(id);
    expect(level(text)).toBe('emergency');
  });

  it.each(['I want to kill myself', 'i wanna die', "I don't want to be alive anymore", 'thinking about suicide', 'I keep hurting myself', 'I want to end my life'])(
    'self-harm language: %s',
    (text) => {
      const hit = safetyCheck(text);
      expect(hit?.trigger).toBe('self-harm');
      expect(hit?.notice.level).toBe('emergency');
      expect(hit?.notice.message).toMatch(/988/);
      expect(hit?.notice.message).toMatch(/911/);
      expect(hit?.notice.message).toMatch(/trusted adult/);
    },
  );

  it('emergency outranks urgent when both appear', () => {
    expect(safetyCheck("my inhaler isn't helping and I can't breathe")?.trigger).toBe('breathing');
  });
});

describe('safety screen: urgent', () => {
  it.each([
    ["My inhaler isn't helping", 'rescue-not-helping'],
    ['the puffer is not working', 'rescue-not-helping'],
    ['albuterol didnt help at all', 'rescue-not-helping'],
    ['I need my inhaler every 2 hours', 'rescue-frequent'],
    ['used my rescue inhaler every hour today', 'rescue-frequent'],
    ['I used my inhaler 8 times today', 'rescue-frequent'],
    ['there was a lot of blood in my poop', 'gi-bleeding'],
    ['my stool was black', 'gi-bleeding'],
    ['black poop this morning', 'gi-bleeding'],
    ['worst headache of my life', 'worst-headache'],
    ['this is the worst headache ever', 'worst-headache'],
    ["bad headache and I can't see out of one eye", 'headache-neuro'],
    ['migraine and my left arm feels weak', 'headache-neuro'],
    ['headache, stiff neck and a fever', 'headache-neuro'],
    ['I have a headache and I feel confused', 'headache-neuro'],
    ["I keep throwing up and can't keep anything down", 'cant-keep-fluids'],
    ["vomiting, can't keep water down", 'cant-keep-fluids'],
  ])('%s → %s', (text, id) => {
    expect(trigger(text)).toBe(id);
    expect(level(text)).toBe('urgent');
  });

  it('messages are plain and say what to do', () => {
    const n = safetyScreen("my inhaler isn't helping")!;
    expect(n.message).toMatch(/action plan/);
    expect(n.message).toMatch(/care team/);
  });
});

describe('safety screen: negatives', () => {
  it.each([
    'I can breathe fine',
    "I'm breathing fine today",
    "I'm not struggling to breathe",
    'a little short of breath during gym',
    'it was kind of hard to breathe when I ran',
    'my lips are chapped',
    'my inhaler helped a lot',
    'the inhaler is working great',
    'I used my inhaler twice today',
    "I didn't pass out",
    'no seizures',
    'a little blood on the toilet paper',
    'no blood today',
    'I had a headache for 2 hours',
    'my neck is stiff from sleeping weird',
    'I threw up once but kept water down after',
    "I can't talk right now, I'm in class",
    'that test killed me',
    '',
  ])('no flag: %s', (text) => {
    expect(safetyScreen(text)).toBeUndefined();
  });

  it('is punctuation- and case-tolerant', () => {
    expect(trigger('CAN’T   BREATHE...')).toBe('breathing');
    expect(trigger('my lips-are BLUE')).toBe('blue-lips');
  });
});
