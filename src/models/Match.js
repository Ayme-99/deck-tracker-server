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
matchSchema.pre('save', function() {
  if (this.userPrizes !== this.opponentPrizes) {
    // Los premios desempatan por sí solos
    this.result = this.userPrizes > this.opponentPrizes ? 'win' : 'loss';
  } else if (this.endReason === 'normal') {
    // Empate real de premios en una partida que terminó de forma normal
    this.result = 'tie';
  } else if (!this.result) {
    // Premios empatados pero terminó por rendicion/sin pokemon/tiempo/etc:
    // el resultado no se puede inferir solo, hace falta que venga explicito
    throw new Error('Con premios empatados y un motivo de fin distinto de "normal", debes indicar el resultado manualmente (win/loss/tie)');
  }
  // Si this.result ya viene informado (caso de empate de premios + motivo no normal), se respeta tal cual
});

module.exports = mongoose.model('Match', matchSchema);