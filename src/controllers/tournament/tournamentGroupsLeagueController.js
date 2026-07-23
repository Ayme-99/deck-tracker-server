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
