export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export type ChannelHint = 'perfect' | 'close' | 'off';

export interface GuessRow {
  guessNumber: number;
  cmyk: CMYK;
  hints: {
    c: ChannelHint;
    m: ChannelHint;
    y: ChannelHint;
    k: ChannelHint;
  };
}

export function clampChannel(val: number): number {
  if (Number.isNaN(val)) return 0;
  return Math.min(100, Math.max(0, Math.round(val)));
}

export function cmykToRgb({ c, m, y, k }: CMYK): {
  r: number;
  g: number;
  b: number;
  css: string;
} {
  const cNorm = clampChannel(c) / 100;
  const mNorm = clampChannel(m) / 100;
  const yNorm = clampChannel(y) / 100;
  const kNorm = clampChannel(k) / 100;

  const r = Math.round(255 * (1 - cNorm) * (1 - kNorm));
  const g = Math.round(255 * (1 - mNorm) * (1 - kNorm));
  const b = Math.round(255 * (1 - yNorm) * (1 - kNorm));

  return {
    r,
    g,
    b,
    css: `rgb(${r}, ${g}, ${b})`,
  };
}

export function evaluateChannel(guessVal: number, targetVal: number): ChannelHint {
  const diff = Math.abs(guessVal - targetVal);
  if (diff <= 2) return 'perfect';
  if (diff <= 15) return 'close';
  return 'off';
}

export function getNextUtcMidnightCountdown(now: Date = new Date()): string {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0
  );
  const diffSeconds = Math.max(0, Math.floor((nextMidnight - now.getTime()) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
}
