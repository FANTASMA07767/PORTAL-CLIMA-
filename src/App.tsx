/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  ArrowUpDown,
  CloudRain,
  Droplets,
  ExternalLink,
  LocateFixed,
  Menu,
  RefreshCw,
  Shield,
  Thermometer,
  Waves,
  X,
} from 'lucide-react';
import { CitizenReportsModule } from './components/CitizenReportsModule';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InteractiveRiskMap } from './components/InteractiveRiskMap';
import { RiskManagementConsole } from './components/RiskManagementConsole';
import { ClimatycProvider, useClimatyc } from './context/ClimatycContext';
import { degreesToCompass } from './services/climateService';
import {
  ActiveTab,
  AlertTier,
  LiveZoneTelemetry,
  OSINT_CATEGORY_LABELS,
  OsintCategory,
  OsintReportItem,
} from './types/climate';

const GUAYAQUIL_HERO_IMG =
  '/src/assets/images/jmac_climatyc_guayaquil_aerial_1793055543240.jpg';

function formatTierText(tier: AlertTier) {
  switch (tier) {
    case 'roja':
      return { text: '✖ Alerta Roja', cls: 'text-rose-700' };
    case 'naranja':
      return { text: '▲ Alerta Naranja', cls: 'text-amber-700' };
    case 'amarilla':
      return { text: '▲ Vigilancia', cls: 'text-sky-700' };
    default:
      return { text: '● Nominal', cls: 'text-emerald-700' };
  }
}

const WorkspaceShell: React.FC = () => {
  const {
    guayaquilTelemetry,
    nacionalTelemetry,
    marine,
    river,
    lastUpdatedIso,
    loadingClimate,
    climateError,
    refreshClimate,
    govAlerts,
    osintReports,
    loadingOsint,
    refreshOsintReports,
    secondsUntilNextSync,
    reports,
  } = useClimatyc();

  const [activeTab, setActiveTab] = useState<ActiveTab>(ActiveTab.GUAYAQUIL);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedGyeZoneId, setSelectedGyeZoneId] = useState<string>('gye_monte_sinai');
  const [selectedNacZoneId, setSelectedNacZoneId] = useState<string>('ec_los_rios');
  const [focusedGyeOsint, setFocusedGyeOsint] = useState<OsintReportItem | null>(null);
  const [focusedNacOsint, setFocusedNacOsint] = useState<OsintReportItem | null>(null);

  const [sortBy, setSortBy] = useState<'index' | 'liveRain' | 'rain24h' | 'rain7d'>('index');
  const [infraCategoryFilter, setInfraCategoryFilter] = useState<'all' | OsintCategory>('all');
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const selectedGyeTelemetry: LiveZoneTelemetry | undefined = useMemo(
    () =>
      guayaquilTelemetry.find((z) => z.zone.id === selectedGyeZoneId) ??
      guayaquilTelemetry[0],
    [guayaquilTelemetry, selectedGyeZoneId]
  );

  const selectedNacTelemetry: LiveZoneTelemetry | undefined = useMemo(
    () =>
      nacionalTelemetry.find((z) => z.zone.id === selectedNacZoneId) ??
      nacionalTelemetry[0],
    [nacionalTelemetry, selectedNacZoneId]
  );

  const sortedGyeList = useMemo(() => {
    const copy = [...guayaquilTelemetry];
    copy.sort((a, b) => {
      if (sortBy === 'liveRain') return b.currentPrecipMm - a.currentPrecipMm;
      if (sortBy === 'rain24h') return b.precip24hMm - a.precip24hMm;
      if (sortBy === 'rain7d') return b.precip7dMm - a.precip7dMm;
      return b.affectationIndex - a.affectationIndex;
    });
    return copy;
  }, [guayaquilTelemetry, sortBy]);

  const sortedNacList = useMemo(() => {
    const copy = [...nacionalTelemetry];
    copy.sort((a, b) => b.affectationIndex - a.affectationIndex);
    return copy;
  }, [nacionalTelemetry]);

  const peakGyeZone = useMemo(() => {
    if (guayaquilTelemetry.length === 0) return null;
    return [...guayaquilTelemetry].sort((a, b) => b.affectationIndex - a.affectationIndex)[0];
  }, [guayaquilTelemetry]);

  const gyeMeanRain7d = useMemo(() => {
    if (guayaquilTelemetry.length === 0) return 0;
    const sum = guayaquilTelemetry.reduce((acc, z) => acc + z.precip7dMm, 0);
    return Number((sum / guayaquilTelemetry.length).toFixed(1));
  }, [guayaquilTelemetry]);

  const gyeLiveWeatherStats = useMemo(() => {
    if (guayaquilTelemetry.length === 0) {
      return { rainingCount: 0, maxLivePrecipMm: 0, meanCloudPct: 0 };
    }
    const rainingCount = guayaquilTelemetry.filter((z) => z.currentPrecipMm >= 0.1).length;
    const maxLivePrecipMm = Math.max(0, ...guayaquilTelemetry.map((z) => z.currentPrecipMm));
    const meanCloudPct = Math.round(
      guayaquilTelemetry.reduce((acc, z) => acc + z.cloudCoverPct, 0) / guayaquilTelemetry.length
    );
    return { rainingCount, maxLivePrecipMm, meanCloudPct };
  }, [guayaquilTelemetry]);

  const gyeOsintFeed = useMemo(() => {
    return osintReports.filter((item) => {
      if (item.scope !== 'guayaquil') return false;
      if (infraCategoryFilter !== 'all' && item.osintCategory !== infraCategoryFilter) {
        return false;
      }
      return true;
    });
  }, [osintReports, infraCategoryFilter]);

  const nacOsintFeed = useMemo(() => {
    return osintReports.filter((item) => item.scope === 'nacional');
  }, [osintReports]);

  const navItems: { id: ActiveTab; label: string }[] = [
    { id: ActiveTab.GUAYAQUIL, label: 'Guayaquil' },
    { id: ActiveTab.NACIONAL, label: 'Ecuador Nacional' },
    { id: ActiveTab.REPORTES, label: 'Observatorio Redes y Vías' },
    { id: ActiveTab.RIESGOS, label: 'Gestión de Riesgos' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-white via-slate-50 to-sky-50/75 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/92 backdrop-blur-md border-b border-slate-200/95">
        <div className="max-w-[1380px] mx-auto flex items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab(ActiveTab.GUAYAQUIL);
            }}
            className="text-lg font-bold font-display tracking-tight text-slate-950 whitespace-nowrap shrink-0"
          >
            JMAC-Climatyc
          </a>

          {/* Zone 2: 4 concise single-line text navigation links */}
          <nav className="hidden lg:flex items-center gap-7 text-sm font-semibold text-slate-600">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                    isActive
                      ? 'text-sky-800 border-sky-700'
                      : 'border-transparent hover:text-slate-950 hover:border-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary observatory action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  activeTab === ActiveTab.REPORTES ? ActiveTab.RIESGOS : ActiveTab.REPORTES
                )
              }
              className="px-4 py-2 text-xs font-semibold bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {activeTab === ActiveTab.REPORTES ? 'Alertas Oficiales' : 'Monitor Redes y Vías'}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Abrir navegación"
              className="lg:hidden p-2 text-slate-700 hover:text-slate-950 border border-slate-300 rounded-lg cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Collapsible Nav */}
        {mobileMenuOpen && (
          <div className="lg:hidden px-6 pb-4 pt-2 border-t border-slate-200 bg-white flex flex-wrap gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-sky-700 text-white'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Sub-Header Observatory Toolbar (Live 60s Sync Controls) */}
      <div className="bg-gradient-to-r from-slate-50 via-white to-sky-50/70 border-b border-slate-200">
        <div className="max-w-[1380px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-sky-700 shrink-0" />
            <span>
              Observatorio JMAC Security · Diseñado y administrado por{' '}
              <strong className="text-slate-950 font-semibold">
                José Manuel Arguello C. (Jmac-Climatyc)
              </strong>
            </span>
            {lastUpdatedIso && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-700">
                  Actualizado:{' '}
                  {new Date(lastUpdatedIso).toLocaleTimeString('es-EC', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}{' '}
                  · Próximo ciclo 60s en{' '}
                  <strong className="text-sky-800">{secondsUntilNextSync}s</strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void refreshClimate()}
              disabled={loadingClimate}
              className="inline-flex items-center gap-1.5 font-semibold text-sky-800 hover:text-sky-950 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingClimate ? 'animate-spin' : ''}`} />
              Actualizar todo ahora
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Stage */}
      <main id="top" className="flex-1 max-w-[1380px] w-full mx-auto px-6 py-8 space-y-8">
        {climateError && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-4 text-xs text-rose-900">
            <span className="font-medium">{climateError}</span>
            <button
              type="button"
              onClick={() => void refreshClimate()}
              className="px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold hover:bg-rose-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              Reintentar conexión
            </button>
          </div>
        )}

        {/* =========================================================
            TAB 1: GUAYAQUIL (FOCO PRINCIPAL)
           ========================================================= */}
        {activeTab === ActiveTab.GUAYAQUIL && (
          <div className="space-y-8">
            {/* Balanced 2-Column Hero Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-gradient-to-br from-white via-white to-sky-50/75 border border-slate-200 rounded-xl p-7 flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <p className="text-xs font-bold text-sky-700">
                    Observatorio Principal · Monitoreo Hiperlocal de Guayaquil y Cuenca Baja del Guayas
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-bold font-display text-slate-950 leading-tight max-w-2xl">
                    Vigilancia satelital y climática en tiempo real sobre el Fenómeno de El Niño
                  </h1>
                  <p className="text-sm text-slate-700 leading-relaxed max-w-2xl">
                    Integración directa de sensores satelitales (GOES-East Infrarrojo, TSM Niño 1+2, NASA IMERG), radar Doppler, caudal fluvial Daule–Babahoyo–Guayas y monitoreo abierto de ductos, alcantarillas, vías anegadas y redes (X) en 12 sectores estratégicos.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab(ActiveTab.REPORTES)}
                    className="px-4 py-2 text-xs font-semibold bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Mapa Satelital Ampliado: Redes (X), Ductos y Vías
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab(ActiveTab.RIESGOS)}
                    className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Alertas Oficiales SNGR / INAMHI ({govAlerts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab(ActiveTab.NACIONAL)}
                    className="px-4 py-2 text-xs font-semibold text-sky-800 hover:text-sky-950 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Ver apartado Ecuador Nacional →
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 relative min-h-[250px] rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
                {!heroImgFailed ? (
                  <img
                    src={GUAYAQUIL_HERO_IMG}
                    alt="Vista aérea del Río Guayas, Estero Salado y sectores urbanos de Guayaquil bajo nubosidad convectiva"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-slate-800 via-sky-950 to-slate-900 flex items-center justify-center p-6">
                    <CloudRain className="w-12 h-12 text-sky-300" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent flex flex-col justify-end p-5">
                  <div className="text-xs text-sky-300 font-semibold">
                    Estuario Río Guayas · Estero Salado
                  </div>
                  <div className="text-sm font-bold text-white">
                    {marine?.ensoPhaseLabel ?? 'Monitoreo Oceánico-Atmosférico Activo'}
                  </div>
                  <div className="text-xs text-slate-200 font-mono tabular-nums mt-0.5">
                    SST Costera: {marine?.coastalSstC ?? '--'} °C · Caudal Guayas:{' '}
                    {river?.currentDischargeM3s ?? '--'} m³/s
                  </div>
                </div>
              </div>
            </div>

            {/* Full-Width 4-Column Highlighted KPI Strip Below Hero */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-b from-white to-amber-50/45 border border-slate-200 rounded-xl p-5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>Anomalía SST Niño 1+2</span>
                  <Thermometer className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-700">
                  {marine
                    ? `${marine.sstAnomalyC >= 0 ? '+' : ''}${marine.sstAnomalyC.toFixed(2)}`
                    : '--'}
                  <span className="text-xs font-medium text-slate-600 ml-1.5">°C</span>
                </div>
                <p className="text-xs text-slate-600">
                  Mar frente a Guayas: <strong className="text-slate-900">{marine?.coastalSstC ?? '--'} °C</strong> · Galápagos:{' '}
                  <strong className="text-slate-900">{marine?.galapagosSstC ?? '--'} °C</strong>
                </p>
              </div>

              <div className="bg-gradient-to-b from-white to-sky-50/50 border border-slate-200 rounded-xl p-5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>Caudal Cuenca Río Guayas</span>
                  <Waves className="w-4 h-4 text-sky-700" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-950">
                  {river ? river.currentDischargeM3s.toFixed(0) : '--'}
                  <span className="text-xs font-medium text-slate-600 ml-1.5">m³/s</span>
                </div>
                <p className="text-xs text-slate-600 font-mono tabular-nums">
                  Pico 14d: <strong className="text-sky-800">{river?.peakForecast14dM3s.toFixed(0) ?? '--'} m³/s</strong> (
                  {river && river.dischargeAnomalyPct >= 0 ? '+' : ''}
                  {river?.dischargeAnomalyPct ?? 0}% vs media)
                </p>
              </div>

              <div className="bg-gradient-to-b from-white to-rose-50/40 border border-slate-200 rounded-xl p-5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>Sector Mayor Exposición Hoy</span>
                  <CloudRain className="w-4 h-4 text-rose-600" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-rose-700">
                  {peakGyeZone ? peakGyeZone.affectationIndex : '--'}
                  <span className="text-xs font-medium text-slate-600 ml-1.5">/ 100</span>
                </div>
                <p className="text-xs text-slate-700 font-medium truncate">
                  {peakGyeZone
                    ? `${peakGyeZone.zone.name} · Prob. 72h: ${peakGyeZone.floodProbability72h}%`
                    : 'Calculando índice...'}
                </p>
              </div>

              <div className="bg-gradient-to-b from-white to-emerald-50/40 border border-slate-200 rounded-xl p-5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>Precipitación Actual en Vivo</span>
                  <Droplets className="w-4 h-4 text-sky-700" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-sky-800">
                  {gyeLiveWeatherStats.maxLivePrecipMm.toFixed(1)}
                  <span className="text-xs font-medium text-slate-600 ml-1.5">mm/h</span>
                </div>
                <p className="text-xs text-slate-700 font-medium truncate">
                  {gyeLiveWeatherStats.rainingCount === 0
                    ? `Sin lluvia activa (Nub. ${gyeLiveWeatherStats.meanCloudPct}%) · Acum. 7D: ${gyeMeanRain7d} mm`
                    : `Lluvia en ${gyeLiveWeatherStats.rainingCount}/12 sectores · Acum. 7D: ${gyeMeanRain7d} mm`}
                </p>
              </div>
            </div>

            {/* Interactive Guayaquil Map + Sector Tactical Inspector */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Mapa Satelital y Meteorológico en Tiempo Real: GOES-East IR, TSM Niño 1+2, Ductos y Vías
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    Satélite + Radar Doppler + Pantalla Completa · 12 estaciones
                  </span>
                </div>
                <InteractiveRiskMap
                  scope="guayaquil"
                  telemetryList={guayaquilTelemetry}
                  selectedZoneId={selectedGyeZoneId}
                  onSelectZone={(id) => {
                    setSelectedGyeZoneId(id);
                    setFocusedGyeOsint(null);
                  }}
                  reports={reports}
                  focusedOsintItem={focusedGyeOsint}
                />
              </div>

              {/* Selected Sector Telemetry Inspector */}
              <div className="lg:col-span-4 bg-gradient-to-b from-white to-slate-50/90 border border-slate-200 rounded-xl p-6 space-y-5">
                {selectedGyeTelemetry ? (
                  <>
                    <div className="space-y-1 border-b border-slate-200 pb-4">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={
                            selectedGyeTelemetry.isRainingNow
                              ? 'text-sky-700 font-bold'
                              : 'text-emerald-700 font-semibold'
                          }
                        >
                          {selectedGyeTelemetry.weatherLabel}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 font-medium">
                          Cota {selectedGyeTelemetry.zone.elevationM} m s.n.m.
                        </span>
                      </div>
                      <h2 className="text-xl font-bold font-display text-slate-950">
                        {selectedGyeTelemetry.zone.name}
                      </h2>
                      <p className="text-xs text-slate-600">
                        {selectedGyeTelemetry.zone.sublabel} ·{' '}
                        <span className={`font-semibold ${formatTierText(selectedGyeTelemetry.alertTier).cls}`}>
                          {formatTierText(selectedGyeTelemetry.alertTier).text} ENSO
                        </span>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-sky-50/70 border border-sky-200/80 rounded-lg">
                        <span className="text-slate-600 font-medium block">Lluvia Ahora (Vivo)</span>
                        <span className="text-xl font-bold font-mono tabular-nums text-sky-800">
                          {selectedGyeTelemetry.currentPrecipMm.toFixed(1)}
                          <span className="text-xs text-slate-600 ml-1">mm/h</span>
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-600 font-medium block">Nubosidad / Viento</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-950 block pt-1">
                          {selectedGyeTelemetry.cloudCoverPct}% ·{' '}
                          {degreesToCompass(selectedGyeTelemetry.windDirectionDeg)}{' '}
                          {selectedGyeTelemetry.windSpeedKmh.toFixed(0)} km/h
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-600 font-medium block">Temp. / Humedad</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-950">
                          {selectedGyeTelemetry.tempC.toFixed(1)} °C ·{' '}
                          {selectedGyeTelemetry.humidityPct}%
                        </span>
                      </div>
                      <div className="p-3 bg-amber-50/65 border border-amber-200/80 rounded-lg">
                        <span className="text-slate-600 font-medium block">Riesgo 72h / Índice</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-amber-800">
                          {selectedGyeTelemetry.floodProbability72h}% ·{' '}
                          {selectedGyeTelemetry.affectationIndex}/100
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Acumulado estimado 24h / 7d</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-950">
                          {selectedGyeTelemetry.precip24hMm} mm / {selectedGyeTelemetry.precip7dMm} mm
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Cuenca y drenaje</span>
                        <span className="text-slate-900 font-medium text-right max-w-[195px] truncate">
                          {selectedGyeTelemetry.zone.hydrologyBasin}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Ráfagas máximas</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-950">
                          {selectedGyeTelemetry.windGustsKmh.toFixed(1)} km/h
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Población expuesta</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-950">
                          {selectedGyeTelemetry.zone.populationExposed.toLocaleString('es-EC')} hab.
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 space-y-1.5">
                      <span className="text-xs font-bold text-slate-950 block">
                        Directriz Operativa de Drenaje y Mitigación
                      </span>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {selectedGyeTelemetry.zone.mitigationProtocol}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveTab(ActiveTab.RIESGOS)}
                        className="flex-1 px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Alertas SNGR / INAMHI
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab(ActiveTab.REPORTES)}
                        className="flex-1 px-3 py-2 text-xs font-semibold bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Monitor Redes y Vías
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="h-80 flex items-center justify-center text-xs text-slate-500">
                    Sincronizando telemetría de sectores de Guayaquil...
                  </div>
                )}
              </div>
            </div>

            {/* Live Updates Feed: Ducts, Storm Drains, Flooded Roads, and X / Open Sources */}
            <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold font-display text-slate-950">
                    Noticias y Reportes en Vivo: Ductos, Alcantarillas, Vías Anegadas y Redes (X)
                  </h2>
                  <p className="text-xs text-slate-600">
                    Monitoreo abierto georreferenciado sobre sumideros, colectores pluviales (Interagua / EMAPAG), túneles, pasos a desnivel (ATM / Segura EP) y reportes ciudadanos en X
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
                    {(
                      [
                        { id: 'all', label: 'Todo Guayaquil' },
                        { id: 'ductos_alcantarillas', label: 'Ductos y Alcantarillas' },
                        { id: 'via_anegada', label: 'Vías Anegadas' },
                        { id: 'redes_x', label: 'Redes (X)' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setInfraCategoryFilter(f.id)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          infraCategoryFilter === f.id
                            ? 'bg-sky-700 text-white'
                            : 'text-slate-700 hover:text-slate-950'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => void refreshOsintReports(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono tabular-nums font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 hover:border-sky-600 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`w-3 h-3 text-sky-700 ${loadingOsint ? 'animate-spin' : ''}`}
                    />
                    {secondsUntilNextSync}s
                  </button>
                </div>
              </div>

              {loadingOsint && gyeOsintFeed.length === 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="h-24 bg-slate-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : gyeOsintFeed.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-600 border border-dashed border-slate-300 bg-slate-50/50 rounded-lg">
                  Sin novedades abiertas para esta categoría específica; selecciona «Todo Guayaquil» para ver todas las actualizaciones activas.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {gyeOsintFeed.slice(0, 6).map((item) => {
                    const catColor =
                      item.osintCategory === 'ductos_alcantarillas'
                        ? 'text-amber-700'
                        : item.osintCategory === 'via_anegada'
                          ? 'text-rose-700'
                          : 'text-sky-700';
                    const catGlyph =
                      item.osintCategory === 'ductos_alcantarillas'
                        ? '◆ Ductos / Alcantarillado'
                        : item.osintCategory === 'via_anegada'
                          ? '▲ Vías Anegadas / Tránsito'
                          : '● Redes (X) / Abiertas';

                    return (
                      <div
                        key={item.id}
                        className="p-4 bg-white border border-slate-200 rounded-lg flex flex-col justify-between gap-3 hover:border-sky-500 transition-colors"
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                            <span className={`font-bold ${catColor}`}>{catGlyph}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-900 font-semibold">{item.zoneName}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono font-semibold text-sky-800">{item.accountRef}</span>
                          </div>
                          <h3 className="text-xs sm:text-sm font-bold text-slate-950 leading-snug">
                            {item.title}
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
                            <span className="font-sans text-slate-600">{item.sourceName}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {new Date(item.publishedAtIso).toLocaleString('es-EC', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedGyeZoneId(item.zoneId);
                              setFocusedGyeOsint({ ...item });
                            }}
                            className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-sky-800 cursor-pointer"
                          >
                            <LocateFixed className="w-3.5 h-3.5 text-sky-700" />
                            Enfocar en mapa
                          </button>

                          <div className="flex items-center gap-3">
                            <a
                              href={item.xLiveSearchUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 font-semibold"
                            >
                              Ver en X
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-slate-900 hover:text-sky-800 font-semibold underline"
                            >
                              Fuente
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* High-Density Guayaquil Sectors Data Table */}
            <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold font-display text-slate-950">
                    Matriz Hidrometeorológica de Sectores de Guayaquil
                  </h2>
                  <p className="text-xs text-slate-600">
                    Comparativa en tiempo real de precipitación actual (mm/h), nubosidad, acumulados y vulnerabilidad de drenaje
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
                  <span className="px-2 text-[11px] font-medium text-slate-600 inline-flex items-center gap-1">
                    <ArrowUpDown className="w-3 h-3" /> Ordenar:
                  </span>
                  {(
                    [
                      { id: 'liveRain', label: 'Lluvia Ahora' },
                      { id: 'index', label: 'Índice ENSO' },
                      { id: 'rain24h', label: 'Lluvia 24h' },
                      { id: 'rain7d', label: 'Acum. 7d' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSortBy(opt.id)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        sortBy === opt.id
                          ? 'bg-white text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {loadingClimate && sortedGyeList.length === 0 ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/85 text-[11px] text-slate-600">
                        <th className="py-2.5 px-3 font-semibold">Sector Urbano</th>
                        <th className="py-2.5 px-3 font-semibold">Condición Actual</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Ahora (mm/h)</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Temp.</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Nubosidad</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Lluvia 24h</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Acum. 7d</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Índice ENSO</th>
                        <th className="py-2.5 pl-3 pr-3 font-semibold text-right">Eventos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {sortedGyeList.map((row) => {
                        const tierInfo = formatTierText(row.alertTier);
                        const isSelected = row.zone.id === selectedGyeZoneId;
                        return (
                          <tr
                            key={row.zone.id}
                            onClick={() => setSelectedGyeZoneId(row.zone.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-sky-50/85' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-slate-950">{row.zone.name}</div>
                              <div className="text-[11px] text-slate-500">{row.zone.sublabel}</div>
                            </td>
                            <td
                              className={`py-2.5 px-3 font-semibold whitespace-nowrap ${
                                row.isRainingNow ? 'text-sky-700' : 'text-slate-700'
                              }`}
                            >
                              {row.weatherLabel}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                                row.currentPrecipMm >= 0.1 ? 'text-sky-700' : 'text-slate-600'
                              }`}
                            >
                              {row.currentPrecipMm.toFixed(1)} mm/h
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 font-medium">
                              {row.tempC.toFixed(1)} °C
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 font-medium">
                              {row.cloudCoverPct}%
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-sky-800">
                              {row.precip24hMm.toFixed(1)} mm
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {row.precip7dMm.toFixed(1)} mm
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${tierInfo.cls}`}
                            >
                              {row.affectationIndex}
                            </td>
                            <td className="py-2.5 pl-3 pr-3 text-right font-mono tabular-nums font-semibold text-slate-800">
                              {row.activeReportsCount}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 2: ECUADOR NACIONAL (RESTO DEL PAÍS)
           ========================================================= */}
        {activeTab === ActiveTab.NACIONAL && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
              <div className="space-y-1">
                <p className="text-xs text-sky-700 font-semibold">
                  Observatorio Territorial Nacional · Perfil Costero, Región Insular (Niño 1+2) y Vertiente Andina
                </p>
                <h1 className="text-2xl md:text-3xl font-bold font-display text-slate-950">
                  Panorama Satelital, Climático e Hidrológico del Resto del País
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab(ActiveTab.GUAYAQUIL)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 rounded-lg hover:border-sky-600 hover:text-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                ← Volver a Foco Principal Guayaquil
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Red Nacional de Provincias, Sensores Satelitales y Nodos Estratégicos ante El Niño
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    Satélite + Radar Doppler + Pantalla Completa · 10 nodos
                  </span>
                </div>
                <InteractiveRiskMap
                  scope="nacional"
                  telemetryList={nacionalTelemetry}
                  selectedZoneId={selectedNacZoneId}
                  onSelectZone={(id) => {
                    setSelectedNacZoneId(id);
                    setFocusedNacOsint(null);
                  }}
                  reports={reports}
                  focusedOsintItem={focusedNacOsint}
                />
              </div>

              <div className="lg:col-span-4 bg-gradient-to-b from-white to-slate-50/90 border border-slate-200 rounded-xl p-6 space-y-5">
                {selectedNacTelemetry ? (
                  <>
                    <div className="space-y-1 border-b border-slate-200 pb-4">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={
                            selectedNacTelemetry.isRainingNow
                              ? 'text-sky-700 font-bold'
                              : 'text-emerald-700 font-semibold'
                          }
                        >
                          {selectedNacTelemetry.weatherLabel}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 font-medium">
                          Altitud {selectedNacTelemetry.zone.elevationM} m
                        </span>
                      </div>
                      <h2 className="text-xl font-bold font-display text-slate-950">
                        {selectedNacTelemetry.zone.name}
                      </h2>
                      <p className="text-xs text-slate-600">
                        {selectedNacTelemetry.zone.sublabel} ·{' '}
                        <span className={`font-semibold ${formatTierText(selectedNacTelemetry.alertTier).cls}`}>
                          {formatTierText(selectedNacTelemetry.alertTier).text} ENSO
                        </span>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-sky-50/70 border border-sky-200/80 rounded-lg">
                        <span className="text-slate-600 font-medium block">Lluvia Ahora (Vivo)</span>
                        <span className="text-xl font-bold font-mono tabular-nums text-sky-800">
                          {selectedNacTelemetry.currentPrecipMm.toFixed(1)}
                          <span className="text-xs text-slate-600 ml-1">mm/h</span>
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-600 font-medium block">Nubosidad / Viento</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-950 block pt-1">
                          {selectedNacTelemetry.cloudCoverPct}% ·{' '}
                          {degreesToCompass(selectedNacTelemetry.windDirectionDeg)}{' '}
                          {selectedNacTelemetry.windSpeedKmh.toFixed(0)} km/h
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-600 font-medium block">Acumulado 7 días</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-950">
                          {selectedNacTelemetry.precip7dMm} mm
                        </span>
                      </div>
                      <div className="p-3 bg-amber-50/65 border border-amber-200/80 rounded-lg">
                        <span className="text-slate-600 font-medium block">Índice / Prob. 72h</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-amber-800">
                          {selectedNacTelemetry.affectationIndex}/100 ·{' '}
                          {selectedNacTelemetry.floodProbability72h}%
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <span className="font-bold text-slate-950 block">
                        Sistema Hidrográfico
                      </span>
                      <p className="text-slate-700">{selectedNacTelemetry.zone.hydrologyBasin}</p>
                    </div>

                    <div className="pt-3 border-t border-slate-200 space-y-1.5 text-xs">
                      <span className="font-bold text-slate-950 block">
                        Acción Territorial Recomendada
                      </span>
                      <p className="text-slate-700 leading-relaxed">
                        {selectedNacTelemetry.zone.mitigationProtocol}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveTab(ActiveTab.REPORTES)}
                      className="w-full px-4 py-2 text-xs font-semibold bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors cursor-pointer"
                    >
                      Abrir Observatorio de Redes y Vías Nacionales
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {/* National Open-Source Roads, Drainage & Social Feed */}
            {nacOsintFeed.length > 0 && (
              <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-950">
                      Actualizaciones Viales, Drenaje y Fuentes Abiertas en Provincias
                    </h2>
                    <p className="text-xs text-slate-600">
                      Reportes abiertos de cierres viales, caudales, alcantarillado y redes sociales en el resto del Ecuador
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-medium text-sky-800">
                    Sincronización 60s ({secondsUntilNextSync}s)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {nacOsintFeed.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="p-4 bg-white border border-slate-200 rounded-lg flex flex-col justify-between gap-3 hover:border-sky-500 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="text-sky-700 font-bold">
                            {OSINT_CATEGORY_LABELS[item.osintCategory]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-900 font-semibold">{item.zoneName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-sky-800">{item.accountRef}</span>
                        </div>
                        <h3 className="text-xs sm:text-sm font-bold text-slate-950 leading-snug">
                          {item.title}
                        </h3>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedNacZoneId(item.zoneId);
                            setFocusedNacOsint({ ...item });
                          }}
                          className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-sky-800 cursor-pointer"
                        >
                          <LocateFixed className="w-3.5 h-3.5 text-sky-700" />
                          Enfocar provincia
                        </button>
                        <div className="flex items-center gap-3">
                          <a
                            href={item.xLiveSearchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 font-semibold"
                          >
                            Ver en X
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-slate-900 hover:text-sky-800 font-semibold underline"
                          >
                            Fuente
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* National Comparative Table */}
            <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-bold font-display text-slate-950">
                Consolidado Nacional por Provincia y Cuenca Estratégica
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/85 text-[11px] text-slate-600">
                      <th className="py-2.5 px-3 font-semibold">Provincia / Nodo</th>
                      <th className="py-2.5 px-3 font-semibold">Condición Actual</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Ahora (mm/h)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Temp. Actual</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Nubosidad</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Lluvia 24h</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Acum. 7d</th>
                      <th className="py-2.5 pl-3 pr-3 font-semibold text-right">Índice ENSO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {sortedNacList.map((row) => {
                      const tier = formatTierText(row.alertTier);
                      return (
                        <tr
                          key={row.zone.id}
                          onClick={() => setSelectedNacZoneId(row.zone.id)}
                          className={`cursor-pointer transition-colors ${
                            row.zone.id === selectedNacZoneId
                              ? 'bg-sky-50/85'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-950">{row.zone.name}</div>
                            <div className="text-[11px] text-slate-500">{row.zone.sublabel}</div>
                          </td>
                          <td
                            className={`py-2.5 px-3 font-semibold whitespace-nowrap ${
                              row.isRainingNow ? 'text-sky-700' : 'text-slate-700'
                            }`}
                          >
                            {row.weatherLabel}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                              row.currentPrecipMm >= 0.1 ? 'text-sky-700' : 'text-slate-600'
                            }`}
                          >
                            {row.currentPrecipMm.toFixed(1)} mm/h
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 font-medium">
                            {row.tempC.toFixed(1)} °C
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 font-medium">
                            {row.cloudCoverPct}%
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-sky-800">
                            {row.precip24hMm.toFixed(1)} mm
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-800">
                            {row.precip7dMm.toFixed(1)} mm
                          </td>
                          <td
                            className={`py-2.5 pl-3 pr-3 text-right font-mono tabular-nums font-bold ${tier.cls}`}
                          >
                            {row.affectationIndex}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 3: OBSERVATORIO DE REPORTES, REDES (X), DUCTOS Y VÍAS
           ========================================================= */}
        {activeTab === ActiveTab.REPORTES && <CitizenReportsModule defaultScope="guayaquil" />}

        {/* =========================================================
            TAB 4: GESTIÓN DE RIESGOS (JMAC-CLIMATYC)
           ========================================================= */}
        {activeTab === ActiveTab.RIESGOS && <RiskManagementConsole />}
      </main>

      {/* Clean Institutional Footer */}
      <footer className="border-t border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100/90 mt-12">
        <div className="max-w-[1380px] mx-auto px-6 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-slate-600">
          <div className="space-y-1">
            <div className="text-slate-900 font-semibold">
              JMAC-Climatyc · Observatorio Satelital y de Gestión de Riesgos ante el Fenómeno de El Niño
            </div>
            <div>
              Diseñado y administrado por{' '}
              <strong className="text-slate-900">José Manuel Arguello C. (Jmac-Climatyc)</strong> · Estándar operativo JMAC Security.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              Telemetría 60s: Sensores NASA GIBS, Open-Meteo, NOAA CPC &amp; Entidades Oficiales (SNGR · INAMHI · INOCAR · Segura EP)
            </span>
            <span aria-hidden="true">·</span>
            <a
              href="https://maps.google.com/help/terms_maps/?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-800 hover:text-sky-800 underline font-medium"
            >
              Términos de Google Maps
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="https://policies.google.com/privacy?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-800 hover:text-sky-800 underline font-medium"
            >
              Privacidad
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuota = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  return (
    <ErrorBoundary>
      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <APIProvider apiKey={mapsApiKey} language="es" region="EC">
        <ClimatycProvider>
          <WorkspaceShell />
        </ClimatycProvider>
      </APIProvider>
    </ErrorBoundary>
  );
}
