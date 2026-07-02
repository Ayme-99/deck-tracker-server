const Match = require('../models/Match');

exports.createMatch = async (req, res) => {
  try {
    const match = new Match(req.body);
    await match.save();
    res.status(201).json(match);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getMatches = async (req, res) => {
  try {
    const { userId, deckId } = req.query;
    const filter = { userId };
    if (deckId) filter.deckId = deckId;
    const matches = await Match.find(filter).sort({ playedAt: -1 });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteMatch = async (req, res) => {
  try {
    const match = await Match.findByIdAndDelete(req.params.id);
    if (!match) return res.status(404).json({ error: 'Partida no encontrada' });
    res.json({ message: 'Partida eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Sugerencias de autocompletado para "opponentDeck"
exports.getOpponentSuggestions = async (req, res) => {
  try {
    const { userId, q } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId es requerido' });

    const filter = { userId };
    if (q) {
      filter.opponentDeck = { $regex: '^' + q, $options: 'i' }; // insensible a mayúsculas
    }

    const suggestions = await Match.distinct('opponentDeck', filter);
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};