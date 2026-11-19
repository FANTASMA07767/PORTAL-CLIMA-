import { ALL_MONITORING_ZONES } from '../data/ecuadorZones';
import {
  AlertTier,
  CitizenReportDoc,
  DailyForecastPoint,
  HourlyDataPoint,
  LiveZoneTelemetry,
  MarineEnsoTelemetry,
  MonitoringZone,
  RiverFloodTelemetry,
} from '../types/climate';

interface OpenMeteoForecastItem {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    is_day?: number;
    precipitation?: number;
    rain?: number;
    showers?: number;
    weather_code?: number;
    cloud_cover?: number;
    surface_pressure?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
  hourly?: {
    time?: string[];
    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
    cloud_cover?: number[];
    temperature_2m?: number[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    soil_moisture_0_to_1cm?: number[];
  };
  daily?: {
    time?: string[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    wind_gusts_10m_max?: number[];
  };
}

const NINO_1_2_BASELINE_SST_C = 23.6;

export function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const normalized = ((deg % 360) + 360) % 360;
  return dirs[Math.round(normalized / 45) % 8];
}

export function describeWeatherCondition(
  weatherCode: number,
  precipMm: number,
  cloudCoverPct: number
): { label: string; shortLabel: string; isRaining: boolean } {
  const activePrecip = Number(precipMm || 0);
  if (weatherCode >= 95 && activePrecip >= 0.1) {
    return { label: 'Tormenta eléctrica activa', shortLabel: 'Tormenta', isRaining: true };
  }
  if (activePrecip >= 7.5) {
    return { label: 'Lluvia intensa en curso', shortLabel: 'Lluvia intensa', isRaining: true };
  }
  if (activePrecip >= 1.5) {
    return { label: 'Lluvia moderada activa', shortLabel: 'Lluvia activa', isRaining: true };
  }
  if (activePrecip >= 0.1) {
    return { label: 'Llovizna / lluvia ligera', shortLabel: 'Llovizna', isRaining: true };
  }
  // Explicitly dry right now (0.0 mm/h) even if WMO synoptic code reflects clouds
  if (cloudCoverPct >= 80 || weatherCode === 3) {
    return { label: 'Sin lluvia · Cielo cubierto', shortLabel: 'Nublado (seco)', isRaining: false };
  }
  if (cloudCoverPct >= 35 || weatherCode === 2 || weatherCode === 1) {
    return { label: 'Sin lluvia · Parcialmente nublado', shortLabel: 'Parcial (seco)', isRaining: false };
  }
  return { label: 'Sin lluvia · Cielo despejado', shortLabel: 'Despejado (seco)', isRaining: false };
}

export function classifyAlertTier(affectationIndex: number): AlertTier {
  if (affectationIndex >= 72) return 'roja';
  if (affectationIndex >= 48) return 'naranja';
  if (affectationIndex >= 26) return 'amarilla';
  return 'nominal';
}

function findCurrentHourIndex(hourlyTimes: string[], currentIso?: string): number {
  if (hourlyTimes.length === 0) return 0;
  if (currentIso) {
    const hourPrefix = currentIso.slice(0, 13); // "YYYY-MM-DDTHH"
    const idx = hourlyTimes.findIndex((t) => t.startsWith(hourPrefix));
    if (idx >= 0) return idx;
  }
  // Fallback using America/Guayaquil local clock (UTC-5)
  const ecNow = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 13);
  const idxFallback = hourlyTimes.findIndex((t) => t.startsWith(ecNow));
  return idxFallback >= 0 ? idxFallback : 0;
}

export function computeZoneTelemetry(
  zone: MonitoringZone,
  raw: OpenMeteoForecastItem,
  sstAnomalyC: number,
  riverAnomalyPct: number,
  reports: CitizenReportDoc[]
): LiveZoneTelemetry {
  const current = raw.current ?? {};
  const hourlyTimes = raw.hourly?.time ?? [];
  const hourlyPrecip = raw.hourly?.precipitation ?? [];
  const hourlyProb = raw.hourly?.precipitation_probability ?? [];
  const hourlyWeatherCode = raw.hourly?.weather_code ?? [];
  const hourlyCloud = raw.hourly?.cloud_cover ?? [];
  const hourlyTemp = raw.hourly?.temperature_2m ?? [];
  const hourlyWindSpd = raw.hourly?.wind_speed_10m ?? [];
  const hourlyWindDir = raw.hourly?.wind_direction_10m ?? [];
  const hourlySoil = raw.hourly?.soil_moisture_0_to_1cm ?? [];

  const startIdx = findCurrentHourIndex(hourlyTimes, current.time);

  const hourly48h: HourlyDataPoint[] = hourlyTimes
    .slice(startIdx, startIdx + 48)
    .map((time, offset) => {
      const idx = startIdx + offset;
      return {
        time,
        precipitationMm: Number(hourlyPrecip[idx] ?? 0),
        precipProbability: Number(hourlyProb[idx] ?? 0),
        tempC: Number(hourlyTemp[idx] ?? current.temperature_2m ?? 26),
        soilMoisture: Number(hourlySoil[idx] ?? 0.28),
        weatherCode: Number(hourlyWeatherCode[idx] ?? current.weather_code ?? 2),
        cloudCoverPct: Number(hourlyCloud[idx] ?? current.cloud_cover ?? 65),
        windSpeedKmh: Number(hourlyWindSpd[idx] ?? current.wind_speed_10m ?? 10),
        windDirectionDeg: Number(hourlyWindDir[idx] ?? current.wind_direction_10m ?? 215),
      };
    });

  const dailyTimes = raw.daily?.time ?? [];
  const dailyPrecip = raw.daily?.precipitation_sum ?? [];
  const dailyProb = raw.daily?.precipitation_probability_max ?? [];
  const dailyMaxT = raw.daily?.temperature_2m_max ?? [];
  const dailyMinT = raw.daily?.temperature_2m_min ?? [];
  const dailyGust = raw.daily?.wind_gusts_10m_max ?? [];

  const daily14d: DailyForecastPoint[] = dailyTimes.slice(0, 14).map((date, idx) => ({
    date,
    precipSumMm: Number(dailyPrecip[idx] ?? 0),
    precipProbMax: Number(dailyProb[idx] ?? 0),
    tempMaxC: Number(dailyMaxT[idx] ?? 30),
    tempMinC: Number(dailyMinT[idx] ?? 22),
    windGustMaxKmh: Number(dailyGust[idx] ?? 18),
  }));

  const currentPrecipMm = Number(
    (
      Number(current.precipitation ?? 0) ||
      Number(current.rain ?? 0) + Number(current.showers ?? 0)
    ).toFixed(2)
  );
  const cloudCoverPct = Number(current.cloud_cover ?? 65);
  const weatherCode = Number(current.weather_code ?? 2);
  const condition = describeWeatherCondition(weatherCode, currentPrecipMm, cloudCoverPct);

  const precip24hMm = hourly48h.slice(0, 24).reduce((acc, h) => acc + h.precipitationMm, 0);
  const precip7dMm = daily14d.slice(0, 7).reduce((acc, d) => acc + d.precipSumMm, 0);
  const precip14dMm = daily14d.reduce((acc, d) => acc + d.precipSumMm, 0);
  const maxProb72hPct = Math.max(0, ...daily14d.slice(0, 3).map((d) => d.precipProbMax));
  const soilMoistureIdx = hourly48h[0]?.soilMoisture ?? 0.3;

  const activeZoneReports = reports.filter(
    (r) => r.zoneId === zone.id && r.status !== 'mitigado'
  );
  const criticalBonus = activeZoneReports.reduce((acc, r) => {
    if (r.severity === 'critica') return acc + 12;
    if (r.severity === 'alta') return acc + 7;
    return acc + 4;
  }, 0);

  // Hydrological ENSO composite risk model (0 - 100)
  const rainPressure =
    Math.min(36, currentPrecipMm * 6.5 + precip24hMm * 0.85 + precip7dMm * 0.18);
  const ensoOceanicPressure = Math.max(0, Math.min(22, (sstAnomalyC + 0.6) * 8.5));
  const riverBasinPressure =
    zone.scope === 'guayaquil' || zone.id === 'ec_los_rios'
      ? Math.max(0, Math.min(18, riverAnomalyPct * 0.22))
      : Math.max(0, Math.min(12, soilMoistureIdx * 24));
  const humidityAndProbPressure =
    (Number(current.relative_humidity_2m ?? 70) / 100) * 8 + (maxProb72hPct / 100) * 10;

  const rawScore =
    (rainPressure + ensoOceanicPressure + riverBasinPressure + humidityAndProbPressure) *
      zone.drainageVulnerability +
    Math.min(28, criticalBonus);

  const affectationIndex = Math.round(Math.max(6, Math.min(99, rawScore)));
  const floodProbability72h = Math.round(
    Math.max(
      4,
      Math.min(
        98,
        maxProb72hPct * 0.48 +
          affectationIndex * 0.42 +
          (zone.elevationM <= 6 ? 9 : 0)
      )
    )
  );

  return {
    zone,
    tempC: Number(current.temperature_2m ?? 27.5),
    apparentTempC: Number(current.apparent_temperature ?? 30.2),
    humidityPct: Number(current.relative_humidity_2m ?? 76),
    currentPrecipMm,
    rainMm: Number(current.rain ?? 0),
    cloudCoverPct,
    pressureHpa: Number(current.surface_pressure ?? 1010.8),
    windSpeedKmh: Number(current.wind_speed_10m ?? 11.2),
    windDirectionDeg: Number(current.wind_direction_10m ?? 215),
    windGustsKmh: Number(current.wind_gusts_10m ?? 19.4),
    weatherCode,
    isDay: Number(current.is_day ?? 1) === 1,
    isRainingNow: condition.isRaining,
    weatherLabel: condition.label,
    precip24hMm: Number(precip24hMm.toFixed(1)),
    precip7dMm: Number(precip7dMm.toFixed(1)),
    precip14dMm: Number(precip14dMm.toFixed(1)),
    maxProb72hPct,
    soilMoistureIdx: Number(soilMoistureIdx.toFixed(3)),
    affectationIndex,
    floodProbability72h,
    alertTier: classifyAlertTier(affectationIndex),
    activeReportsCount: activeZoneReports.length,
    hourly48h,
    daily14d,
  };
}

export async function fetchAllClimateTelemetry(): Promise<{
  rawForecasts: Map<string, OpenMeteoForecastItem>;
  marine: MarineEnsoTelemetry;
  river: RiverFloodTelemetry;
  fetchedAtIso: string;
}> {
  const lats = ALL_MONITORING_ZONES.map((z) => z.lat.toFixed(4)).join(',');
  const lngs = ALL_MONITORING_ZONES.map((z) => z.lng.toFixed(4)).join(',');

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&hourly=precipitation_probability,precipitation,weather_code,cloud_cover,temperature_2m,wind_speed_10m,wind_direction_10m,soil_moisture_0_to_1cm` +
    `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max` +
    `&forecast_days=14&timezone=America%2FGuayaquil`;

  // Marine API: Gulf of Guayaquil offshore (-2.65, -81.15) & Galápagos (-0.90, -89.61)
  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=-2.65,-0.90&longitude=-81.15,-89.61` +
    `&current=sea_surface_temperature,wave_height` +
    `&daily=sea_surface_temperature_max` +
    `&forecast_days=14&timezone=America%2FGuayaquil`;

  // Global Flood API: Cuenca Baja Río Guayas (-2.18, -79.87)
  const floodUrl =
    `https://flood-api.open-meteo.com/v1/flood?latitude=-2.18&longitude=-79.87` +
    `&daily=river_discharge,river_discharge_mean,river_discharge_max` +
    `&forecast_days=14`;

  const [forecastRes, marineRes, floodRes] = await Promise.all([
    fetch(forecastUrl, { cache: 'no-store' }),
    fetch(marineUrl, { cache: 'no-store' }).catch(() => null),
    fetch(floodUrl, { cache: 'no-store' }).catch(() => null),
  ]);

  if (!forecastRes.ok) {
    throw new Error(`Error al consultar telemetría atmosférica (${forecastRes.status})`);
  }

  const forecastJson = await forecastRes.json();
  const forecastList: OpenMeteoForecastItem[] = Array.isArray(forecastJson)
    ? forecastJson
    : [forecastJson];

  const rawForecasts = new Map<string, OpenMeteoForecastItem>();
  ALL_MONITORING_ZONES.forEach((zone, idx) => {
    rawForecasts.set(zone.id, forecastList[idx] ?? forecastList[0] ?? {});
  });

  // Parse Marine SST
  let coastalSstC = 25.1;
  let galapagosSstC = 24.4;
  let waveHeightM = 1.35;
  let dailySstTrend: { date: string; coastalSstC: number; anomalyC: number }[] = [];

  if (marineRes && marineRes.ok) {
    const marineJson = await marineRes.json();
    const marineArr = Array.isArray(marineJson) ? marineJson : [marineJson];
    const coastNode = marineArr[0];
    const galNode = marineArr[1] ?? marineArr[0];
    coastalSstC = Number(coastNode?.current?.sea_surface_temperature ?? 25.1);
    waveHeightM = Number(coastNode?.current?.wave_height ?? 1.35);
    galapagosSstC = Number(galNode?.current?.sea_surface_temperature ?? 24.4);

    const mDates: string[] = coastNode?.daily?.time ?? [];
    const mMaxSst: number[] = coastNode?.daily?.sea_surface_temperature_max ?? [];
    dailySstTrend = mDates.map((date, i) => {
      const val = Number(mMaxSst[i] ?? coastalSstC);
      return {
        date,
        coastalSstC: Number(val.toFixed(2)),
        anomalyC: Number((val - NINO_1_2_BASELINE_SST_C).toFixed(2)),
      };
    });
  }

  const meanSst = (coastalSstC + galapagosSstC) / 2;
  const sstAnomalyC = Number((meanSst - NINO_1_2_BASELINE_SST_C).toFixed(2));
  const ensoPhaseLabel =
    sstAnomalyC >= 1.5
      ? 'El Niño Fuerte (Niño 1+2)'
      : sstAnomalyC >= 0.5
        ? 'Calentamiento Activo El Niño'
        : sstAnomalyC >= 0.0
          ? 'Vigilancia Cálida Costera'
          : 'Condición Neutral Costera';

  const marine: MarineEnsoTelemetry = {
    coastalSstC: Number(coastalSstC.toFixed(2)),
    galapagosSstC: Number(galapagosSstC.toFixed(2)),
    sstAnomalyC,
    waveHeightM: Number(waveHeightM.toFixed(2)),
    ensoPhaseLabel,
    dailySstTrend,
  };

  // Parse River Flood Discharge
  let currentDischargeM3s = 940;
  let meanHistoricalM3s = 780;
  let peakForecast14dM3s = 1120;
  let series14d: RiverFloodTelemetry['series14d'] = [];

  if (floodRes && floodRes.ok) {
    const floodJson = await floodRes.json();
    const fDates: string[] = floodJson?.daily?.time ?? [];
    const fDis: number[] = floodJson?.daily?.river_discharge ?? [];
    const fMean: number[] = floodJson?.daily?.river_discharge_mean ?? [];
    const fMax: number[] = floodJson?.daily?.river_discharge_max ?? [];

    series14d = fDates.map((date, idx) => ({
      date,
      dischargeM3s: Number((fDis[idx] ?? 850).toFixed(1)),
      meanM3s: Number((fMean[idx] ?? 760).toFixed(1)),
      maxM3s: Number((fMax[idx] ?? fDis[idx] ?? 920).toFixed(1)),
    }));

    if (series14d.length > 0) {
      currentDischargeM3s = series14d[0].dischargeM3s;
      meanHistoricalM3s = Math.max(1, series14d[0].meanM3s);
      peakForecast14dM3s = Math.max(...series14d.map((s) => s.maxM3s));
    }
  }

  const dischargeAnomalyPct = Number(
    (((currentDischargeM3s - meanHistoricalM3s) / Math.max(1, meanHistoricalM3s)) * 100).toFixed(1)
  );

  const river: RiverFloodTelemetry = {
    stationName: 'Cuenca Baja Río Guayas (Confluencia Daule · Babahoyo)',
    currentDischargeM3s,
    meanHistoricalM3s,
    peakForecast14dM3s,
    dischargeAnomalyPct,
    series14d,
  };

  return {
    rawForecasts,
    marine,
    river,
    fetchedAtIso: new Date().toISOString(),
  };
}
