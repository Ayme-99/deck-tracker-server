// Orquestacion de creacion de partidas de entrada/avance a la fase
// eliminatoria (issue #115). Extraido de tournamentController porque, a
// diferencia de los servicios puros de pairing (eliminationPairingService,
// groupsEliminationService...), necesita crear documentos reales via
// TournamentMatch (Mongoose) -- no es logica pura, pero tampoco pertenece
// al controller.

const TournamentMatch = require('../models/TournamentMatch');
const { calculateEliminationEntry } = require('./groupsEliminationService');
const { seededPairings, nextPhase } = require('./eliminationPairingService');

// Crea en BD un enfrentamiento real (una partida single, o first_leg+
// second_leg enlazadas si el torneo es a ida y vuelta). Compartida entre
// createEliminationEntryMatches, resolvePreliminaryEntry y (potencialmente)
// otros puntos que generen partidos de eliminatoria.
async function createRealMatch(tournament, phase, pairing) {
  if (tournament.eliminationFormat === 'two_legs') {
    const firstLeg = await TournamentMatch.create({
      tournamentId: tournament._id, phase,
      player1Id: pairing.player1Id, player2Id: pairing.player2Id, leg: 'first_leg'
    });
    const secondLeg = await TournamentMatch.create({
      tournamentId: tournament._id, phase,
      player1Id: pairing.player2Id, player2Id: pairing.player1Id,
      leg: 'second_leg', tiedMatchId: firstLeg._id
    });
    firstLeg.tiedMatchId = secondLeg._id;
    await firstLeg.save();
    return [firstLeg, secondLeg];
  }
  const match = await TournamentMatch.create({
    tournamentId: tournament._id, phase, player1Id: pairing.player1Id, player2Id: pairing.player2Id, leg: 'single'
  });
  return [match];
}

// Crea las partidas para la entrada a la fase eliminatoria, respetando
// tournament.eliminationFormat (single_match / two_legs). Reutilizada por
// swiss_elimination y groups_elimination -- ambas comparten la misma logica.
//
// FIX (bug detectado tras #80/#83): antes, TODOS los byeIds se declaraban
// "ganadores sin rival" (player2Id: null, status: completed) sin jugar
// nada. Eso era conceptualmente incorrecto en el caso extra===0 (nº de
// clasificados ya potencia de 2): ahi no hace falta ninguna ronda previa,
// asi que los clasificados deben EMPAREJARSE DE VERDAD entre si en la
// fase destino, no "ganar gratis". El bye solo tiene sentido cuando de
// verdad se salta una ronda previa REAL (extra>0) -- y en ese caso, el
// rival de cada bye (el ganador de la previa) todavia no se conoce, asi
// que tampoco se puede crear su partida aqui: hay que esperar a que la
// ronda previa termine y resolverlo con resolvePreliminaryEntry.
async function createEliminationEntryMatches(tournament, classifiedIds) {
  const { targetPhase, byeIds, preliminary } = calculateEliminationEntry(classifiedIds);
  const createdMatches = [];

  if (!preliminary) {
    // Sin ronda previa: los clasificados se emparejan de verdad en la
    // fase destino, con el mismo seeding (mejor vs peor).
    const pairings = seededPairings(byeIds);
    for (const pairing of pairings) {
      const created = await createRealMatch(tournament, targetPhase, pairing);
      createdMatches.push(...created);
    }
    return { targetPhase, preliminaryPhase: null, byeIds: [], matches: createdMatches };
  }

  // Con ronda previa: solo se crean sus partidas. Los byeIds quedan en
  // espera (no se crea nada para ellos todavia) hasta que se llame a
  // resolvePreliminaryEntry una vez la previa este resuelta.
  for (const pairing of preliminary.pairings) {
    const created = await createRealMatch(tournament, preliminary.phase, pairing);
    createdMatches.push(...created);
  }
  return { targetPhase, preliminaryPhase: preliminary.phase, byeIds, matches: createdMatches };
}

// Agrupa las partidas de una fase por enfrentamiento real (single = 1 sola;
// two_legs = first_leg+second_leg[+sudden_death] enlazadas por tiedMatchId).
// Compartida entre advanceBracketRound y resolvePreliminaryEntry
// (issue #78: movida aqui desde tournamentRoundsController junto con
// resolveBracketWinner, con las que forma una unidad logica).
function groupMatchesByTiedPair(phaseMatches) {
  const grouped = [];
  const seen = new Set();
  for (const m of phaseMatches) {
    if (seen.has(m._id.toString())) continue;
    const group = [m];
    seen.add(m._id.toString());
    if (m.tiedMatchId) {
      const linked = phaseMatches.filter(
        (other) => !seen.has(other._id.toString()) &&
          (other._id.toString() === m.tiedMatchId.toString() || (other.tiedMatchId && other.tiedMatchId.toString() === m._id.toString()))
      );
      for (const l of linked) {
        group.push(l);
        seen.add(l._id.toString());
      }
    }
    grouped.push(group);
  }
  return grouped;
}

// Determina el ganador de un enfrentamiento del bracket a partir de sus
// partidas: single_match tiene 1 sola TournamentMatch con winnerId directo.
// two_legs puede tener first_leg+second_leg (agregado de premios, ya que
// second_leg invierte player1Id/player2Id respecto a first_leg) y, si el
// agregado empata, una sudden_death que decide de forma definitiva.
// Devuelve null si el enfrentamiento aun no tiene ganador determinable.
function resolveBracketWinner(matchesForThisPair) {
  const single = matchesForThisPair.find((m) => m.leg === 'single');
  if (single) return single.winnerId ? single.winnerId.toString() : null;

  const suddenDeath = matchesForThisPair.find((m) => m.leg === 'sudden_death');
  if (suddenDeath && suddenDeath.winnerId) return suddenDeath.winnerId.toString();

  const firstLeg = matchesForThisPair.find((m) => m.leg === 'first_leg');
  const secondLeg = matchesForThisPair.find((m) => m.leg === 'second_leg');
  if (!firstLeg || !secondLeg || firstLeg.status !== 'completed' || secondLeg.status !== 'completed') {
    return null; // ida/vuelta aun no completas
  }

  const p1 = firstLeg.player1Id.toString();
  const p2 = firstLeg.player2Id.toString();
  // second_leg invierte player1Id/player2Id respecto a first_leg
  const p1Total = (firstLeg.player1Prizes || 0) + (secondLeg.player2Id.toString() === p1 ? (secondLeg.player2Prizes || 0) : (secondLeg.player1Prizes || 0));
  const p2Total = (firstLeg.player2Prizes || 0) + (secondLeg.player1Id.toString() === p2 ? (secondLeg.player1Prizes || 0) : (secondLeg.player2Prizes || 0));

  if (p1Total > p2Total) return p1;
  if (p2Total > p1Total) return p2;
  return null; // agregado empatado y sin muerte subita todavia -- hace falta crearla manualmente
}

// Issue #206: antes, para saber contra quien se jugaba la siguiente fase
// habia que esperar a que TODA la ronda actual estuviera resuelta
// (advanceBracketRound exigia el cierre completo de la fase). Ahora, en
// cuanto se resuelve una partida, se comprueba si su pareja "hermana" (el
// otro emparejamiento que le toca enfrentar en la siguiente fase, segun el
// orden de creacion) tambien esta resuelta -- si es asi, se crea ya esa
// partida de la fase siguiente, sin esperar al resto de la ronda.
//
// Se llama tras cada registerMatchResult; es idempotente (no crea un
// duplicado si la partida de la fase siguiente ya existe), asi que es
// seguro llamarla de mas -- por ejemplo, ambas piernas de una partida a
// ida/vuelta disparan esta funcion, pero solo la segunda (cuando ya hay
// resultado agregado) llega a crear algo.
async function maybeAdvancePartialBracket(tournament, match) {
  if (match.isThirdPlaceMatch) return null;
  const next = nextPhase(match.phase);
  if (!next) return null; // 'final', o una fase sin bracket (group_stage/swiss/league_round)

  const phaseMatches = await TournamentMatch.find({
    tournamentId: tournament._id,
    phase: match.phase
  }).sort({ createdAt: 1 });

  const grouped = groupMatchesByTiedPair(phaseMatches);
  const matchId = match._id.toString();
  const idx = grouped.findIndex((group) => group.some((m) => m._id.toString() === matchId));
  if (idx === -1) return null;

  const winnerId = resolveBracketWinner(grouped[idx]);
  if (!winnerId) return null; // ida/vuelta: la otra pierna aun no esta jugada

  // El orden de creacion empareja consecutivos (0-1, 2-3...), igual que ya
  // hacia advanceBracketRound al construir winners[i] vs winners[i+1].
  const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
  if (siblingIdx < 0 || siblingIdx >= grouped.length) return null;

  const siblingWinnerId = resolveBracketWinner(grouped[siblingIdx]);
  if (!siblingWinnerId) return null; // el otro lado del emparejamiento sigue en curso

  const lowerIdx = Math.min(idx, siblingIdx);
  const player1Id = lowerIdx === idx ? winnerId : siblingWinnerId;
  const player2Id = lowerIdx === idx ? siblingWinnerId : winnerId;

  const alreadyExists = await TournamentMatch.exists({
    tournamentId: tournament._id,
    phase: next,
    isThirdPlaceMatch: { $ne: true },
    $or: [
      { player1Id, player2Id },
      { player1Id: player2Id, player2Id: player1Id }
    ]
  });
  if (alreadyExists) return null;

  const createdMatches = await createRealMatch(tournament, next, { player1Id, player2Id });

  // 3er/4º puesto: solo al avanzar desde semifinal, con los perdedores de
  // ambos lados (mismo criterio que ya usaba advanceBracketRound).
  if (match.phase === 'semifinal' && tournament.thirdPlacePlayoff) {
    const loserOf = (group, winner) => {
      const anyMatch = group[0];
      const p1 = anyMatch.player1Id.toString();
      const p2 = anyMatch.player2Id ? anyMatch.player2Id.toString() : null;
      return p1 === winner ? p2 : p1;
    };
    const loser1 = loserOf(grouped[idx], winnerId);
    const loser2 = loserOf(grouped[siblingIdx], siblingWinnerId);
    if (loser1 && loser2) {
      const thirdPlaceMatch = await TournamentMatch.create({
        tournamentId: tournament._id,
        phase: 'final',
        player1Id: loser1,
        player2Id: loser2,
        leg: 'single',
        isThirdPlaceMatch: true
      });
      createdMatches.push(thirdPlaceMatch);
    }
  }

  return { phase: next, matches: createdMatches };
}

module.exports = {
  createRealMatch,
  createEliminationEntryMatches,
  groupMatchesByTiedPair,
  resolveBracketWinner,
  maybeAdvancePartialBracket
};
