import React, { useMemo, useState } from 'react';
import {
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useClimatyc } from '../context/ClimatycContext';
import { GovAlertLevel, GovEntityCode } from '../types/climate';

import EMBLEM_SRC from '../assets/images/jmac_director_emblem_1793055546704.jpg';

const OFFICIAL_PORTALS: {
  code: GovEntityCode;
  shortName: string;
  fullName: string;
  role: string;
  url: string;
}[] = [
  {
    code: 'SNGR',
    shortName: 'SNGR Ecuador',
    fullName: 'Secretaría Nacional de Gestión de Riesgos',
    role: 'Declaratorias de alerta, informes de situación invernal y coordinación COE',
    url: 'https://www.gestionderiesgos.gob.ec/',
  },
  {
    code: 'INAMHI',
    shortName: 'INAMHI',
    fullName: 'Instituto Nacional de Meteorología e Hidrología',
    role: 'Advertencias meteorológicas por lluvias intensas, tormentas y caudales',
    url: 'https://www.inamhi.gob.ec/',
  },
  {
    code: 'INOCAR_ERFEN',
    shortName: 'INOCAR · ERFEN',
    fullName: 'Instituto Oceanográfico y Antártico · Comité Nacional ERFEN',
    role: 'Boletines oficiales del Fenómeno de El Niño (Región Niño 1+2), oleaje y aguaje',
    url: 'https://www.inocar.mil.ec/',
  },
  {
    code: 'SEGURA_EP',
    shortName: 'Segura EP · COE',
    fullName: 'Empresa Pública Municipal de Gestión de Riesgos de Guayaquil',
    role: 'Vigilancia pluvial cantonal, pasos a desnivel y respuesta urbana en Guayaquil',
    url: 'https://seguraep.gob.ec/',
  },
];

function formatGovAlertLevel(level: GovAlertLevel) {
  switch (level) {
    case 'roja':
      return { label: '✖ Alerta Roja', cls: 'text-rose-700' };
    case 'naranja':
      return { label: '▲ Alerta Naranja', cls: 'text-amber-700' };
    case 'amarilla':
      return { label: '▲ Vigilancia Amarilla', cls: 'text-sky-700' };
    default:
      return { label: '● Aviso Oficial', cls: 'text-emerald-700' };
  }
}

function formatShortEntityLabel(code: GovEntityCode): string {
  switch (code) {
    case 'SNGR':
      return 'SNGR · Gestión de Riesgos';
    case 'INAMHI':
      return 'INAMHI';
    case 'INOCAR_ERFEN':
      return 'INOCAR · Comité ERFEN';
    case 'SEGURA_EP':
      return 'Segura EP · COE Guayaquil';
  }
}

export const RiskManagementConsole: React.FC = () => {
  const {
    guayaquilTelemetry,
    nacionalTelemetry,
    reports,
    govAlerts,
    noaaNino12,
    lastGovAlertsSyncIso,
    loadingGovAlerts,
    refreshGovAlerts,
    secondsUntilNextSync,
  } = useClimatyc();

  const [emblemFailed, setEmblemFailed] = useState(false);
  const [protocolScope, setProtocolScope] = useState<'guayaquil' | 'nacional'>('guayaquil');
  const [entityFilter, setEntityFilter] = useState<'ALL' | GovEntityCode>('ALL');
  const [alertScopeFilter, setAlertScopeFilter] = useState<'all' | 'guayaquil' | 'nacional'>('all');

  const allZonesTelemetry = useMemo(
    () => [...guayaquilTelemetry, ...nacionalTelemetry],
    [guayaquilTelemetry, nacionalTelemetry]
  );

  const highRiskZones = useMemo(
    () =>
      allZonesTelemetry.filter(
        (z) => z.alertTier === 'roja' || z.alertTier === 'naranja'
      ),
    [allZonesTelemetry]
  );

  const totalExposedPop = useMemo(
    () =>
      guayaquilTelemetry.reduce((acc, item) => acc + item.zone.populationExposed, 0),
    [guayaquilTelemetry]
  );

  const activeReports = useMemo(
    () => reports.filter((r) => r.status !== 'mitigado'),
    [reports]
  );
  const mitigatedReports = useMemo(
    () => reports.filter((r) => r.status === 'mitigado'),
    [reports]
  );

  const filteredGovAlerts = useMemo(() => {
    return govAlerts.filter((item) => {
      if (entityFilter !== 'ALL' && item.entityCode !== entityFilter) return false;
      if (alertScopeFilter !== 'all' && item.scope !== alertScopeFilter) return false;
      return true;
    });
  }, [govAlerts, entityFilter, alertScopeFilter]);

  const displayedProtocols =
    protocolScope === 'guayaquil' ? guayaquilTelemetry : nacionalTelemetry;

  const handleDownloadCsv = () => {
    const headers = [
      'Ambito',
      'Sector_Provincia',
      'Indice_Afectacion_ENSO',
      'Nivel_Alerta',
      'Precipitacion_24h_mm',
      'Acumulado_7d_mm',
      'Prob_Anegamiento_72h_Pct',
      'Poblacion_Expuesta',
      'Reportes_Activos',
      'Protocolo_Mitigacion_JMAC',
    ];
    const rows = allZonesTelemetry.map((t) => [
      t.zone.scope,
      `"${t.zone.name}"`,
      t.affectationIndex,
      t.alertTier.toUpperCase(),
      t.precip24hMm,
      t.precip7dMm,
      t.floodProbability72h,
      t.zone.populationExposed,
      t.activeReportsCount,
      `"${t.zone.mitigationProtocol.replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `JMAC_Climatyc_Matriz_Riesgos_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      {/* Command Identity Header */}
      <div className="bg-gradient-to-r from-white via-slate-50/90 to-sky-50/75 border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-300 bg-slate-900 shrink-0 flex items-center justify-center">
            {!emblemFailed ? (
              <img
                src={EMBLEM_SRC}
                alt="Emblema Táctico JMAC-Climatyc"
                referrerPolicy="no-referrer"
                onError={() => setEmblemFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <ShieldCheck className="w-8 h-8 text-sky-400" />
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-sky-700 font-semibold">
              Monitoreo Hidrometeorológico e Institucional · Estándar Operativo JMAC Security
            </p>
            <h1 className="text-2xl font-bold font-display text-slate-950">
              Tablero de Gestión Efectiva de Riesgos y Alertas Oficiales
            </h1>
            <p className="text-xs text-slate-600">
              Diseñado y administrado por{' '}
              <span className="text-slate-900 font-semibold">
                José Manuel Arguello C. (Jmac-Climatyc)
              </span>{' '}
              · Sincronización automática cada 60s
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void refreshGovAlerts(true)}
            disabled={loadingGovAlerts}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white text-slate-800 border border-slate-300 rounded-lg hover:border-sky-600 hover:text-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-700 ${loadingGovAlerts ? 'animate-spin' : ''}`} />
            Actualizar alertas ({secondsUntilNextSync}s)
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar Matriz CSV
          </button>
        </div>
      </div>

      {/* 4-Column Operational KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-b from-white to-amber-50/40 border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-600">Zonas en Alerta Naranja / Roja</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-amber-700">
            {highRiskZones.length}
            <span className="text-xs font-normal text-slate-500 ml-1.5">
              / {allZonesTelemetry.length} nodos
            </span>
          </div>
          <p className="text-xs text-slate-600">Guayaquil + Provincias Nacionales</p>
        </div>

        <div className="bg-gradient-to-b from-white to-slate-50/80 border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-600">Población Metropolitana Vigilada</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-slate-950">
            {(totalExposedPop / 1_000_000).toFixed(2)}
            <span className="text-xs font-normal text-slate-500 ml-1.5">M hab.</span>
          </div>
          <p className="text-xs text-slate-600">12 sectores estratégicos de Guayaquil</p>
        </div>

        <div className="bg-gradient-to-b from-white to-sky-50/45 border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-600">Eventos Territoriales en Seguimiento</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-sky-700">
            {activeReports.length}
            <span className="text-xs font-normal text-slate-500 ml-1.5">activos</span>
          </div>
          <p className="text-xs text-slate-600">
            Cerrados / mitigados: {mitigatedReports.length}
          </p>
        </div>

        <div className="bg-gradient-to-b from-white to-emerald-50/40 border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-600">Alertas de Entidades Oficiales</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
            {govAlerts.length}
            <span className="text-xs font-normal text-slate-500 ml-1.5">avisos</span>
          </div>
          <p className="text-xs text-slate-600">SNGR · INAMHI · INOCAR · Segura EP</p>
        </div>
      </div>

      {/* Official Government & Hydrometeorological Entities Alerts Feed */}
      <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold font-display text-slate-950">
              Alertas Emitidas por Entidades de Gobierno sobre El Niño y Lluvias
            </h2>
            <p className="text-xs text-slate-600">
              Avisos oficiales y comunicados interinstitucionales de la Secretaría Nacional de Gestión de Riesgos (SNGR), INAMHI, INOCAR · Comité ERFEN y Segura EP
              {lastGovAlertsSyncIso && (
                <span className="font-mono tabular-nums text-slate-500">
                  {' '}
                  · Actualizado{' '}
                  {new Date(lastGovAlertsSyncIso).toLocaleTimeString('es-EC', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Entity Segmented Filter */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              {(
                [
                  { id: 'ALL', label: 'Todas las entidades' },
                  { id: 'SNGR', label: 'SNGR' },
                  { id: 'INAMHI', label: 'INAMHI' },
                  { id: 'INOCAR_ERFEN', label: 'INOCAR · ERFEN' },
                  { id: 'SEGURA_EP', label: 'Segura EP' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEntityFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    entityFilter === tab.id
                      ? 'bg-sky-700 text-white'
                      : 'text-slate-700 hover:text-slate-950'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scope Segmented Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              {(
                [
                  { id: 'all', label: 'Todo el país' },
                  { id: 'guayaquil', label: 'Guayaquil' },
                  { id: 'nacional', label: 'Nacional' },
                ] as const
              ).map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setAlertScopeFilter(sc.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    alertScopeFilter === sc.id
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-700 hover:text-slate-950'
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Official NOAA/ERFEN Niño 1+2 Summary Strip when available */}
        {noaaNino12 && (
          <div className="p-4 bg-gradient-to-r from-sky-50/80 via-white to-amber-50/50 border border-slate-200 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="text-slate-950 font-bold">
                Referencia Oceanográfica Oficial Región Niño 1+2 (Semana {noaaNino12.weekLabel} · Comité ERFEN / NOAA CPC)
              </div>
              <div className="text-slate-600">
                Parámetro técnico utilizado por SNGR, INOCAR e INAMHI para vigilar el acoplamiento cálido frente a las costas de Ecuador y Galápagos.
              </div>
            </div>
            <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
              <div>
                <span className="text-slate-500 block text-[11px]">TSM Niño 1+2</span>
                <span className="text-sm font-bold text-slate-950">
                  {noaaNino12.sstC.toFixed(1)} °C (
                  {noaaNino12.anomalyC >= 0 ? '+' : ''}
                  {noaaNino12.anomalyC.toFixed(1)} °C)
                </span>
              </div>
              <span aria-hidden="true" className="text-slate-300">|</span>
              <div>
                <span className="text-slate-500 block text-[11px]">TSM Niño 3.4</span>
                <span className="text-sm font-bold text-sky-800">
                  {noaaNino12.nino34SstC.toFixed(1)} °C (
                  {noaaNino12.nino34AnomalyC >= 0 ? '+' : ''}
                  {noaaNino12.nino34AnomalyC.toFixed(1)} °C)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Alerts List */}
        {loadingGovAlerts && govAlerts.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-24 bg-slate-100 border border-slate-200 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : filteredGovAlerts.length === 0 ? (
          <div className="py-8 border border-dashed border-slate-300 bg-slate-50/60 rounded-lg text-center space-y-2">
            <p className="text-sm text-slate-700 font-medium">
              No se registran alertas para el filtro institucional seleccionado.
            </p>
            <button
              type="button"
              onClick={() => {
                setEntityFilter('ALL');
                setAlertScopeFilter('all');
              }}
              className="text-xs font-semibold text-sky-700 hover:text-sky-800 underline cursor-pointer"
            >
              Mostrar todas las alertas oficiales vigentes
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredGovAlerts.map((alertItem) => {
              const levelInfo = formatGovAlertLevel(alertItem.alertLevel);
              return (
                <div
                  key={alertItem.id}
                  className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-sky-50/40 transition-colors px-2"
                >
                  <div className="space-y-1.5 max-w-4xl">
                    {/* Zero-Pill Unboxed Metadata Line */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className={`font-bold ${levelInfo.cls}`}>{levelInfo.label}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-950 font-semibold">
                        {formatShortEntityLabel(alertItem.entityCode)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-700">
                        {alertItem.scope === 'guayaquil' ? 'Foco Guayaquil / Guayas' : 'Alcance Nacional'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {new Date(alertItem.publishedAtIso).toLocaleString('es-EC', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-950 leading-snug">
                      {alertItem.title}
                    </h3>

                    <p className="text-xs text-slate-700 leading-relaxed">{alertItem.summary}</p>

                    <div className="text-[11px] text-slate-500">
                      Fuente reportada: <span className="text-slate-800 font-medium">{alertItem.sourceName}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={alertItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      Ver reporte
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={alertItem.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:text-sky-800 hover:border-sky-600 transition-colors whitespace-nowrap shrink-0"
                    >
                      Portal oficial
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Direct Links to Ecuadorian Government Risk & Climate Entities */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="text-xs font-bold text-slate-900">
            Directorio Directo de Entidades Oficiales de Emergencia y Monitoreo ENSO
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {OFFICIAL_PORTALS.map((portal) => (
              <a
                key={portal.code}
                href={portal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3.5 bg-white border border-slate-200 rounded-lg hover:border-sky-600 transition-colors flex flex-col justify-between gap-2 group"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-950 group-hover:text-sky-700 transition-colors">
                    <span>{portal.shortName}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-700" />
                  </div>
                  <div className="text-[11px] text-slate-700 font-semibold">{portal.fullName}</div>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">{portal.role}</p>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Sector & Provincial Mitigation Protocols Matrix */}
      <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-display text-slate-950">
              Matriz Operativa de Protocolos Preventivos por Zona
            </h2>
            <p className="text-xs text-slate-600">
              Planes de respuesta calibrados según vulnerabilidad de drenaje, cota topográfica y lluvia proyectada
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
            <button
              type="button"
              onClick={() => setProtocolScope('guayaquil')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                protocolScope === 'guayaquil'
                  ? 'bg-sky-700 text-white'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              Sectores Guayaquil (12)
            </button>
            <button
              type="button"
              onClick={() => setProtocolScope('nacional')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                protocolScope === 'nacional'
                  ? 'bg-sky-700 text-white'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              Ecuador Nacional (10)
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] text-slate-600">
                <th className="py-2.5 px-3 font-semibold">Sector / Provincia</th>
                <th className="py-2.5 px-3 font-semibold text-right">Cota</th>
                <th className="py-2.5 px-3 font-semibold text-right">Índice ENSO</th>
                <th className="py-2.5 px-3 font-semibold">Estado Operativo</th>
                <th className="py-2.5 pl-4 pr-3 font-semibold">Protocolo de Mitigación JMAC-Climatyc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {displayedProtocols.map((item) => {
                const stateLabel =
                  item.alertTier === 'roja'
                    ? '✖ Alerta Roja'
                    : item.alertTier === 'naranja'
                      ? '▲ Alerta Naranja'
                      : item.alertTier === 'amarilla'
                        ? '▲ Vigilancia'
                        : '● Nominal';
                const stateColor =
                  item.alertTier === 'roja'
                    ? 'text-rose-700'
                    : item.alertTier === 'naranja'
                      ? 'text-amber-700'
                      : item.alertTier === 'amarilla'
                        ? 'text-sky-700'
                        : 'text-emerald-700';

                return (
                  <tr key={item.zone.id} className="hover:bg-sky-50/45 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-950">{item.zone.name}</div>
                      <div className="text-[11px] text-slate-500">{item.zone.hydrologyBasin}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 font-medium">
                      {item.zone.elevationM} m
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-950">
                      {item.affectationIndex} / 100
                    </td>
                    <td className={`py-3 px-3 font-bold whitespace-nowrap ${stateColor}`}>
                      {stateLabel}
                    </td>
                    <td className="py-3 pl-4 pr-3 text-slate-700 leading-relaxed max-w-md">
                      {item.zone.mitigationProtocol}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
