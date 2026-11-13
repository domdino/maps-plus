/** Debug logging, off unless the user enables it in options. Never pass API keys here. */
let enabled = false;

export function setDebug(on: boolean): void {
  enabled = on;
}

export function logger(feature: string) {
  const prefix = `[maps-plus:${feature}]`;
  return {
    debug: (...args: unknown[]) => {
      if (enabled) console.debug(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (enabled) console.warn(prefix, ...args);
    },
  };
}
