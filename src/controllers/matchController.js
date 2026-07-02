const Match = require('../models/Match');

exports.createMatch = async (req, res) => {
  try {
    const match = new Match({ ...req.body, userId: req.userId });
    await match.save();
    res.status(201).json(match);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getMatches = async (req, res) => {
  try {
    const { deckId } = req.query;
    const filter = { userId: req.userId };
    if (deckId) filter.deckId = deckId;
    const matches = await Match.find(filter).sort({ playedAt: -1 });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMatchById = async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.id, userId: req.userId });
    if (!match) return res.status(404).json({ error: 'Partida no encontrada' });
    res.json(match);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateMatch = async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.id, userId: req.userId });
    if (!match) return res.status(404).json({ error: 'Partida no encontrada' });

    Object.assign(match, req.body);
    await match.save();

    res.json(match);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteMatch = async (req, res) => {
  try {
    const match = await Match.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!match) return res.status(404).json({ error: 'Partida no encontrada' });
    res.json({ message: 'Partida eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOpponentSuggestions = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { userId: req.userId };
    if (q) {
      filter.opponentDeck = { $regex: '^' + q, $options: 'i' };
    }
    const suggestions = await Match.distinct('opponentDeck', filter);
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};