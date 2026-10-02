"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker as MLMarker, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { Coordinate, GeoLine, TrackDefinition } from "@/lib/types";

export type MapLine = {
  id: string;
  coords: Array<[number, number]>; // [lng, lat]
  color: string;
  width?: number;
  /** Optional per-vertex speed (km/h) -> line coloured by speed. */
  speeds?: Array<number | null>;
};

export type DraftMarker = { lng: number; lat: number; label: string; color?: string };

type Props = {
  track: TrackDefinition;
  lines?: MapLine[];
  draftMarkers?: DraftMarker[];
  draftLines?: GeoLine[];
  onMapClick?: (c: Coordinate) => void;
  height?: string;
};

type Style = NonNullable<ConstructorParameters<typeof MLMap>[0]["style"]>;

const TERRAIN_URL = process.env.NEXT_PUBLIC_TERRAIN_TILES_URL;
const TERRAIN_ENCODING = (process.env.NEXT_PUBLIC_TERRAIN_ENCODING ?? "terrarium") as "terrarium" | "mapbox";

function baseStyle(): Style {
  return {
    version: 8,
    sources: {
      sat: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      ...(TERRAIN_URL
        ? { dem: { type: "raster-dem" as const, tiles: [TERRAIN_URL], tileSize: 256, encoding: TERRAIN_ENCODING, maxzoom: 14 } }
        : {}),
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#09090b" } },
      { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.75 } },
      { id: "osm", type: "raster", source: "osm", layout: { visibility: "none" }, paint: { "raster-brightness-max": 0.6 } },
    ],
  };
}

const lineFeature = (l: GeoLine, props: Record<string, unknown> = {}) => ({
  type: "Feature" as const,
  properties: props,
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [l.pointA.longitude, l.pointA.latitude],
      [l.pointB.longitude, l.pointB.latitude],
    ],
  },
});

const fc = (features: unknown[]) => ({ type: "FeatureCollection" as const, features }) as FeatureCollection;

function trackGeoJSON(track: TrackDefinition) {
  const f: unknown[] = [lineFeature(track.startFinishLine, { kind: "sf" })];
  for (const s of track.sectors) if (s.endLine) f.push(lineFeature(s.endLine, { kind: "sector", label: s.id }));
  if (track.racingLine?.length)
    f.push({ type: "Feature", properties: { kind: "racing" }, geometry: { type: "LineString", coordinates: track.racingLine.map((c) => [c.longitude, c.latitude]) } });
  if (track.boundary)
    for (const side of [track.boundary.left, track.boundary.right])
      f.push({ type: "Feature", properties: { kind: "boundary" }, geometry: { type: "LineString", coordinates: side.map((c) => [c.longitude, c.latitude]) } });
  return fc(f);
}

function linesGeoJSON(lines: MapLine[]) {
  const f: unknown[] = [];
  for (const l of lines) {
    if (l.speeds) {
      for (let i = 1; i < l.coords.length; i++) {
        f.push({
          type: "Feature",
          properties: { id: l.id, color: l.color, width: l.width ?? 4, speed: l.speeds[i] ?? l.speeds[i - 1] ?? -1, bySpeed: 1 },
          geometry: { type: "LineString", coordinates: [l.coords[i - 1], l.coords[i]] },
        });
      }
    } else {
      f.push({ type: "Feature", properties: { id: l.id, color: l.color, width: l.width ?? 4, bySpeed: 0 }, geometry: { type: "LineString", coordinates: l.coords } });
    }
  }
  return fc(f);
}

export function TrackMap({ track, lines = [], draftMarkers = [], draftLines = [], onMapClick, height = "60vh" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<MLMarker[]>([]);
  const markerCtor = useRef<typeof MLMarker | null>(null);
  const clickRef = useRef(onMapClick);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"2D" | "3D">("2D");
  const [base, setBase] = useState<"sat" | "osm">("sat");
  const [error, setError] = useState<string | null>(null);
  clickRef.current = onMapClick;

  // Init once.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const ml = await import("maplibre-gl");
        if (disposed || !el.current) return;
        markerCtor.current = ml.Marker;
        const map = new ml.Map({
          container: el.current,
          style: baseStyle(),
          center: [track.center.longitude, track.center.latitude],
          zoom: track.defaultZoom,
          maxPitch: 75,
          attributionControl: { compact: true },
        });
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
        map.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");
        map.on("click", (e: MapMouseEvent) => clickRef.current?.({ latitude: e.lngLat.lat, longitude: e.lngLat.lng }));
        map.on("load", () => {
          map.addSource("track", { type: "geojson", data: trackGeoJSON(track) });
          map.addSource("laps", { type: "geojson", data: fc([]) });
          map.addSource("draft", { type: "geojson", data: fc([]) });
          map.addLayer({ id: "boundary", type: "line", source: "track", filter: ["==", ["get", "kind"], "boundary"], paint: { "line-color": "#ffffff", "line-opacity": 0.35, "line-width": 1 } });
          map.addLayer({ id: "racing", type: "line", source: "track", filter: ["==", ["get", "kind"], "racing"], paint: { "line-color": "#b76bff", "line-width": 2, "line-dasharray": [2, 2] } });
          map.addLayer({
            id: "laps-solid",
            type: "line",
            source: "laps",
            filter: ["==", ["get", "bySpeed"], 0],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.9 },
          });
          map.addLayer({
            id: "laps-speed",
            type: "line",
            source: "laps",
            filter: ["==", ["get", "bySpeed"], 1],
            layout: { "line-cap": "round" },
            paint: {
              "line-width": ["get", "width"],
              "line-color": [
                "case",
                ["<", ["get", "speed"], 0],
                "#555",
                ["interpolate", ["linear"], ["get", "speed"], 40, "#ff2d2d", 90, "#ffd500", 140, "#19e27a", 200, "#3ad7ff"],
              ],
            },
          });
          map.addLayer({ id: "sectors", type: "line", source: "track", filter: ["==", ["get", "kind"], "sector"], paint: { "line-color": "#ffd500", "line-width": 4 } });
          map.addLayer({ id: "sf-under", type: "line", source: "track", filter: ["==", ["get", "kind"], "sf"], paint: { "line-color": "#000", "line-width": 7 } });
          map.addLayer({ id: "sf", type: "line", source: "track", filter: ["==", ["get", "kind"], "sf"], paint: { "line-color": "#fff", "line-width": 5, "line-dasharray": [1, 1] } });
          map.addLayer({ id: "draft", type: "line", source: "draft", paint: { "line-color": "#ff2d2d", "line-width": 4 } });
          mapRef.current = map;
          setReady(true);
        });
        map.on("error", (e) => {
          if (e.error?.message?.includes("dem")) setError("3D terrain unavailable — using 2D.");
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Map failed to load (WebGL unavailable?)");
      }
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lap lines -> fit bounds on first data.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("laps") as unknown as { setData: (d: FeatureCollection) => void }).setData(linesGeoJSON(lines));
    const all = lines.flatMap((l) => l.coords);
    if (all.length > 1 && !fitted.current) {
      const lngs = all.map((c) => c[0]);
      const lats = all.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 40, duration: 0 },
      );
      fitted.current = true;
    }
  }, [ready, lines]);

  // Track geometry (re-render if config hot-reloads).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("track") as unknown as { setData: (d: FeatureCollection) => void }).setData(trackGeoJSON(track));
  }, [ready, track]);

  // Corner + draft markers (HTML markers: no glyph server needed).
  useEffect(() => {
    const map = mapRef.current;
    const Marker = markerCtor.current;
    if (!ready || !map || !Marker) return;
    markersRef.current.forEach((m) => m.remove());
    const mk = (lng: number, lat: number, label: string, color: string) => {
      const div = document.createElement("div");
      div.textContent = label;
      div.style.cssText = `background:${color};color:#000;font:700 10px ui-monospace,monospace;padding:2px 4px;border-radius:3px;pointer-events:none`;
      return new Marker({ element: div }).setLngLat([lng, lat]).addTo(map);
    };
    markersRef.current = [
      ...track.corners.map((c) => mk(c.apex.longitude, c.apex.latitude, c.id, "#ffffff")),
      ...draftMarkers.map((d) => mk(d.lng, d.lat, d.label, d.color ?? "#ff2d2d")),
    ];
    (map.getSource("draft") as unknown as { setData: (d: FeatureCollection) => void }).setData(fc(draftLines.map((l) => lineFeature(l))));
  }, [ready, track, draftMarkers, draftLines]);

  // 2D / 3D camera (+ terrain when configured; graceful fallback otherwise).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (mode === "3D") {
      map.easeTo({ pitch: 60, duration: 600 });
      if (TERRAIN_URL) {
        try {
          map.setTerrain({ source: "dem", exaggeration: 1.5 });
        } catch {
          setError("3D terrain unavailable — pitched 2D view.");
        }
      }
    } else {
      if (TERRAIN_URL) map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, [ready, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("sat", "visibility", base === "sat" ? "visible" : "none");
    map.setLayoutProperty("osm", "visibility", base === "osm" ? "visible" : "none");
  }, [ready, base]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-line" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      <div className="absolute top-2 left-2 z-10 flex gap-1">
        {(["2D", "3D"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded px-3 py-1.5 text-xs font-black ${mode === m ? "bg-flag text-black" : "bg-black/70 text-ink"}`}>
            {m}
          </button>
        ))}
        <button onClick={() => setBase(base === "sat" ? "osm" : "sat")} className="rounded bg-black/70 px-3 py-1.5 text-xs font-bold">
          {base === "sat" ? "Map" : "Satellite"}
        </button>
      </div>
      {error && <div className="absolute bottom-8 left-2 z-10 rounded bg-black/80 px-2 py-1 text-xs text-flag">{error}</div>}
    </div>
  );
}
