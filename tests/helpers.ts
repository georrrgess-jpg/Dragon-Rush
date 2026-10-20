import type { RegionId, SpeciesId } from '../src/content/types';
import type { TalentId } from '../src/content/progression';
import { FlightSim, type TrialCourseData } from '../src/sim/flight';
import { flightStats } from '../src/stats';

export interface SimOpts {
  level?: number;
  seed?: number;
  region?: RegionId;
  mode?: 'rush' | 'trials';
  runSeconds?: number;
  course?: TrialCourseData;
  talents?: { t10: TalentId | null; t20: TalentId | null };
}

/** Builds a FlightSim the same way the game does (species stats for the mode). */
export function makeSim(species: SpeciesId = 'ember', o: SimOpts = {}): FlightSim {
  const mode = o.mode ?? (o.course ? 'trials' : 'rush');
  return new FlightSim({
    stats: flightStats({ species, level: o.level ?? 1, talents: o.talents ?? { t10: null, t20: null } }, mode),
    seed: o.seed ?? 1,
    region: o.region,
    mode,
    runSeconds: o.runSeconds,
    course: o.course,
  });
}
