// Shared render-effect policy helpers (Update 5). Every gameplay renderer asks the same question
// ("may the camera shake?") through this module so the rule lives in one place.

export interface ShakeSettings {
  reducedMotion: boolean;
  lowEffects: boolean;
  /** settings.screenShake; undefined counts as on (the default). */
  screenShake?: boolean;
}

/**
 * Camera shake is allowed only when the player has not asked for reduced motion, has not turned on
 * Low effects, and has not switched screen shake off.
 */
export function shakeAllowed(s: ShakeSettings): boolean {
  return !s.reducedMotion && !s.lowEffects && s.screenShake !== false;
}
