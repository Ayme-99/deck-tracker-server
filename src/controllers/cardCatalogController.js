const { searchCards } = require('../services/tcgdexService');

exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const results = await searchCards(q);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
