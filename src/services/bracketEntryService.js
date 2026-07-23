// Orquestacion de creacion de partidas de entrada/avance a la fase
// eliminatoria (issue #115). Extraido de tournamentController porque, a
// diferencia de los servicios puros de pairing (eliminationPairingService,
// groupsEliminationService...), necesita crear documentos reales via
// TournamentMatch (Mongoose) -- no es logica pura, pero tampoco pertenece
// al controller.

const TournamentMatch = require('../models/TournamentMatch');
const { calculateEliminationEntry } = require('./groupsEliminationService');
const { seededPairings } = require('./eliminationPairingService');

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

module.exports = { createRealMatch, createEliminationEntryMatches, groupMatchesByTiedPair, resolveBracketWinner };
