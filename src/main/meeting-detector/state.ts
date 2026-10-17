// A small pure state machine, so detection logic is unit-testable without
// touching any OS APIs.

export interface DetectorState {
  /** Meeting app we already announced, or null when idle. */
  current: string | null;
  /** Consecutive polls in which `current` was no longer using the mic. */
  missedPolls: number;
}

export type DetectorEvent = { type: "detected"; app: string } | { type: "ended"; app: string };

export const INITIAL_STATE: DetectorState = { current: null, missedPolls: 0 };

/** Polls a meeting app may disappear for (e.g. a brief mic re-acquire) before we call it over. */
export const END_AFTER_MISSED_POLLS = 3;

export function step(
  state: DetectorState,
  observedApp: string | null,
): { state: DetectorState; event: DetectorEvent | null } {
  if (state.current === null) {
    if (observedApp === null) return { state, event: null };
    return {
      state: { current: observedApp, missedPolls: 0 },
      event: { type: "detected", app: observedApp },
    };
  }

  if (observedApp !== null) {
    // Still in a call (possibly switched apps): keep the original announcement.
    return { state: { ...state, missedPolls: 0 }, event: null };
  }

  const missedPolls = state.missedPolls + 1;
  if (missedPolls >= END_AFTER_MISSED_POLLS) {
    return { state: INITIAL_STATE, event: { type: "ended", app: state.current } };
  }
  return { state: { ...state, missedPolls }, event: null };
}
