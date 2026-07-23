// (issue #78: dividido a partir de tournamentRoundsController.js,
// que agrupaba TODO el modo hosted en un unico archivo de 670 lineas.
// Se separa por formato/dominio en vez de mantener un unico bucket
// de "rondas" -- ese bucket es justo el que se habia convertido en
// el nuevo monolito tras la Fase 3 original (#115/#76).

const Tournament = require('../../models/Tournament');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');
const { generateBracket, nextPhase, seededPairings } = require('../../services/eliminationPairingService');
const { calculateEliminationEntry } = require('../../services/groupsEliminationService');
const {
  createEliminationEntryMatches,
  createRealMatch,
  groupMatchesByTiedPair,
  resolveBracketWinner
} = require('../../services/bracketEntryService');

// --- Eliminacion directa (issue #42) ---

exports.generateEliminationBracket = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { playerIds, seeded } = req.body;
    const { phase, pairings } = generateBracket(playerIds, { seeded: !!seeded });

    const createdMatches = [];
    for (const pairing of pairings) {
      if (tournament.eliminationFormat === 'two_legs') {
        const firstLeg = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          player1Id: pairing.player1Id,
          player2Id: pairing.player2Id,
          leg: 'first_leg'
        });
        const secondLeg = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          // vuelta: se invierten local/visitante, pero a efectos de
          // agregado solo importa la suma de premios de cada jugador
          player1Id: pairing.player2Id,
          player2Id: pairing.player1Id,
          leg: 'second_leg',
          tiedMatchId: firstLeg._id
        });
        firstLeg.tiedMatchId = secondLeg._id;
        await firstLeg.save();
        createdMatches.push(firstLeg, secondLeg);
      } else {
        const match = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          player1Id: pairing.player1Id,
          player2Id: pairing.player2Id,
          leg: 'single'
        });
        createdMatches.push(match);
      }
    }

    res.status(201).json({ phase, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Transicion swiss/grupos -> eliminacion (issue #24) ---

exports.closePhaseToElimination = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    if (!['swiss_elimination', 'groups_elimination'].includes(tournament.structure)) {
      return res.status(400).json({ error: 'Esta accion solo aplica a swiss_elimination o groups_elimination' });
    }

    let classifiedIds;

    if (tournament.structure === 'swiss_elimination') {
      const { topCut } = req.body;
      const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false })
        .sort({ points: -1, prizeDifferential: -1 });
      classifiedIds = players.slice(0, topCut).map((p) => p._id.toString());
    } else {
      const { qualifiersPerGroup } = req.body;
      const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false })
        .sort({ points: -1, prizeDifferential: -1 });

      const groupNames = [...new Set(players.map((p) => p.groupName).filter(Boolean))];
      let qualifiers = [];
      for (const groupName of groupNames) {
        const groupPlayers = players.filter((p) => p.groupName === groupName);
        qualifiers.push(...groupPlayers.slice(0, qualifiersPerGroup));
      }
      // Reordena el conjunto combinado de clasificados de todos los grupos
      // por standing real, para que el seeding de la eliminatoria sea justo
      qualifiers.sort((a, b) => b.points - a.points || b.prizeDifferential - a.prizeDifferential);
      classifiedIds = qualifiers.map((p) => p._id.toString());
    }

    const result = await createEliminationEntryMatches(tournament, classifiedIds);

    // Si hizo falta ronda previa, se guarda la lista de clasificados para
    // que resolvePreliminaryEntry pueda leerla despues sin depender de
    // que el frontend la recuerde/reenvie.
    if (result.preliminaryPhase) {
      tournament.pendingEliminationClassifiedIds = classifiedIds;
      await tournament.save();
    }

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.advanceBracketRound = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { phase } = req.body;
    const phaseMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase });
    if (phaseMatches.length === 0) {
      return res.status(400).json({ error: `No hay partidas en la fase ${phase}` });
    }

    // Agrupa las partidas por enfrentamiento real (single = 1 sola;
    // two_legs = first_leg+second_leg[+sudden_death] enlazadas por tiedMatchId)
    const grouped = groupMatchesByTiedPair(phaseMatches);

    const winners = [];
    for (const group of grouped) {
      const winnerId = resolveBracketWinner(group);
      if (!winnerId) {
        return res.status(400).json({ error: 'Todavia hay enfrentamientos de esta fase sin resolver (incluida posible muerte subita pendiente)' });
      }
      winners.push(winnerId);
    }

    const next = nextPhase(phase);
    if (!next) {
      return res.status(400).json({ error: 'La final no tiene fase siguiente' });
    }

    const createdMatches = [];
    for (let i = 0; i < winners.length; i += 2) {
      const pairing = { player1Id: winners[i], player2Id: winners[i + 1] };
      const created = await createRealMatch(tournament, next, pairing);
      createdMatches.push(...created);
    }

    // 3er/4º puesto: solo al avanzar desde semifinal, con los perdedores
    if (phase === 'semifinal' && tournament.thirdPlacePlayoff) {
      const losers = grouped.map((group, i) => {
        const winnerId = winners[i];
        const anyMatch = group[0];
        const p1 = anyMatch.player1Id.toString();
        const p2 = anyMatch.player2Id ? anyMatch.player2Id.toString() : null;
        return p1 === winnerId ? p2 : p1;
      }).filter(Boolean);

      if (losers.length === 2) {
        const thirdPlaceMatch = await TournamentMatch.create({
          tournamentId: tournament._id, phase: 'final',
          player1Id: losers[0], player2Id: losers[1], leg: 'single', isThirdPlaceMatch: true
        });
        createdMatches.push(thirdPlaceMatch);
      }
    }

    res.status(201).json({ phase: next, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.resolvePreliminaryEntry = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const classifiedIds = tournament.pendingEliminationClassifiedIds.map((id) => id.toString());
    if (classifiedIds.length === 0) {
      return res.status(400).json({ error: 'No hay ninguna entrada a eliminatoria pendiente de resolver' });
    }

    const { targetPhase, byeIds, preliminary } = calculateEliminationEntry(classifiedIds);

    if (!preliminary) {
      return res.status(400).json({ error: 'Este torneo no tenia ronda previa que resolver' });
    }

    const prelimMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase: preliminary.phase });
    if (prelimMatches.length === 0) {
      return res.status(400).json({ error: 'No se encontraron partidas de la ronda previa' });
    }

    const grouped = groupMatchesByTiedPair(prelimMatches);
    const prelimWinners = [];
    for (const group of grouped) {
      const winnerId = resolveBracketWinner(group);
      if (!winnerId) {
        return res.status(400).json({ error: 'Todavia hay partidas de la ronda previa sin resolver (incluida posible muerte subita pendiente)' });
      }
      prelimWinners.push(winnerId);
    }

    // byeIds ya vienen ordenados de mejor a peor seed; los ganadores de la
    // previa se añaden a continuacion (peores seeds que cualquier bye) y
    // se reordena el conjunto combinado con seededPairings.
    const combined = [...byeIds, ...prelimWinners];
    const pairings = seededPairings(combined);

    const createdMatches = [];
    for (const pairing of pairings) {
      const created = await createRealMatch(tournament, targetPhase, pairing);
      createdMatches.push(...created);
    }

    // Limpia el estado temporal, ya resuelto
    tournament.pendingEliminationClassifiedIds = [];
    await tournament.save();

    res.status(201).json({ phase: targetPhase, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
