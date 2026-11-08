// Calculo de OMW% (Opponent's Match Win Percentage), 2º criterio de
// desempate tras prizeDifferential (issue #45). Logica pura: recibe los
// jugadores del torneo con sus datos de W-L-D y opponentIds, sin acceso a
// base de datos.
//
// Ver TORNEOS_HOSTED_GDD.md seccion 5.
//
// Regla estandar (igual que en Pokemon TCG/MTG): el % de victorias de un
// jugador se limita a un minimo (33%), para no penalizar/premiar de forma
// desproporcionada por el mal/buen resultado de un solo rival. Un jugador
// sin partidas jugadas (0 games) tambien cuenta como el minimo.

const MIN_MATCH_WIN_PERCENTAGE = 1 / 3;

/**
 * % de victorias de un jugador, con el suelo del 33% aplicado.
 * @param {{wins: number, losses: number, draws: number}} player
 */
function matchWinPercentage(player) {
  const totalGames = player.wins + player.losses + player.draws;
  if (totalGames === 0) return MIN_MATCH_WIN_PERCENTAGE;
  const raw = player.wins / totalGames;
  return Math.max(raw, MIN_MATCH_WIN_PERCENTAGE);
}

/**
 * Calcula el OMW% de cada jugador: media del match-win% de todos sus
 * rivales (opponentIds). Devuelve un Map id -> omwPercentage (0-1).
 *
 * @param {Array<{id: string, wins: number, losses: number, draws: number, opponentIds: string[]}>} players
 */
function calculateOMW(players) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const result = new Map();

  for (const player of players) {
    if (player.opponentIds.length === 0) {
      result.set(player.id, 0);
      continue;
    }
    const sum = player.opponentIds.reduce((acc, oppId) => {
      const opponent = byId.get(oppId);
      // Si el rival ya no existe (ej. borrado), se ignora en la media
      return opponent ? acc + matchWinPercentage(opponent) : acc;
    }, 0);
    const validOpponents = player.opponentIds.filter((id) => byId.has(id)).length;
    result.set(player.id, validOpponents > 0 ? sum / validOpponents : 0);
  }

  return result;
}

module.exports = { matchWinPercentage, calculateOMW, MIN_MATCH_WIN_PERCENTAGE };