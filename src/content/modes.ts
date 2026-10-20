// Game modes as the menu presents them (Update 5). One shared definition so the main menu,
// Play screen, results and records describe modes the same way.
import type { ModeId } from './types';
import type { SaveData } from '../save';

export interface ModeDef {
  id: ModeId;
  name: string;
  /** One-sentence objective shown beside the Play button. */
  objective: string;
  /** Expected duration, shown beside the Play button. */
  duration: string;
  /** Short label for compact mode choices. */
  short: string;
  /** Null when available; otherwise the reason it is locked (shown to the player). */
  locked: (save: SaveData) => string | null;
}

/** Full Rush flights needed before Aether Ascent opens (keeps the first session focused). */
export const ASCENT_UNLOCK_FLIGHTS = 2;

export const MODES: Record<ModeId, ModeDef> = {
  rush: {
    id: 'rush',
    name: 'Dragon Rush',
    short: 'Rush',
    objective: 'Fly through the sky, break treasure and gather Emberfruit for your dragons.',
    duration: '60 s',
    locked: () => null,
  },
  trials: {
    id: 'trials',
    name: 'Sky Trials',
    short: 'Trials',
    objective: 'Race designed courses through rings for Bronze, Silver and Gold medals.',
    duration: '1–2 min',
    locked: () => null,
  },
  arena: {
    id: 'arena',
    name: 'Dragon Arena',
    short: 'Arena',
    objective: 'Survive four waves, pick upgrades and defeat the Stormcrown Wyrm.',
    duration: '≈ 4 min',
    locked: () => null,
  },
  ascent: {
    id: 'ascent',
    name: 'Aether Ascent',
    short: 'Ascent',
    objective: 'Fly as far as you can through shifting skyways: dodge hazards, choose upgrades, survive the storm.',
    duration: 'Endless',
    locked: (s) => (s.lifetime.flights >= ASCENT_UNLOCK_FLIGHTS ? null : `Unlocks after ${ASCENT_UNLOCK_FLIGHTS} full Rush flights (${s.lifetime.flights}/${ASCENT_UNLOCK_FLIGHTS})`),
  },
};

export const MODE_ORDER: ModeId[] = ['rush', 'ascent', 'arena', 'trials'];

/** The mode the main Play button should start: the last one played if still available, else Rush. */
export function menuMode(save: SaveData): ModeId {
  const m = save.prefs.lastMode;
  return MODES[m] && !MODES[m].locked(save) ? m : 'rush';
}
