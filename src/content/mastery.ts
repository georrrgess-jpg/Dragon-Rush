// Three mastery challenges per species, built from shared templates and tailored to each
// species' role. Progress comes from per-dragon counters (counted from when the dragon is
// owned), so nothing needs exact timing or grinding a single run. Rewards are cosmetic.
import { SPECIES, SPECIES_LIST } from './species';
import type { SpeciesId } from './types';

export type MasteryStat = 'abilityUses' | 'containers' | 'pickups' | 'cleanFlights' | 'rings' | 'kills' | 'fruitCollected' | 'elites' | 'bestTrialMedal';

export interface MasteryDef {
  id: string;
  species: SpeciesId;
  index: 1 | 2 | 3;
  title: string;
  stat: MasteryStat;
  target: number;
  /** Modes where progress can be made (shown in the UI). */
  modes: string;
  reward: { kind: 'abilityVariant' } | { kind: 'marking' } | { kind: 'title'; title: string };
  rewardText: string;
}

type Role = 'container' | 'collect' | 'fruit' | 'defense' | 'air' | 'burst';

const ROLE: Record<SpeciesId, Role> = {
  ember: 'container', cinder: 'container', pyrelisk: 'defense', solpyre: 'burst',
  tide: 'collect', ripple: 'defense', abyssfin: 'collect', leviara: 'burst',
  grove: 'fruit', bramble: 'container', orchid: 'collect', rootwarden: 'defense',
  gale: 'air', zephyr: 'air', cloudtail: 'collect', tempest: 'air',
  rime: 'defense', snowcap: 'defense', frostfang: 'container', glacielle: 'burst',
  spark: 'burst', voltwing: 'collect', thundercrest: 'burst', astralux: 'air',
};

const ROLE_CHALLENGE: Record<Role, { stat: MasteryStat; target: number; text: (n: string) => string; modes: string }> = {
  container: { stat: 'containers', target: 40, text: (n) => `Break 40 containers with ${n}`, modes: 'Rush, Trials' },
  collect: { stat: 'pickups', target: 600, text: (n) => `Collect 600 pickups with ${n}`, modes: 'Rush, Arena' },
  fruit: { stat: 'fruitCollected', target: 300, text: (n) => `Collect 300 Emberfruit with ${n}`, modes: 'Rush, Arena' },
  defense: { stat: 'cleanFlights', target: 5, text: (n) => `Finish 5 Rush flights with ${n} hitting at most 1 rock`, modes: 'Rush' },
  air: { stat: 'rings', target: 40, text: (n) => `Fly through 40 wind rings with ${n}`, modes: 'Rush (Canyon, Storm), Trials' },
  burst: { stat: 'kills', target: 150, text: (n) => `Defeat 150 Arena enemies with ${n}`, modes: 'Arena' },
};

function build(): MasteryDef[] {
  const out: MasteryDef[] = [];
  for (const s of SPECIES_LIST) {
    const role = ROLE_CHALLENGE[ROLE[s.id]];
    const arenaFinal = s.rarity === 'epic' || s.rarity === 'legendary';
    out.push(
      {
        id: `${s.id}.m1`,
        species: s.id,
        index: 1,
        title: `Use ${s.active.name} 15 times`,
        stat: 'abilityUses',
        target: 15,
        modes: 'Any mode except practice',
        reward: { kind: 'abilityVariant' },
        rewardText: `Alternate ${s.active.name} color`,
      },
      {
        id: `${s.id}.m2`,
        species: s.id,
        index: 2,
        title: role.text(s.name),
        stat: role.stat,
        target: role.target,
        modes: role.modes,
        reward: { kind: 'marking' },
        rewardText: 'Radiant markings',
      },
      arenaFinal
        ? {
            id: `${s.id}.m3`,
            species: s.id,
            index: 3,
            title: `Defeat an Arena elite with ${s.name}`,
            stat: 'elites',
            target: 1,
            modes: 'Arena',
            reward: { kind: 'title', title: s.masteryTitle },
            rewardText: `Title: “${s.masteryTitle}”`,
          }
        : {
            id: `${s.id}.m3`,
            species: s.id,
            index: 3,
            title: `Earn a Silver Sky Trial medal with ${s.name}`,
            stat: 'bestTrialMedal',
            target: 2,
            modes: 'Sky Trials (not practice)',
            reward: { kind: 'title', title: s.masteryTitle },
            rewardText: `Title: “${s.masteryTitle}”`,
          },
    );
  }
  return out;
}

export const MASTERY: MasteryDef[] = build();
export const MASTERY_BY_SPECIES: Record<SpeciesId, MasteryDef[]> = Object.fromEntries(
  Object.keys(SPECIES).map((id) => [id, MASTERY.filter((m) => m.species === id)]),
) as Record<SpeciesId, MasteryDef[]>;
/** Completing all three of a species' mastery challenges grants this many Aether Keys once. */
export const MASTERY_COMPLETE_KEYS = 1;
