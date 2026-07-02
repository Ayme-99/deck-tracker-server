const Deck = require('../models/Deck');

exports.getDecks = async (req, res) => {
  try {
    const decks = await Deck.find({ userId: req.userId });
    res.json(decks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDeckById = async (req, res) => {
  try {
    const deck = await Deck.findOne({ _id: req.params.id, userId: req.userId });
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json(deck);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createDeck = async (req, res) => {
  try {
    const deck = new Deck({ ...req.body, userId: req.userId });
    await deck.save();
    res.status(201).json(deck);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateDeck = async (req, res) => {
  try {
    const deck = await Deck.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json(deck);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteDeck = async (req, res) => {
  try {
    const deck = await Deck.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json({ message: 'Mazo eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateDeckStats = async (req, res) => {
  try {
    const { result } = req.body;
    const update = result === 'win' ? { $inc: { wins: 1 } } : { $inc: { losses: 1 } };
    const deck = await Deck.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      update,
      { new: true }
    );
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json(deck);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};