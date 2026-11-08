const Deck = require('../models/Deck');
const Match = require('../models/Match');

exports.getDecks = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [decks, total] = await Promise.all([
      Deck.find({ userId: req.userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Deck.countDocuments({ userId: req.userId })
    ]);

    res.json({
      data: decks,
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

    // Borrado en cascada: elimina también las partidas del mazo
    // para no dejar stats huérfanas (issue #31)
    const { deletedCount } = await Match.deleteMany({ deckId: deck._id, userId: req.userId });

    res.json({
      message: 'Mazo eliminado correctamente',
      deletedMatches: deletedCount,
    });
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