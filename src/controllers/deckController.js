exports.getDeckById = async (req, res) => {
  try {
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json(deck);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateDeck = async (req, res) => {
  try {
    const deck = await Deck.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json(deck);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteDeck = async (req, res) => {
  try {
    const deck = await Deck.findByIdAndDelete(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });
    res.json({ message: 'Mazo eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};