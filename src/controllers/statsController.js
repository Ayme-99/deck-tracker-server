const Match = require('../models/Match');
const mongoose = require('mongoose');

// Resumen general de un mazo
exports.getDeckOverview = async (req, res) => {
  try {
    const { deckId } = req.params;

    const stats = await Match.aggregate([
      { $match: { deckId: new mongoose.Types.ObjectId(deckId), userId: req.userId } },
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
      return res.json({
        totalMatches: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        winRate: 0,
        avgUserPrizes: 0,
        avgOpponentPrizes: 0,
        totalUserPrizes: 0,
        totalOpponentPrizes: 0
      });
    }

    const result = stats[0];
    delete result._id;
    result.winRate = result.totalMatches > 0
      ? Math.round((result.wins / result.totalMatches) * 1000) / 10
      : 0;
    result.avgUserPrizes = Math.round(result.avgUserPrizes * 10) / 10;
    result.avgOpponentPrizes = Math.round(result.avgOpponentPrizes * 10) / 10;

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Win-rate por matchup (contra cada tipo de mazo rival)
exports.getDeckMatchups = async (req, res) => {
  try {
    const { deckId } = req.params;

    const matchups = await Match.aggregate([
      { $match: { deckId: new mongoose.Types.ObjectId(deckId), userId: req.userId } },
      {
        $group: {
          _id: '$opponentDeck',
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          ties: { $sum: { $cond: [{ $eq: ['$result', 'tie'] }, 1, 0] } }
        }
      },
      {
        $project: {
          _id: 0,
          opponentDeck: '$_id',
          totalMatches: 1,
          wins: 1,
          losses: 1,
          ties: 1,
          winRate: {
            $round: [{ $multiply: [{ $divide: ['$wins', '$totalMatches'] }, 100] }, 1]
          }
        }
      },
      { $sort: { totalMatches: -1 } } // los matchups más jugados primero
    ]);

    res.json(matchups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Racha actual (ganando o perdiendo)
exports.getDeckStreak = async (req, res) => {
  try {
    const { deckId } = req.params;

    const recentMatches = await Match.find({ deckId, userId: req.userId })
      .sort({ playedAt: -1 })
      .select('result playedAt');

    if (recentMatches.length === 0) {
      return res.json({ streakType: null, streakCount: 0 });
    }

    const lastResult = recentMatches[0].result;
    let streakCount = 0;

    for (const match of recentMatches) {
      if (match.result === lastResult) {
        streakCount++;
      } else {
        break;
      }
    }

    res.json({ streakType: lastResult, streakCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Estadísticas globales del usuario (todos sus mazos combinados)
exports.getGlobalOverview = async (req, res) => {
  try {
    const stats = await Match.aggregate([
      { $match: { userId: req.userId } },
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          ties: { $sum: { $cond: [{ $eq: ['$result', 'tie'] }, 1, 0] } },
          totalUserPrizes: { $sum: '$userPrizes' },
          totalOpponentPrizes: { $sum: '$opponentPrizes' }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalMatches: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        winRate: 0,
        totalUserPrizes: 0,
        totalOpponentPrizes: 0
      });
    }

    const result = stats[0];
    delete result._id;
    result.winRate = result.totalMatches > 0
      ? Math.round((result.wins / result.totalMatches) * 1000) / 10
      : 0;

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Ranking de mazos por win-rate (con mínimo de partidas para ser representativo)
exports.getDeckRanking = async (req, res) => {
  try {
    const minMatches = parseInt(req.query.minMatches) || 3; // por defecto, al menos 3 partidas

    const ranking = await Match.aggregate([
      { $match: { userId: req.userId } },
      {
        $group: {
          _id: '$deckId',
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          ties: { $sum: { $cond: [{ $eq: ['$result', 'tie'] }, 1, 0] } }
        }
      },
      { $match: { totalMatches: { $gte: minMatches } } },
      {
        $lookup: {
          from: 'decks',
          localField: '_id',
          foreignField: '_id',
          as: 'deckInfo'
        }
      },
      { $unwind: '$deckInfo' },
      {
      $project: {
        _id: 0,
        deckId: '$_id',
        deckName: '$deckInfo.name',
        sprite1: '$deckInfo.sprite1',
        sprite2: '$deckInfo.sprite2',
        totalMatches: 1,
        wins: 1,
        losses: 1,
        ties: 1,
        winRate: {
          $round: [{ $multiply: [{ $divide: ['$wins', '$totalMatches'] }, 100] }, 1]
        }
      }
    },
      { $sort: { winRate: -1 } }
    ]);

    res.json(ranking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};