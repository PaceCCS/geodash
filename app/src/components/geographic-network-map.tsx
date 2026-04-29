import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layer,
  Map as MapLibreMap,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "@vis.gl/react-maplibre";
import { Map as MapIcon } from "lucide-react";

import {
  type GeoCoordinate,
  inspectGeoBlocks,
  type GeoInspectResult,
} from "@/lib/api-client";
import { DotmSquare12 } from "@/components/ui/dotm-square-12";

type RouteTooltip = {
  longitude: number;
  latitude: number;
  id: string;
  branchId: string;
  blockIndex: number;
  blockType: string;
  format: string;
  routePath: string;
  routeLength: string;
  mapStatus: string;
  featureKind: string;
};

function sameCoordinate(a: GeoCoordinate, b: GeoCoordinate): boolean {
  return a.lon === b.lon && a.lat === b.lat;
}

function coordinatePair(coordinate: GeoCoordinate): [number, number] {
  return [coordinate.lon, coordinate.lat];
}

export function GeographicNetworkMap({ syncDirectory }: { syncDirectory: string }) {
  const mapRef = useRef<MapRef>(null);
  const [geoResult, setGeoResult] = useState<GeoInspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<RouteTooltip | null>(null);

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
          blockType: block.type ?? "Block",
          format: block.format,
          routePath: block.routePath,
          routeLength: block.route.displayLength ?? "Not measured",
          mapStatus: block.route.mapStatus,
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

  const componentLineGeoJson = useMemo(() => {
    const features = (geoResult?.blocks ?? [])
      .filter(
        (block) =>
          !block.routeGeometry &&
          block.previousRouteEndpoint &&
          block.nextRouteEndpoint &&
          !sameCoordinate(block.previousRouteEndpoint, block.nextRouteEndpoint),
      )
      .map((block) => ({
        type: "Feature" as const,
        properties: {
          id: `${block.branchId}/${block.blockIndex}`,
          branchId: block.branchId,
          blockIndex: block.blockIndex,
          blockType: block.type ?? "Block",
          format: block.format,
          routePath: block.routePath,
          routeLength: block.route.displayLength ?? "Not measured",
          mapStatus: block.route.mapStatus,
          featureKind: "Component link",
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            coordinatePair(block.previousRouteEndpoint!),
            coordinatePair(block.nextRouteEndpoint!),
          ],
        },
      }));

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [geoResult]);

  const componentPointGeoJson = useMemo(() => {
    const features = (geoResult?.blocks ?? [])
      .filter((block) => !block.routeGeometry)
      .map((block) => {
        const coordinate = block.previousRouteEndpoint ?? block.nextRouteEndpoint;
        if (!coordinate) return null;
        const hasBothEndpoints = Boolean(
          block.previousRouteEndpoint && block.nextRouteEndpoint,
        );

        return {
          type: "Feature" as const,
          properties: {
            id: `${block.branchId}/${block.blockIndex}`,
            branchId: block.branchId,
            blockIndex: block.blockIndex,
            blockType: block.type ?? "Block",
            format: block.format,
            routePath: block.routePath,
            routeLength: block.route.displayLength ?? "Not measured",
            mapStatus: block.route.mapStatus,
            featureKind: hasBothEndpoints ? "Component" : "Terminal component",
          },
          geometry: {
            type: "Point" as const,
            coordinates: coordinatePair(coordinate),
          },
        };
      })
      .filter((feature) => feature !== null);

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

  const handleRouteMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature?.properties) {
      setTooltip(null);
      return;
    }

    event.target.getCanvas().style.cursor = "pointer";
    setTooltip({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      id: String(feature.properties.id ?? ""),
      branchId: String(feature.properties.branchId ?? ""),
      blockIndex: Number(feature.properties.blockIndex ?? 0),
      blockType: String(feature.properties.blockType ?? "Block"),
      format: String(feature.properties.format ?? "unknown"),
      routePath: String(feature.properties.routePath ?? "No route file"),
      routeLength: String(feature.properties.routeLength ?? "Not measured"),
      mapStatus: String(feature.properties.mapStatus ?? "unknown"),
      featureKind: String(feature.properties.featureKind ?? "Route"),
    });
  }, []);

  const handleRouteMouseLeave = useCallback((event: MapLayerMouseEvent) => {
    event.target.getCanvas().style.cursor = "";
    setTooltip(null);
  }, []);

  const center = geoResult?.center ?? { longitude: 0, latitude: 20 };
  const routeCount = routeGeoJson.features.length;
  const componentCount = componentPointGeoJson.features.length;
  let statusText = "Loading route geometry...";
  if (error) {
    statusText = `Could not load route geometry: ${error}`;
  } else if (geoResult) {
    statusText = `${routeCount} route${routeCount === 1 ? "" : "s"} and ${componentCount} component${componentCount === 1 ? "" : "s"} ready for mapping.`;
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
        interactiveLayerIds={[
          "network-routes-casing",
          "network-routes-line",
          "network-components-line",
          "network-components-point",
        ]}
        onLoad={fitMapToBounds}
        onMouseMove={handleRouteMouseMove}
        onMouseLeave={handleRouteMouseLeave}
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
        {componentLineGeoJson.features.length > 0 ? (
          <Source id="network-components-line" type="geojson" data={componentLineGeoJson}>
            <Layer
              id="network-components-line"
              type="line"
              paint={{
                "line-color": "#f97316",
                "line-width": 3,
                "line-dasharray": [1.5, 1.5],
                "line-opacity": 0.9,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </Source>
        ) : null}
        {componentCount > 0 ? (
          <Source id="network-components-point" type="geojson" data={componentPointGeoJson}>
            <Layer
              id="network-components-point"
              type="circle"
              paint={{
                "circle-color": "#fb923c",
                "circle-radius": 6,
                "circle-stroke-color": "#0f172a",
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        ) : null}
        {tooltip ? (
          <Popup
            longitude={tooltip.longitude}
            latitude={tooltip.latitude}
            closeButton={false}
            closeOnClick={false}
            offset={14}
            className="geodash-map-tooltip"
          >
            <div className="min-w-48 text-xs text-foreground">
              <div className="font-semibold">{tooltip.blockType}</div>
              <div className="mt-1 text-muted-foreground">
                {tooltip.id} · {tooltip.featureKind}
              </div>
              <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Route</span>
                <span className="truncate">{tooltip.routePath}</span>
                <span className="text-muted-foreground">Format</span>
                <span>{tooltip.format}</span>
                <span className="text-muted-foreground">Length</span>
                <span>{tooltip.routeLength}</span>
                <span className="text-muted-foreground">Status</span>
                <span>{tooltip.mapStatus}</span>
              </div>
            </div>
          </Popup>
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
