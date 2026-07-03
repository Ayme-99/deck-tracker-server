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
  if (this.endReason === 'normal') {
    // Unico caso donde el marcador de premios determina el resultado por si solo
    if (this.userPrizes > this.opponentPrizes) {
      this.result = 'win';
    } else if (this.userPrizes < this.opponentPrizes) {
      this.result = 'loss';
    } else {
      this.result = 'tie';
    }
  } else if (!this.result) {
    // Cualquier otro motivo (rendicion, sin pokemon, tiempo, deck-out) puede
    // desconectar el resultado real del marcador de premios, asi que hace
    // falta que venga indicado explicitamente
    throw new Error('Con un motivo de fin distinto de "normal", debes indicar el resultado manualmente (win/loss/tie)');
  }
  // Si this.result ya viene informado, se respeta tal cual
});

module.exports = mongoose.model('Match', matchSchema);