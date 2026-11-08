const OpponentArchetype = require('../models/OpponentArchetype');
const Match = require('../models/Match');

// Crea o actualiza los sprites asociados a un nombre de rival
exports.upsert = async (req, res) => {
  try {
    const { name, sprite1, sprite2 } = req.body;

    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const archetype = await OpponentArchetype.findOneAndUpdate(
      { userId: req.userId, name },
      { sprite1: sprite1 || null, sprite2: sprite2 || null },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(archetype);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Obtiene los sprites de un nombre de rival concreto
exports.getByName = async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const archetype = await OpponentArchetype.findOne({ userId: req.userId, name });
    res.json(archetype || { name, sprite1: null, sprite2: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Devuelve todos los archetypes guardados del usuario (util para pintar listas de matchups con icono)
exports.getAll = async (req, res) => {
  try {
    const archetypes = await OpponentArchetype.find({ userId: req.userId });
    res.json(archetypes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Edita nombre y/o sprites de un rival ya afrontado (issue #74). Si cambia el
// nombre, hay que propagarlo a las partidas ya registradas (Match.opponentDeck
// es un string suelto, no una referencia), para no perder el historial al
// agrupar por nombre en las estadisticas.
exports.update = async (req, res) => {
  try {
    const { name, newName, sprite1, sprite2 } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const finalName = newName || name;

    if (finalName !== name) {
      await Match.updateMany(
        { userId: req.userId, opponentDeck: name },
        { $set: { opponentDeck: finalName } }
      );
    }

    const archetype = await OpponentArchetype.findOneAndUpdate(
      { userId: req.userId, name },
      { name: finalName, sprite1: sprite1 || null, sprite2: sprite2 || null },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(archetype);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Borra un rival y, en cascada, todas las partidas registradas contra el
// (mismo criterio que deckController.deleteDeck para no dejar stats huerfanas)
exports.remove = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    await OpponentArchetype.findOneAndDelete({ userId: req.userId, name });
    const { deletedCount } = await Match.deleteMany({ userId: req.userId, opponentDeck: name });

    res.json({ message: 'Mazo rival eliminado correctamente', deletedMatches: deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};