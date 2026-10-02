/**
 * Shared domain types. Pure data — no runtime deps.
 * Units: time = epoch ms, distance = meters, raw speed = m/s, display speed = km/h.
 */

export type Coordinate = { latitude: number; longitude: number };

export type GeoLine = { pointA: Coordinate; pointB: Coordinate };

/** One fix from the phone (navigator.geolocation). Timestamp is the DEVICE fix time. */
export type GPSPoint = {
  timestamp: number;
  latitude: number;
  longitude: number;
  /** m/s as reported by the device; null when the device does not provide it. */
  speed: number | null;
  /** Horizontal accuracy radius, meters. */
  accuracy: number;
  altitude?: number | null;
  heading?: number | null;
};

/** GPSPoint after sanitizing. Low-quality points are flagged, not dropped. */
export type CleanPoint = GPSPoint & {
  lowQuality: boolean;
  /** True when the segment from the previous point to this one is implausible (GPS jump) or a long gap. */
  breakBefore: boolean;
};

/** Extension point: future sources (external 10–50 Hz GPS, IMU, OBD/CAN) share the time base. */
export type TelemetrySource = "phone-gps" | "external-gps" | "imu" | "can" | "obd";

export type TelemetryChannelSample = {
  timestamp: number;
  source: TelemetrySource;
  channel: string; // e.g. "rpm", "throttle", "lean_angle"
  value: number;
};

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

/**
 * Sectors are defined by their END boundary. S1 starts at start/finish.
 * The last sector has no endLine — it ends at start/finish.
 */
export type SectorDefinition = {
  id: string;
  name: string;
  endLine?: GeoLine;
};

export type CornerDefinition = {
  id: string; // "T1"
  name: string;
  apex: Coordinate;
  /** Meters of track (by distance) before the apex to analyse. Default 150. */
  entryWindowMeters?: number;
  /** Meters after the apex. Default 120. */
  exitWindowMeters?: number;
};

export type TrackDefinition = {
  id: string;
  name: string;
  country: string;
  /** Map centre + zoom for visualization. */
  center: Coordinate;
  defaultZoom: number;
  lengthMeters?: number;
  startFinishLine: GeoLine;
  /**
   * Which way is "forward" through the start/finish line.
   *  "left-to-right": moving from the left side of vector A->B to the right side.
   *  "any": accept either direction.
   */
  direction: "left-to-right" | "right-to-left" | "any";
  /** Extra meters added to each end of every timing line (absorbs lateral GPS error). */
  lineToleranceMeters: number;
  sectors: SectorDefinition[];
  corners: CornerDefinition[];
  racingLine?: Coordinate[];
  boundary?: { left: Coordinate[]; right: Coordinate[] };
  /** False until coordinates have been surveyed/verified on-site. UI warns while false. */
  verified: boolean;
  notes?: string;
};

// ---------------------------------------------------------------------------
// Session / laps
// ---------------------------------------------------------------------------

export type SessionStatus = "active" | "completed";

export type TrackSession = {
  id: string;
  trackId: string;
  name?: string | null;
  startedAt: string;
  endedAt?: string | null;
  status: SessionStatus;
};

export type LineCrossing = {
  /** Interpolated crossing time (ms). */
  timestamp: number;
  /** Index of the point AFTER the crossing. */
  pointIndex: number;
  direction: "left-to-right" | "right-to-left";
  /** Interpolated speed at crossing, m/s, if available. */
  speedMs: number | null;
};

export type LapKind = "out" | "timed" | "in";

export type DetectedLap = {
  lapNumber: number; // 1-based, Lap 1 = session start -> first crossing
  kind: LapKind;
  startTime: number;
  endTime: number;
  /** Only "timed" laps (crossing -> crossing) have an official lap time. */
  isTimed: boolean;
};

export type GPSQuality = {
  pointCount: number;
  lowQualityCount: number;
  meanAccuracyMeters: number | null;
  medianIntervalMs: number | null;
  maxGapMs: number;
  speedFromDevicePct: number;
  rating: "good" | "medium" | "poor";
};

export type LapMetrics = {
  lapTimeMs: number;
  distanceMeters: number;
  maxSpeedKmh: number;
  averageSpeedKmh: number;
  /** sectorId -> ms (null when a boundary was not detected). */
  sectorTimes: Record<string, number | null>;
  gpsQuality: GPSQuality;
};

export type LapRecord = {
  id: string;
  sessionId: string;
  lapNumber: number;
  kind: LapKind;
  isTimed: boolean;
  startTime: number;
  endTime: number;
  metrics: LapMetrics;
};
