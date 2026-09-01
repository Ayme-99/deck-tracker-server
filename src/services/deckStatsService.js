const Match = require('../models/Match');
const mongoose = require('mongoose');

// Resumen general de un mazo (extraido de statsController.getDeckOverview,
// issue #93: se reutiliza tambien para exponer el resumen de un mazo de un
// amigo, ya que la logica es identica salvo el userId dueño del mazo).
async function computeDeckOverview(deckId, userId) {
  const stats = await Match.aggregate([
    { $match: { deckId: new mongoose.Types.ObjectId(deckId), userId } },
    {
      $group: {
        _id: null,
        totalMatches: { $sum: 1 },
        wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
        ties: { $sum: { $cond: [{ $eq: ['$result', 'tie'] }, 1, 0] } },
        avgUserPrizes: { $avg: '$userPrizes' },
        avgOpponentPrizes: { $avg: '$opponentPrizes' },
        totalUserPrizes: { $sum: '$userPrizes' },
        totalOpponentPrizes: { $sum: '$opponentPrizes' }
      }
    }
  ]);

  if (stats.length === 0) {
    return {
      totalMatches: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      winRate: 0,
      avgUserPrizes: 0,
      avgOpponentPrizes: 0,
      totalUserPrizes: 0,
      totalOpponentPrizes: 0
    };
  }

  const result = stats[0];
  delete result._id;
  result.winRate = result.totalMatches > 0
    ? Math.round((result.wins / result.totalMatches) * 1000) / 10
    : 0;
  result.avgUserPrizes = Math.round(result.avgUserPrizes * 10) / 10;
  result.avgOpponentPrizes = Math.round(result.avgOpponentPrizes * 10) / 10;

  return result;
}

module.exports = { computeDeckOverview };
