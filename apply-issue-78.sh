#!/usr/bin/env bash
# Aplica el refactor de la issue #78 (deck-tracker-server) desde la raiz del repo.
# Uso: colocar este script en la raiz de deck-tracker-server y ejecutar: bash apply-issue-78.sh
set -euo pipefail

echo 'Eliminando el controller monolitico original...'
rm -f src/controllers/tournament/tournamentRoundsController.js

mkdir -p src/controllers/tournament src/services src/routes tests/controllers

echo 'Creando src/controllers/tournament/tournamentSwissController.js...'
cat > src/controllers/tournament/tournamentSwissController.js <<'DECKTRACKER_EOF'
// (issue #78: dividido a partir de tournamentRoundsController.js,
// que agrupaba TODO el modo hosted en un unico archivo de 670 lineas.
// Se separa por formato/dominio en vez de mantener un unico bucket
// de "rondas" -- ese bucket es justo el que se habia convertido en
// el nuevo monolito tras la Fase 3 original (#115/#76).

const Tournament = require('../../models/Tournament');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');
const { generateSwissPairings } = require('../../services/swissPairingService');

// --- Modo hosted: formato Swiss (issue #21) ---

exports.generateSwissRound = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const activePlayers = await TournamentPlayer.find({
      tournamentId: tournament._id,
      dropped: false
    });

    if (activePlayers.length < 2) {
      return res.status(400).json({ error: 'Hacen falta al menos 2 jugadores activos para emparejar una ronda' });
    }

    // Adapta los documentos de Mongoose al formato plano que espera el
    // servicio de pairing (logica pura, sin dependencia de Mongoose)
    const playersForPairing = activePlayers.map((p) => ({
      id: p._id.toString(),
      points: p.points,
      opponentIds: p.opponentIds.map((id) => id.toString()),
      byeReceived: p.byeReceived
    }));

    const { pairings } = generateSwissPairings(playersForPairing);

    // Siguiente numero de ronda para la fase swiss de este torneo
    const existingSwissMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase: 'swiss' });
    const nextRound = existingSwissMatches.length > 0
      ? Math.max(...existingSwissMatches.map((m) => m.round || 0)) + 1
      : 1;

    const createdMatches = [];
    for (const pairing of pairings) {
      const match = await TournamentMatch.create({
        tournamentId: tournament._id,
        phase: 'swiss',
        round: nextRound,
        player1Id: pairing.player1Id,
        player2Id: pairing.player2Id,
        // Un bye se resuelve automaticamente como victoria del jugador 1,
        // sin necesidad de que el organizador registre resultado
        status: pairing.player2Id === null ? 'completed' : 'pending',
        winnerId: pairing.player2Id === null ? pairing.player1Id : null
      });
      createdMatches.push(match);

      // Actualiza opponentIds (evitar repetir rival) y byeReceived
      if (pairing.player2Id) {
        await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, { $addToSet: { opponentIds: pairing.player2Id } });
        await TournamentPlayer.findByIdAndUpdate(pairing.player2Id, { $addToSet: { opponentIds: pairing.player1Id } });
      } else {
        await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, {
          byeReceived: true,
          $inc: { points: 3, wins: 1 }
        });
      }
    }

    res.status(201).json({ round: nextRound, matches: createdMatches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
DECKTRACKER_EOF

echo 'Creando src/controllers/tournament/tournamentEliminationController.js...'
cat > src/controllers/tournament/tournamentEliminationController.js <<'DECKTRACKER_EOF'
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
DECKTRACKER_EOF

echo 'Creando src/controllers/tournament/tournamentGroupsLeagueController.js...'
cat > src/controllers/tournament/tournamentGroupsLeagueController.js <<'DECKTRACKER_EOF'
// (issue #78: dividido a partir de tournamentRoundsController.js,
// que agrupaba TODO el modo hosted en un unico archivo de 670 lineas.
// Se separa por formato/dominio en vez de mantener un unico bucket
// de "rondas" -- ese bucket es justo el que se habia convertido en
// el nuevo monolito tras la Fase 3 original (#115/#76).

const Tournament = require('../../models/Tournament');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');
const { assignGroups } = require('../../services/groupsEliminationService');
const { generateRoundRobinSchedule } = require('../../services/roundRobinService');
const { createEliminationEntryMatches } = require('../../services/bracketEntryService');

// --- Grupos + Eliminacion (issue #43) ---

exports.assignPlayerGroups = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const playerIds = players.map((p) => p._id.toString());
    const groups = assignGroups(playerIds, req.body.groupSize);

    for (let i = 0; i < groups.length; i++) {
      const groupName = `Grupo ${i + 1}`;
      await TournamentPlayer.updateMany(
        { _id: { $in: groups[i] } },
        { groupName }
      );
    }

    res.json({ groups: groups.map((ids, i) => ({ groupName: `Grupo ${i + 1}`, playerIds: ids })) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.generateGroupStageRounds = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const groupNames = [...new Set(players.map((p) => p.groupName).filter(Boolean))];
    if (groupNames.length === 0) {
      return res.status(400).json({ error: 'Los jugadores no tienen grupo asignado todavia (ver assignPlayerGroups)' });
    }

    const createdMatches = [];
    for (const groupName of groupNames) {
      const groupPlayerIds = players.filter((p) => p.groupName === groupName).map((p) => p._id.toString());
      const schedule = generateRoundRobinSchedule(groupPlayerIds);

      for (let roundIndex = 0; roundIndex < schedule.length; roundIndex++) {
        for (const pairing of schedule[roundIndex]) {
          const match = await TournamentMatch.create({
            tournamentId: tournament._id,
            phase: 'group_stage',
            round: roundIndex + 1,
            player1Id: pairing.player1Id,
            player2Id: pairing.player2Id,
            status: pairing.player2Id === null ? 'completed' : 'pending',
            winnerId: pairing.player2Id === null ? pairing.player1Id : null
          });
          createdMatches.push(match);

          if (pairing.player2Id === null) {
            await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, { $inc: { points: 3, wins: 1 } });
          }
        }
      }
    }

    res.status(201).json({ matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.generateGroupsEliminationEntry = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { classifiedIds } = req.body;
    const result = await createEliminationEntryMatches(tournament, classifiedIds);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Liga (issue #44) ---

exports.generateLeagueRounds = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const playerIds = players.map((p) => p._id.toString());

    const firstLegSchedule = generateRoundRobinSchedule(playerIds);
    let fullSchedule = firstLegSchedule;

    if (tournament.leagueDoubleRound) {
      // Vuelta: mismos enfrentamientos con local/visitante invertidos
      const secondLegSchedule = firstLegSchedule.map((round) =>
        round.map((pairing) => ({
          player1Id: pairing.player2Id,
          player2Id: pairing.player1Id
        }))
      );
      fullSchedule = [...firstLegSchedule, ...secondLegSchedule];
    }

    const createdMatches = [];
    for (let roundIndex = 0; roundIndex < fullSchedule.length; roundIndex++) {
      for (const pairing of fullSchedule[roundIndex]) {
        // Un bye de round-robin (jugador impar) puede quedar como null tras
        // invertir player1/player2 en la vuelta -- se preserva igual que
        // en la ida, marcando victoria automatica sin partida que jugar.
        const match = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase: 'league_round',
          round: roundIndex + 1,
          player1Id: pairing.player1Id || pairing.player2Id,
          player2Id: pairing.player1Id ? pairing.player2Id : null,
          status: (pairing.player1Id && pairing.player2Id) ? 'pending' : 'completed',
          winnerId: (pairing.player1Id && pairing.player2Id) ? null : (pairing.player1Id || pairing.player2Id)
        });
        createdMatches.push(match);

        if (!pairing.player1Id || !pairing.player2Id) {
          const byePlayerId = pairing.player1Id || pairing.player2Id;
          await TournamentPlayer.findByIdAndUpdate(byePlayerId, { $inc: { points: 3, wins: 1 } });
        }
      }
    }

    res.status(201).json({ totalRounds: fullSchedule.length, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
DECKTRACKER_EOF

echo 'Creando src/controllers/tournament/tournamentResultsController.js...'
cat > src/controllers/tournament/tournamentResultsController.js <<'DECKTRACKER_EOF'
// (issue #78: dividido a partir de tournamentRoundsController.js,
// que agrupaba TODO el modo hosted en un unico archivo de 670 lineas.
// Se separa por formato/dominio en vez de mantener un unico bucket
// de "rondas" -- ese bucket es justo el que se habia convertido en
// el nuevo monolito tras la Fase 3 original (#115/#76).

const Tournament = require('../../models/Tournament');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');
const Match = require('../../models/Match');
const { calculateOMW } = require('../../services/tiebreakerService');

// --- Resultados y clasificacion (transversal a todos los formatos) ---

exports.getHostedStandings = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id });

    const omwMap = calculateOMW(players.map((p) => ({
      id: p._id.toString(),
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      opponentIds: p.opponentIds.map((id) => id.toString())
    })));

    const sorted = [...players].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.prizeDifferential !== a.prizeDifferential) return b.prizeDifferential - a.prizeDifferential;
      return omwMap.get(b._id.toString()) - omwMap.get(a._id.toString());
    });

    let last = null;
    let lastPosition = 0;

    const standings = sorted.map((p, index) => {
      const omwPercentage = omwMap.get(p._id.toString());
      const tiedWithPrevious = last
        && p.points === last.points
        && p.prizeDifferential === last.prizeDifferential
        && omwPercentage === last.omwPercentage;
      const position = tiedWithPrevious ? lastPosition : index + 1;
      last = { points: p.points, prizeDifferential: p.prizeDifferential, omwPercentage };
      lastPosition = position;

      return {
        position,
        playerId: p._id,
        name: p.name,
        deckArchetype: p.deckArchetype,
        points: p.points,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        prizeDifferential: p.prizeDifferential,
        omwPercentage: Math.round(omwPercentage * 1000) / 10, // 0-100, 1 decimal
        dropped: p.dropped
      };
    });

    res.json({ standings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.registerMatchResult = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const tMatch = await TournamentMatch.findOne({ _id: req.params.matchId, tournamentId: tournament._id });
    if (!tMatch) return res.status(404).json({ error: 'Partida no encontrada' });

    const { player1Prizes, player2Prizes, winnerId, isDraw } = req.body;

    tMatch.player1Prizes = player1Prizes;
    tMatch.player2Prizes = player2Prizes;
    tMatch.isDraw = !!isDraw;
    tMatch.winnerId = isDraw ? null : winnerId;
    tMatch.status = 'completed';
    await tMatch.save();

    const player1 = await TournamentPlayer.findById(tMatch.player1Id);
    const player2 = await TournamentPlayer.findById(tMatch.player2Id);

    const diff1 = (player1Prizes || 0) - (player2Prizes || 0);
    const diff2 = -diff1;

    if (isDraw) {
      player1.draws += 1;
      player2.draws += 1;
      player1.points += 1;
      player2.points += 1;
    } else if (String(winnerId) === String(player1._id)) {
      player1.wins += 1;
      player1.points += 3;
      player2.losses += 1;
    } else {
      player2.wins += 1;
      player2.points += 3;
      player1.losses += 1;
    }
    player1.prizeDifferential += diff1;
    player2.prizeDifferential += diff2;
    await player1.save();
    await player2.save();

    // Si alguno de los dos es el organizador, genera un Match real
    // (modelo de tracked) vinculado a su deckId, para que cuente en sus
    // stats/rachas/matchups sin tener que registrarlo dos veces a mano
    const createMatchIfOrganizer = async (self, opponent, ownPrizes, opponentPrizes) => {
      if (!self.isOrganizer || !self.deckId) return;
      await Match.create({
        deckId: self.deckId,
        userId: req.userId,
        opponentDeck: opponent.deckArchetype || opponent.name,
        userPrizes: ownPrizes,
        opponentPrizes: opponentPrizes,
        endReason: 'normal',
        tournamentId: tournament._id,
        phase: tMatch.phase,
        round: tMatch.round
      });
    };
    await createMatchIfOrganizer(player1, player2, player1Prizes, player2Prizes);
    await createMatchIfOrganizer(player2, player1, player2Prizes, player1Prizes);

    res.json({ match: tMatch, player1, player2 });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getHostedMatches = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const matches = await TournamentMatch.find({ tournamentId: tournament._id })
      .sort({ phase: 1, round: 1 });

    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
DECKTRACKER_EOF

echo 'Sobrescribiendo src/services/bracketEntryService.js...'
cat > src/services/bracketEntryService.js <<'DECKTRACKER_EOF'
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
DECKTRACKER_EOF

echo 'Sobrescribiendo src/routes/tournamentRoutes.js...'
cat > src/routes/tournamentRoutes.js <<'DECKTRACKER_EOF'
const express = require('express');
const router = express.Router();
const crudController = require('../controllers/tournament/tournamentCrudController');
const playerController = require('../controllers/tournament/tournamentPlayerController');
const swissController = require('../controllers/tournament/tournamentSwissController');
const eliminationController = require('../controllers/tournament/tournamentEliminationController');
const groupsLeagueController = require('../controllers/tournament/tournamentGroupsLeagueController');
const resultsController = require('../controllers/tournament/tournamentResultsController');
const transferController = require('../controllers/tournament/tournamentTransferController');
const protect = require('../middleware/authMiddleware');

router.use(protect); // aplica el middleware a TODAS las rutas de este archivo

router.get('/', crudController.getTournaments);
router.get('/:id', crudController.getTournamentById);
router.post('/', crudController.createTournament);
router.put('/:id', crudController.updateTournament);
router.delete('/:id', crudController.deleteTournament);
router.post('/:id/standing', crudController.addStandingSnapshot);
router.get('/:id/summary', crudController.getTournamentSummary);
router.post('/:id/swiss-round', swissController.generateSwissRound);
router.get('/:id/hosted-standings', resultsController.getHostedStandings);
router.get('/:id/hosted-matches', resultsController.getHostedMatches);
router.post('/:id/advance-bracket', eliminationController.advanceBracketRound);
router.post('/:id/resolve-preliminary-entry', eliminationController.resolvePreliminaryEntry);
router.post('/:id/players', playerController.createPlayer);
router.get('/:id/players', playerController.getPlayers);
router.put('/:id/players/:playerId', playerController.updatePlayer);
router.delete('/:id/players/:playerId', playerController.deletePlayer);
router.put('/:id/hosted-matches/:matchId/result', resultsController.registerMatchResult);
router.post('/:id/elimination-bracket', eliminationController.generateEliminationBracket);
router.post('/:id/assign-groups', groupsLeagueController.assignPlayerGroups);
router.post('/:id/group-stage-rounds', groupsLeagueController.generateGroupStageRounds);
router.post('/:id/groups-elimination-entry', groupsLeagueController.generateGroupsEliminationEntry);
router.post('/:id/league-rounds', groupsLeagueController.generateLeagueRounds);
router.post('/:id/close-phase', eliminationController.closePhaseToElimination);
router.get('/:id/export', transferController.exportTournament);
router.post('/import', transferController.importTournament);

module.exports = router;
DECKTRACKER_EOF

echo 'Sobrescribiendo tests/controllers/tournamentController.hosted.test.js...'
cat > tests/controllers/tournamentController.hosted.test.js <<'DECKTRACKER_EOF'
﻿jest.mock('../../src/models/Tournament');
jest.mock('../../src/models/TournamentPlayer');
jest.mock('../../src/models/TournamentMatch');
jest.mock('../../src/models/Match');

const Tournament = require('../../src/models/Tournament');
const TournamentPlayer = require('../../src/models/TournamentPlayer');
const TournamentMatch = require('../../src/models/TournamentMatch');
const Match = require('../../src/models/Match');
// Este archivo cubre handlers de varios controllers distintos tras la
// division del monolito "rounds" (issue #78, continuacion de la Fase 3
// del refactor #115/#76): swiss, eliminacion, grupos/liga, resultados y
// transfer. Se fusionan en un unico objeto `controller` para no tener que
// renombrar cada `controller.xxx` de los tests.
const swissController = require('../../src/controllers/tournament/tournamentSwissController');
const eliminationController = require('../../src/controllers/tournament/tournamentEliminationController');
const groupsLeagueController = require('../../src/controllers/tournament/tournamentGroupsLeagueController');
const resultsController = require('../../src/controllers/tournament/tournamentResultsController');
const transferController = require('../../src/controllers/tournament/tournamentTransferController');
const controller = {
  ...swissController,
  ...eliminationController,
  ...groupsLeagueController,
  ...resultsController,
  ...transferController
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const USER_ID = 'user1';

afterEach(() => {
  jest.clearAllMocks();
});

describe('generateSwissRound', () => {
  test('genera pairings y resuelve el bye automaticamente (3 jugadores)', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    TournamentPlayer.find.mockResolvedValue([
      { _id: 'p1', points: 0, opponentIds: [], byeReceived: false, dropped: false },
      { _id: 'p2', points: 0, opponentIds: [], byeReceived: false, dropped: false },
      { _id: 'p3', points: 0, opponentIds: [], byeReceived: false, dropped: false }
    ]);
    TournamentMatch.find.mockResolvedValue([]); // sin rondas swiss previas
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random() }));
    TournamentPlayer.findByIdAndUpdate.mockResolvedValue({});

    const req = { params: { id: 'tid1' }, userId: USER_ID };
    const res = mockRes();
    await controller.generateSwissRound(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const { matches, round } = res.json.mock.calls[0][0];
    expect(round).toBe(1);
    expect(matches).toHaveLength(2); // 1 pairing + 1 bye

    const byeMatch = matches.find((m) => m.player2Id === null);
    expect(byeMatch.status).toBe('completed');
    expect(byeMatch.winnerId).toBe(byeMatch.player1Id);

    const byeUpdateCall = TournamentPlayer.findByIdAndUpdate.mock.calls.find(
      (call) => call[1].byeReceived === true
    );
    expect(byeUpdateCall[1]).toMatchObject({ byeReceived: true, $inc: { points: 3, wins: 1 } });
  });

  test('404 si el torneo no existe', async () => {
    Tournament.findOne.mockResolvedValue(null);
    const req = { params: { id: 'x' }, userId: USER_ID };
    const res = mockRes();
    await controller.generateSwissRound(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 si hay menos de 2 jugadores activos', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    TournamentPlayer.find.mockResolvedValue([{ _id: 'p1' }]);
    const req = { params: { id: 'tid1' }, userId: USER_ID };
    const res = mockRes();
    await controller.generateSwissRound(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('registerMatchResult', () => {
  test('actualiza puntuacion y genera Match real para el jugador organizador', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const tMatch = { _id: 'm1', player1Id: 'p1', player2Id: 'p2', phase: 'swiss', round: 2, save: jest.fn() };
    TournamentMatch.findOne.mockResolvedValue(tMatch);

    const player1 = {
      _id: 'p1', isOrganizer: true, deckId: 'deck123', deckArchetype: 'A',
      wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn()
    };
    const player2 = {
      _id: 'p2', isOrganizer: false, deckId: null, name: 'Rival', deckArchetype: 'Charizard ex',
      wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn()
    };
    TournamentPlayer.findById.mockImplementation(async (id) => (id === 'p1' ? player1 : player2));
    Match.create.mockResolvedValue({});

    const req = {
      params: { id: 'tid1', matchId: 'm1' },
      userId: USER_ID,
      body: { player1Prizes: 6, player2Prizes: 2, winnerId: 'p1', isDraw: false }
    };
    const res = mockRes();
    await controller.registerMatchResult(req, res);

    expect(player1.wins).toBe(1);
    expect(player1.points).toBe(3);
    expect(player1.prizeDifferential).toBe(4);
    expect(player2.losses).toBe(1);
    expect(player2.prizeDifferential).toBe(-4);

    // Solo se crea un Match real (el del organizador), no el del rival normal
    expect(Match.create).toHaveBeenCalledTimes(1);
    expect(Match.create).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: 'deck123', opponentDeck: 'Charizard ex', userPrizes: 6, opponentPrizes: 2, phase: 'swiss', round: 2 })
    );
  });

  test('un empate no genera ganador ni actualiza wins/losses', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const tMatch = { _id: 'm1', player1Id: 'p1', player2Id: 'p2', phase: 'league_round', round: 1, save: jest.fn() };
    TournamentMatch.findOne.mockResolvedValue(tMatch);

    const player1 = { _id: 'p1', isOrganizer: false, wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn() };
    const player2 = { _id: 'p2', isOrganizer: false, wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn() };
    TournamentPlayer.findById.mockImplementation(async (id) => (id === 'p1' ? player1 : player2));

    const req = {
      params: { id: 'tid1', matchId: 'm1' },
      userId: USER_ID,
      body: { player1Prizes: 3, player2Prizes: 3, isDraw: true }
    };
    const res = mockRes();
    await controller.registerMatchResult(req, res);

    expect(player1.draws).toBe(1);
    expect(player2.draws).toBe(1);
    expect(player1.points).toBe(1);
    expect(player2.points).toBe(1);
    expect(tMatch.winnerId).toBeNull();
    expect(Match.create).not.toHaveBeenCalled();
  });
});

describe('closePhaseToElimination', () => {
  test('swiss_elimination sin ronda previa (extra=0): empareja de verdad, sin byes falsos', async () => {
    const tournamentDoc = { _id: 'tid1', userId: USER_ID, structure: 'swiss_elimination', eliminationFormat: 'single_match', save: jest.fn() };
    Tournament.findOne.mockResolvedValue(tournamentDoc);
    const sortedPlayers = Array.from({ length: 8 }, (_, i) => ({ _id: 'p' + (i + 1), points: 24 - i, prizeDifferential: 10 - i }));
    TournamentPlayer.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(sortedPlayers) });
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random(), save: jest.fn() }));

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: { topCut: 4 } };
    const res = mockRes();
    await controller.closePhaseToElimination(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.targetPhase).toBe('semifinal');
    expect(body.preliminaryPhase).toBeNull();
    // 2 partidas REALES (seededPairings: p1 vs p4, p2 vs p3), no 4 byes falsos
    expect(body.matches).toHaveLength(2);
    expect(body.matches.every((m) => m.status === undefined || m.status !== 'completed')).toBe(true);
    // No hizo falta guardar nada pendiente (sin ronda previa)
    expect(tournamentDoc.save).not.toHaveBeenCalled();
  });

  test('swiss_elimination con ronda previa (extra>0): guarda classifiedIds pendientes', async () => {
    const tournamentDoc = { _id: 'tid1', userId: USER_ID, structure: 'swiss_elimination', eliminationFormat: 'single_match', save: jest.fn() };
    Tournament.findOne.mockResolvedValue(tournamentDoc);
    const sortedPlayers = Array.from({ length: 10 }, (_, i) => ({ _id: 'seed' + (i + 1), points: 20 - i, prizeDifferential: 10 - i }));
    TournamentPlayer.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(sortedPlayers) });
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random(), save: jest.fn() }));

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: { topCut: 10 } };
    const res = mockRes();
    await controller.closePhaseToElimination(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.preliminaryPhase).toBe('round_of_16');
    // Solo se crean las 2 partidas de la ronda previa, nada en targetPhase todavia
    expect(body.matches).toHaveLength(2);
    // Se persisten los 10 classifiedIds para resolvePreliminaryEntry
    expect(tournamentDoc.save).toHaveBeenCalled();
    expect(tournamentDoc.pendingEliminationClassifiedIds).toHaveLength(10);
  });

  test('rechaza una estructura que no es swiss_elimination ni groups_elimination', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID, structure: 'league' });
    const req = { params: { id: 'tid1' }, userId: USER_ID, body: {} };
    const res = mockRes();
    await controller.closePhaseToElimination(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('resolvePreliminaryEntry', () => {
  test('lee classifiedIds del torneo (sin body) y genera la fase destino', async () => {
    const classifiedIds = Array.from({ length: 10 }, (_, i) => 'seed' + (i + 1));
    const tournamentDoc = {
      _id: 'tid1', userId: USER_ID, eliminationFormat: 'single_match',
      pendingEliminationClassifiedIds: classifiedIds,
      save: jest.fn()
    };
    Tournament.findOne.mockResolvedValue(tournamentDoc);

    const prelimMatches = [
      { _id: 'pm1', phase: 'round_of_16', player1Id: 'seed7', player2Id: 'seed10', winnerId: 'seed7', leg: 'single', status: 'completed', tiedMatchId: null },
      { _id: 'pm2', phase: 'round_of_16', player1Id: 'seed8', player2Id: 'seed9', winnerId: 'seed9', leg: 'single', status: 'completed', tiedMatchId: null }
    ];
    TournamentMatch.find.mockResolvedValue(prelimMatches);
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random(), save: jest.fn() }));

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: {} };
    const res = mockRes();
    await controller.resolvePreliminaryEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.phase).toBe('quarterfinal');
    expect(body.matches).toHaveLength(4); // 6 byes + 2 ganadores = 8 -> 4 partidos
    // Se limpia el estado pendiente tras resolver
    expect(tournamentDoc.pendingEliminationClassifiedIds).toEqual([]);
    expect(tournamentDoc.save).toHaveBeenCalled();
  });

  test('400 si no hay nada pendiente que resolver', async () => {
    const tournamentDoc = { _id: 'tid1', userId: USER_ID, pendingEliminationClassifiedIds: [], save: jest.fn() };
    Tournament.findOne.mockResolvedValue(tournamentDoc);

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: {} };
    const res = mockRes();
    await controller.resolvePreliminaryEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('importTournament', () => {
  test('remapea IDs de jugadores, opponentIds, matches y tiedMatchId; vincula al organizador', async () => {
    const exportedData = {
      tournament: { name: 'Liga importada', structure: 'swiss' },
      players: [
        { _id: 'OLD_p1', name: 'Ana', opponentIds: ['OLD_p2'], points: 3, wins: 1, losses: 0, draws: 0, prizeDifferential: 3, byeReceived: false, groupName: null, dropped: false },
        { _id: 'OLD_p2', name: 'Bea', opponentIds: ['OLD_p1'], points: 0, wins: 0, losses: 1, draws: 0, prizeDifferential: -3, byeReceived: false, groupName: null, dropped: false }
      ],
      matches: [
        { _id: 'OLD_m1', phase: 'quarterfinal', player1Id: 'OLD_p1', player2Id: 'OLD_p2', winnerId: 'OLD_p1', status: 'completed', isDraw: false, leg: 'first_leg', tiedMatchId: 'OLD_m2' },
        { _id: 'OLD_m2', phase: 'quarterfinal', player1Id: 'OLD_p2', player2Id: 'OLD_p1', winnerId: null, status: 'pending', isDraw: false, leg: 'second_leg', tiedMatchId: 'OLD_m1' }
      ]
    };

    Tournament.create.mockImplementation(async (data) => ({ ...data, _id: 'NEW_tid' }));
    let playerCounter = 0;
    TournamentPlayer.create.mockImplementation(async (data) => { playerCounter++; return { ...data, _id: 'NEW_p' + playerCounter }; });
    TournamentPlayer.findByIdAndUpdate.mockResolvedValue({});
    let matchCounter = 0;
    TournamentMatch.create.mockImplementation(async (data) => { matchCounter++; return { ...data, _id: 'NEW_m' + matchCounter }; });
    TournamentMatch.findByIdAndUpdate.mockResolvedValue({});

    const req = {
      userId: 'importer',
      body: { data: exportedData, selfPlayerId: 'OLD_p1', selfDeckId: 'myRealDeck' }
    };
    const res = mockRes();
    await controller.importTournament(req, res);

    expect(Tournament.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'hosted', userId: 'importer' }));

    const anaCreateCall = TournamentPlayer.create.mock.calls.find((c) => c[0].name === 'Ana')[0];
    expect(anaCreateCall.isOrganizer).toBe(true);
    expect(anaCreateCall.deckId).toBe('myRealDeck');

    const beaCreateCall = TournamentPlayer.create.mock.calls.find((c) => c[0].name === 'Bea')[0];
    expect(beaCreateCall.isOrganizer).toBe(false);

    // opponentIds remapeados a los nuevos IDs (segunda pasada)
    const opponentUpdateCalls = TournamentPlayer.findByIdAndUpdate.mock.calls;
    expect(opponentUpdateCalls.some((c) => c[1].opponentIds && c[1].opponentIds.length === 1)).toBe(true);

    // tiedMatchId remapeado (segunda pasada)
    const tiedUpdateCalls = TournamentMatch.findByIdAndUpdate.mock.calls;
    expect(tiedUpdateCalls.length).toBeGreaterThan(0);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.playersCreated).toBe(2);
    expect(body.matchesCreated).toBe(2);
  });

  test('400 si se indica selfPlayerId sin selfDeckId', async () => {
    const req = { userId: 'importer', body: { data: { tournament: {}, players: [], matches: [] }, selfPlayerId: 'x' } };
    const res = mockRes();
    await controller.importTournament(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
DECKTRACKER_EOF

echo 'Listo. Corriendo tests...'
npm test