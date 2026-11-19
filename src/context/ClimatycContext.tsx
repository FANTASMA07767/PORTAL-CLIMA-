import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDocsFromServer,
  limit,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { GUAYAQUIL_ZONES, NACIONAL_ZONES, ALL_MONITORING_ZONES } from '../data/ecuadorZones';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  computeZoneTelemetry,
  fetchAllClimateTelemetry,
} from '../services/climateService';
import {
  BLUEPRINT_CONSTRAINTS,
  CitizenReportDoc,
  DIRECTOR_ADMIN_EMAIL,
  GovernmentAlertItem,
  LiveZoneTelemetry,
  MarineEnsoTelemetry,
  NoaaNino12Reading,
  OsintReportItem,
  RadarFrameItem,
  ReportCategory,
  ReportStatus,
  RiverFloodTelemetry,
  SeverityLevel,
} from '../types/climate';

const AUTO_REFRESH_INTERVAL_SEC = 60;

interface NewReportInput {
  scope: 'guayaquil' | 'nacional';
  zoneId: string;
  category: ReportCategory;
  severity: SeverityLevel;
  waterDepthCm: number;
  affectedFamilies: number;
  description: string;
  reporterAlias: string;
  lat: number;
  lng: number;
}

interface ClimatycContextValue {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  guayaquilTelemetry: LiveZoneTelemetry[];
  nacionalTelemetry: LiveZoneTelemetry[];
  marine: MarineEnsoTelemetry | null;
  river: RiverFloodTelemetry | null;
  lastUpdatedIso: string | null;
  loadingClimate: boolean;
  climateError: string | null;
  refreshClimate: () => Promise<void>;
  govAlerts: GovernmentAlertItem[];
  noaaNino12: NoaaNino12Reading | null;
  lastGovAlertsSyncIso: string | null;
  loadingGovAlerts: boolean;
  refreshGovAlerts: (force?: boolean) => Promise<void>;
  osintReports: OsintReportItem[];
  lastOsintSyncIso: string | null;
  loadingOsint: boolean;
  refreshOsintReports: (force?: boolean) => Promise<void>;
  radarHost: string;
  radarFrames: RadarFrameItem[];
  refreshWeatherRadar: (force?: boolean) => Promise<void>;
  reports: CitizenReportDoc[];
  lastReportsSyncIso: string | null;
  loadingFirestore: boolean;
  syncReportsNow: () => Promise<void>;
  secondsUntilNextSync: number;
  submitCitizenReport: (input: NewReportInput) => Promise<void>;
  upvoteCitizenReport: (report: CitizenReportDoc) => Promise<void>;
  deleteCitizenReport: (reportId: string) => Promise<void>;
  seedOperationalReports: () => Promise<void>;
}

const ClimatycContext = createContext<ClimatycContextValue | null>(null);

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) {
    return val.toMillis();
  }
  if (
    val &&
    typeof val === 'object' &&
    'seconds' in val &&
    typeof (val as { seconds: number }).seconds === 'number'
  ) {
    return (val as { seconds: number }).seconds * 1000;
  }
  return Date.now();
}

function generateSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function mapSnapshotDocsToReports(
  docs: QueryDocumentSnapshot<DocumentData, DocumentData>[]
): CitizenReportDoc[] {
  const items: CitizenReportDoc[] = docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      scope: data.scope === 'nacional' ? 'nacional' : 'guayaquil',
      zoneId: String(data.zoneId ?? ''),
      zoneName: String(data.zoneName ?? ''),
      category: (data.category as ReportCategory) ?? 'inundacion_vial',
      severity: (data.severity as SeverityLevel) ?? 'moderada',
      waterDepthCm: Number(data.waterDepthCm ?? 0),
      affectedFamilies: Number(data.affectedFamilies ?? 0),
      description: String(data.description ?? ''),
      reporterAlias: String(data.reporterAlias ?? 'Observador'),
      authorId: String(data.authorId ?? ''),
      lat: Number(data.lat ?? -2.1894),
      lng: Number(data.lng ?? -79.8891),
      status: (data.status as ReportStatus) ?? 'reportado',
      visibility: data.visibility === 'archivado' ? 'archivado' : 'publico',
      upvotes: Number(data.upvotes ?? 0),
      adminNote: String(data.adminNote ?? ''),
      createdAtMs: toMillis(data.createdAt),
      updatedAtMs: toMillis(data.updatedAt),
    };
  });
  items.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return items;
}

export const ClimatycProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [rawClimatePayload, setRawClimatePayload] = useState<Awaited<
    ReturnType<typeof fetchAllClimateTelemetry>
  > | null>(null);
  const [loadingClimate, setLoadingClimate] = useState<boolean>(true);
  const [climateError, setClimateError] = useState<string | null>(null);

  const [govAlerts, setGovAlerts] = useState<GovernmentAlertItem[]>([]);
  const [noaaNino12, setNoaaNino12] = useState<NoaaNino12Reading | null>(null);
  const [lastGovAlertsSyncIso, setLastGovAlertsSyncIso] = useState<string | null>(null);
  const [loadingGovAlerts, setLoadingGovAlerts] = useState<boolean>(true);

  const [osintReports, setOsintReports] = useState<OsintReportItem[]>([]);
  const [lastOsintSyncIso, setLastOsintSyncIso] = useState<string | null>(null);
  const [loadingOsint, setLoadingOsint] = useState<boolean>(true);

  const [radarHost, setRadarHost] = useState<string>('https://tilecache.rainviewer.com');
  const [radarFrames, setRadarFrames] = useState<RadarFrameItem[]>([]);

  const [reports, setReports] = useState<CitizenReportDoc[]>([]);
  const [lastReportsSyncIso, setLastReportsSyncIso] = useState<string | null>(null);
  const [loadingFirestore, setLoadingFirestore] = useState<boolean>(false);

  const [secondsUntilNextSync, setSecondsUntilNextSync] = useState<number>(
    AUTO_REFRESH_INTERVAL_SEC
  );
  const countdownRef = useRef<number>(AUTO_REFRESH_INTERVAL_SEC);

  const isAdmin = useMemo(() => {
    return Boolean(
      user &&
        user.emailVerified &&
        user.email?.toLowerCase() === DIRECTOR_ADMIN_EMAIL.toLowerCase()
    );
  }, [user]);

  // 1. Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2. Climate Telemetry Fetcher (Open-Meteo Atmospheric + Marine SST + River Flood)
  const fetchClimateOnly = useCallback(async () => {
    setLoadingClimate(true);
    setClimateError(null);
    try {
      const data = await fetchAllClimateTelemetry();
      setRawClimatePayload(data);
    } catch (err) {
      setClimateError(
        err instanceof Error
          ? err.message
          : 'No se pudo sincronizar la telemetría climática en tiempo real.'
      );
    } finally {
      setLoadingClimate(false);
    }
  }, []);

  // 3. Official Government Alerts Fetcher (SNGR, INAMHI, INOCAR/ERFEN, Segura EP, NOAA CPC)
  const refreshGovAlerts = useCallback(async (force = false) => {
    setLoadingGovAlerts(true);
    try {
      const querySuffix = force ? '?force=1' : '';
      const res = await fetch(`/api/gov-alerts${querySuffix}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        fetchedAtIso?: string;
        noaaNino12?: NoaaNino12Reading | null;
        alerts?: GovernmentAlertItem[];
      };
      if (Array.isArray(data.alerts)) {
        setGovAlerts(data.alerts);
      }
      setNoaaNino12(data.noaaNino12 ?? null);
      setLastGovAlertsSyncIso(data.fetchedAtIso ?? new Date().toISOString());
    } catch {
      setLastGovAlertsSyncIso((prev) => prev ?? new Date().toISOString());
    } finally {
      setLoadingGovAlerts(false);
    }
  }, []);

  // 3b. Open-Source / Social (X) / Ducts / Sewers / Flooded Roads Live Feed
  const refreshOsintReports = useCallback(async (force = false) => {
    setLoadingOsint(true);
    try {
      const querySuffix = force ? '?force=1' : '';
      const res = await fetch(`/api/osint-reports${querySuffix}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        fetchedAtIso?: string;
        items?: OsintReportItem[];
      };
      if (Array.isArray(data.items)) {
        setOsintReports(data.items);
      }
      setLastOsintSyncIso(data.fetchedAtIso ?? new Date().toISOString());
    } catch {
      setLastOsintSyncIso((prev) => prev ?? new Date().toISOString());
    } finally {
      setLoadingOsint(false);
    }
  }, []);

  // 3c. Live Doppler Weather Radar Tile Frames (RainViewer)
  const refreshWeatherRadar = useCallback(async (force = false) => {
    try {
      const querySuffix = force ? '?force=1' : '';
      const res = await fetch(`/api/weather-radar${querySuffix}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        host?: string;
        frames?: RadarFrameItem[];
      };
      if (data.host) setRadarHost(data.host);
      if (Array.isArray(data.frames)) setRadarFrames(data.frames);
    } catch {
      // Radar overlay gracefully degrades when tiles are unreachable
    }
  }, []);

  // 4. Active Server Verification for Citizen Reports (supplements real-time onSnapshot push)
  const syncReportsNow = useCallback(async () => {
    if (!authReady || !auth.currentUser) return;
    const reportsPath = 'citizen_reports';
    const reportsQuery = query(
      collection(db, reportsPath),
      where('visibility', '==', 'publico'),
      limit(100)
    );
    try {
      const serverSnap = await getDocsFromServer(reportsQuery);
      setReports(mapSnapshotDocsToReports(serverSnap.docs));
      setLastReportsSyncIso(new Date().toISOString());
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('Missing or insufficient permissions') ||
          error.message.includes('PERMISSION_DENIED'))
      ) {
        handleFirestoreError(error, OperationType.LIST, reportsPath);
      }
    }
  }, [authReady]);

  // Unified manual & 60-second refresh trigger across ALL platform streams
  const refreshClimate = useCallback(async () => {
    countdownRef.current = AUTO_REFRESH_INTERVAL_SEC;
    setSecondsUntilNextSync(AUTO_REFRESH_INTERVAL_SEC);
    await Promise.all([
      fetchClimateOnly(),
      refreshGovAlerts(true),
      refreshOsintReports(true),
      refreshWeatherRadar(true),
      syncReportsNow(),
    ]);
  }, [fetchClimateOnly, refreshGovAlerts, refreshOsintReports, refreshWeatherRadar, syncReportsNow]);

  // Initial load on mount
  useEffect(() => {
    void fetchClimateOnly();
    void refreshGovAlerts(false);
    void refreshOsintReports(false);
    void refreshWeatherRadar(false);
  }, [fetchClimateOnly, refreshGovAlerts, refreshOsintReports, refreshWeatherRadar]);

  // Master 60-second near-real-time synchronization cycle (updates Climate + Radar + Gov Alerts + OSINT/X + Citizen Reports every minute)
  useEffect(() => {
    countdownRef.current = AUTO_REFRESH_INTERVAL_SEC;
    setSecondsUntilNextSync(AUTO_REFRESH_INTERVAL_SEC);

    const ticker = setInterval(() => {
      if (countdownRef.current <= 1) {
        countdownRef.current = AUTO_REFRESH_INTERVAL_SEC;
        setSecondsUntilNextSync(AUTO_REFRESH_INTERVAL_SEC);
        void fetchClimateOnly();
        void refreshGovAlerts(true);
        void refreshOsintReports(true);
        void refreshWeatherRadar(true);
        void syncReportsNow();
      } else {
        countdownRef.current -= 1;
        setSecondsUntilNextSync(countdownRef.current);
      }
    }, 1000);

    return () => clearInterval(ticker);
  }, [fetchClimateOnly, refreshGovAlerts, refreshOsintReports, refreshWeatherRadar, syncReportsNow]);

  // 5. Firestore Real-Time Push Listener for Citizen Reports (instant push + 60s server verification)
  useEffect(() => {
    if (!authReady || !user) {
      setReports([]);
      setLastReportsSyncIso(null);
      setLoadingFirestore(false);
      return;
    }

    setLoadingFirestore(true);

    const reportsPath = 'citizen_reports';
    const reportsQuery = query(
      collection(db, reportsPath),
      where('visibility', '==', 'publico'),
      limit(100)
    );

    const unsubReports = onSnapshot(
      reportsQuery,
      (snapshot) => {
        setReports(mapSnapshotDocsToReports(snapshot.docs));
        setLastReportsSyncIso(new Date().toISOString());
        setLoadingFirestore(false);
      },
      (error) => {
        setLoadingFirestore(false);
        handleFirestoreError(error, OperationType.LIST, reportsPath);
      }
    );

    return () => {
      unsubReports();
    };
  }, [authReady, user]);

  // 6. Derived Live Zone Telemetry combining atmospheric, marine SST, river discharge, and citizen reports
  const guayaquilTelemetry = useMemo(() => {
    if (!rawClimatePayload) return [];
    return GUAYAQUIL_ZONES.map((zone) =>
      computeZoneTelemetry(
        zone,
        rawClimatePayload.rawForecasts.get(zone.id) ?? {},
        rawClimatePayload.marine.sstAnomalyC,
        rawClimatePayload.river.dischargeAnomalyPct,
        reports
      )
    );
  }, [rawClimatePayload, reports]);

  const nacionalTelemetry = useMemo(() => {
    if (!rawClimatePayload) return [];
    return NACIONAL_ZONES.map((zone) =>
      computeZoneTelemetry(
        zone,
        rawClimatePayload.rawForecasts.get(zone.id) ?? {},
        rawClimatePayload.marine.sstAnomalyC,
        rawClimatePayload.river.dischargeAnomalyPct,
        reports
      )
    );
  }, [rawClimatePayload, reports]);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  // Sanitized Firestore Mutations
  const submitCitizenReport = useCallback(async (input: NewReportInput) => {
    if (!auth.currentUser) {
      throw new Error(
        'Debes iniciar sesión con Google para registrar un reporte georreferenciado.'
      );
    }
    const matchedZone = ALL_MONITORING_ZONES.find((z) => z.id === input.zoneId);
    if (!matchedZone || !BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(matchedZone.id)) {
      throw new Error('Selecciona un sector o provincia válida.');
    }

    const cleanDesc = input.description.trim().slice(0, BLUEPRINT_CONSTRAINTS.DESCRIPTION_MAX);
    if (cleanDesc.length < BLUEPRINT_CONSTRAINTS.DESCRIPTION_MIN) {
      throw new Error(
        `La descripción requiere al menos ${BLUEPRINT_CONSTRAINTS.DESCRIPTION_MIN} caracteres.`
      );
    }

    const cleanAlias = (
      input.reporterAlias.trim() ||
      auth.currentUser.displayName ||
      'Ciudadano Verificado'
    ).slice(0, BLUEPRINT_CONSTRAINTS.ALIAS_MAX);
    if (cleanAlias.length < BLUEPRINT_CONSTRAINTS.ALIAS_MIN) {
      throw new Error('Ingresa un alias de observador válido (mínimo 2 caracteres).');
    }

    const clampedLat = Math.max(
      BLUEPRINT_CONSTRAINTS.LAT_MIN,
      Math.min(BLUEPRINT_CONSTRAINTS.LAT_MAX, Number(input.lat.toFixed(5)))
    );
    const clampedLng = Math.max(
      BLUEPRINT_CONSTRAINTS.LNG_MIN,
      Math.min(BLUEPRINT_CONSTRAINTS.LNG_MAX, Number(input.lng.toFixed(5)))
    );
    const clampedDepth = Math.round(
      Math.max(
        BLUEPRINT_CONSTRAINTS.WATER_DEPTH_MIN,
        Math.min(BLUEPRINT_CONSTRAINTS.WATER_DEPTH_MAX, Number(input.waterDepthCm) || 0)
      )
    );
    const clampedFamilies = Math.round(
      Math.max(
        BLUEPRINT_CONSTRAINTS.FAMILIES_MIN,
        Math.min(BLUEPRINT_CONSTRAINTS.FAMILIES_MAX, Number(input.affectedFamilies) || 0)
      )
    );

    const reportId = generateSafeDocId('rep');
    const docPath = `citizen_reports/${reportId}`;

    try {
      await setDoc(doc(db, 'citizen_reports', reportId), {
        scope: matchedZone.scope,
        zoneId: matchedZone.id,
        zoneName: matchedZone.name.slice(0, BLUEPRINT_CONSTRAINTS.ZONE_NAME_MAX),
        category: input.category,
        severity: input.severity,
        waterDepthCm: clampedDepth,
        affectedFamilies: clampedFamilies,
        description: cleanDesc,
        reporterAlias: cleanAlias,
        authorId: auth.currentUser.uid,
        lat: clampedLat,
        lng: clampedLng,
        status: 'reportado',
        visibility: 'publico',
        upvotes: 0,
        adminNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }
  }, []);

  const upvoteCitizenReport = useCallback(async (report: CitizenReportDoc) => {
    if (!auth.currentUser || report.status === 'mitigado') return;
    const docPath = `citizen_reports/${report.id}`;
    try {
      await updateDoc(doc(db, 'citizen_reports', report.id), {
        upvotes: report.upvotes + 1,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }
  }, []);

  const deleteCitizenReport = useCallback(async (reportId: string) => {
    if (!auth.currentUser) return;
    const docPath = `citizen_reports/${reportId}`;
    try {
      await deleteDoc(doc(db, 'citizen_reports', reportId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, docPath);
    }
  }, []);

  const seedOperationalReports = useCallback(async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const sampleEntries: Array<Omit<NewReportInput, 'reporterAlias'> & { reporterAlias: string }> =
      [
        {
          scope: 'guayaquil',
          zoneId: 'gye_monte_sinai',
          category: 'inundacion_vial',
          severity: 'critica',
          waterDepthCm: 48,
          affectedFamilies: 34,
          description:
            'Acumulación pluvial en vía principal de acceso a cooperativa Trinidad de Dios; tránsito liviano restringido y requerimiento de hidrocleaner.',
          reporterAlias: 'Red Barrial Monte Sinaí',
          lat: -2.1138,
          lng: -79.9655,
        },
        {
          scope: 'guayaquil',
          zoneId: 'gye_isla_trinitaria',
          category: 'desbordamiento',
          severity: 'alta',
          waterDepthCm: 32,
          affectedFamilies: 21,
          description:
            'Incremento del nivel del Estero Mogollón coincidente con pleamar y escorrentía urbana hacia calles ribereñas.',
          reporterAlias: 'Comité Comunitario Trinitaria',
          lat: -2.2492,
          lng: -79.9131,
        },
        {
          scope: 'guayaquil',
          zoneId: 'gye_urdesa',
          category: 'alcantarillado',
          severity: 'moderada',
          waterDepthCm: 22,
          affectedFamilies: 8,
          description:
            'Retorno temporal en sumideros de Av. Víctor Emilio Estrada e Ilanes tras lluvia convectiva vespertina.',
          reporterAlias: 'Veeduría Vial Urdesa',
          lat: -2.1679,
          lng: -79.9106,
        },
        {
          scope: 'nacional',
          zoneId: 'ec_los_rios',
          category: 'desbordamiento',
          severity: 'alta',
          waterDepthCm: 40,
          affectedFamilies: 55,
          description:
            'Crecida del río Catarama y anegamiento de áreas bajas agrícolas en el eje Babahoyo - Jujan.',
          reporterAlias: 'Monitor Fluvial Los Ríos',
          lat: -1.8041,
          lng: -79.5322,
        },
      ];

    for (const item of sampleEntries) {
      const zone = ALL_MONITORING_ZONES.find((z) => z.id === item.zoneId);
      if (!zone) continue;
      const reportId = generateSafeDocId('rep');
      const docPath = `citizen_reports/${reportId}`;
      try {
        await setDoc(doc(db, 'citizen_reports', reportId), {
          scope: zone.scope,
          zoneId: zone.id,
          zoneName: zone.name,
          category: item.category,
          severity: item.severity,
          waterDepthCm: item.waterDepthCm,
          affectedFamilies: item.affectedFamilies,
          description: item.description,
          reporterAlias: item.reporterAlias,
          authorId: uid,
          lat: item.lat,
          lng: item.lng,
          status: 'reportado',
          visibility: 'publico',
          upvotes: 0,
          adminNote: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, docPath);
      }
    }
  }, []);

  const value: ClimatycContextValue = {
    user,
    authReady,
    isAdmin,
    signInWithGoogle,
    signOut,
    guayaquilTelemetry,
    nacionalTelemetry,
    marine: rawClimatePayload?.marine ?? null,
    river: rawClimatePayload?.river ?? null,
    lastUpdatedIso: rawClimatePayload?.fetchedAtIso ?? null,
    loadingClimate,
    climateError,
    refreshClimate,
    govAlerts,
    noaaNino12,
    lastGovAlertsSyncIso,
    loadingGovAlerts,
    refreshGovAlerts,
    osintReports,
    lastOsintSyncIso,
    loadingOsint,
    refreshOsintReports,
    radarHost,
    radarFrames,
    refreshWeatherRadar,
    reports,
    lastReportsSyncIso,
    loadingFirestore,
    syncReportsNow,
    secondsUntilNextSync,
    submitCitizenReport,
    upvoteCitizenReport,
    deleteCitizenReport,
    seedOperationalReports,
  };

  return <ClimatycContext.Provider value={value}>{children}</ClimatycContext.Provider>;
};

export function useClimatyc(): ClimatycContextValue {
  const ctx = useContext(ClimatycContext);
  if (!ctx) {
    throw new Error('useClimatyc debe usarse dentro de ClimatycProvider');
  }
  return ctx;
}
