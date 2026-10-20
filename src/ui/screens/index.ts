import type { Screen, Tab, UI } from '../types';
import { DragonsScreen } from './dragons';
import { HatcheryScreen } from './hatchery';
import { HomeScreen } from './home';
import { JournalScreen } from './journal';
import { PlayScreen } from './play';

export function createScreen(tab: Tab, ui: UI, arg?: string): Screen {
  switch (tab) {
    case 'home':
      return new HomeScreen(ui);
    case 'play':
      return new PlayScreen(ui, arg);
    case 'dragons':
      return new DragonsScreen(ui, arg);
    case 'hatchery':
      return new HatcheryScreen(ui);
    case 'journal':
      return new JournalScreen(ui, arg);
  }
}
