/** Tunable constants for the telemetry engine. Override per call via options objects. */
export const TELEMETRY_CONFIG = {
  /** Points with worse horizontal accuracy are flagged lowQuality (kept, not dropped). */
  MAX_GPS_ACCURACY_METERS: 30,
  /** Implied speed between two fixes above this = GPS jump; segment is ignored. */
  MAX_PLAUSIBLE_SPEED_KMH: 380,
  /** Time gap that breaks the trajectory (signal loss / pause). */
  MAX_SEGMENT_GAP_MS: 5_000,
  /** A lap shorter than this is impossible -> the crossing is ignored. */
  MIN_LAP_TIME_SECONDS: 45,
  /** After an accepted crossing, ignore any crossing of the same line for this long. */
  CROSSING_COOLDOWN_SECONDS: 10,
} as const;

export type TelemetryOptions = {
  maxAccuracyMeters: number;
  maxPlausibleSpeedKmh: number;
  maxSegmentGapMs: number;
  minLapTimeSeconds: number;
  crossingCooldownSeconds: number;
};

export const DEFAULT_OPTIONS: TelemetryOptions = {
  maxAccuracyMeters: TELEMETRY_CONFIG.MAX_GPS_ACCURACY_METERS,
  maxPlausibleSpeedKmh: TELEMETRY_CONFIG.MAX_PLAUSIBLE_SPEED_KMH,
  maxSegmentGapMs: TELEMETRY_CONFIG.MAX_SEGMENT_GAP_MS,
  minLapTimeSeconds: TELEMETRY_CONFIG.MIN_LAP_TIME_SECONDS,
  crossingCooldownSeconds: TELEMETRY_CONFIG.CROSSING_COOLDOWN_SECONDS,
};

export function withDefaults(opts?: Partial<TelemetryOptions>): TelemetryOptions {
  return { ...DEFAULT_OPTIONS, ...opts };
}
