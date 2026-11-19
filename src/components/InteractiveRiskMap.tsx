import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Circle,
  ColorScheme,
  InfoWindow,
  Map,
  MapCameraChangedEvent,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Crosshair,
  ExternalLink,
  Layers,
  LocateFixed,
  Maximize2,
  Minimize2,
  Navigation,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Satellite,
  Sun,
} from 'lucide-react';
import { useClimatyc } from '../context/ClimatycContext';
import { degreesToCompass, describeWeatherCondition } from '../services/climateService';
import {
  AlertTier,
  CATEGORY_LABELS,
  CitizenReportDoc,
  LiveZoneTelemetry,
  OSINT_CATEGORY_LABELS,
  OsintReportItem,
} from '../types/climate';

interface InteractiveRiskMapProps {
  scope: 'guayaquil' | 'nacional';
  telemetryList: LiveZoneTelemetry[];
  selectedZoneId: string;
  onSelectZone: (zoneId: string) => void;
  reports: CitizenReportDoc[];
  heightClassName?: string;
  focusedOsintItem?: OsintReportItem | null;
  externalFullscreenTrigger?: number;
}

type MapLayerMode = 'meteo_vivo' | 'riesgo_enso';
type BaseCartographyMode = 'roadmap' | 'hybrid' | 'terrain';
type SatelliteSensorLayer = 'none' | 'goes_ir' | 'sst_nino' | 'imerg_rain';

interface SatelliteSensorConfig {
  id: Exclude<SatelliteSensorLayer, 'none'>;
  shortLabel: string;
  gibsLayer: string;
  matrixSet: string;
  maxNativeZoom: number;
  opacity: number;
  legendText: string;
}

const SATELLITE_SENSOR_CONFIGS: Record<
  Exclude<SatelliteSensorLayer, 'none'>,
  SatelliteSensorConfig
> = {
  goes_ir: {
    id: 'goes_ir',
    shortLabel: 'Nubosidad IR (GOES-East)',
    gibsLayer: 'GOES-East_ABI_Band13_Clean_Infrared',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxNativeZoom: 6,
    opacity: 0.56,
    legendText:
      'Satélite Geoestacionario GOES-East Banda 13 IR Limpio: topes nubosos fríos y sistemas convectivos sobre Ecuador y Pacífico Oriental',
  },
  sst_nino: {
    id: 'sst_nino',
    shortLabel: 'Temp. Mar TSM (Niño 1+2)',
    gibsLayer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    matrixSet: 'GoogleMapsCompatible_Level7',
    maxNativeZoom: 7,
    opacity: 0.62,
    legendText:
      'Satélite NASA/JPL GHRSST MUR L4: Temperatura Superficial del Mar (TSM) para monitoreo del acoplamiento cálido en Región Niño 1+2',
  },
  imerg_rain: {
    id: 'imerg_rain',
    shortLabel: 'Tasa Pluvial (NASA IMERG)',
    gibsLayer: 'IMERG_Precipitation_Rate',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxNativeZoom: 6,
    opacity: 0.64,
    legendText:
      'Constelación Satelital NASA GPM IMERG: estimación orbital de tasa de precipitación sobre cuencas costeras, andinas e insulares',
  },
};

interface EvolutionStep {
  id: string;
  kind: 'radar_past' | 'live_now' | 'hourly_forecast';
  label: string;
  shortTag: string;
  radarPath: string | null;
  hourOffset: number;
}

const GUAYAQUIL_VIEW = {
  center: { lat: -2.1785, lng: -79.9105 },
  zoom: 11.7,
};

const ECUADOR_MAINLAND_VIEW = {
  center: { lat: -1.48, lng: -79.45 },
  zoom: 6.7,
};

const GALAPAGOS_VIEW = {
  center: { lat: -0.9022, lng: -89.6092 },
  zoom: 8.5,
};

const FORECAST_OFFSETS = [1, 2, 3, 4, 6, 9, 12, 18, 24];

const MAX_NATIVE_RADAR_ZOOM = 7;

function getTierColors(tier: AlertTier) {
  switch (tier) {
    case 'roja':
      return {
        stroke: '#BE123C',
        fill: '#E11D48',
        badgeBg: 'bg-rose-700 text-white border-rose-200',
        indexCls: 'text-rose-700',
        label: '✖ Alerta Roja',
      };
    case 'naranja':
      return {
        stroke: '#B45309',
        fill: '#D97706',
        badgeBg: 'bg-amber-600 text-white border-amber-200',
        indexCls: 'text-amber-700',
        label: '▲ Alerta Naranja',
      };
    case 'amarilla':
      return {
        stroke: '#0369A1',
        fill: '#0284C7',
        badgeBg: 'bg-sky-700 text-white border-sky-200',
        indexCls: 'text-sky-700',
        label: '▲ Vigilancia',
      };
    default:
      return {
        stroke: '#047857',
        fill: '#059669',
        badgeBg: 'bg-emerald-700 text-white border-emerald-200',
        indexCls: 'text-emerald-700',
        label: '● Nominal',
      };
  }
}

function getLivePrecipPalette(precipMm: number, weatherCode: number) {
  if (weatherCode >= 95 && precipMm >= 0.1) {
    return {
      stroke: '#BE123C',
      fill: '#E11D48',
      chipCls: 'bg-rose-700 text-white border-white',
    };
  }
  if (precipMm >= 7.5) {
    return {
      stroke: '#4338CA',
      fill: '#4F46E5',
      chipCls: 'bg-indigo-700 text-white border-white',
    };
  }
  if (precipMm >= 1.5) {
    return {
      stroke: '#0369A1',
      fill: '#0284C7',
      chipCls: 'bg-sky-700 text-white border-white',
    };
  }
  if (precipMm >= 0.1) {
    return {
      stroke: '#0E7490',
      fill: '#0891B2',
      chipCls: 'bg-cyan-700 text-white border-white',
    };
  }
  return {
    stroke: '#64748B',
    fill: '#94A3B8',
    chipCls: 'bg-white/95 text-slate-900 border-slate-300',
  };
}

function renderWeatherGlyph(weatherCode: number, precipMm: number, cloudCoverPct: number) {
  if (weatherCode >= 95 && precipMm >= 0.1) {
    return <CloudLightning className="w-3.5 h-3.5 text-rose-100 shrink-0" />;
  }
  if (precipMm >= 0.1) {
    return <CloudRain className="w-3.5 h-3.5 text-sky-100 shrink-0" />;
  }
  if (cloudCoverPct >= 75) {
    return <Cloud className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  }
  if (cloudCoverPct >= 30) {
    return <CloudSun className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }
  return <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
}

/**
 * Helper to build a Web Mercator sub-quadrant tile div so tile servers with lower native maxZoom
 * (e.g. zoom 6 or 7) project smoothly all the way to street zoom (zoom 20) without 404s or error watermarks.
 */
function buildSubQuadrantTileDiv(params: {
  coord: { x: number; y: number } | null;
  zoom: number;
  ownerDocument: Document | null;
  maxNativeZoom: number;
  opacity: number;
  buildUrl: (z: number, x: number, y: number) => string;
}): HTMLElement {
  const { coord, zoom, ownerDocument, maxNativeZoom, opacity, buildUrl } = params;
  const doc = ownerDocument || document;
  const tileDiv = doc.createElement('div');
  tileDiv.style.width = '256px';
  tileDiv.style.height = '256px';
  tileDiv.style.pointerEvents = 'none';
  tileDiv.style.overflow = 'hidden';
  tileDiv.setAttribute('aria-hidden', 'true');

  if (!coord || zoom < 2) {
    return tileDiv;
  }

  const maxTile = 1 << zoom;
  if (coord.y < 0 || coord.y >= maxTile) {
    return tileDiv;
  }

  const wrappedX = ((coord.x % maxTile) + maxTile) % maxTile;
  tileDiv.style.opacity = String(opacity);
  tileDiv.style.backgroundRepeat = 'no-repeat';

  if (zoom <= maxNativeZoom) {
    const url = buildUrl(zoom, wrappedX, coord.y);
    tileDiv.style.backgroundImage = `url("${url}")`;
    tileDiv.style.backgroundSize = '256px 256px';
    tileDiv.style.backgroundPosition = '0px 0px';
    return tileDiv;
  }

  const zoomDiff = Math.min(zoom - maxNativeZoom, 12);
  const scale = 1 << zoomDiff;
  const effectiveZoomShift = zoom - maxNativeZoom;
  const rawScale = 1 << effectiveZoomShift;
  const parentX = Math.floor(wrappedX / rawScale);
  const parentY = Math.floor(coord.y / rawScale);

  const subX = (wrappedX % rawScale) / (rawScale / scale);
  const subY = (coord.y % rawScale) / (rawScale / scale);

  const url = buildUrl(maxNativeZoom, parentX, parentY);
  tileDiv.style.backgroundImage = `url("${url}")`;
  tileDiv.style.backgroundSize = `${256 * scale}px ${256 * scale}px`;
  tileDiv.style.backgroundPosition = `${-subX * 256}px ${-subY * 256}px`;
  if (zoom >= maxNativeZoom + 3) {
    tileDiv.style.filter = 'blur(1.5px)';
  }

  return tileDiv;
}

const CameraController: React.FC<{
  targetCenter: { lat: number; lng: number } | null;
  targetZoom: number | null;
  onSettled: () => void;
}> = ({ targetCenter, targetZoom, onSettled }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || !targetCenter) return;
    map.panTo(targetCenter);
    if (targetZoom !== null) {
      map.setZoom(targetZoom);
    }
    onSettled();
  }, [map, targetCenter, targetZoom, onSettled]);

  return null;
};

const SatelliteSensorOverlayController: React.FC<{
  sensor: SatelliteSensorLayer;
}> = ({ sensor }) => {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !coreLib) return;

    const removeExisting = () => {
      const overlays = map.overlayMapTypes;
      for (let i = overlays.getLength() - 1; i >= 0; i--) {
        const layer = overlays.getAt(i);
        if (layer && layer.name === 'JmacSatelliteSensor') {
          overlays.removeAt(i);
        }
      }
    };

    removeExisting();

    if (sensor === 'none') {
      return () => removeExisting();
    }

    const cfg = SATELLITE_SENSOR_CONFIGS[sensor];
    type OverlayItem = Parameters<typeof map.overlayMapTypes.push>[0];

    const customSatLayer = {
      name: 'JmacSatelliteSensor',
      alt: cfg.shortLabel,
      tileSize: new coreLib.Size(256, 256),
      maxZoom: 20,
      minZoom: 2,
      getTile: (
        coord: { x: number; y: number } | null,
        zoom: number,
        ownerDocument: Document | null
      ): HTMLElement =>
        buildSubQuadrantTileDiv({
          coord,
          zoom,
          ownerDocument,
          maxNativeZoom: cfg.maxNativeZoom,
          opacity: cfg.opacity,
          buildUrl: (z, x, y) =>
            `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${cfg.gibsLayer}/default/default/${cfg.matrixSet}/${z}/${y}/${x}.png`,
        }),
      releaseTile: (tile: Element | null) => {
        if (tile && tile instanceof HTMLElement) {
          tile.style.backgroundImage = 'none';
        }
      },
    };

    // Insert at bottom of overlay stack (index 0) so Doppler radar sits cleanly above satellite imagery
    map.overlayMapTypes.insertAt(0, customSatLayer as unknown as OverlayItem);

    return () => {
      removeExisting();
    };
  }, [map, coreLib, sensor]);

  return null;
};

const RadarOverlayController: React.FC<{
  enabled: boolean;
  radarHost: string;
  radarPath: string | null;
}> = ({ enabled, radarHost, radarPath }) => {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !coreLib) return;

    const removeExisting = () => {
      const overlays = map.overlayMapTypes;
      for (let i = overlays.getLength() - 1; i >= 0; i--) {
        const layer = overlays.getAt(i);
        if (layer && layer.name === 'JmacDopplerRadar') {
          overlays.removeAt(i);
        }
      }
    };

    removeExisting();

    if (!enabled || !radarPath) {
      return () => removeExisting();
    }

    type OverlayItem = Parameters<typeof map.overlayMapTypes.push>[0];

    const customRadarLayer = {
      name: 'JmacDopplerRadar',
      alt: 'Radar Doppler en tiempo real',
      tileSize: new coreLib.Size(256, 256),
      maxZoom: 20,
      minZoom: 2,
      getTile: (
        coord: { x: number; y: number } | null,
        zoom: number,
        ownerDocument: Document | null
      ): HTMLElement =>
        buildSubQuadrantTileDiv({
          coord,
          zoom,
          ownerDocument,
          maxNativeZoom: MAX_NATIVE_RADAR_ZOOM,
          opacity: 0.62,
          buildUrl: (z, x, y) => `${radarHost}${radarPath}/256/${z}/${x}/${y}/2/1_1.png`,
        }),
      releaseTile: (tile: Element | null) => {
        if (tile && tile instanceof HTMLElement) {
          tile.style.backgroundImage = 'none';
        }
      },
    };

    map.overlayMapTypes.push(customRadarLayer as unknown as OverlayItem);

    return () => {
      removeExisting();
    };
  }, [map, coreLib, enabled, radarHost, radarPath]);

  return null;
};

export const InteractiveRiskMap: React.FC<InteractiveRiskMapProps> = ({
  scope,
  telemetryList,
  selectedZoneId,
  onSelectZone,
  reports,
  heightClassName = 'h-[585px]',
  focusedOsintItem = null,
  externalFullscreenTrigger = 0,
}) => {
  const { osintReports, radarHost, radarFrames, secondsUntilNextSync } = useClimatyc();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wasNativeFullscreenRef = useRef<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const initialView = scope === 'guayaquil' ? GUAYAQUIL_VIEW : ECUADOR_MAINLAND_VIEW;
  const [camera, setCamera] = useState(initialView);
  const [flyTarget, setFlyTarget] = useState<{
    center: { lat: number; lng: number } | null;
    zoom: number | null;
  }>({ center: null, zoom: null });

  const [layerMode, setLayerMode] = useState<MapLayerMode>('meteo_vivo');
  const [baseCartography, setBaseCartography] = useState<BaseCartographyMode>('hybrid');
  const [satelliteSensor, setSatelliteSensor] = useState<SatelliteSensorLayer>('goes_ir');
  const [showRadarTiles, setShowRadarTiles] = useState(true);
  const [showOsintInfraPins, setShowOsintInfraPins] = useState(true);
  const [showCitizenPins, setShowCitizenPins] = useState(true);

  const [activeInfoReport, setActiveInfoReport] = useState<CitizenReportDoc | null>(null);
  const [activeOsintItem, setActiveOsintItem] = useState<OsintReportItem | null>(null);

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    try {
      if (containerRef.current && containerRef.current.requestFullscreen) {
        await containerRef.current.requestFullscreen();
        wasNativeFullscreenRef.current = Boolean(document.fullscreenElement);
      }
    } catch {
      // Sandbox iFrame environments may block native requestFullscreen;
      // fixed inset-0 z-[100] w-screen h-screen guarantees full-viewport expansion seamlessly.
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore if native fullscreen was not active
    }
    wasNativeFullscreenRef.current = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  useEffect(() => {
    if (externalFullscreenTrigger > 0) {
      void enterFullscreen();
    }
  }, [externalFullscreenTrigger, enterFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void exitFullscreen();
      }
    };

    const handleNativeFullscreenChange = () => {
      if (document.fullscreenElement) {
        wasNativeFullscreenRef.current = true;
      } else if (wasNativeFullscreenRef.current) {
        wasNativeFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleNativeFullscreenChange);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleNativeFullscreenChange);
    };
  }, [isFullscreen, exitFullscreen]);

  // Build Evolution Steps: Past Radar Frames -> AHORA (En Vivo) -> +1h..+24h Hourly Evolution
  const evolutionSteps: EvolutionStep[] = useMemo(() => {
    const pastFrames = radarFrames.filter((f) => !f.isForecast);
    const latestPast = pastFrames.length > 0 ? pastFrames[pastFrames.length - 1] : null;
    const earlierPast = pastFrames.slice(0, Math.max(0, pastFrames.length - 1));

    const steps: EvolutionStep[] = earlierPast.map((frame) => {
      const dt = new Date(frame.time * 1000);
      const hm = dt.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
      const minsAgo = Math.max(10, Math.round((Date.now() - frame.time * 1000) / 60000));
      return {
        id: `radar_${frame.time}`,
        kind: 'radar_past',
        label: `Radar Doppler hace ${minsAgo} min (${hm})`,
        shortTag: `-${minsAgo}m`,
        radarPath: frame.path,
        hourOffset: 0,
      };
    });

    steps.push({
      id: 'live_now',
      kind: 'live_now',
      label: 'AHORA · Meteorología en Tiempo Real',
      shortTag: 'AHORA',
      radarPath: latestPast ? latestPast.path : null,
      hourOffset: 0,
    });

    const sampleZone = telemetryList[0];
    for (const offset of FORECAST_OFFSETS) {
      const hrPoint = sampleZone?.hourly48h?.[offset];
      const timePart = hrPoint?.time ? hrPoint.time.slice(11, 16) : `+${offset}h`;
      steps.push({
        id: `fc_${offset}`,
        kind: 'hourly_forecast',
        label: `Evolución +${offset}h (${timePart} EC)`,
        shortTag: `+${offset}h`,
        radarPath: null,
        hourOffset: offset,
      });
    }

    return steps;
  }, [radarFrames, telemetryList]);

  const liveStepIndex = useMemo(() => {
    const idx = evolutionSteps.findIndex((s) => s.id === 'live_now');
    return idx >= 0 ? idx : 0;
  }, [evolutionSteps]);

  const [stepIdx, setStepIdx] = useState<number>(liveStepIndex);
  const [isPlayingEvolution, setIsPlayingEvolution] = useState(false);

  useEffect(() => {
    if (!isPlayingEvolution) {
      setStepIdx((prev) => {
        const currentStep = evolutionSteps[prev];
        if (!currentStep || currentStep.id === 'live_now') {
          return liveStepIndex;
        }
        return Math.min(prev, evolutionSteps.length - 1);
      });
    }
  }, [liveStepIndex, evolutionSteps, isPlayingEvolution]);

  useEffect(() => {
    if (!isPlayingEvolution) return;
    const timer = setInterval(() => {
      setStepIdx((prev) => (prev + 1) % evolutionSteps.length);
    }, 1500);
    return () => clearInterval(timer);
  }, [isPlayingEvolution, evolutionSteps.length]);

  const activeStep = evolutionSteps[stepIdx] ?? {
    id: 'live_now',
    kind: 'live_now' as const,
    label: 'AHORA · Meteorología en Tiempo Real',
    shortTag: 'AHORA',
    radarPath: null,
    hourOffset: 0,
  };

  useEffect(() => {
    const view = scope === 'guayaquil' ? GUAYAQUIL_VIEW : ECUADOR_MAINLAND_VIEW;
    setFlyTarget({ center: view.center, zoom: view.zoom });
    setActiveInfoReport(null);
    setActiveOsintItem(null);
  }, [scope]);

  useEffect(() => {
    const found = telemetryList.find((t) => t.zone.id === selectedZoneId);
    if (found) {
      setFlyTarget({
        center: { lat: found.zone.lat, lng: found.zone.lng },
        zoom: scope === 'guayaquil' ? 12.8 : found.zone.id === 'ec_galapagos' ? 9.2 : 8.2,
      });
    }
  }, [selectedZoneId, scope, telemetryList]);

  useEffect(() => {
    if (!focusedOsintItem) return;
    setShowOsintInfraPins(true);
    setActiveInfoReport(null);
    setActiveOsintItem(focusedOsintItem);
    setFlyTarget({
      center: { lat: focusedOsintItem.lat, lng: focusedOsintItem.lng },
      zoom: focusedOsintItem.scope === 'guayaquil' ? 13.8 : 10.2,
    });
  }, [focusedOsintItem]);

  const handleCameraChanged = useCallback((ev: MapCameraChangedEvent) => {
    setCamera({
      center: ev.detail.center,
      zoom: ev.detail.zoom,
    });
  }, []);

  const clearFlyTarget = useCallback(() => {
    setFlyTarget({ center: null, zoom: null });
  }, []);

  const zoneSnapshots = useMemo(() => {
    return telemetryList.map((item) => {
      if (activeStep.kind === 'hourly_forecast') {
        const pt = item.hourly48h[activeStep.hourOffset] ?? item.hourly48h[0];
        const precipMm = Number((pt?.precipitationMm ?? 0).toFixed(2));
        const tempC = Number((pt?.tempC ?? item.tempC).toFixed(1));
        const cloudCoverPct = Math.round(pt?.cloudCoverPct ?? item.cloudCoverPct);
        const weatherCode = pt?.weatherCode ?? item.weatherCode;
        const windSpeedKmh = Number((pt?.windSpeedKmh ?? item.windSpeedKmh).toFixed(1));
        const windDirectionDeg = pt?.windDirectionDeg ?? item.windDirectionDeg;
        const probPct = pt?.precipProbability ?? 0;
        const cond = describeWeatherCondition(weatherCode, precipMm, cloudCoverPct);
        return {
          item,
          precipMm,
          tempC,
          cloudCoverPct,
          weatherCode,
          windSpeedKmh,
          windDirectionDeg,
          probPct,
          cond,
        };
      }

      const cond = describeWeatherCondition(
        item.weatherCode,
        item.currentPrecipMm,
        item.cloudCoverPct
      );
      return {
        item,
        precipMm: item.currentPrecipMm,
        tempC: item.tempC,
        cloudCoverPct: item.cloudCoverPct,
        weatherCode: item.weatherCode,
        windSpeedKmh: item.windSpeedKmh,
        windDirectionDeg: item.windDirectionDeg,
        probPct: item.hourly48h[0]?.precipProbability ?? 0,
        cond,
      };
    });
  }, [telemetryList, activeStep]);

  const liveSummary = useMemo(() => {
    if (zoneSnapshots.length === 0) {
      return {
        rainingCount: 0,
        maxPrecipMm: 0,
        avgTempC: 0,
        avgCloudPct: 0,
        avgWindKmh: 0,
        dominantCompass: 'SO',
      };
    }
    const rainingCount = zoneSnapshots.filter((s) => s.precipMm >= 0.1).length;
    const maxPrecipMm = Math.max(0, ...zoneSnapshots.map((s) => s.precipMm));
    const avgTempC =
      zoneSnapshots.reduce((acc, s) => acc + s.tempC, 0) / zoneSnapshots.length;
    const avgCloudPct = Math.round(
      zoneSnapshots.reduce((acc, s) => acc + s.cloudCoverPct, 0) / zoneSnapshots.length
    );
    const avgWindKmh =
      zoneSnapshots.reduce((acc, s) => acc + s.windSpeedKmh, 0) / zoneSnapshots.length;
    const dominantCompass = degreesToCompass(zoneSnapshots[0].windDirectionDeg);

    return {
      rainingCount,
      maxPrecipMm,
      avgTempC: Number(avgTempC.toFixed(1)),
      avgCloudPct,
      avgWindKmh: Number(avgWindKmh.toFixed(1)),
      dominantCompass,
    };
  }, [zoneSnapshots]);

  const scopedReports = useMemo(
    () => reports.filter((r) => r.scope === scope && r.status !== 'mitigado'),
    [reports, scope]
  );

  const scopedOsint = useMemo(
    () => osintReports.filter((o) => o.scope === scope),
    [osintReports, scope]
  );

  const activeSatelliteMeta =
    satelliteSensor !== 'none' ? SATELLITE_SENSOR_CONFIGS[satelliteSensor] : null;

  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[100] w-screen h-screen bg-slate-100 overflow-hidden'
          : `relative w-full ${heightClassName} bg-slate-100 border border-slate-300 rounded-xl overflow-hidden`
      }
    >
      <Map
        center={camera.center}
        zoom={camera.zoom}
        onCameraChanged={handleCameraChanged}
        mapId="DEMO_MAP_ID"
        mapTypeId={baseCartography}
        colorScheme={ColorScheme.LIGHT}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        fullscreenControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="w-full h-full"
      >
        <CameraController
          targetCenter={flyTarget.center}
          targetZoom={flyTarget.zoom}
          onSettled={clearFlyTarget}
        />

        {/* Real-Time Satellite Sensor Overlay (GOES-East Clean IR, GHRSST Sea Surface Temp, NASA GPM IMERG) */}
        <SatelliteSensorOverlayController sensor={satelliteSensor} />

        {/* Live RainViewer Doppler Radar Overlay */}
        <RadarOverlayController
          enabled={layerMode === 'meteo_vivo' && showRadarTiles && Boolean(activeStep.radarPath)}
          radarHost={radarHost}
          radarPath={activeStep.radarPath}
        />

        {/* Circles: In 'meteo_vivo' ONLY draw footprints where rain is ACTUALLY falling (>= 0.1 mm/h) */}
        {zoneSnapshots.map((snap) => {
          const { item, precipMm, weatherCode } = snap;
          const isSelected = item.zone.id === selectedZoneId;

          if (layerMode === 'meteo_vivo') {
            if (precipMm < 0.1) {
              return null;
            }
            const pal = getLivePrecipPalette(precipMm, weatherCode);
            const dynamicRadius = Math.round(
              item.zone.impactRadiusM * Math.min(1.65, Math.max(0.7, 0.65 + precipMm * 0.14))
            );
            return (
              <Circle
                key={`rain_cell_${item.zone.id}`}
                center={{ lat: item.zone.lat, lng: item.zone.lng }}
                radius={dynamicRadius}
                strokeColor={pal.stroke}
                strokeOpacity={isSelected ? 0.95 : 0.78}
                strokeWeight={isSelected ? 2.2 : 1.4}
                fillColor={pal.fill}
                fillOpacity={Math.min(0.42, 0.18 + precipMm * 0.035)}
                onClick={() => onSelectZone(item.zone.id)}
              />
            );
          }

          const colors = getTierColors(item.alertTier);
          return (
            <Circle
              key={`enso_circle_${item.zone.id}`}
              center={{ lat: item.zone.lat, lng: item.zone.lng }}
              radius={item.zone.impactRadiusM}
              strokeColor={colors.stroke}
              strokeOpacity={isSelected ? 0.95 : 0.68}
              strokeWeight={isSelected ? 2.2 : 1.3}
              fillColor={colors.fill}
              fillOpacity={isSelected ? 0.26 : 0.14}
              onClick={() => onSelectZone(item.zone.id)}
            />
          );
        })}

        {/* Sector & Provincial Markers: High-Contrast Readouts over both Light Map & Satellite */}
        {zoneSnapshots.map((snap) => {
          const {
            item,
            precipMm,
            tempC,
            cloudCoverPct,
            weatherCode,
            windSpeedKmh,
            windDirectionDeg,
            cond,
          } = snap;
          const isSelected = item.zone.id === selectedZoneId;

          if (layerMode === 'meteo_vivo') {
            const pal = getLivePrecipPalette(precipMm, weatherCode);
            return (
              <AdvancedMarker
                key={item.zone.id}
                position={{ lat: item.zone.lat, lng: item.zone.lng }}
                onClick={() => onSelectZone(item.zone.id)}
                zIndex={isSelected ? 45 : precipMm >= 0.1 ? 30 : 20}
                title={`${item.zone.name} · ${cond.label} (${precipMm.toFixed(1)} mm/h)`}
              >
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border shadow-md transition-transform duration-150 ${
                    isSelected
                      ? precipMm >= 0.1
                        ? `${pal.chipCls} scale-110 ring-2 ring-sky-400`
                        : 'bg-slate-900 text-white border-white scale-110 ring-2 ring-sky-500'
                      : precipMm >= 0.1
                        ? pal.chipCls
                        : 'bg-white/95 text-slate-900 border-slate-300 hover:border-sky-600'
                  }`}
                >
                  {renderWeatherGlyph(weatherCode, precipMm, cloudCoverPct)}
                  <div className="flex flex-col leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold whitespace-nowrap max-w-[105px] truncate">
                        {item.zone.name}
                      </span>
                      <span className="font-mono tabular-nums text-[10px] font-semibold opacity-95">
                        {tempC.toFixed(1)}°
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-mono tabular-nums opacity-90">
                      <span>
                        {precipMm >= 0.1
                          ? `${precipMm.toFixed(1)} mm/h`
                          : `Seco · Nub ${cloudCoverPct}%`}
                      </span>
                      <Navigation
                        className="w-2.5 h-2.5 inline-block shrink-0 opacity-85"
                        style={{ transform: `rotate(${(windDirectionDeg + 180) % 360}deg)` }}
                      />
                      <span>{Math.round(windSpeedKmh)}k</span>
                    </div>
                  </div>
                </div>
              </AdvancedMarker>
            );
          }

          const colors = getTierColors(item.alertTier);
          return (
            <AdvancedMarker
              key={item.zone.id}
              position={{ lat: item.zone.lat, lng: item.zone.lng }}
              onClick={() => onSelectZone(item.zone.id)}
              zIndex={isSelected ? 40 : 20}
              title={`${item.zone.name} — Índice ENSO ${item.affectationIndex}/100`}
            >
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border shadow-md transition-transform duration-150 ${
                  isSelected
                    ? `${colors.badgeBg} scale-110 ring-2 ring-white`
                    : 'bg-white/95 text-slate-900 border-slate-300 hover:border-sky-600'
                }`}
              >
                <span
                  className={`font-mono tabular-nums text-[11px] font-bold ${
                    isSelected ? 'text-white' : colors.indexCls
                  }`}
                >
                  {item.affectationIndex}
                </span>
                <span className="text-[11px] font-semibold whitespace-nowrap max-w-[115px] truncate">
                  {item.zone.name}
                </span>
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Geotagged Open-Source / X / Ducts / Storm Drains / Flooded Roads Pins */}
        {showOsintInfraPins &&
          scopedOsint.map((osint) => {
            const codeChar =
              osint.osintCategory === 'ductos_alcantarillas'
                ? 'D'
                : osint.osintCategory === 'via_anegada'
                  ? 'V'
                  : 'X';
            const markerStyle =
              osint.osintCategory === 'ductos_alcantarillas'
                ? 'bg-amber-600 border-white text-white'
                : osint.osintCategory === 'via_anegada'
                  ? 'bg-rose-700 border-white text-white'
                  : 'bg-sky-700 border-white text-white';

            return (
              <AdvancedMarker
                key={osint.id}
                position={{ lat: osint.lat, lng: osint.lng }}
                onClick={() => {
                  setActiveInfoReport(null);
                  setActiveOsintItem(osint);
                }}
                zIndex={34}
                title={`${OSINT_CATEGORY_LABELS[osint.osintCategory]}: ${osint.title}`}
              >
                <div
                  className={`w-6 h-6 rounded-md border-2 flex items-center justify-center text-[10px] font-mono font-bold shadow-md cursor-pointer hover:scale-110 transition-transform ${markerStyle}`}
                >
                  {codeChar}
                </div>
              </AdvancedMarker>
            );
          })}

        {/* Geotagged Community Incident Markers */}
        {showCitizenPins &&
          scopedReports.map((rep) => (
            <AdvancedMarker
              key={`rep_${rep.id}`}
              position={{ lat: rep.lat, lng: rep.lng }}
              onClick={() => {
                setActiveOsintItem(null);
                setActiveInfoReport(rep);
              }}
              zIndex={36}
              title={`Registro territorial: ${rep.zoneName}`}
            >
              <div
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-mono font-bold shadow cursor-pointer ${
                  rep.severity === 'critica'
                    ? 'bg-rose-700 border-white text-white'
                    : rep.severity === 'alta'
                      ? 'bg-amber-600 border-white text-white'
                      : 'bg-sky-700 border-white text-white'
                }`}
              >
                !
              </div>
            </AdvancedMarker>
          ))}

        {/* InfoWindow for Community Incident */}
        {activeInfoReport && (
          <InfoWindow
            position={{ lat: activeInfoReport.lat, lng: activeInfoReport.lng }}
            onCloseClick={() => setActiveInfoReport(null)}
            maxWidth={290}
          >
            <div className="text-slate-900 p-1 space-y-1.5 font-sans">
              <div className="text-xs font-semibold text-slate-900">
                {CATEGORY_LABELS[activeInfoReport.category]} · {activeInfoReport.zoneName}
              </div>
              <p className="text-xs text-slate-700 leading-snug">
                {activeInfoReport.description}
              </p>
              <div className="text-[11px] font-mono text-slate-600 pt-1 border-t border-slate-200">
                Lámina: {activeInfoReport.waterDepthCm} cm · Familias: {activeInfoReport.affectedFamilies}
              </div>
            </div>
          </InfoWindow>
        )}

        {/* InfoWindow for Open-Source / X / Ducts / Sewers / Flooded Roads Update */}
        {activeOsintItem && (
          <InfoWindow
            position={{ lat: activeOsintItem.lat, lng: activeOsintItem.lng }}
            onCloseClick={() => setActiveOsintItem(null)}
            maxWidth={310}
          >
            <div className="text-slate-900 p-1 space-y-2 font-sans">
              <div className="text-[11px] font-semibold text-sky-800">
                {OSINT_CATEGORY_LABELS[activeOsintItem.osintCategory]} · {activeOsintItem.zoneName}
              </div>
              <div className="text-xs font-semibold text-slate-950 leading-snug">
                {activeOsintItem.title}
              </div>
              <div className="text-[11px] text-slate-600">
                {activeOsintItem.accountRef} · {activeOsintItem.sourceName}
              </div>
              <div className="flex items-center gap-3 pt-1.5 border-t border-slate-200 text-[11px] font-semibold">
                <a
                  href={activeOsintItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-900 underline hover:text-sky-700"
                >
                  Abrir noticia / reporte
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={activeOsintItem.xLiveSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-800 underline hover:text-sky-600"
                >
                  Ver en X en vivo
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* Top HUD Bar: Cartography Base + Satellite Sensor Layer + Mode Controls + Fullscreen */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 z-10 pointer-events-none">
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {/* Primary Mode Switch: Live Meteorology vs. 7D ENSO Risk */}
          <div className="flex items-center gap-0.5 p-0.5 bg-white/95 backdrop-blur-md border border-slate-300 rounded-lg shadow-sm">
            <button
              type="button"
              onClick={() => setLayerMode('meteo_vivo')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                layerMode === 'meteo_vivo'
                  ? 'bg-sky-700 text-white'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              Meteo en Vivo
            </button>
            <button
              type="button"
              onClick={() => setLayerMode('riesgo_enso')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                layerMode === 'riesgo_enso'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              Riesgo ENSO 7D
            </button>
          </div>

          {/* Base Cartography Switcher: Satélite Híbrido / Mapa Claro / Relieve */}
          <div className="flex items-center gap-0.5 p-0.5 bg-white/95 backdrop-blur-md border border-slate-300 rounded-lg shadow-sm">
            {(
              [
                { id: 'hybrid', label: 'Satélite' },
                { id: 'roadmap', label: 'Mapa Claro' },
                { id: 'terrain', label: 'Relieve' },
              ] as const
            ).map((bm) => (
              <button
                key={bm.id}
                type="button"
                onClick={() => setBaseCartography(bm.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  baseCartography === bm.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                {bm.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              const reset = scope === 'guayaquil' ? GUAYAQUIL_VIEW : ECUADOR_MAINLAND_VIEW;
              setFlyTarget({ center: reset.center, zoom: reset.zoom });
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-white/95 backdrop-blur-md text-slate-800 border border-slate-300 rounded-lg shadow-sm hover:border-sky-600 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <LocateFixed className="w-3.5 h-3.5 text-sky-700" />
            {scope === 'guayaquil' ? 'Encuadre Guayaquil' : 'Ecuador Continental'}
          </button>

          {scope === 'nacional' && (
            <button
              type="button"
              onClick={() => {
                onSelectZone('ec_galapagos');
                setFlyTarget({ center: GALAPAGOS_VIEW.center, zoom: GALAPAGOS_VIEW.zoom });
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-white/95 backdrop-blur-md text-slate-800 border border-slate-300 rounded-lg shadow-sm hover:border-sky-600 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Galápagos (Niño 1+2)
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {/* Satellite Sensor Layer Selector (GOES-East IR, GHRSST SST, NASA IMERG) */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/95 backdrop-blur-md border border-slate-300 rounded-lg shadow-sm">
            <Satellite className="w-3.5 h-3.5 text-sky-700 shrink-0" />
            <label htmlFor={`sat-layer-${scope}`} className="sr-only">
              Capa de información satelital
            </label>
            <select
              id={`sat-layer-${scope}`}
              value={satelliteSensor}
              onChange={(e) => setSatelliteSensor(e.target.value as SatelliteSensorLayer)}
              className="bg-transparent text-xs font-semibold text-slate-900 focus:outline-none cursor-pointer"
            >
              <option value="goes_ir">Capa Satelital: Nubosidad IR (GOES-East)</option>
              <option value="sst_nino">Capa Satelital: Temp. Mar TSM (Niño 1+2)</option>
              <option value="imerg_rain">Capa Satelital: Tasa Pluvial (NASA IMERG)</option>
              <option value="none">Capa Satelital: Desactivada</option>
            </select>
          </div>

          {layerMode === 'meteo_vivo' && (
            <button
              type="button"
              onClick={() => setShowRadarTiles((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                showRadarTiles
                  ? 'bg-sky-700 text-white border-sky-800'
                  : 'bg-white/95 text-slate-700 border-slate-300 hover:text-slate-950'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              Radar Doppler
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowOsintInfraPins((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showOsintInfraPins
                ? 'bg-amber-600 text-white border-amber-700'
                : 'bg-white/95 text-slate-700 border-slate-300 hover:text-slate-950'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Ductos · Vías · X ({scopedOsint.length})
          </button>

          {scopedReports.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCitizenPins((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                showCitizenPins
                  ? 'bg-rose-700 text-white border-rose-800'
                  : 'bg-white/95 text-slate-700 border-slate-300 hover:text-slate-950'
              }`}
            >
              Bitácora ({scopedReports.length})
            </button>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            title={
              isFullscreen
                ? 'Salir de pantalla completa (Esc)'
                : 'Ampliar mapa a pantalla completa'
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isFullscreen
                ? 'bg-slate-900 text-white border-slate-950 hover:bg-slate-800'
                : 'bg-white/95 text-slate-900 border-slate-300 hover:border-sky-600 hover:text-sky-800'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                Salir de pantalla completa
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-sky-700" />
                Pantalla completa
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Meteorological Condition Strip */}
      {layerMode === 'meteo_vivo' && (
        <div className="absolute top-14 left-3 right-3 z-10 pointer-events-none">
          <div className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 bg-white/95 backdrop-blur-md border border-slate-300 rounded-lg text-xs text-slate-800 shadow-sm">
            <span className="font-bold text-sky-800">{activeStep.label}</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            {liveSummary.rainingCount === 0 ? (
              <span className="text-emerald-700 font-semibold">
                Sin precipitación activa (0.0 mm/h) en los {zoneSnapshots.length} nodos
              </span>
            ) : (
              <span className="text-sky-800 font-semibold">
                Lluvia activa en {liveSummary.rainingCount}/{zoneSnapshots.length} nodos (máx.{' '}
                {liveSummary.maxPrecipMm.toFixed(1)} mm/h)
              </span>
            )}
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-mono tabular-nums font-medium text-slate-800">
              Nubosidad {liveSummary.avgCloudPct}% · {liveSummary.avgTempC}°C · Viento{' '}
              {liveSummary.dominantCompass} {liveSummary.avgWindKmh} km/h
            </span>
          </div>
        </div>
      )}

      {/* Bottom Interactive Evolution Timeline + Satellite Description + Legend */}
      <div className="absolute bottom-3 left-3 right-3 bg-white/95 backdrop-blur-md border border-slate-300 rounded-lg px-3 py-2.5 space-y-2 z-10 shadow-md">
        {layerMode === 'meteo_vivo' && evolutionSteps.length > 1 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsPlayingEvolution((p) => !p)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-sky-700 text-white rounded-md hover:bg-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isPlayingEvolution ? (
                <>
                  <Pause className="w-3 h-3" />
                  Pausar
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  Evolución
                </>
              )}
            </button>

            {activeStep.id !== 'live_now' && (
              <button
                type="button"
                onClick={() => {
                  setIsPlayingEvolution(false);
                  setStepIdx(liveStepIndex);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-slate-100 text-sky-800 border border-slate-300 rounded-md hover:border-sky-600 cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                En Vivo
              </button>
            )}

            <input
              type="range"
              min={0}
              max={evolutionSteps.length - 1}
              value={stepIdx}
              aria-label="Línea de tiempo de evolución meteorológica"
              onChange={(e) => {
                setIsPlayingEvolution(false);
                setStepIdx(Number(e.target.value));
              }}
              className="flex-1 min-w-[140px] accent-sky-700 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
            />

            <span className="font-mono tabular-nums text-[11px] text-slate-700 whitespace-nowrap shrink-0">
              Paso: <strong className="text-sky-800">{activeStep.shortTag}</strong> · Sync 60s (
              {secondsUntilNextSync}s)
            </span>
          </div>
        )}

        {activeSatelliteMeta && (
          <div className="text-[11px] text-slate-700 flex flex-wrap items-center gap-1.5 pt-0.5 border-t border-slate-200">
            <span className="font-semibold text-sky-800">Sensor Satelital Activo:</span>
            <span>{activeSatelliteMeta.legendText}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-800 pt-1 border-t border-slate-200">
          {layerMode === 'meteo_vivo' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-700">● Seco (0.0 mm/h)</span>
              <span className="text-cyan-800 font-semibold">▲ Llovizna (0.1–1.4)</span>
              <span className="text-sky-800 font-semibold">▲ Lluvia (1.5–7.4)</span>
              <span className="text-indigo-800 font-semibold">✖ Tormenta (≥7.5 mm/h)</span>
              <span className="text-amber-800 font-mono font-semibold">[D] Ductos/Alcantarillas</span>
              <span className="text-rose-800 font-mono font-semibold">[V] Vías Anegadas</span>
              <span className="text-sky-800 font-mono font-semibold">[X] Redes</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-emerald-700 font-semibold">● Nominal (&lt;26)</span>
              <span className="text-sky-700 font-semibold">▲ Vigilancia (26–47)</span>
              <span className="text-amber-700 font-semibold">▲ Alerta Naranja (48–71)</span>
              <span className="text-rose-700 font-semibold">✖ Alerta Roja (≥72)</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 font-mono tabular-nums text-slate-700">
            <Crosshair className="w-3 h-3 text-sky-700" />
            <span>
              {camera.center.lat.toFixed(4)}°, {camera.center.lng.toFixed(4)}° · Z
              {camera.zoom.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
