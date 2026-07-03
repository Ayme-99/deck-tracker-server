const OpponentArchetype = require('../models/OpponentArchetype');

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