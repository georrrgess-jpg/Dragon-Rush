import type { ProgressEvents } from '../economy';
import type { ModeId, SaveData } from '../save';

export type Tab = 'home' | 'play' | 'dragons' | 'hatchery' | 'journal';

/** What menu screens can ask of the app. */
export interface UI {
  readonly save: SaveData;
  readonly readOnly: boolean;
  readonly scale: number;
  /** Persists a new save as one transaction (no-op write when read-only). */
  commit(next: SaveData): void;
  toast(text: string, ms?: number): void;
  go(tab: Tab, arg?: string): void;
  startRush(): void;
  startTrial(id: string, practice: boolean): void;
  startArena(): void;
  /** Update 5: starts a mode from the main menu (remembers it as the menu's mode). */
  startMode(mode: ModeId): void;
  openSettings(): void;
  /** Toasts for contracts, milestones, mastery and new species from a transaction. */
  announce(ev: ProgressEvents): void;
  confirm(title: string, body: string, ok: string, cancel?: string): Promise<boolean>;
  /** Opens a full-stage dialog (Observatory): background inert, Escape closes, focus restored. */
  openOverlay(o: Overlay): void;
  closeOverlay(): void;
}

/** A full-stage dialog. While open it receives update() and the screen behind does not. */
export interface Overlay {
  el: HTMLElement;
  focus(): void;
  update?(dt: number): void;
  destroy?(): void;
}

export interface Screen {
  el: HTMLElement;
  render(): void;
  update?(dt: number): void;
  destroy?(): void;
}
