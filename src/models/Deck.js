const mongoose = require('mongoose');

const deckSchema = new mongoose.Schema({
  name: { type: String, required: true },
  format: { type: String, default: 'Standard' },
  cards: [{
    cardId: { type: String, required: true },
    name: String,
    quantity: { type: Number, default: 1 },
    category: { type: String, enum: ['pokemon', 'trainer', 'energy'] }
  }],
  userId: { type: String, required: true },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Deck', deckSchema);