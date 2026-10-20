import type { ProgressEvents } from '../economy';
import type { SaveData } from '../save';

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
  openSettings(): void;
  /** Toasts for contracts, milestones, mastery and new species from a transaction. */
  announce(ev: ProgressEvents): void;
  confirm(title: string, body: string, ok: string, cancel?: string): Promise<boolean>;
}

export interface Screen {
  el: HTMLElement;
  render(): void;
  update?(dt: number): void;
  destroy?(): void;
}
