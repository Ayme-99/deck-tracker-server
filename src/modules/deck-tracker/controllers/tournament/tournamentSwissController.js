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
