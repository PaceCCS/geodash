import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layer,
  Map as MapLibreMap,
  Source,
  type MapRef,
} from "@vis.gl/react-maplibre";
import { Map as MapIcon } from "lucide-react";

import {
  inspectGeoBlocks,
  type GeoInspectResult,
} from "@/lib/api-client";
import { DotmSquare12 } from "@/components/ui/dotm-square-12";

export function GeographicNetworkMap({ syncDirectory }: { syncDirectory: string }) {
  const mapRef = useRef<MapRef>(null);
  const [geoResult, setGeoResult] = useState<GeoInspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setError(null);
    inspectGeoBlocks(syncDirectory)
      .then((result) => {
        if (!cancelled) setGeoResult(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setGeoResult(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [syncDirectory]);

  const routeGeoJson = useMemo(() => {
    const features = (geoResult?.blocks ?? [])
      .filter(
        (block) =>
          block.routeGeometry && block.routeGeometry.coordinates.length > 1,
      )
      .map((block) => ({
        type: "Feature" as const,
        properties: {
          id: `${block.branchId}/${block.blockIndex}`,
          branchId: block.branchId,
          blockIndex: block.blockIndex,
          routePath: block.routePath,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: block.routeGeometry!.coordinates.map((coordinate) => [
            coordinate.lon,
            coordinate.lat,
          ]),
        },
      }));

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [geoResult]);

  const fitMapToBounds = useCallback(() => {
    if (!geoResult?.bounds) return;
    mapRef.current?.fitBounds(
      [
        [geoResult.bounds.west, geoResult.bounds.south],
        [geoResult.bounds.east, geoResult.bounds.north],
      ],
      { padding: 72, duration: 0 },
    );
  }, [geoResult?.bounds]);

  useEffect(() => {
    fitMapToBounds();
  }, [fitMapToBounds]);

  const center = geoResult?.center ?? { longitude: 0, latitude: 20 };
  const routeCount = routeGeoJson.features.length;
  let statusText = "Loading route geometry...";
  if (error) {
    statusText = `Could not load route geometry: ${error}`;
  } else if (geoResult) {
    statusText = `${routeCount} route${routeCount === 1 ? "" : "s"} ready for mapping.`;
  }

  return (
    <div className="relative h-full w-full bg-muted/30">
      <MapLibreMap
        ref={mapRef}
        initialViewState={{
          longitude: center.longitude,
          latitude: center.latitude,
          zoom: 8,
        }}
        mapStyle="https://demotiles.maplibre.org/style.json"
        style={{ width: "100%", height: "100%" }}
        onLoad={fitMapToBounds}
      >
        {routeCount > 0 ? (
          <Source id="network-routes" type="geojson" data={routeGeoJson}>
            <Layer
              id="network-routes-casing"
              type="line"
              paint={{
                "line-color": "#0f172a",
                "line-width": 7,
                "line-opacity": 0.78,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
            <Layer
              id="network-routes-line"
              type="line"
              paint={{
                "line-color": "#38bdf8",
                "line-width": 4,
                "line-opacity": 0.95,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </Source>
        ) : null}
      </MapLibreMap>

      <div className="absolute left-4 top-4 max-w-sm rounded-lg border bg-background/95 p-3 text-sm shadow-sm backdrop-blur">
        <div className="flex items-center gap-2 font-medium">
          <MapIcon className="size-4" />
          Geographic view
        </div>
        <div className="mt-1 flex items-center gap-2 text-muted-foreground">
          {!error && !geoResult ? (
            <DotmSquare12 size={18} dotSize={3} ariaLabel="Loading route geometry" />
          ) : null}
          <p>{statusText}</p>
        </div>
        {!error && geoResult && routeCount === 0 ? (
          <p className="mt-2 text-muted-foreground">
            Add a WGS84 shapefile, KMZ, KML, or CSV route to draw it here.
          </p>
        ) : null}
      </div>
    </div>
  );
}
