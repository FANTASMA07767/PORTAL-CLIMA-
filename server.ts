import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type GovEntityCode = 'SNGR' | 'INAMHI' | 'INOCAR_ERFEN' | 'SEGURA_EP';
export type GovAlertLevel = 'roja' | 'naranja' | 'amarilla' | 'informativa';

export interface GovAlertEntry {
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

interface GovAlertsApiPayload {
  fetchedAtIso: string;
  refreshIntervalSec: number;
  noaaNino12: {
    weekLabel: string;
    sstC: number;
    anomalyC: number;
    nino34SstC: number;
    nino34AnomalyC: number;
  } | null;
  alerts: GovAlertEntry[];
}

const ENTITY_PORTALS: Record<GovEntityCode, { fullName: string; url: string }> = {
  SNGR: {
    fullName: 'Secretaría Nacional de Gestión de Riesgos (SNGR)',
    url: 'https://www.gestionderiesgos.gob.ec/',
  },
  INAMHI: {
    fullName: 'Instituto Nacional de Meteorología e Hidrología (INAMHI)',
    url: 'https://www.inamhi.gob.ec/',
  },
  INOCAR_ERFEN: {
    fullName: 'INOCAR · Comité Nacional ERFEN',
    url: 'https://www.inocar.mil.ec/',
  },
  SEGURA_EP: {
    fullName: 'Segura EP · COE Cantonal Guayaquil',
    url: 'https://seguraep.gob.ec/',
  },
};

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(xmlBlock: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xmlBlock.match(regex);
  return match ? decodeXmlEntities(match[1]) : '';
}

function classifyEntity(title: string, source: string): GovEntityCode {
  const combined = `${title} ${source}`.toLowerCase();
  if (
    combined.includes('segura ep') ||
    combined.includes('coe cantonal') ||
    combined.includes('municipio de guayaquil') ||
    combined.includes('alcaldía de guayaquil')
  ) {
    return 'SEGURA_EP';
  }
  if (combined.includes('inamhi') || combined.includes('hidrología') || combined.includes('meteorolog')) {
    return 'INAMHI';
  }
  if (
    combined.includes('inocar') ||
    combined.includes('erfen') ||
    combined.includes('aguaje') ||
    combined.includes('oleaje') ||
    combined.includes('oceanográf')
  ) {
    return 'INOCAR_ERFEN';
  }
  return 'SNGR';
}

function classifyScope(text: string): 'guayaquil' | 'nacional' {
  const lower = text.toLowerCase();
  if (
    lower.includes('guayaquil') ||
    lower.includes('segura ep') ||
    lower.includes('estero salado') ||
    lower.includes('monte sinaí') ||
    lower.includes('guasmo') ||
    lower.includes('durán') ||
    lower.includes('samborondón')
  ) {
    return 'guayaquil';
  }
  return 'nacional';
}

function classifyAlertLevel(text: string): GovAlertLevel {
  const lower = text.toLowerCase();
  if (
    lower.includes('alerta roja') ||
    lower.includes('emergencia') ||
    lower.includes('desbordamiento') ||
    lower.includes('evacuación') ||
    lower.includes('crítica') ||
    lower.includes('desastre')
  ) {
    return 'roja';
  }
  if (
    lower.includes('alerta naranja') ||
    lower.includes('fuertes lluvias') ||
    lower.includes('lluvias intensas') ||
    lower.includes('inundac') ||
    lower.includes('tormenta') ||
    lower.includes('advertencia') ||
    lower.includes('aluvión') ||
    lower.includes('deslizamiento')
  ) {
    return 'naranja';
  }
  if (
    lower.includes('alerta amarilla') ||
    lower.includes('lluvia') ||
    lower.includes('precipitaciones') ||
    lower.includes('el niño') ||
    lower.includes('aguaje') ||
    lower.includes('oleaje') ||
    lower.includes('invernal')
  ) {
    return 'amarilla';
  }
  return 'informativa';
}

function buildInstitutionalSummary(entityCode: GovEntityCode, scope: 'guayaquil' | 'nacional'): string {
  switch (entityCode) {
    case 'SNGR':
      return scope === 'guayaquil'
        ? 'Seguimiento oficial de la Secretaría Nacional de Gestión de Riesgos sobre eventos pluviales, anegamientos y coordinación interinstitucional en Guayaquil y cuenca baja del Guayas.'
        : 'Reporte oficial articulado con la Secretaría Nacional de Gestión de Riesgos para vigilancia de afectaciones por lluvias, crecidas fluviales y Fenómeno de El Niño en territorio ecuatoriano.';
    case 'INAMHI':
      return 'Aviso hidrometeorológico referente a inestabilidad atmosférica, lluvias de intensidad variable, tormentas eléctricas y saturación de suelos monitoreados por el INAMHI.';
    case 'INOCAR_ERFEN':
      return 'Vigilancia oceanográfica y costera del INOCAR / Comité Nacional ERFEN sobre anomalías térmicas en Región Niño 1+2, estado del mar y condiciones de aguaje en el perfil costero.';
    case 'SEGURA_EP':
      return 'Comunicado operativo de Segura EP y mesas técnicas del COE Cantonal Guayaquil sobre monitoreo de cámaras, drenaje pluvial y respuesta ante lluvias en sectores urbanos.';
  }
}

async function fetchRssFeedItems(rssUrl: string): Promise<GovAlertEntry[]> {
  const response = await fetch(rssUrl, {
    headers: {
      'User-Agent': 'JMAC-Climatyc-Monitor/1.0 (+https://gestionderiesgos.gob.ec)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(7000),
  });

  if (!response.ok) {
    throw new Error(`RSS HTTP ${response.status}`);
  }

  const xml = await response.text();
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  const parsed: GovAlertEntry[] = [];

  for (let i = 0; i < Math.min(itemMatches.length, 14); i++) {
    const rawItem = itemMatches[i];
    const rawTitle = extractTag(rawItem, 'title');
    const link = extractTag(rawItem, 'link');
    const pubDateRaw = extractTag(rawItem, 'pubDate');
    const sourceTag = extractTag(rawItem, 'source');

    if (!rawTitle || !link) continue;

    // Clean trailing " - SourceName" from Google News RSS titles when present
    const cleanTitle =
      sourceTag && rawTitle.endsWith(` - ${sourceTag}`)
        ? rawTitle.slice(0, rawTitle.length - ` - ${sourceTag}`.length).trim()
        : rawTitle;

    const entityCode = classifyEntity(cleanTitle, sourceTag);
    const scope = classifyScope(cleanTitle);
    const alertLevel = classifyAlertLevel(cleanTitle);
    const pubMs = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
    const publishedAtIso = Number.isFinite(pubMs)
      ? new Date(pubMs).toISOString()
      : new Date().toISOString();

    parsed.push({
      id: `gov_${entityCode.toLowerCase()}_${i}_${Math.abs(
        cleanTitle.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)
      )}`,
      entityCode,
      entityName: ENTITY_PORTALS[entityCode].fullName,
      title: cleanTitle,
      summary: buildInstitutionalSummary(entityCode, scope),
      alertLevel,
      scope,
      publishedAtIso,
      sourceName: sourceTag || ENTITY_PORTALS[entityCode].fullName,
      url: link,
      portalUrl: ENTITY_PORTALS[entityCode].url,
    });
  }

  return parsed;
}

async function fetchNoaaNino12Index(): Promise<GovAlertsApiPayload['noaaNino12']> {
  try {
    const res = await fetch('https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for', {
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const rowRegex =
      /^\s*(\d{2}[A-Z]{3}\d{4})\s+(-?\d+\.\d)\s*(-?\d+\.\d)\s+(-?\d+\.\d)\s*(-?\d+\.\d)\s+(-?\d+\.\d)\s*(-?\d+\.\d)/;

    let latestMatch: RegExpMatchArray | null = null;
    for (const line of lines) {
      const m = line.match(rowRegex);
      if (m) {
        latestMatch = m;
      }
    }

    if (!latestMatch) return null;

    return {
      weekLabel: latestMatch[1],
      sstC: Number(latestMatch[2]),
      anomalyC: Number(latestMatch[3]),
      nino34SstC: Number(latestMatch[6]),
      nino34AnomalyC: Number(latestMatch[7]),
    };
  } catch {
    return null;
  }
}

function buildFallbackInstitutionalAlerts(nowIso: string): GovAlertEntry[] {
  return [
    {
      id: 'gov_fallback_sngr_1',
      entityCode: 'SNGR',
      entityName: ENTITY_PORTALS.SNGR.fullName,
      title:
        'SNGR mantiene monitoreo permanente por lluvias e impactos invernales asociados a condiciones oceánico-atmosféricas en el Litoral y Guayaquil',
      summary:
        'Vigilancia activa de Unidades de Gestión de Riesgos cantonales, limpieza de canales de drenaje y seguimiento de caudales en las cuencas del Guayas, Los Ríos, Manabí y El Oro.',
      alertLevel: 'naranja',
      scope: 'guayaquil',
      publishedAtIso: nowIso,
      sourceName: 'Portal Oficial SNGR Ecuador',
      url: 'https://www.gestionderiesgos.gob.ec/',
      portalUrl: ENTITY_PORTALS.SNGR.url,
    },
    {
      id: 'gov_fallback_inamhi_2',
      entityCode: 'INAMHI',
      entityName: ENTITY_PORTALS.INAMHI.fullName,
      title:
        'INAMHI: Vigilancia de precipitaciones convectivas, tormentas eléctricas y acumulación pluvial en la Región Litoral e Insular',
      summary:
        'Seguimiento sinóptico horario de nubosidad convectiva sobre la cuenca baja del Río Guayas, Guayaquil metropolitano y estribaciones de cordillera.',
      alertLevel: 'amarilla',
      scope: 'nacional',
      publishedAtIso: nowIso,
      sourceName: 'Red Hidrometeorológica INAMHI',
      url: 'https://www.inamhi.gob.ec/',
      portalUrl: ENTITY_PORTALS.INAMHI.url,
    },
    {
      id: 'gov_fallback_segura_3',
      entityCode: 'SEGURA_EP',
      entityName: ENTITY_PORTALS.SEGURA_EP.fullName,
      title:
        'Segura EP y COE Cantonal Guayaquil mantienen vigilancia en pasos a desnivel, riberas del Estero Salado y sectores vulnerables ante lluvias y pleamar',
      summary:
        'Coordinación preventiva con Interagua, Cuerpo de Bomberos y ATM para atención oportuna de acumulación de agua en vías estratégicas de Guayaquil.',
      alertLevel: 'amarilla',
      scope: 'guayaquil',
      publishedAtIso: nowIso,
      sourceName: 'Segura EP Guayaquil',
      url: 'https://seguraep.gob.ec/',
      portalUrl: ENTITY_PORTALS.SEGURA_EP.url,
    },
  ];
}

export type OsintCategory =
  | 'ductos_alcantarillas'
  | 'via_anegada'
  | 'redes_x'
  | 'evento_pluvial';

export interface OsintReportEntry {
  id: string;
  title: string;
  summary: string;
  osintCategory: OsintCategory;
  channelLabel: string;
  accountRef: string;
  severity: 'moderada' | 'alta' | 'critica';
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

export interface RadarFrameEntry {
  time: number;
  path: string;
  isForecast: boolean;
}

interface RadarApiPayload {
  fetchedAtIso: string;
  host: string;
  frames: RadarFrameEntry[];
}

interface OsintApiPayload {
  fetchedAtIso: string;
  refreshIntervalSec: number;
  items: OsintReportEntry[];
}

interface GazetteerRule {
  keywords: string[];
  zoneId: string;
  zoneName: string;
  scope: 'guayaquil' | 'nacional';
  lat: number;
  lng: number;
}

const ECUADOR_GAZETTEER: GazetteerRule[] = [
  {
    keywords: ['monte sinaí', 'monte sinai', 'trinidad de dios', ' Sergio Toral', 'sergio toral', 'flor de bastión', 'flor de bastion', 'socio vivienda'],
    zoneId: 'gye_monte_sinai',
    zoneName: 'Monte Sinaí',
    scope: 'guayaquil',
    lat: -2.1125,
    lng: -79.9672,
  },
  {
    keywords: ['guasmo', 'esclusas', 'cobina', 'unión de bananeros', 'union de bananeros', 'río guayas sur', 'fertisa'],
    zoneId: 'gye_guasmo_sur',
    zoneName: 'Guasmo Sur',
    scope: 'guayaquil',
    lat: -2.2698,
    lng: -79.8825,
  },
  {
    keywords: ['trinitaria', 'mogollón', 'mogollon', 'perimetral', 'tres bocas'],
    zoneId: 'gye_isla_trinitaria',
    zoneName: 'Isla Trinitaria',
    scope: 'guayaquil',
    lat: -2.2485,
    lng: -79.9142,
  },
  {
    keywords: ['urdesa', 'víctor emilio estrada', 'victor emilio estrada', 'las monjas', 'miraflores', 'kennedy', 'policentro', 'san marino'],
    zoneId: 'gye_urdesa',
    zoneName: 'Urdesa Central',
    scope: 'guayaquil',
    lat: -2.1684,
    lng: -79.9098,
  },
  {
    keywords: ['alborada', 'sauces', 'samanes', 'garzota', 'isidro ayora', 'francisco de orellana', 'orellana', 'guayacanes', 'tarqui norte', 'aeropuerto'],
    zoneId: 'gye_alborada_sauces',
    zoneName: 'Alborada y Sauces',
    scope: 'guayaquil',
    lat: -2.1389,
    lng: -79.8962,
  },
  {
    keywords: ['suburbio', 'cisne', 'portete', 'batallón', 'batallon', 'chala', 'estero salado oeste'],
    zoneId: 'gye_suburbio_oeste',
    zoneName: 'Suburbio Oeste',
    scope: 'guayaquil',
    lat: -2.2165,
    lng: -79.9325,
  },
  {
    keywords: ['mapasingue', 'tanca marengo', 'prosperina', 'martha de roldós', 'martha de roldos', 'cerros de mapasingue'],
    zoneId: 'gye_mapasingue',
    zoneName: 'Mapasingue',
    scope: 'guayaquil',
    lat: -2.1562,
    lng: -79.9278,
  },
  {
    keywords: ['bastión popular', 'bastion popular', 'pascuales', 'vía a daule', 'via a daule', 'mucho lote', 'orquídeas', 'orquideas', 'vergel'],
    zoneId: 'gye_bastion_popular',
    zoneName: 'Bastión Popular',
    scope: 'guayaquil',
    lat: -2.0894,
    lng: -79.9310,
  },
  {
    keywords: ['durán', 'duran', 'el recreo', 'puente unidad nacional', 'abel gilbert'],
    zoneId: 'gye_duran_recreo',
    zoneName: 'Durán · El Recreo',
    scope: 'guayaquil',
    lat: -2.1731,
    lng: -79.8390,
  },
  {
    keywords: ['9 de octubre', 'malecón', 'malecon', 'boyacá', 'boyaca', 'túnel', 'tunel', 'cerro del carmen', 'san eduardo', 'centro de guayaquil', 'olmedo', 'quito y', 'machala y'],
    zoneId: 'gye_centro_malecon',
    zoneName: 'Centro Urbano',
    scope: 'guayaquil',
    lat: -2.1924,
    lng: -79.8805,
  },
  {
    keywords: ['samborondón', 'samborondon', 'la puntilla', 'tarifa', 'entreríos', 'entrerios'],
    zoneId: 'gye_samborondon',
    zoneName: 'Samborondón',
    scope: 'guayaquil',
    lat: -2.1422,
    lng: -79.8655,
  },
  {
    keywords: ['vía a la costa', 'via a la costa', 'chongón', 'chongon', 'puerto hondo', 'puerto azul', 'ceibos', 'los ceibos'],
    zoneId: 'gye_via_costa',
    zoneName: 'Vía a la Costa',
    scope: 'guayaquil',
    lat: -2.1892,
    lng: -80.0155,
  },
  {
    keywords: ['los ríos', 'los rios', 'babahoyo', 'quevedo', 'jujan', 'vinces', 'catarama', 'buena fe'],
    zoneId: 'ec_los_rios',
    zoneName: 'Los Ríos · Babahoyo',
    scope: 'nacional',
    lat: -1.8019,
    lng: -79.5346,
  },
  {
    keywords: ['portoviejo', 'chone', 'poza honda', 'calceta', 'rocafuerte'],
    zoneId: 'ec_manabi_portoviejo',
    zoneName: 'Manabí · Portoviejo',
    scope: 'nacional',
    lat: -1.0546,
    lng: -80.4545,
  },
  {
    keywords: ['manta', 'montecristi', 'jaramijó', 'jaramijo', 'manabí', 'manabi'],
    zoneId: 'ec_manabi_manta',
    zoneName: 'Manabí · Manta',
    scope: 'nacional',
    lat: -0.9677,
    lng: -80.7089,
  },
  {
    keywords: ['esmeraldas', 'quinindé', 'quininde', 'atacames', 'teaone', 'muisne'],
    zoneId: 'ec_esmeraldas',
    zoneName: 'Esmeraldas',
    scope: 'nacional',
    lat: 0.9592,
    lng: -79.6540,
  },
  {
    keywords: ['el oro', 'machala', 'pasaje', 'santa rosa', 'puerto bolívar', 'puerto bolivar', 'jubones', 'zaruma', 'piñas'],
    zoneId: 'ec_el_oro',
    zoneName: 'El Oro · Machala',
    scope: 'nacional',
    lat: -3.2581,
    lng: -79.9554,
  },
  {
    keywords: ['santa elena', 'salinas', 'la libertad', 'montañita', 'manglaralto'],
    zoneId: 'ec_santa_elena',
    zoneName: 'Santa Elena · Salinas',
    scope: 'nacional',
    lat: -2.2145,
    lng: -80.9515,
  },
  {
    keywords: ['santo domingo', 'alóag', 'aloag', 'toachi', 'la concordia'],
    zoneId: 'ec_santo_domingo',
    zoneName: 'Santo Domingo',
    scope: 'nacional',
    lat: -0.2530,
    lng: -79.1754,
  },
  {
    keywords: ['galápagos', 'galapagos', 'san cristóbal', 'santa cruz'],
    zoneId: 'ec_galapagos',
    zoneName: 'Galápagos · San Cristóbal',
    scope: 'nacional',
    lat: -0.9022,
    lng: -89.6092,
  },
  {
    keywords: ['quito', 'pichincha', ' la gasca', 'guayllabamba', 'ruminahui'],
    zoneId: 'ec_pichincha',
    zoneName: 'Pichincha · Quito',
    scope: 'nacional',
    lat: -0.1807,
    lng: -78.4678,
  },
  {
    keywords: ['cuenca', 'azuay', 'molleturo', 'tomebamba', 'yanuncay', 'paute'],
    zoneId: 'ec_azuay',
    zoneName: 'Azuay · Cuenca',
    scope: 'nacional',
    lat: -2.9001,
    lng: -79.0059,
  },
];

const GYE_ROTATING_SECTORS: Array<{
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
}> = [
  { zoneId: 'gye_alborada_sauces', zoneName: 'Alborada y Sauces', lat: -2.1389, lng: -79.8962 },
  { zoneId: 'gye_urdesa', zoneName: 'Urdesa Central', lat: -2.1684, lng: -79.9098 },
  { zoneId: 'gye_centro_malecon', zoneName: 'Centro Urbano', lat: -2.1924, lng: -79.8805 },
  { zoneId: 'gye_guasmo_sur', zoneName: 'Guasmo Sur', lat: -2.2698, lng: -79.8825 },
  { zoneId: 'gye_monte_sinai', zoneName: 'Monte Sinaí', lat: -2.1125, lng: -79.9672 },
  { zoneId: 'gye_mapasingue', zoneName: 'Mapasingue', lat: -2.1562, lng: -79.9278 },
];

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function resolveLocationFromText(
  text: string,
  defaultScope: 'guayaquil' | 'nacional'
): {
  zoneId: string;
  zoneName: string;
  scope: 'guayaquil' | 'nacional';
  lat: number;
  lng: number;
} {
  const lower = text.toLowerCase();
  const h = hashString(text);

  for (const rule of ECUADOR_GAZETTEER) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      const spread = rule.scope === 'guayaquil' ? 0.0055 : 0.032;
      const dLat = (((h % 200) - 100) / 100) * spread;
      const dLng = ((((h >> 8) % 200) - 100) / 100) * spread;
      return {
        zoneId: rule.zoneId,
        zoneName: rule.zoneName,
        scope: rule.scope,
        lat: Number((rule.lat + dLat).toFixed(5)),
        lng: Number((rule.lng + dLng).toFixed(5)),
      };
    }
  }

  if (
    defaultScope === 'guayaquil' ||
    lower.includes('guayaquil') ||
    lower.includes('interagua') ||
    lower.includes('emapag') ||
    lower.includes('segura ep') ||
    lower.includes('atm')
  ) {
    const pick = GYE_ROTATING_SECTORS[h % GYE_ROTATING_SECTORS.length];
    const dLat = (((h % 180) - 90) / 90) * 0.0048;
    const dLng = ((((h >> 7) % 180) - 90) / 90) * 0.0048;
    return {
      zoneId: pick.zoneId,
      zoneName: `${pick.zoneName} · Guayaquil`,
      scope: 'guayaquil',
      lat: Number((pick.lat + dLat).toFixed(5)),
      lng: Number((pick.lng + dLng).toFixed(5)),
    };
  }

  return {
    zoneId: 'ec_los_rios',
    zoneName: 'Cuenca del Litoral · Ecuador',
    scope: 'nacional',
    lat: Number((-1.8019 + (((h % 140) - 70) / 70) * 0.04).toFixed(5)),
    lng: Number((-79.5346 + ((((h >> 6) % 140) - 70) / 70) * 0.04).toFixed(5)),
  };
}

function classifyOsintEntry(
  title: string,
  source: string,
  feedHint: OsintCategory
): {
  osintCategory: OsintCategory;
  channelLabel: string;
  accountRef: string;
  severity: 'moderada' | 'alta' | 'critica';
  summary: string;
} {
  const combined = `${title} ${source}`;
  const lower = combined.toLowerCase();

  const drainRegex =
    /\b(alcantarill\w*|ductos?|sumideros?|colector\w*|interagua|emapag|hidrocleaner\w*|zanjas?|drenaje\w*|desazolve)\b/i;
  const roadRegex =
    /\b(v[ií]as?|calles?|avenidas?|av\.|t[uú]nel\w*|desnivel|anegad\w*|anegamiento\w*|tr[aá]nsito|atm|cierres?\s+vial\w*|calzada|acumulaci[oó]n\s+de\s+agua)\b/i;
  const socialRegex =
    /\b(en\s+x|twitter|redes\s+sociales|usuarios|ciudadanos|reportan|videos?|ecu\s?911|segura\s?ep)\b/i;

  let osintCategory: OsintCategory = feedHint;
  if (drainRegex.test(combined)) {
    osintCategory = 'ductos_alcantarillas';
  } else if (feedHint === 'redes_x' && socialRegex.test(combined)) {
    osintCategory = 'redes_x';
  } else if (roadRegex.test(combined)) {
    osintCategory = 'via_anegada';
  } else if (socialRegex.test(combined)) {
    osintCategory = 'redes_x';
  }

  let accountRef = 'X · Fuentes Abiertas EC';
  if (lower.includes('interagua') || lower.includes('emapag')) {
    accountRef = '@interagua · Drenaje Pluvial';
  } else if (/\batm\b/i.test(combined)) {
    accountRef = '@ATMGuayaquil · Tránsito';
  } else if (lower.includes('segura ep') || lower.includes('coe cantonal')) {
    accountRef = '@SeguraEP · Monitoreo';
  } else if (lower.includes('ecu 911') || lower.includes('ecu911')) {
    accountRef = '@ECU911Sambo · Cámaras';
  } else if (lower.includes('riesgos') || lower.includes('sngr')) {
    accountRef = '@Riesgos_Ec · SNGR';
  } else if (lower.includes('inamhi')) {
    accountRef = '@inamhi_ec · Meteo';
  }

  const channelLabel =
    osintCategory === 'ductos_alcantarillas'
      ? 'Ductos y Alcantarillado'
      : osintCategory === 'via_anegada'
        ? 'Vías Anegadas y Tránsito'
        : osintCategory === 'redes_x'
          ? 'Redes Sociales (X / Abiertas)'
          : 'Monitoreo Abierto Pluvial';

  let severity: 'moderada' | 'alta' | 'critica' = 'moderada';
  if (
    lower.includes('colapso') ||
    lower.includes('cierre') ||
    lower.includes('cerrad') ||
    lower.includes('emergencia') ||
    lower.includes('desbord') ||
    lower.includes('atrapad') ||
    lower.includes('socavón')
  ) {
    severity = 'critica';
  } else if (
    lower.includes('inundad') ||
    lower.includes('anegad') ||
    lower.includes('taponamiento') ||
    lower.includes('acumulación') ||
    lower.includes('restring') ||
    lower.includes('alerta') ||
    lower.includes('intensas')
  ) {
    severity = 'alta';
  }

  const summary =
    osintCategory === 'ductos_alcantarillas'
      ? 'Actualización de fuentes abiertas sobre operatividad de sumideros, colectores pluviales, ductos cajón y limpieza preventiva de alcantarillas.'
      : osintCategory === 'via_anegada'
        ? 'Reporte abierto de movilidad urbana sobre acumulación de agua en calzada, estado de pasos a desnivel, túneles y corredores arteriales.'
        : osintCategory === 'redes_x'
          ? 'Incidencia ciudadana detectada en redes abiertas (X / portales comunitarios) y cámaras de monitoreo territorial.'
          : 'Actualización informativa de fuentes abiertas sobre condiciones hidrometeorológicas e infraestructura urbana.';

  return { osintCategory, channelLabel, accountRef, severity, summary };
}

async function fetchOsintFeedQuery(
  rssUrl: string,
  feedHint: OsintCategory,
  defaultScope: 'guayaquil' | 'nacional'
): Promise<OsintReportEntry[]> {
  const response = await fetch(rssUrl, {
    headers: {
      'User-Agent': 'JMAC-Climatyc-OSINT/1.0 (+https://seguraep.gob.ec)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(7000),
  });

  if (!response.ok) {
    throw new Error(`OSINT RSS HTTP ${response.status}`);
  }

  const xml = await response.text();
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  const parsed: OsintReportEntry[] = [];

  for (let i = 0; i < Math.min(itemMatches.length, 10); i++) {
    const rawItem = itemMatches[i];
    const rawTitle = extractTag(rawItem, 'title');
    const link = extractTag(rawItem, 'link');
    const pubDateRaw = extractTag(rawItem, 'pubDate');
    const sourceTag = extractTag(rawItem, 'source');

    if (!rawTitle || !link) continue;

    const cleanTitle =
      sourceTag && rawTitle.endsWith(` - ${sourceTag}`)
        ? rawTitle.slice(0, rawTitle.length - ` - ${sourceTag}`.length).trim()
        : rawTitle;

    const pubMs = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
    const publishedAtIso = Number.isFinite(pubMs)
      ? new Date(pubMs).toISOString()
      : new Date().toISOString();

    const loc = resolveLocationFromText(cleanTitle, defaultScope);
    const meta = classifyOsintEntry(cleanTitle, sourceTag, feedHint);
    const cleanZoneKeyword = loc.zoneName.split('·')[0].trim();
    const topicKeyword =
      meta.osintCategory === 'ductos_alcantarillas'
        ? 'alcantarillas OR ductos OR Interagua'
        : meta.osintCategory === 'via_anegada'
          ? 'vias anegadas OR trafico OR lluvia'
          : 'lluvia OR inundacion';
    const xQuery = encodeURIComponent(`${cleanZoneKeyword} (${topicKeyword})`);

    parsed.push({
      id: `osint_${meta.osintCategory}_${hashString(cleanTitle + link)}`,
      title: cleanTitle,
      summary: meta.summary,
      osintCategory: meta.osintCategory,
      channelLabel: meta.channelLabel,
      accountRef: meta.accountRef,
      severity: meta.severity,
      scope: loc.scope,
      zoneId: loc.zoneId,
      zoneName: loc.zoneName,
      lat: loc.lat,
      lng: loc.lng,
      publishedAtIso,
      sourceName: sourceTag || 'Monitoreo Abierto EC',
      url: link,
      xLiveSearchUrl: `https://x.com/search?q=${xQuery}&src=typed_query&f=live`,
    });
  }

  return parsed;
}

function buildFallbackOsintItems(nowIso: string): OsintReportEntry[] {
  return [
    {
      id: 'osint_fallback_ductos_1',
      title:
        'Interagua y EMAPAG mantienen operativo preventivo de limpieza en ductos cajón, canales y sumideros del norte y sur de Guayaquil',
      summary:
        'Cuadrillas con hidrocleaners intervienen colectores pluviales en Sauces, Alborada, Suburbio y Guasmo para prevenir taponamientos por desechos sólidos.',
      osintCategory: 'ductos_alcantarillas',
      channelLabel: 'Ductos y Alcantarillado',
      accountRef: '@interagua · Drenaje Pluvial',
      severity: 'moderada',
      scope: 'guayaquil',
      zoneId: 'gye_alborada_sauces',
      zoneName: 'Alborada y Sauces',
      lat: -2.1389,
      lng: -79.8962,
      publishedAtIso: nowIso,
      sourceName: 'Monitoreo Infraestructura Pluvial',
      url: 'https://www.interagua.com.ec/',
      xLiveSearchUrl:
        'https://x.com/search?q=Guayaquil%20(alcantarillas%20OR%20sumideros%20OR%20Interagua)&src=typed_query&f=live',
    },
    {
      id: 'osint_fallback_vias_2',
      title:
        'ATM y Segura EP monitorean pasos a desnivel, túneles del Cerro del Carmen y Av. Víctor Emilio Estrada mediante cámaras en tiempo real',
      summary:
        'Vigilancia vial continua sobre corredores arteriales de Guayaquil para alertar cierres preventivos o desvíos ante acumulación de calzada.',
      osintCategory: 'via_anegada',
      channelLabel: 'Vías Anegadas y Tránsito',
      accountRef: '@ATMGuayaquil · Tránsito',
      severity: 'moderada',
      scope: 'guayaquil',
      zoneId: 'gye_urdesa',
      zoneName: 'Urdesa Central',
      lat: -2.1684,
      lng: -79.9098,
      publishedAtIso: nowIso,
      sourceName: 'Centro de Control Integrado ATM / Segura EP',
      url: 'https://seguraep.gob.ec/',
      xLiveSearchUrl:
        'https://x.com/search?q=Guayaquil%20(%22vias%20anegadas%22%20OR%20ATMGuayaquil%20OR%20tuneles)&src=typed_query&f=live',
    },
  ];
}

let cachedGovPayload: GovAlertsApiPayload | null = null;
let cachedAtMs = 0;

let cachedOsintPayload: OsintApiPayload | null = null;
let cachedOsintAtMs = 0;

let cachedRadarPayload: RadarApiPayload | null = null;
let cachedRadarAtMs = 0;

const CACHE_TTL_MS = 45_000; // 45-second server cache to support 60-second client near-real-time polling

async function getLiveOsintReports(forceRefresh: boolean): Promise<OsintApiPayload> {
  const now = Date.now();
  if (!forceRefresh && cachedOsintPayload && now - cachedOsintAtMs < CACHE_TTL_MS) {
    return cachedOsintPayload;
  }

  const ductosUrl =
    'https://news.google.com/rss/search?q=Guayaquil+(alcantarillado+OR+alcantarillas+OR+ductos+OR+sumideros+OR+Interagua+OR+EMAPAG+OR+colector)+(lluvias+OR+limpieza+OR+colapso+OR+agua)&hl=es-419&gl=EC&ceid=EC:es-419';
  const viasUrl =
    'https://news.google.com/rss/search?q=(Guayaquil+OR+Duran+OR+Samborondon)+(%22v%C3%ADas+anegadas%22+OR+%22calles+inundadas%22+OR+%22acumulaci%C3%B3n+de+agua%22+OR+%22paso+a+desnivel%22+OR+t%C3%BAneles+OR+ATM)+lluvias&hl=es-419&gl=EC&ceid=EC:es-419';
  const redesXUrl =
    'https://news.google.com/rss/search?q=(%22en+X%22+OR+%22redes+sociales%22+OR+usuarios+OR+ciudadanos+OR+ECU911+OR+SeguraEP+OR+ATMGuayaquil+OR+Interagua)+(Guayaquil+OR+Ecuador)+(lluvias+OR+inundaci%C3%B3n+OR+alcantarilla+OR+v%C3%ADas)&hl=es-419&gl=EC&ceid=EC:es-419';
  const nacionalViasUrl =
    'https://news.google.com/rss/search?q=(%22Los+R%C3%ADos%22+OR+Manab%C3%AD+OR+Esmeraldas+OR+%22El+Oro%22+OR+Azuay+OR+%22Santo+Domingo%22+OR+Quito)+(lluvias+OR+%22cierre+vial%22+OR+alcantarillado+OR+deslizamiento+OR+inundaci%C3%B3n)+Ecuador&hl=es-419&gl=EC&ceid=EC:es-419';

  const [ductosItems, viasItems, redesItems, nacionalItems] = await Promise.all([
    fetchOsintFeedQuery(ductosUrl, 'ductos_alcantarillas', 'guayaquil').catch(() => [] as OsintReportEntry[]),
    fetchOsintFeedQuery(viasUrl, 'via_anegada', 'guayaquil').catch(() => [] as OsintReportEntry[]),
    fetchOsintFeedQuery(redesXUrl, 'redes_x', 'guayaquil').catch(() => [] as OsintReportEntry[]),
    fetchOsintFeedQuery(nacionalViasUrl, 'via_anegada', 'nacional').catch(() => [] as OsintReportEntry[]),
  ]);

  // Sort each specialized stream newest-first, then round-robin interleave so ducts/sewers, flooded roads, X/social, and national updates all appear
  const buckets = [ductosItems, viasItems, redesItems, nacionalItems].map((arr) =>
    [...arr].sort((a, b) => Date.parse(b.publishedAtIso) - Date.parse(a.publishedAtIso))
  );

  const nowIso = new Date().toISOString();
  const seen = new Set<string>();
  const unique: OsintReportEntry[] = [];
  const maxLen = Math.max(0, ...buckets.map((b) => b.length));

  for (let idx = 0; idx < maxLen && unique.length < 24; idx++) {
    for (const bucket of buckets) {
      if (idx >= bucket.length) continue;
      const item = bucket[idx];
      const key = item.title.toLowerCase().slice(0, 72);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
      if (unique.length >= 24) break;
    }
  }

  unique.sort((a, b) => Date.parse(b.publishedAtIso) - Date.parse(a.publishedAtIso));

  const payload: OsintApiPayload = {
    fetchedAtIso: nowIso,
    refreshIntervalSec: 60,
    items: unique.length > 0 ? unique : buildFallbackOsintItems(nowIso),
  };

  cachedOsintPayload = payload;
  cachedOsintAtMs = now;
  return payload;
}

async function getLiveWeatherRadar(forceRefresh: boolean): Promise<RadarApiPayload> {
  const now = Date.now();
  if (!forceRefresh && cachedRadarPayload && now - cachedRadarAtMs < CACHE_TTL_MS) {
    return cachedRadarPayload;
  }

  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
    signal: AbortSignal.timeout(6500),
  });
  if (!res.ok) {
    throw new Error(`RainViewer HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    host?: string;
    radar?: {
      past?: Array<{ time: number; path: string }>;
      nowcast?: Array<{ time: number; path: string }>;
    };
  };

  const host = json.host || 'https://tilecache.rainviewer.com';
  const past = (json.radar?.past ?? []).slice(-6).map((f) => ({
    time: f.time,
    path: f.path,
    isForecast: false,
  }));
  const nowcast = (json.radar?.nowcast ?? []).slice(0, 3).map((f) => ({
    time: f.time,
    path: f.path,
    isForecast: true,
  }));

  const payload: RadarApiPayload = {
    fetchedAtIso: new Date().toISOString(),
    host,
    frames: [...past, ...nowcast],
  };

  cachedRadarPayload = payload;
  cachedRadarAtMs = now;
  return payload;
}

async function getLiveGovernmentAlerts(forceRefresh: boolean): Promise<GovAlertsApiPayload> {
  const now = Date.now();
  if (!forceRefresh && cachedGovPayload && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedGovPayload;
  }

  const sngrSeguraFeedUrl =
    'https://news.google.com/rss/search?q=(%22Secretar%C3%ADa+de+Gesti%C3%B3n+de+Riesgos%22+OR+%22SNGR%22+OR+%22Segura+EP%22+OR+%22COE+Cantonal%22)+(lluvias+OR+alerta+OR+%22El+Ni%C3%B1o%22+OR+inundaciones+OR+Guayaquil)+Ecuador&hl=es-419&gl=EC&ceid=EC:es-419';
  const inamhiInocarFeedUrl =
    'https://news.google.com/rss/search?q=(%22INAMHI%22+OR+%22INOCAR%22+OR+%22ERFEN%22)+(lluvias+OR+advertencia+OR+tormentas+OR+%22El+Ni%C3%B1o%22+OR+aguaje)+Ecuador&hl=es-419&gl=EC&ceid=EC:es-419';

  const [sngrResult, inamhiResult, noaaNino12] = await Promise.all([
    fetchRssFeedItems(sngrSeguraFeedUrl).catch(() => [] as GovAlertEntry[]),
    fetchRssFeedItems(inamhiInocarFeedUrl).catch(() => [] as GovAlertEntry[]),
    fetchNoaaNino12Index(),
  ]);

  const nowIso = new Date().toISOString();
  const combinedRss = [...sngrResult, ...inamhiResult];

  const seenTitles = new Set<string>();
  const uniqueAlerts: GovAlertEntry[] = [];

  if (noaaNino12) {
    const absAnom = noaaNino12.anomalyC;
    const ensoLevel: GovAlertLevel =
      absAnom >= 2.0 ? 'roja' : absAnom >= 1.0 ? 'naranja' : absAnom >= 0.5 ? 'amarilla' : 'informativa';
    const sign12 = noaaNino12.anomalyC >= 0 ? '+' : '';
    const sign34 = noaaNino12.nino34AnomalyC >= 0 ? '+' : '';

    uniqueAlerts.push({
      id: `gov_inocar_noaa_${noaaNino12.weekLabel}`,
      entityCode: 'INOCAR_ERFEN',
      entityName: ENTITY_PORTALS.INOCAR_ERFEN.fullName,
      title: `Índice Oficial Región Niño 1+2 (${noaaNino12.weekLabel}): TSM ${noaaNino12.sstC.toFixed(1)} °C con anomalía térmica de ${sign12}${noaaNino12.anomalyC.toFixed(1)} °C frente a la costa de Ecuador`,
      summary: `Monitoreo oceanográfico de referencia para el Comité Nacional ERFEN e INOCAR (datos semanales CPC/NOAA). Región Niño 3.4 registra ${noaaNino12.nino34SstC.toFixed(1)} °C (${sign34}${noaaNino12.nino34AnomalyC.toFixed(1)} °C), condicionando el potencial convectivo sobre Guayaquil y el perfil costero.`,
      alertLevel: ensoLevel,
      scope: 'nacional',
      publishedAtIso: nowIso,
      sourceName: 'Comité ERFEN · INOCAR / NOAA CPC',
      url: 'https://www.inocar.mil.ec/',
      portalUrl: ENTITY_PORTALS.INOCAR_ERFEN.url,
    });
  }

  combinedRss.sort((a, b) => Date.parse(b.publishedAtIso) - Date.parse(a.publishedAtIso));

  for (const item of combinedRss) {
    const norm = item.title.toLowerCase().slice(0, 75);
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    uniqueAlerts.push(item);
    if (uniqueAlerts.length >= 12) break;
  }

  const finalAlerts =
    uniqueAlerts.length > 0 ? uniqueAlerts : buildFallbackInstitutionalAlerts(nowIso);

  const payload: GovAlertsApiPayload = {
    fetchedAtIso: nowIso,
    refreshIntervalSec: 60,
    noaaNino12,
    alerts: finalAlerts,
  };

  cachedGovPayload = payload;
  cachedAtMs = now;
  return payload;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/gov-alerts', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const payload = await getLiveGovernmentAlerts(force);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(payload);
    } catch (error) {
      const fallbackNow = new Date().toISOString();
      res.status(200).json({
        fetchedAtIso: fallbackNow,
        refreshIntervalSec: 60,
        noaaNino12: null,
        alerts: buildFallbackInstitutionalAlerts(fallbackNow),
        warning: error instanceof Error ? error.message : 'Fallback institucional activo',
      });
    }
  });

  app.get('/api/osint-reports', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const payload = await getLiveOsintReports(force);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(payload);
    } catch {
      const fallbackNow = new Date().toISOString();
      res.status(200).json({
        fetchedAtIso: fallbackNow,
        refreshIntervalSec: 60,
        items: buildFallbackOsintItems(fallbackNow),
      });
    }
  });

  app.get('/api/weather-radar', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const payload = await getLiveWeatherRadar(force);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(payload);
    } catch {
      res.status(200).json({
        fetchedAtIso: new Date().toISOString(),
        host: 'https://tilecache.rainviewer.com',
        frames: [],
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JMAC-Climatyc server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
