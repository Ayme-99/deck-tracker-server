const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const mongoose = require('mongoose');
const TournamentPlayer = require('../models/TournamentPlayer');
const TournamentMatch = require('../models/TournamentMatch');
const { generateSwissPairings } = require('../services/swissPairingService');

exports.getTournaments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [tournaments, total] = await Promise.all([
      Tournament.find({ userId: req.userId })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      Tournament.countDocuments({ userId: req.userId })
    ]);

    res.json({
      data: tournaments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTournamentById = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    // Partidas del torneo, agrupadas visualmente por fase/ronda en el propio
    // orden de llegada (el front se encarga de agruparlas si lo necesita)
    const matches = await Match.find({ tournamentId: tournament._id, userId: req.userId })
      .sort({ phase: 1, round: 1, playedAt: 1 });

    res.json({ ...tournament.toObject(), matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createTournament = async (req, res) => {
  try {
    const tournament = new Tournament({ ...req.body, userId: req.userId });
    await tournament.save();
    res.status(201).json(tournament);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
    res.json(tournament);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    // A diferencia del borrado de mazos, aqui NO se borran las partidas en
    // cascada: quedan como partidas sueltas (se limpia su referencia al
    // torneo) para no perder historial ni stats del mazo.
    const { modifiedCount } = await Match.updateMany(
      { tournamentId: tournament._id, userId: req.userId },
      { $set: { tournamentId: null, phase: null, round: null } }
    );

    res.json({
      message: 'Torneo eliminado correctamente',
      unlinkedMatches: modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Añade un snapshot manual de puntos/posición (solo tiene sentido cuando
// structure es 'league', ya que ahi no hay forma de calcular la clasificacion
// a partir de los matches propios: hace falta que el usuario la introduzca
// a mano cuando quiera)
exports.addStandingSnapshot = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    if (tournament.structure !== 'league') {
      return res.status(400).json({ error: 'Los snapshots de standing solo aplican a torneos de tipo "league"' });
    }

    const { points, position, notes } = req.body;
    tournament.standingSnapshots.push({ points, position, notes });
    await tournament.save();

    res.status(201).json(tournament);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Resumen W-L-T del torneo, global y desglosado por fase
exports.getTournamentSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await Tournament.findOne({ _id: id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const byPhase = await Match.aggregate([
      { $match: { tournamentId: new mongoose.Types.ObjectId(id), userId: req.userId } },
      {
        $group: {
          _id: '$phase',
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          ties: { $sum: { $cond: [{ $eq: ['$result', 'tie'] }, 1, 0] } }
        }
      },
      {
        $project: {
          _id: 0,
          phase: '$_id',
          totalMatches: 1,
          wins: 1,
          losses: 1,
          ties: 1,
          winRate: {
            $round: [{ $multiply: [{ $divide: ['$wins', '$totalMatches'] }, 100] }, 1]
          }
        }
      },
      { $sort: { phase: 1 } }
    ]);

    // El global se calcula sumando el desglose por fase, en vez de lanzar
    // una segunda query, ya que byPhase ya cubre todas las partidas del torneo
    const overall = byPhase.reduce((acc, phase) => ({
      totalMatches: acc.totalMatches + phase.totalMatches,
      wins: acc.wins + phase.wins,
      losses: acc.losses + phase.losses,
      ties: acc.ties + phase.ties
    }), { totalMatches: 0, wins: 0, losses: 0, ties: 0 });

    overall.winRate = overall.totalMatches > 0
      ? Math.round((overall.wins / overall.totalMatches) * 1000) / 10
      : 0;

    res.json({ overall, byPhase });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Modo hosted (issue #21) ---

// Genera la siguiente ronda swiss: empareja jugadores activos (no dropped)
// segun puntos, evitando repetir rivales, y crea los TournamentMatch
// correspondientes. Actualiza opponentIds/byeReceived de los jugadores.
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

// Clasificacion del torneo hosted, ordenada por puntos y desempatada por
// prizeDifferential (1er criterio). OMW% (2º criterio) se añade en #45.
// Jugadores con el mismo points+prizeDifferential comparten posicion.
exports.getHostedStandings = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id })
      .sort({ points: -1, prizeDifferential: -1 });

    let lastPoints = null;
    let lastDiff = null;
    let lastPosition = 0;

    const standings = players.map((p, index) => {
      const tiedWithPrevious = p.points === lastPoints && p.prizeDifferential === lastDiff;
      const position = tiedWithPrevious ? lastPosition : index + 1;
      lastPoints = p.points;
      lastDiff = p.prizeDifferential;
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
        dropped: p.dropped
      };
    });

    res.json({ standings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};