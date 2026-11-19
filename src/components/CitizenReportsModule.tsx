import React, { useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  LocateFixed,
  MapPin,
  Maximize2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { ALL_MONITORING_ZONES, GUAYAQUIL_ZONES, NACIONAL_ZONES } from '../data/ecuadorZones';
import { useClimatyc } from '../context/ClimatycContext';
import {
  CATEGORY_LABELS,
  OSINT_CATEGORY_LABELS,
  OsintReportItem,
  SeverityLevel,
  STATUS_LABELS,
} from '../types/climate';
import { InteractiveRiskMap } from './InteractiveRiskMap';

interface CitizenReportsModuleProps {
  defaultScope?: 'guayaquil' | 'nacional';
}

type FeedChannelFilter =
  | 'todos'
  | 'redes_abiertas'
  | 'ductos_alcantarillas'
  | 'via_anegada';

const LIVE_X_CHANNELS = [
  {
    label: 'X · #LluviasGuayaquil',
    url: 'https://x.com/search?q=(Guayaquil%20lluvia%20OR%20%23LluviasGuayaquil%20OR%20inundacion)&src=typed_query&f=live',
  },
  {
    label: 'X · Ductos / @interagua',
    url: 'https://x.com/search?q=(interagua%20OR%20emapag%20OR%20alcantarillas%20OR%20sumideros)%20Guayaquil&src=typed_query&f=live',
  },
  {
    label: 'X · Vías Anegadas / @ATMGuayaquil',
    url: 'https://x.com/search?q=(ATMGuayaquil%20OR%20%22vias%20anegadas%22%20OR%20%22paso%20a%20desnivel%22%20OR%20tunel)%20Guayaquil&src=typed_query&f=live',
  },
  {
    label: 'X · Cámaras / @SeguraEP',
    url: 'https://x.com/search?q=(from%3ASeguraEP%20OR%20SeguraEP)%20(lluvia%20OR%20agua%20OR%20vias%20OR%20alerta)&src=typed_query&f=live',
  },
  {
    label: 'X · @ECU911Sambo',
    url: 'https://x.com/search?q=(ECU911Sambo%20OR%20ECU911_)*%20(lluvia%20OR%20calzada%20OR%20anegada)&src=typed_query&f=live',
  },
  {
    label: 'X · @Riesgos_Ec / @inamhi_ec',
    url: 'https://x.com/search?q=(from%3ARiesgos_Ec%20OR%20from%3Ainamhi_ec)&src=typed_query&f=live',
  },
];

export const CitizenReportsModule: React.FC<CitizenReportsModuleProps> = ({
  defaultScope = 'guayaquil',
}) => {
  const {
    user,
    reports,
    lastReportsSyncIso,
    loadingFirestore,
    syncReportsNow,
    osintReports,
    lastOsintSyncIso,
    loadingOsint,
    refreshOsintReports,
    secondsUntilNextSync,
    guayaquilTelemetry,
    nacionalTelemetry,
  } = useClimatyc();

  const mapSectionRef = useRef<HTMLDivElement | null>(null);

  const [mapScope, setMapScope] = useState<'guayaquil' | 'nacional'>(defaultScope);
  const availableZones = mapScope === 'guayaquil' ? GUAYAQUIL_ZONES : NACIONAL_ZONES;
  const [selectedZoneId, setSelectedZoneId] = useState<string>(availableZones[0].id);
  const [focusedOsintItem, setFocusedOsintItem] = useState<OsintReportItem | null>(null);
  const [fullscreenTrigger, setFullscreenTrigger] = useState<number>(0);

  const [channelFilter, setChannelFilter] = useState<FeedChannelFilter>('todos');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'guayaquil' | 'nacional'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | SeverityLevel>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const handleScopeSwitch = (nextScope: 'guayaquil' | 'nacional') => {
    setMapScope(nextScope);
    const list = nextScope === 'guayaquil' ? GUAYAQUIL_ZONES : NACIONAL_ZONES;
    setSelectedZoneId(list[0].id);
    setFocusedOsintItem(null);
  };

  const handleZoneChange = (nextZoneId: string) => {
    setSelectedZoneId(nextZoneId);
    setFocusedOsintItem(null);
  };

  const handleFocusOsintOnMap = (item: OsintReportItem) => {
    setMapScope(item.scope);
    const matchedZone = ALL_MONITORING_ZONES.find((z) => z.id === item.zoneId);
    if (matchedZone) {
      setSelectedZoneId(matchedZone.id);
    }
    setFocusedOsintItem({ ...item });
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSyncAllFeeds = async () => {
    await Promise.all([
      refreshOsintReports(true),
      user ? syncReportsNow() : Promise.resolve(),
    ]);
  };

  const filteredCommunityReports = useMemo(() => {
    if (channelFilter === 'redes_abiertas') return [];

    return reports.filter((r) => {
      if (channelFilter === 'ductos_alcantarillas' && r.category !== 'alcantarillado') return false;
      if (channelFilter === 'via_anegada' && r.category !== 'inundacion_vial') return false;
      if (scopeFilter !== 'all' && r.scope !== scopeFilter) return false;
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchZone = r.zoneName.toLowerCase().includes(q);
        const matchDesc = r.description.toLowerCase().includes(q);
        const matchCat = CATEGORY_LABELS[r.category].toLowerCase().includes(q);
        if (!matchZone && !matchDesc && !matchCat) return false;
      }
      return true;
    });
  }, [reports, channelFilter, scopeFilter, severityFilter, searchQuery]);

  const filteredOsintReports = useMemo(() => {
    return osintReports.filter((item) => {
      if (
        channelFilter === 'ductos_alcantarillas' &&
        item.osintCategory !== 'ductos_alcantarillas'
      ) {
        return false;
      }
      if (channelFilter === 'via_anegada' && item.osintCategory !== 'via_anegada') {
        return false;
      }
      if (scopeFilter !== 'all' && item.scope !== scopeFilter) return false;
      if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchZone = item.zoneName.toLowerCase().includes(q);
        const matchAccount = item.accountRef.toLowerCase().includes(q);
        const matchSource = item.sourceName.toLowerCase().includes(q);
        if (!matchTitle && !matchZone && !matchAccount && !matchSource) return false;
      }
      return true;
    });
  }, [osintReports, channelFilter, scopeFilter, severityFilter, searchQuery]);

  const ductosTotalCount = useMemo(
    () =>
      osintReports.filter((o) => o.osintCategory === 'ductos_alcantarillas').length +
      reports.filter((r) => r.category === 'alcantarillado').length,
    [osintReports, reports]
  );

  const viasTotalCount = useMemo(
    () =>
      osintReports.filter((o) => o.osintCategory === 'via_anegada').length +
      reports.filter((r) => r.category === 'inundacion_vial').length,
    [osintReports, reports]
  );

  const mapTelemetry = mapScope === 'guayaquil' ? guayaquilTelemetry : nacionalTelemetry;
  const latestSyncLabel = lastOsintSyncIso || lastReportsSyncIso;

  return (
    <div className="space-y-8">
      {/* Observatory Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="space-y-1">
          <p className="text-xs text-sky-700 font-semibold">
            Observatorio Abierto en Tiempo Real · Redes Sociales (X / Twitter), Fuentes Abiertas e Infraestructura Urbana
          </p>
          <h1 className="text-2xl md:text-3xl font-bold font-display text-slate-950">
            Monitoreo de Reportes Ciudadanos, Redes (X), Ductos y Vías Anegadas
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="font-medium text-slate-800">Modo Observatorio Pasivo</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums font-semibold text-sky-800">
            Sincronización 60s ({secondsUntilNextSync}s)
          </span>
        </div>
      </div>

      {/* Direct X (Twitter) & Open-Source Live Channels Strip */}
      <div className="bg-gradient-to-r from-white via-slate-50/90 to-sky-50/70 border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-bold text-slate-900">
            Rastreo Directo en X (Twitter) y Canales Operativos Abiertos
          </div>
          <p className="text-xs text-slate-600">
            Consulta en tiempo real publicaciones abiertas sobre alcantarillas, ductos cajón, pasos a desnivel y tránsito en Guayaquil y Ecuador.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {LIVE_X_CHANNELS.map((ch) => (
            <a
              key={ch.label}
              href={ch.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-slate-800 border border-slate-300 rounded-lg hover:border-sky-600 hover:text-sky-800 transition-colors whitespace-nowrap shrink-0"
            >
              {ch.label}
              <ExternalLink className="w-3 h-3 text-sky-700" />
            </a>
          ))}
        </div>
      </div>

      {/* Full-Width Expanded Observatory Map */}
      <div
        ref={mapSectionRef}
        className="bg-gradient-to-b from-white to-slate-50/85 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <MapPin className="w-4 h-4 text-sky-700 shrink-0" />
            <span className="font-bold text-slate-950">
              Cartografía Satelital y Meteorológica Ampliada del Observatorio
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="text-slate-600">
              {mapScope === 'guayaquil'
                ? '12 sectores estratégicos de Guayaquil + capas satelitales + pines de ductos [D], vías [V] y redes [X]'
                : '10 nodos provinciales e insulares del Ecuador + sensores satelitales y eventos viales'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scope Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              <button
                type="button"
                onClick={() => handleScopeSwitch('guayaquil')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  mapScope === 'guayaquil'
                    ? 'bg-sky-700 text-white'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                Guayaquil (12)
              </button>
              <button
                type="button"
                onClick={() => handleScopeSwitch('nacional')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  mapScope === 'nacional'
                    ? 'bg-sky-700 text-white'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                Ecuador Nacional (10)
              </button>
            </div>

            {/* Quick Sector / Node Selector */}
            <select
              value={selectedZoneId}
              aria-label="Seleccionar sector o provincia en el mapa"
              onChange={(e) => handleZoneChange(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-900 focus:outline-none focus:border-sky-600"
            >
              {availableZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>

            {/* Full-Screen Trigger */}
            <button
              type="button"
              onClick={() => setFullscreenTrigger((c) => c + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Ampliar a pantalla completa
            </button>
          </div>
        </div>

        <InteractiveRiskMap
          scope={mapScope}
          telemetryList={mapTelemetry}
          selectedZoneId={selectedZoneId}
          onSelectZone={handleZoneChange}
          reports={reports}
          heightClassName="h-[680px]"
          focusedOsintItem={focusedOsintItem}
          externalFullscreenTrigger={fullscreenTrigger}
        />
      </div>

      {/* Unified Live Feed: X / Open Sources + Ducts / Sewers + Flooded Roads */}
      <div className="bg-gradient-to-b from-white to-slate-50/75 border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold font-display text-slate-950">
              Flujo Unificado en Tiempo Real: Redes (X), Fuentes Abiertas, Ductos y Vías
            </h2>
            <p className="text-xs text-slate-600">
              Sincronización automática cada 60 segundos de reportes en X/fuentes abiertas, estado de ductos/alcantarillas y vías anegadas
              {latestSyncLabel && (
                <span className="font-mono tabular-nums text-slate-500">
                  {' '}
                  · Última sincronización{' '}
                  {new Date(latestSyncLabel).toLocaleTimeString('es-EC', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSyncAllFeeds()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono tabular-nums font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 hover:border-sky-600 hover:text-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3 h-3 text-sky-700 ${loadingOsint || loadingFirestore ? 'animate-spin' : ''}`}
              />
              Actualizar ({secondsUntilNextSync}s)
            </button>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar sector, vía, alcantarilla..."
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              {(['all', 'guayaquil', 'nacional'] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setScopeFilter(sc)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    scopeFilter === sc
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  {sc === 'all' ? 'Todo EC' : sc === 'guayaquil' ? 'Guayaquil' : 'Nacional'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              {(['all', 'critica', 'alta', 'moderada'] as const).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    severityFilter === sev
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  {sev === 'all'
                    ? 'Severidad'
                    : sev === 'critica'
                      ? 'Crítica'
                      : sev === 'alta'
                        ? 'Alta'
                        : 'Moderada'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Channel Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg">
          {(
            [
              {
                id: 'todos',
                label: `Todos los canales (${osintReports.length + reports.length})`,
              },
              {
                id: 'redes_abiertas',
                label: `Redes (X) y Fuentes Abiertas (${osintReports.length})`,
              },
              {
                id: 'ductos_alcantarillas',
                label: `Ductos y Alcantarillas (${ductosTotalCount})`,
              },
              {
                id: 'via_anegada',
                label: `Vías Anegadas y Túneles (${viasTotalCount})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setChannelFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                channelFilter === tab.id
                  ? 'bg-sky-700 text-white'
                  : 'text-slate-700 hover:text-slate-950 hover:bg-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Loading Skeletons */}
        {loadingOsint && osintReports.length === 0 && filteredCommunityReports.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-20 bg-slate-100 border border-slate-200 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : filteredOsintReports.length === 0 && filteredCommunityReports.length === 0 ? (
          <div className="py-10 text-center space-y-2 border border-dashed border-slate-300 rounded-lg bg-slate-50/60">
            <p className="text-sm text-slate-700 font-medium">
              No se encontraron reportes abiertos con los filtros seleccionados.
            </p>
            <button
              type="button"
              onClick={() => {
                setChannelFilter('todos');
                setScopeFilter('all');
                setSeverityFilter('all');
                setSearchQuery('');
              }}
              className="text-xs font-semibold text-sky-700 hover:text-sky-800 underline cursor-pointer"
            >
              Restablecer filtros de observación
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border-t border-slate-200">
            {/* Passive Historical Community Entries */}
            {filteredCommunityReports.map((rep) => {
              const sevText =
                rep.severity === 'critica'
                  ? 'text-rose-700'
                  : rep.severity === 'alta'
                    ? 'text-amber-700'
                    : 'text-sky-700';
              const sevGlyph =
                rep.severity === 'critica'
                  ? '✖ Crítica'
                  : rep.severity === 'alta'
                    ? '▲ Alta'
                    : '● Moderada';

              return (
                <div
                  key={rep.id}
                  className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-sky-50/40 transition-colors px-2"
                >
                  <div className="space-y-1.5 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className={`font-bold ${sevText}`}>{sevGlyph}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-700 font-semibold">Bitácora Territorial</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-900 font-semibold">{rep.zoneName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{CATEGORY_LABELS[rep.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-sky-700 font-medium">{STATUS_LABELS[rep.status]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {new Date(rep.createdAtMs).toLocaleString('es-EC', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <p className="text-sm text-slate-800 leading-relaxed">{rep.description}</p>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
                      <span>Lámina: {rep.waterDepthCm} cm</span>
                      <span aria-hidden="true">·</span>
                      <span>Familias: {rep.affectedFamilies}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Coord: {rep.lat.toFixed(4)}°, {rep.lng.toFixed(4)}°
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setMapScope(rep.scope);
                        setSelectedZoneId(rep.zoneId);
                        mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 hover:border-sky-600 hover:text-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <LocateFixed className="w-3.5 h-3.5 text-sky-700" />
                      Ubicar en mapa
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Open-Source / X (Twitter) / Ducts & Sewers / Flooded Roads Live Items */}
            {filteredOsintReports.map((item) => {
              const catColor =
                item.osintCategory === 'ductos_alcantarillas'
                  ? 'text-amber-700'
                  : item.osintCategory === 'via_anegada'
                    ? 'text-rose-700'
                    : 'text-sky-700';

              const catGlyph =
                item.osintCategory === 'ductos_alcantarillas'
                  ? '◆ Ductos y Alcantarillas'
                  : item.osintCategory === 'via_anegada'
                    ? '▲ Vías Anegadas y Tránsito'
                    : item.osintCategory === 'redes_x'
                      ? '● Redes (X / Abiertas)'
                      : '● Fuente Abierta';

              return (
                <div
                  key={item.id}
                  className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-sky-50/45 transition-colors px-2"
                >
                  <div className="space-y-1.5 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className={`font-bold ${catColor}`}>{catGlyph}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-900 font-semibold">{item.zoneName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-sky-800">{item.accountRef}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-700">{item.sourceName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {new Date(item.publishedAtIso).toLocaleString('es-EC', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-950 leading-snug">
                      {item.title}
                    </h3>

                    <p className="text-xs text-slate-700 leading-relaxed">{item.summary}</p>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
                      <span>{OSINT_CATEGORY_LABELS[item.osintCategory]}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Georref: {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleFocusOsintOnMap(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 hover:border-sky-600 hover:text-sky-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <LocateFixed className="w-3.5 h-3.5 text-sky-700" />
                      Ubicar en mapa
                    </button>

                    <a
                      href={item.xLiveSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-sky-50 border border-sky-200 rounded-lg text-sky-800 hover:border-sky-500 transition-colors whitespace-nowrap shrink-0"
                    >
                      Pulso en X
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      Fuente
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
