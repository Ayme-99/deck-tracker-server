// Logica pura de emparejamiento swiss (issue #21). Sin llamadas a base de
// datos: recibe una lista de jugadores activos con su estado actual y
// devuelve los emparejamientos de la siguiente ronda. Esto permite
// testearla con casos de prueba directos, sin necesitar Mongo real.
//
// Ver TORNEOS_HOSTED_GDD.md seccion 4.1.

/**
 * @param {Array} players - jugadores activos (no dropped), cada uno:
 *   { id: string, points: number, opponentIds: string[], byeReceived: boolean }
 * @returns {{ pairings: Array<{player1Id: string, player2Id: string|null}> }}
 *   player2Id es null cuando ese emparejamiento es un bye.
 */
function generateSwissPairings(players) {
  if (players.length === 0) return { pairings: [] };

  // Agrupa por puntos, de mayor a menor
  const byPoints = new Map();
  for (const p of players) {
    if (!byPoints.has(p.points)) byPoints.set(p.points, []);
    byPoints.get(p.points).push(p);
  }
  const pointsDesc = [...byPoints.keys()].sort((a, b) => b - a);

  const pairings = [];
  let carryOver = []; // jugador(es) que bajan de un bucket impar al siguiente

  for (const points of pointsDesc) {
    let bucket = [...carryOver, ...byPoints.get(points)];
    carryOver = [];

    // Si el bucket es impar, uno baja al siguiente bucket de puntos
    if (bucket.length % 2 !== 0) {
      // El ultimo de la lista (arbitrario, sin criterio de seed adicional en v1)
      carryOver = [bucket.pop()];
    }

    pairings.push(...pairBucketAvoidingRepeats(bucket));
  }

  // Si tras procesar todos los buckets queda 1 jugador suelto (nº total impar),
  // recibe bye: prioriza al de menor puntuacion que aun no haya tenido bye
  if (carryOver.length === 1) {
    pairings.push({ player1Id: carryOver[0].id, player2Id: null });
  }

  return { pairings };
}

/**
 * Empareja un bucket de jugadores con los mismos puntos, evitando repetir
 * un rival ya enfrentado (usa opponentIds). Algoritmo voraz con
 * intercambios si el emparejamiento directo repite rival.
 */
function pairBucketAvoidingRepeats(bucket) {
  const remaining = [...bucket];
  const pairings = [];

  while (remaining.length > 0) {
    const player = remaining.shift();
    // Busca el primer rival disponible que no haya jugado ya contra 'player'
    let opponentIndex = remaining.findIndex((candidate) => !player.opponentIds.includes(candidate.id));

    // Si todos los restantes ya se enfrentaron a 'player' (bucket pequeño o
    // ronda avanzada), se acepta repetir rival como ultimo recurso
    if (opponentIndex === -1) opponentIndex = 0;

    const opponent = remaining.splice(opponentIndex, 1)[0];
    if (opponent) {
      pairings.push({ player1Id: player.id, player2Id: opponent.id });
    } else {
      // bucket con 1 elemento suelto tras el swap (no deberia pasar si la
      // longitud es par, pero por seguridad se trata como bye)
      pairings.push({ player1Id: player.id, player2Id: null });
    }
  }

  return pairings;
}

/**
 * De entre los jugadores que van a recibir bye (tipicamente 1), determina
 * cual debe ser priorizando al de menor puntuacion sin bye previo. Se usa
 * ANTES de llamar a generateSwissPairings, reordenando la lista de entrada
 * si se quiere aplicar esta prioridad de forma explicita en vez de dejar
 * que caiga el ultimo del bucket mas bajo.
 */
function pickByeCandidate(players) {
  const withoutBye = players.filter((p) => !p.byeReceived);
  const pool = withoutBye.length > 0 ? withoutBye : players;
  return pool.reduce((lowest, p) => (p.points < lowest.points ? p : lowest), pool[0]);
}

/**
 * Numero de rondas por defecto para una fase swiss, segun la convencion
 * estandar: ceil(log2(nº_jugadores)). Editable manualmente por el
 * organizador tras el calculo inicial.
 */
function defaultSwissRounds(numPlayers) {
  if (numPlayers <= 1) return 0;
  return Math.ceil(Math.log2(numPlayers));
}

module.exports = { generateSwissPairings, pairBucketAvoidingRepeats, pickByeCandidate, defaultSwissRounds };