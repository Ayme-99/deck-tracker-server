const Tournament = require('../models/Tournament');
const Match = require('../models/Match');

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