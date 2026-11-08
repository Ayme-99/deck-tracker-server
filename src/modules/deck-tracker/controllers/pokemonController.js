const { searchSpecies, getSpeciesSprite } = require('../services/pokeapiService');

exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const results = await searchSpecies(q);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSprite = async (req, res) => {
  try {
    const { name } = req.params;
    const spriteUrl = await getSpeciesSprite(name);

    if (!spriteUrl) {
      return res.status(404).json({ error: 'No se encontro sprite para esa especie' });
    }

    res.json({ name, spriteUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};