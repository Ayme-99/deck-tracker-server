const mongoose = require('mongoose');

// NOTA: Este modelo es parte del modo 'hosted' (issue #11), que esta fuera
// de alcance del sprint actual (issue #19). Se deja creado y listo, pero
// SIN endpoints/rutas todavia — se conectara cuando se desarrolle 'hosted'
// en serio, despues de Japon.

const tournamentPlayerSchema = new mongoose.Schema({
  // Torneo (modo 'hosted') al que pertenece este jugador
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true
  },
  // Jugador sin cuenta en la app: nombre libre, no hay User asociado
  name: {
    type: String,
    required: true
  },
  // Arquetipo de mazo del jugador, texto libre (igual que OpponentArchetype,
  // pero aqui no hace falta ref porque no se lleva estadistica cruzada
  // entre torneos, solo dentro de este)
  deckArchetype: {
    type: String
  },
  // Si el jugador se retira a mitad de torneo (deja de recibir emparejamientos
  // en las siguientes rondas, pero conserva su historial de partidas jugadas)
  dropped: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Un mismo torneo no puede tener dos jugadores con el mismo nombre
// (mismo criterio que OpponentArchetype con userId+name)
tournamentPlayerSchema.index({ tournamentId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('TournamentPlayer', tournamentPlayerSchema);