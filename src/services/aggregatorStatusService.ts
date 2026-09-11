/**
 * Serviço de Resolução de Status Agregador de Animes e Franquias
 *
 * Princípio Fundamental: Nosso aplicativo é um AGREGADOR DE OBRAS, não um repositório isolado
 * de temporadas únicas como o MAL.
 *
 * Regras de Status:
 * 1. Em Exibição (releasing): O anime ou sua temporada atual está lançando novos episódios semanalmente.
 *    Possui dia e horário de transmissão no fuso horário do Brasil.
 * 2. Próxima Temporada Confirmada / Em Breve (upcoming): A obra tem continuação/sequel confirmada
 *    (ex: One Punch Man 3ª Temp, Jujutsu Kaisen 3ª Temp, etc.). Exibe previsão de lançamento ou informa
 *    que está em produção aguardando data oficial. NUNCA exibe como "Finalizado" e NUNCA exibe dia falso (Segunda-feira).
 * 3. Já Finalizado (finished): Todas as temporadas da obra foram lançadas e concluídas, sem sequências anunciadas.
 */

import { getFranchiseRootTitle } from './franchiseService';
import type { Anime, FranchiseTreeItem } from '../types';

export interface AnimeAggregatedStatus {
  state: 'releasing' | 'upcoming' | 'finished';
  isCurrentlyAiring: boolean;
  isUpcoming: boolean;
  isFinished: boolean;
  broadcastDay?: string | null;
  broadcastTime?: string | null;
  airingCountdownText?: string | null;
  upcomingTitle?: string | null;
  upcomingDate?: string | null;
  statusBadgeLabel: string;
  statusDescription: string;
  totalAggregateEpisodes?: number | null;
  bannerUrl?: string | null;
}

const SEASON_MAP_PT: Record<string, string> = {
  WINTER: 'Inverno',
  SPRING: 'Primavera',
  SUMMER: 'Verão',
  FALL: 'Outono',
};

const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/**
 * Traduz dias da semana em inglês para o português formal do Brasil
 */
export function translateBroadcastDay(day?: string | null): string | null {
  if (!day) return null;
  const trimmed = day.trim();
  const lower = trimmed.toLowerCase();

  const map: Record<string, string> = {
    sunday: 'Domingo',
    sundays: 'Domingo',
    monday: 'Segunda-feira',
    mondays: 'Segunda-feira',
    tuesday: 'Terça-feira',
    tuesdays: 'Terça-feira',
    wednesday: 'Quarta-feira',
    wednesdays: 'Quarta-feira',
    thursday: 'Quinta-feira',
    thursdays: 'Quinta-feira',
    friday: 'Sexta-feira',
    fridays: 'Sexta-feira',
    saturday: 'Sábado',
    saturdays: 'Sábado',
  };

  if (map[lower]) return map[lower];

  if (lower.includes('segunda')) return 'Segunda-feira';
  if (lower.includes('terça') || lower.includes('terca')) return 'Terça-feira';
  if (lower.includes('quarta')) return 'Quarta-feira';
  if (lower.includes('quinta')) return 'Quinta-feira';
  if (lower.includes('sexta')) return 'Sexta-feira';
  if (lower.includes('sábado') || lower.includes('sabado')) return 'Sábado';
  if (lower.includes('domingo')) return 'Domingo';

  if (lower === 'outros' || lower === 'em breve') return null;

  return trimmed;
}

/**
 * Formata data de previsão de lançamento diretamente dos metadados da API
 */
export function formatUpcomingReleaseDate(node?: {
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  seasonYear?: number | null;
  season?: string | null;
}): string {
  if (!node) return 'Aguardando data oficial de estreia';

  const year = node.startDate?.year || node.seasonYear;
  const month = node.startDate?.month;
  const day = node.startDate?.day;
  const season = node.season ? SEASON_MAP_PT[node.season.toUpperCase()] : null;

  if (day && month && year) {
    return `${day} de ${MONTH_NAMES_PT[month - 1]} de ${year}`;
  }
  if (month && year) {
    return `${MONTH_NAMES_PT[month - 1]} de ${year}`;
  }
  if (season && year) {
    return `Temporada de ${season} de ${year}`;
  }
  if (year) {
    return `Previsão: ${year}`;
  }

  return 'Aguardando data oficial de estreia';
}

/**
 * Resolve o Status Agregador dinamicamente a partir dos dados em tempo real da API
 * (AniList / Jikan), sem nenhuma tabela inventada ou regras fixas manuais.
 */
export function resolveAnimeAggregatedStatus(params: {
  title: string;
  rawApiStatus?: string | null;
  broadcastDay?: string | null;
  broadcastTime?: string | null;
  userTrackerStatus?: string | null;
  nextEpisode?: { airingAt: number; episode: number } | null;
  apiRelations?: Array<{
    relationType?: string;
    node?: {
      status?: string;
      title?: { romaji?: string; english?: string; native?: string };
      seasonYear?: number | null;
      season?: string | null;
      startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
      nextAiringEpisode?: { airingAt: number; episode: number } | null;
      bannerImage?: string | null;
    };
  }> | null;
  totalEpisodes?: number | null;
  bannerUrl?: string | null;
}): AnimeAggregatedStatus {
  const {
    rawApiStatus,
    broadcastDay,
    broadcastTime,
    userTrackerStatus,
    nextEpisode,
    apiRelations,
    totalEpisodes,
    bannerUrl,
  } = params;

  const rawClean = (rawApiStatus || '').toLowerCase().trim();

  // 1. Checar se a própria mídia ou alguma relação direta está em exibição ativa (RELEASING)
  const isDirectlyReleasing =
    rawClean === 'releasing' ||
    rawClean === 'currently airing' ||
    rawClean === 'airing' ||
    Boolean(nextEpisode?.airingAt);

  let relationReleasingNode: any = null;
  let relationUpcomingNode: any = null;
  let relationBanner: string | null = bannerUrl || null;

  if (apiRelations && apiRelations.length > 0) {
    for (const rel of apiRelations) {
      const node = rel.node;
      if (!node) continue;
      if (node.bannerImage && !relationBanner) {
        relationBanner = node.bannerImage;
      }
      const nodeStatus = (node.status || '').toUpperCase();
      const isSequelOrSide =
        !rel.relationType ||
        ['SEQUEL', 'PARENT_STORY', 'SIDE_STORY', 'ALTERNATIVE_SETTING'].includes(
          rel.relationType.toUpperCase()
        );

      if (isSequelOrSide) {
        if (nodeStatus === 'RELEASING' || node.nextAiringEpisode?.airingAt) {
          relationReleasingNode = node;
        } else if (nodeStatus === 'NOT_YET_RELEASED') {
          if (!relationUpcomingNode) {
            relationUpcomingNode = node;
          }
        }
      }
    }
  }

  // --- CASO 1: EM EXIBIÇÃO ATIVA (Semanal) ---
  if (isDirectlyReleasing || relationReleasingNode) {
    let activeDay = translateBroadcastDay(broadcastDay);
    let activeTime = broadcastTime;

    // Se temos o timestamp exato do próximo episódio da API, calcular o dia no Brasil (America/Sao_Paulo)
    const activeNext = nextEpisode || relationReleasingNode?.nextAiringEpisode;
    if (activeNext?.airingAt) {
      try {
        const airingDate = new Date(activeNext.airingAt * 1000);
        const formatter = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
        const parts = formatter.formatToParts(airingDate);
        const weekdayPart = parts.find((p) => p.type === 'weekday')?.value;
        const hourPart = parts.find((p) => p.type === 'hour')?.value;
        const minutePart = parts.find((p) => p.type === 'minute')?.value;

        if (weekdayPart) {
          const capDay = weekdayPart.charAt(0).toUpperCase() + weekdayPart.slice(1);
          activeDay = capDay.includes('feira') ? capDay : `${capDay}-feira`;
          if (capDay === 'Sábado' || capDay === 'Domingo') activeDay = capDay;
        }
        if (hourPart && minutePart) {
          activeTime = `${hourPart}:${minutePart}`;
        }
      } catch (e) {
        console.warn('Erro ao formatar data de exibição da API:', e);
      }
    }

    const cleanDay = activeDay && activeDay !== 'Outros' && activeDay !== 'Em breve' ? activeDay : 'Semanalmente';

    return {
      state: 'releasing',
      isCurrentlyAiring: true,
      isUpcoming: false,
      isFinished: false,
      broadcastDay: cleanDay,
      broadcastTime: activeTime || null,
      statusBadgeLabel: 'Em Exibição',
      statusDescription: `Novos episódios transmitidos ${cleanDay}${activeTime ? ` às ${activeTime}` : ''}.`,
      totalAggregateEpisodes: totalEpisodes,
      bannerUrl: relationBanner,
    };
  }

  // --- CASO 2: PRÓXIMA TEMPORADA CONFIRMADA / NÃO LANÇADA ---
  const isUpcomingApi =
    relationUpcomingNode ||
    rawClean === 'not_yet_released' ||
    rawClean === 'not yet aired' ||
    rawClean === 'upcoming' ||
    rawClean === 'to be aired' ||
    userTrackerStatus === 'waiting_new_episodes';

  if (isUpcomingApi) {
    const upcomingTitle =
      relationUpcomingNode?.title?.romaji ||
      relationUpcomingNode?.title?.english ||
      'Próxima Temporada';
    const upcomingDate = formatUpcomingReleaseDate(relationUpcomingNode);

    return {
      state: 'upcoming',
      isCurrentlyAiring: false,
      isUpcoming: true,
      isFinished: false,
      broadcastDay: null,
      broadcastTime: null,
      upcomingTitle,
      upcomingDate,
      statusBadgeLabel: 'Próxima Temporada Confirmada',
      statusDescription: 'Continuação ou nova temporada confirmada pelas fontes oficiais da produção.',
      totalAggregateEpisodes: totalEpisodes,
      bannerUrl: relationBanner,
    };
  }

  // --- CASO 3: ANIME JÁ FINALIZADO ---
  const isFinishedApi =
    rawClean === 'finished' ||
    rawClean === 'finished airing' ||
    rawClean === 'completed' ||
    userTrackerStatus === 'completed';

  if (isFinishedApi) {
    return {
      state: 'finished',
      isCurrentlyAiring: false,
      isUpcoming: false,
      isFinished: true,
      broadcastDay: null,
      broadcastTime: null,
      statusBadgeLabel: 'Já Finalizado',
      statusDescription: totalEpisodes
        ? `Obra completamente concluída com ${totalEpisodes} episódios.`
        : 'Obra concluída.',
      totalAggregateEpisodes: totalEpisodes,
      bannerUrl: relationBanner,
    };
  }

  // Fallback padrão se não for finalizado nem tiver transmissão confirmada
  return {
    state: 'upcoming',
    isCurrentlyAiring: false,
    isUpcoming: true,
    isFinished: false,
    broadcastDay: null,
    broadcastTime: null,
    upcomingTitle: 'Em Produção',
    upcomingDate: 'Aguardando data oficial de estreia',
    statusBadgeLabel: 'Aguardando Lançamento',
    statusDescription: 'Aguardando confirmação oficial dos produtores sobre novas informações.',
    totalAggregateEpisodes: totalEpisodes,
    bannerUrl: relationBanner,
  };
}

export interface FranchiseAggregatedInfo {
  status: AnimeAggregatedStatus;
  unifiedStudios: string | null;
  totalReleasedEpisodes: number | null;
  displayStatusBadge: string;
}

/**
 * Agregação Inteligente de Dados e Status Soberano da Franquia
 * 
 * Regras Estritas:
 * - Status da Obra: Se há uma continuação anunciada/confirmada (ex: OPM T3), o status é "Próxima Temp. Confirmada".
 *   Se estiver passando no Japão, é "Em Exibição".
 *   Se todas as temporadas estiverem finalizadas sem sequências anunciadas, é "Já Finalizado".
 * - Estúdios Unificados: Unifica os estúdios das temporadas principais (ex: "Madhouse, J.C.Staff" para One Punch Man).
 * - Total de Episódios: Soma apenas os episódios das temporadas já lançadas (ex: 12 da T1 + 12 da T2 = 24 eps para OPM).
 */
export function resolveFranchiseAggregatedInfo(
  anime: Anime,
  franchiseTree?: {
    items?: FranchiseTreeItem[];
    unifiedStudios?: string[];
    hasUpcomingSeason?: boolean;
    hasReleasingSeason?: boolean;
    totalReleasedEpisodes?: number;
  } | null
): FranchiseAggregatedInfo {
  const nowYear = new Date().getFullYear();

  // 1. Estúdios Unificados
  let unifiedStudios: string | null = null;
  if (franchiseTree?.unifiedStudios && franchiseTree.unifiedStudios.length > 0) {
    unifiedStudios = franchiseTree.unifiedStudios.join(', ');
  } else if (anime.studio) {
    unifiedStudios = anime.studio;
  }

  // 2. Total de Episódios das temporadas já lançadas
  let totalReleasedEpisodes: number | null = null;
  if (franchiseTree?.totalReleasedEpisodes && franchiseTree.totalReleasedEpisodes > 0) {
    totalReleasedEpisodes = franchiseTree.totalReleasedEpisodes;
  } else if (Array.isArray(anime.seasons) && anime.seasons.length > 0) {
    let sum = 0;
    let found = false;
    for (const s of anime.seasons) {
      const year = s.releaseYear;
      // Não soma se for temporada claramente futura
      if (year && year > nowYear) continue;
      if (s.totalEpisodes && s.totalEpisodes > 0) {
        sum += s.totalEpisodes;
        found = true;
      }
    }
    if (found && sum > 0) {
      totalReleasedEpisodes = sum;
    }
  }

  if (!totalReleasedEpisodes && anime.totalEpisodes) {
    totalReleasedEpisodes = anime.totalEpisodes;
  }

  // 3. Status Soberano da Franquia
  const hasReleasing = Boolean(
    franchiseTree?.hasReleasingSeason ||
    anime.airingStatus === 'Currently Airing' ||
    anime.seasons?.some((s) => s.status?.toLowerCase().includes('currently') || s.status?.toLowerCase().includes('ongoing'))
  );

  const hasUpcoming = Boolean(
    franchiseTree?.hasUpcomingSeason ||
    anime.airingStatus === 'Not yet aired' ||
    anime.status === 'waiting_new_episodes' ||
    anime.seasons?.some((s) => {
      const yr = s.releaseYear;
      const st = (s.status || '').toLowerCase();
      return (yr && yr > nowYear) || st.includes('anons') || st.includes('not yet') || st.includes('upcoming');
    })
  );

  let state: 'releasing' | 'upcoming' | 'finished' = 'finished';
  let badgeLabel = 'Já Finalizado';
  let desc = totalReleasedEpisodes ? `Obra concluída com ${totalReleasedEpisodes} episódios.` : 'Obra concluída.';

  if (hasReleasing) {
    state = 'releasing';
    badgeLabel = 'Em Exibição';
    const day = translateBroadcastDay(anime.broadcastDay) || 'Semanalmente';
    desc = `Novos episódios transmitidos ${day}.`;
  } else if (hasUpcoming) {
    state = 'upcoming';
    badgeLabel = 'Próxima Temp. Confirmada';
    desc = 'Continuação ou nova temporada confirmada pelas fontes oficiais da produção.';
  }

  const status: AnimeAggregatedStatus = {
    state,
    isCurrentlyAiring: state === 'releasing',
    isUpcoming: state === 'upcoming',
    isFinished: state === 'finished',
    broadcastDay: state === 'releasing' ? translateBroadcastDay(anime.broadcastDay) : null,
    broadcastTime: null,
    statusBadgeLabel: badgeLabel,
    statusDescription: desc,
    totalAggregateEpisodes: totalReleasedEpisodes,
    bannerUrl: anime.bannerUrl || null,
  };

  return {
    status,
    unifiedStudios,
    totalReleasedEpisodes,
    displayStatusBadge: badgeLabel,
  };
}
