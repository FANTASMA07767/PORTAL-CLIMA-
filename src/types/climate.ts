export enum ScopeMode {
  GUAYAQUIL = 'guayaquil',
  NACIONAL = 'nacional',
}

export enum ActiveTab {
  GUAYAQUIL = 'guayaquil',
  NACIONAL = 'nacional',
  REPORTES = 'reportes',
  RIESGOS = 'riesgos',
}

export type ReportCategory =
  | 'inundacion_vial'
  | 'desbordamiento'
  | 'deslizamiento'
  | 'alcantarillado'
  | 'corte_electrico'
  | 'vivienda_afectada';

export type SeverityLevel = 'moderada' | 'alta' | 'critica';

export type ReportStatus = 'reportado' | 'en_verificacion' | 'en_atencion' | 'mitigado';

export type AlertTier = 'nominal' | 'amarilla' | 'naranja' | 'roja';

export interface MonitoringZone {
  id: string;
  name: string;
  sublabel: string;
  scope: 'guayaquil' | 'nacional';
  lat: number;
  lng: number;
  elevationM: number;
  drainageVulnerability: number; // 1.0 - 1.55 hydrological sensitivity factor
  populationExposed: number;
  hydrologyBasin: string;
  mitigationProtocol: string;
  impactRadiusM: number;
}

export interface HourlyDataPoint {
  time: string;
  precipitationMm: number;
  precipProbability: number;
  tempC: number;
  soilMoisture: number;
  weatherCode: number;
  cloudCoverPct: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
}

export interface DailyForecastPoint {
  date: string;
  precipSumMm: number;
  precipProbMax: number;
  tempMaxC: number;
  tempMinC: number;
  windGustMaxKmh: number;
}

export interface LiveZoneTelemetry {
  zone: MonitoringZone;
  tempC: number;
  apparentTempC: number;
  humidityPct: number;
  currentPrecipMm: number;
  rainMm: number;
  cloudCoverPct: number;
  pressureHpa: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  windGustsKmh: number;
  weatherCode: number;
  isDay: boolean;
  isRainingNow: boolean;
  weatherLabel: string;
  precip24hMm: number;
  precip7dMm: number;
  precip14dMm: number;
  maxProb72hPct: number;
  soilMoistureIdx: number;
  affectationIndex: number; // 0 - 100 composite hydrological & citizen index
  floodProbability72h: number; // 0 - 100%
  alertTier: AlertTier;
  activeReportsCount: number;
  hourly48h: HourlyDataPoint[];
  daily14d: DailyForecastPoint[];
}

export interface MarineEnsoTelemetry {
  coastalSstC: number;
  galapagosSstC: number;
  sstAnomalyC: number; // vs 23.6°C historical baseline in Niño 1+2
  waveHeightM: number;
  ensoPhaseLabel: string;
  dailySstTrend: { date: string; coastalSstC: number; anomalyC: number }[];
}

export interface RiverFloodTelemetry {
  stationName: string;
  currentDischargeM3s: number;
  meanHistoricalM3s: number;
  peakForecast14dM3s: number;
  dischargeAnomalyPct: number;
  series14d: {
    date: string;
    dischargeM3s: number;
    meanM3s: number;
    maxM3s: number;
  }[];
}

export interface CitizenReportDoc {
  id: string;
  scope: 'guayaquil' | 'nacional';
  zoneId: string;
  zoneName: string;
  category: ReportCategory;
  severity: SeverityLevel;
  waterDepthCm: number;
  affectedFamilies: number;
  description: string;
  reporterAlias: string;
  authorId: string;
  lat: number;
  lng: number;
  status: ReportStatus;
  visibility: 'publico' | 'archivado';
  upvotes: number;
  adminNote: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export type OsintCategory =
  | 'ductos_alcantarillas'
  | 'via_anegada'
  | 'redes_x'
  | 'evento_pluvial';

export interface OsintReportItem {
  id: string;
  title: string;
  summary: string;
  osintCategory: OsintCategory;
  channelLabel: string;
  accountRef: string;
  severity: SeverityLevel;
  scope: 'guayaquil' | 'nacional';
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  publishedAtIso: string;
  sourceName: string;
  url: string;
  xLiveSearchUrl: string;
}

export interface RadarFrameItem {
  time: number;
  path: string;
  isForecast: boolean;
}

export type GovEntityCode = 'SNGR' | 'INAMHI' | 'INOCAR_ERFEN' | 'SEGURA_EP';

export type GovAlertLevel = 'roja' | 'naranja' | 'amarilla' | 'informativa';

export interface GovernmentAlertItem {
  id: string;
  entityCode: GovEntityCode;
  entityName: string;
  title: string;
  summary: string;
  alertLevel: GovAlertLevel;
  scope: 'guayaquil' | 'nacional';
  publishedAtIso: string;
  sourceName: string;
  url: string;
  portalUrl: string;
}

export interface NoaaNino12Reading {
  weekLabel: string;
  sstC: number;
  anomalyC: number;
  nino34SstC: number;
  nino34AnomalyC: number;
}

// Verbatim validation constraints synchronized with firebase-blueprint.json
export const BLUEPRINT_CONSTRAINTS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  ZONE_ID_MIN: 2,
  ZONE_ID_MAX: 64,
  ZONE_NAME_MIN: 2,
  ZONE_NAME_MAX: 80,
  DESCRIPTION_MIN: 10,
  DESCRIPTION_MAX: 500,
  ALIAS_MIN: 2,
  ALIAS_MAX: 60,
  ADMIN_NOTE_MAX: 300,
  WATER_DEPTH_MIN: 0,
  WATER_DEPTH_MAX: 500,
  FAMILIES_MIN: 0,
  FAMILIES_MAX: 10000,
  LAT_MIN: -6.0,
  LAT_MAX: 2.5,
  LNG_MIN: -92.5,
  LNG_MAX: -75.0,
} as const;

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  inundacion_vial: 'Inundación vial',
  desbordamiento: 'Desbordamiento de estero / río',
  deslizamiento: 'Deslizamiento de ladera',
  alcantarillado: 'Colapso de alcantarillado',
  corte_electrico: 'Corte eléctrico por tormenta',
  vivienda_afectada: 'Ingreso de agua a viviendas',
};

export const OSINT_CATEGORY_LABELS: Record<OsintCategory, string> = {
  ductos_alcantarillas: 'Ductos y alcantarillado',
  via_anegada: 'Vías anegadas y tránsito',
  redes_x: 'Redes sociales (X / abiertas)',
  evento_pluvial: 'Evento pluvial abierto',
};

export const STATUS_LABELS: Record<ReportStatus, string> = {
  reportado: 'Reportado',
  en_verificacion: 'En verificación',
  en_atencion: 'Brigada en atención',
  mitigado: 'Mitigado',
};

export const DIRECTOR_ADMIN_EMAIL = 'lidermancoordinador2@gmail.com';
