const KEY = "ddas.lastSimulationId";

export function getLastSimulationId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastSimulationId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // storage unavailable — the nav item just stays hidden
  }
}
