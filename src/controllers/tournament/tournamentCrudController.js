// CRUD basico de Tournament + resumen agregado (issue #115: extraido de
// tournamentController.js, que reunia los 4 dominios de torneos en un
// unico archivo).

const Tournament = require('../../models/Tournament');
const Match = require('../../models/Match');
const mongoose = require('mongoose');

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
