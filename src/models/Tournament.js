const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  format: {
    type: String,
    default: 'Standard'
  },
  date: {
    type: Date,
    default: Date.now
  },
  location: {
    type: String
  },
  // 'tracked': solo se registran las partidas propias de un torneo externo
  // 'hosted': la app aloja el torneo completo (jugadores, pairings, standings)
  mode: {
    type: String,
    enum: ['tracked', 'hosted'],
    required: true
  },
  // Formato de competición. Obligatorio en modo 'tracked' para saber como
  // agrupar/mostrar las partidas (fases, rondas...). En 'hosted' tambien
  // determina la logica de pairings y calculo de standings.
  structure: {
    type: String,
    enum: ['swiss', 'swiss_elimination', 'groups_elimination', 'elimination', 'league']
  },
  // Mazo con el que se juega el torneo. Solo tiene sentido en modo 'tracked',
  // ya que en 'hosted' cada jugador registrado puede llevar un mazo distinto.
  deckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deck'
  },
  status: {
    type: String,
    enum: ['in_progress', 'finished'],
    default: 'in_progress'
  },
  // Resumen final libre, ej "Top 8", "Campeon", "3-2 en swiss"
  finalStanding: {
    type: String
  },
  // Snapshots manuales de puntos/posicion. Solo relevante cuando structure
  // es 'league', ya que en modo 'tracked' no hay forma de conocer la
  // puntuacion del resto de participantes salvo que el propio usuario la
  // introduzca a mano cuando quiera.
  standingSnapshots: [{
    date: {
      type: Date,
      default: Date.now
    },
    points: {
      type: Number
    },
    position: {
      type: Number
    },
    notes: {
      type: String
    }
  }],
  notes: {
    type: String
  },

  // --- Configuracion de eliminatoria directa (issue #42) ---
  // Solo relevante si structure incluye una fase eliminatoria (elimination,
  // swiss_elimination, groups_elimination). Se pregunta al crear el torneo.
  eliminationFormat: {
    type: String,
    enum: ['single_match', 'two_legs'],
    default: 'single_match'
  },
  thirdPlacePlayoff: {
    type: Boolean,
    default: false
  }

  // --- TODO (modo 'hosted', resto pendiente, ver issue #11) ---
  // Este modelo es compartido entre 'tracked' y 'hosted' (el campo `mode`
  // distingue el comportamiento). Ademas de lo ya añadido arriba, falta:
  //   - referencia a TournamentPlayer / TournamentMatch (ver issues #19-#25,
  //     #19 y #20 ya creados y ampliados)
  //   - configuracion de grupos (tamaño, clasificados) para groups_elimination
  //   - configuracion de liga (ida/vuelta) -- reutilizar eliminationFormat
  //     ya no aplica aqui, ver issue #44 (Liga) para su propio campo
  // deckId y structure NO sirven tal cual para 'hosted': cada jugador podra
  // llevar su propio mazo, y structure pasara a condicionar tambien la
  // logica de pairings y calculo de standings, no solo el agrupado visual.

}, { timestamps: true });

// Valida los campos que son obligatorios solo en modo 'tracked'.
// En 'hosted' estos campos no aplican (deckId no tiene sentido porque cada
// jugador puede llevar un mazo distinto, y todavia no gestionamos jugadores).
//
// NOTA: bajo Mongoose 9.x los hooks pre('validate') con estilo callback
// (function(next) { ... next(err) }) NO funcionan (lanzan "next is not a
// function"), asi que la validacion nunca se llegaba a aplicar en la
// practica. El patron correcto es una funcion normal que lanza el error
// directamente. Descubierto al escribir los tests del modelo (issue #18).
tournamentSchema.pre('validate', function() {
  if (this.mode === 'tracked') {
    if (!this.structure) {
      throw new Error('El campo structure es obligatorio en torneos de modo "tracked"');
    }
    if (!this.deckId) {
      throw new Error('El campo deckId es obligatorio en torneos de modo "tracked"');
    }
  }
});

module.exports = mongoose.model('Tournament', tournamentSchema);