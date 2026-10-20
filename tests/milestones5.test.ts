import { describe, expect, it } from 'vitest';
import { MILESTONES } from '../src/content/world';
import { milestoneValue } from '../src/economy';
import { defaultSave } from '../src/save';

describe('Update 5 milestones', () => {
  it('measure Ascent records (standard rules only) and collection breadth', () => {
    const s = defaultSave();
    expect(milestoneValue(s, 'rarityTiers')).toBe(1); // the starter is Common
    s.dragons.cinder.owned = true;
    s.dragons.orchid.owned = true;
    s.dragons.leviara.owned = true;
    expect(milestoneValue(s, 'rarityTiers')).toBe(4);
    expect(milestoneValue(s, 'legendaries')).toBe(1);
    s.ascent.bestAssist = 5000;
    expect(milestoneValue(s, 'ascentBest')).toBe(0);
    s.ascent.best = 1200;
    s.ascent.runs = 3;
    expect(milestoneValue(s, 'ascentBest')).toBe(1200);
    expect(milestoneValue(s, 'ascentRuns')).toBe(3);
  });

  it('use existing reward currencies only', () => {
    for (const m of MILESTONES.filter((x) => ['ascent-first', 'ascent-1000', 'ascent-3000', 'rarity-all', 'legend-2'].includes(x.id))) {
      expect(Object.keys(m.reward).every((k) => ['keys', 'essence', 'gold', 'fruit'].includes(k))).toBe(true);
    }
  });
});
