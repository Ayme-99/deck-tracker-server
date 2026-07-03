const mongoose = require('mongoose');

const opponentArchetypeSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  sprite1: {
    type: String,
    default: null
  },
  sprite2: {
    type: String,
    default: null
  }
});

// Un mismo usuario no puede tener dos entradas con el mismo nombre de rival
opponentArchetypeSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('OpponentArchetype', opponentArchetypeSchema);