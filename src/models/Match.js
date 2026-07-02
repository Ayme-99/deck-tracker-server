const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  deckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deck',
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  opponentDeck: {
    type: String,
    required: true
  },
  result: {
    type: String,
    enum: ['win', 'loss', 'tie'],
    required: true
  },
  format: {
    type: String,
    default: 'Standard'
  },
  notes: {
    type: String
  },
  playedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Match', matchSchema);