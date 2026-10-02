import type { CleanPoint, GPSPoint, TrackDefinition } from "@/lib/types";
import { calculateDistance, isValidCoordinate } from "./distance";
import { detectLap } from "./lapDetection";
import { withDefaults, type TelemetryOptions } from "./config";
import { msToKmh } from "./speed";

export type LiveLap = { lapNumber: number; lapTimeMs: number; endTime: number };

export type LiveState = {
  lapNumber: number;
  /** Start time of the current lap; null until first fix. */
  currentLapStart: number | null;
  /** True once the first start/finish crossing happened (current lap is a timed lap). */
  currentLapTimed: boolean;
  lastLapMs: number | null;
  bestLapMs: number | null;
  completedLaps: LiveLap[];
  speedKmh: number | null;
  accuracy: number | null;
  lastFixTime: number | null;
  /** Timestamp of the most recent start/finish crossing (for a "crossed" flash in the UI). */
  lastCrossingTime: number | null;
  pointCount: number;
};

export const initialLiveState = (): LiveState => ({
  lapNumber: 1,
  currentLapStart: null,
  currentLapTimed: false,
  lastLapMs: null,
  bestLapMs: null,
  completedLaps: [],
  speedKmh: null,
  accuracy: null,
  lastFixTime: null,
  lastCrossingTime: null,
  pointCount: 0,
});

/**
 * Incremental lap timer for the live screen. Pure logic (no React, no browser APIs).
 * Mirrors sanitizePoints + detectLaps so live laps match the server's recompute.
 */
export class LiveLapTimer {
  private state: LiveState = initialLiveState();
  private last: CleanPoint | null = null;
  private jumpStreak = 0;
  private readonly o: TelemetryOptions;

  constructor(private readonly track: TrackDefinition, opts?: Partial<TelemetryOptions>) {
    this.o = withDefaults(opts);
  }

  getState(): LiveState {
    return this.state;
  }

  /** Feed one raw fix. Returns the new state (same object if the point was rejected). */
  feed(p: GPSPoint): LiveState {
    if (!Number.isFinite(p.timestamp) || !isValidCoordinate(p)) return this.state;
    const prev = this.last;
    if (prev && p.timestamp <= prev.timestamp) return this.state; // duplicate / out-of-order

    const lowQuality = !(Number.isFinite(p.accuracy) && p.accuracy <= this.o.maxAccuracyMeters);
    let breakBefore = false;
    let derivedKmh: number | null = null;
    if (prev) {
      const dt = p.timestamp - prev.timestamp;
      const kmh = (calculateDistance(prev, p) / (dt / 1000)) * 3.6;
      if (dt > this.o.maxSegmentGapMs) breakBefore = true;
      else if (kmh > this.o.maxPlausibleSpeedKmh) {
        if (this.jumpStreak < 3) {
          this.jumpStreak++;
          return this.state;
        }
        breakBefore = true;
      } else derivedKmh = kmh;
    }
    this.jumpStreak = 0;
    const pt: CleanPoint = { ...p, lowQuality, breakBefore };

    const s: LiveState = {
      ...this.state,
      speedKmh: p.speed != null && p.speed >= 0 ? msToKmh(p.speed) : derivedKmh,
      accuracy: p.accuracy,
      lastFixTime: p.timestamp,
      pointCount: this.state.pointCount + 1,
      currentLapStart: this.state.currentLapStart ?? p.timestamp,
    };

    if (prev) {
      const crossing = detectLap(prev, pt, this.track, this.state.lastCrossingTime, this.o);
      if (crossing) {
        if (s.currentLapTimed && s.currentLapStart != null) {
          const lapTimeMs = Math.round(crossing.timestamp - s.currentLapStart);
          s.completedLaps = [...s.completedLaps, { lapNumber: s.lapNumber, lapTimeMs, endTime: crossing.timestamp }];
          s.lastLapMs = lapTimeMs;
          s.bestLapMs = s.bestLapMs == null ? lapTimeMs : Math.min(s.bestLapMs, lapTimeMs);
        }
        s.lapNumber += 1;
        s.currentLapStart = crossing.timestamp;
        s.currentLapTimed = true;
        s.lastCrossingTime = crossing.timestamp;
      }
    }

    this.last = pt;
    this.state = s;
    return s;
  }
}
