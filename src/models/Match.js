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
  userPrizes: {
    type: Number,
    required: true,
    min: 0,
    max: 6
  },
  opponentPrizes: {
    type: Number,
    required: true,
    min: 0,
    max: 6
  },
  endReason: {
    type: String,
    enum: ['normal', 'concession', 'no_pokemon', 'time', 'deck_out'],
    default: 'normal'
  },
  result: {
    type: String,
    enum: ['win', 'loss', 'tie']
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

// Calcula el resultado automáticamente antes de guardar
matchSchema.pre('save', function(next) {
  if (this.userPrizes > this.opponentPrizes) {
    this.result = 'win'; // cogiste más premios que el rival = ganaste
  } else if (this.userPrizes < this.opponentPrizes) {
    this.result = 'loss';
  } else {
    this.result = 'tie';
  }
  next();
});

module.exports = mongoose.model('Match', matchSchema);