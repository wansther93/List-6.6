/**
 * Serviço Shikimori API (100% Gratuito & Backup Imediato do MyAnimeList / Jikan)
 * Espelho de altíssima velocidade para busca de metadados, títulos alternativos e capas em alta resolução.
 */
import type { JikanAnimeResult } from './jikanService';
import { translateGenres } from './translationService';

export async function searchShikimori(query: string): Promise<JikanAnimeResult[]> {
  if (!query || !query.trim()) return [];

  const url = `https://shikimori.one/api/animes?search=${encodeURIComponent(query.trim())}&limit=8`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WAnimeList/2.0 (Open Source Anime Tracker)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Shikimori HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return [];

    return data.map((item: any) => {
      let cover = item.image?.original || item.image?.preview || '';
      if (cover && cover.startsWith('/')) {
        cover = `https://shikimori.one${cover}`;
      }

      const rawKind = item.kind ? item.kind.toUpperCase() : 'TV';
      let format = 'TV (Série)';
      if (rawKind === 'MOVIE') format = 'Filme';
      else if (rawKind === 'OVA') format = 'OVA';
      else if (rawKind === 'ONA') format = 'ONA (Web)';
      else if (rawKind === 'SPECIAL') format = 'Especial';

      const year = item.aired_on ? new Date(item.aired_on).getFullYear() : undefined;

      return {
        mal_id: item.id,
        title: item.name || item.russian || query,
        title_japanese: item.japanese || '',
        title_english: item.name || '',
        episodes: item.episodes && item.episodes > 0 ? item.episodes : null,
        status: item.status || 'released',
        synopsis: null, // Shikimori na listagem não envia sinopse longa; Jikan ou AniList enriquecem
        imageUrl: cover,
        genres: translateGenres([]),
        studio: null,
        format,
        source: null,
        year,
      };
    });
  } catch (err) {
    console.warn('Shikimori API fallback erro:', err);
    return [];
  }
}

/**
 * Validador estrito: apenas mídias audiovisuais canônicas (TV, Movie, OVA, ONA, Special)
 * Rejeita explicitamente clipes de música, mangás, light novels e one-shots.
 */
export function isAudiovisualKind(kind?: string): boolean {
  if (!kind) return true; // Se desconhecido, permite para análise posterior
  const k = kind.toLowerCase().trim();
  if (
    k.includes('клип') ||
    k.includes('clip') ||
    k.includes('music') ||
    k.includes('manga') ||
    k.includes('novel') ||
    k.includes('one_shot') ||
    k.includes('doujin')
  ) {
    return false;
  }
  return (
    k.includes('tv') ||
    k.includes('сериал') ||
    k.includes('movie') ||
    k.includes('фильм') ||
    k.includes('ova') ||
    k.includes('ona') ||
    k.includes('special') ||
    k.includes('спецвыпуск')
  );
}

export function normalizeAudiovisualFormat(kind?: string): 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' {
  if (!kind) return 'TV';
  const k = kind.toLowerCase();
  if (k.includes('movie') || k.includes('фильм')) return 'Movie';
  if (k.includes('ova')) return 'OVA';
  if (k.includes('ona')) return 'ONA';
  if (k.includes('special') || k.includes('спецвыпуск')) return 'Special';
  return 'TV';
}

export interface ShikimoriFranchiseNode {
  id: number;
  date?: number;
  name: string;
  image_url?: string;
  url?: string;
  year?: number | null;
  kind?: string;
  weight?: number;
}

export interface ShikimoriFranchiseLink {
  id: number;
  source_id: number;
  target_id: number;
  relation: string;
}

export interface ShikimoriAnimeDetail {
  id: number;
  name: string;
  russian?: string;
  japanese?: string | string[];
  kind?: string;
  status?: string; // 'released' | 'ongoing' | 'anons'
  episodes?: number | null;
  aired_on?: string | null;
  studios?: Array<{ id: number; name: string }>;
  image?: { original?: string; preview?: string };
}

const studioCache = new Map<number, string[]>();

/**
 * Busca lote de animes no Shikimori por IDs em uma única requisição (máx 50)
 */
export async function fetchShikimoriAnimeBatch(ids: number[]): Promise<Map<number, ShikimoriAnimeDetail>> {
  const result = new Map<number, ShikimoriAnimeDetail>();
  if (!ids || ids.length === 0) return result;

  const uniqueIds = Array.from(new Set(ids)).slice(0, 50);
  const url = `https://shikimori.one/api/animes?ids=${uniqueIds.join(',')}&limit=50`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WAnimeList/2.0 (Open Source Anime Tracker)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          result.set(item.id, item);
        }
      }
    }
  } catch (err) {
    console.warn('Shikimori batch request falhou:', err);
  }

  return result;
}

/**
 * Busca detalhes completos de um anime específico no Shikimori, incluindo estúdios de animação
 */
export async function fetchShikimoriAnimeWithStudios(id: number): Promise<{ studios: string[]; detail?: ShikimoriAnimeDetail }> {
  if (studioCache.has(id)) {
    return { studios: studioCache.get(id) || [] };
  }

  const url = `https://shikimori.one/api/animes/${id}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WAnimeList/2.0 (Open Source Anime Tracker)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data: ShikimoriAnimeDetail = await res.json();
      const studioNames = (data.studios || []).map((s) => s.name).filter(Boolean);
      studioCache.set(id, studioNames);
      return { studios: studioNames, detail: data };
    }
  } catch (err) {
    console.warn(`Shikimori studio fetch falhou para anime ${id}:`, err);
  }

  return { studios: [] };
}

/**
 * Camada 1: Varrer toda a árvore genealógica de franquia pelo Shikimori em uma única chamada
 */
export async function fetchShikimoriFranchise(malId: number): Promise<{
  nodes: ShikimoriFranchiseNode[];
  links: ShikimoriFranchiseLink[];
  detailsMap: Map<number, ShikimoriAnimeDetail>;
  unifiedStudios: string[];
  hasUpcomingSeason: boolean;
  hasReleasingSeason: boolean;
  totalReleasedEpisodes: number;
} | null> {
  if (!malId || malId <= 0) return null;

  const url = `https://shikimori.one/api/animes/${malId}/franchise`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WAnimeList/2.0 (Open Source Anime Tracker)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return null;

    const rawNodes: ShikimoriFranchiseNode[] = data.nodes;
    const rawLinks: ShikimoriFranchiseLink[] = Array.isArray(data.links) ? data.links : [];

    // Filtro estrito: apenas mídias audiovisuais canônicas
    const validNodes = rawNodes.filter((node) => isAudiovisualKind(node.kind));
    if (validNodes.length === 0) return null;

    // Busca lote de dados detalhados para os nós válidos (nomes em inglês, episódios, status e datas)
    const validIds = validNodes.map((n) => n.id);
    const detailsMap = await fetchShikimoriAnimeBatch(validIds);

    // Identificação de estúdios das mídias principais (prioriza o ID de entrada e temporadas com maior peso)
    const mainIds = Array.from(
      new Set([
        malId,
        ...validNodes
          .filter((n) => {
            const k = (n.kind || '').toLowerCase();
            return k.includes('tv') || k.includes('сериал') || k.includes('movie') || k.includes('фильм');
          })
          .sort((a, b) => (b.weight || 0) - (a.weight || 0))
          .map((n) => n.id),
      ])
    ).slice(0, 6);

    const studioSet = new Set<string>();
    await Promise.all(
      mainIds.map(async (id) => {
        const { studios } = await fetchShikimoriAnimeWithStudios(id);
        studios.forEach((s) => studioSet.add(s));
      })
    );

    const now = new Date();
    const nowYear = now.getFullYear();
    const nowIso = now.toISOString().slice(0, 10);
    let hasUpcoming = false;
    let hasReleasing = false;
    let totalReleasedEps = 0;

    for (const node of validNodes) {
      const detail = detailsMap.get(node.id);
      const status = (detail?.status || '').toLowerCase();
      const airedYear = detail?.aired_on ? new Date(detail.aired_on).getFullYear() : (node.year || null);
      const airedDate = detail?.aired_on || null;
      const isFutureDate = airedDate ? airedDate > nowIso : (airedYear ? airedYear > nowYear : false);

      if (status === 'ongoing') {
        hasReleasing = true;
      } else if (status === 'anons' || isFutureDate) {
        hasUpcoming = true;
      }

      // Soma apenas episódios de temporadas principais de TV ou Filmes já efetivamente lançadas
      const kindLower = (detail?.kind || node.kind || '').toLowerCase();
      const isTvOrMovie = kindLower.includes('tv') || kindLower.includes('сериал') || kindLower.includes('movie') || kindLower.includes('фильм');

      if (isTvOrMovie && !isFutureDate && status !== 'anons') {
        const eps = detail?.episodes;
        if (typeof eps === 'number' && eps > 0) {
          totalReleasedEps += eps;
        }
      }
    }

    return {
      nodes: validNodes,
      links: rawLinks,
      detailsMap,
      unifiedStudios: Array.from(studioSet),
      hasUpcomingSeason: hasUpcoming,
      hasReleasingSeason: hasReleasing,
      totalReleasedEpisodes: totalReleasedEps,
    };
  } catch (err) {
    console.warn('Shikimori franchise fetch error:', err);
    return null;
  }
}
