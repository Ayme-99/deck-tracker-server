const Deck = require('../models/Deck');

exports.getDecks = async (req, res) => {
  try {
    const decks = await Deck.find({ userId: req.query.userId });
    res.json(decks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createDeck = async (req, res) => {
  try {
    const deck = new Deck(req.body);
    await deck.save();
    res.status(201).json(deck);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateDeckStats = async (req, res) => {
  try {
    const { result } = req.body; // 'win' o 'loss'
    const update = result === 'win' ? { $inc: { wins: 1 } } : { $inc: { losses: 1 } };
    const deck = await Deck.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(deck);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};