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
  }

  // --- TODO (modo 'hosted', post-Japon, ver issue #11) ---
  // Este modelo es compartido entre 'tracked' y 'hosted' (el campo `mode`
  // distingue el comportamiento), pero de momento SOLO contiene los campos
  // necesarios para 'tracked'. Para desarrollar 'hosted' habra que anadir
  // aqui, entre otros:
  //   - players: [{ name, deckArchetype, dropped }] (jugadores sin cuenta)
  //   - pairingSystem / rondas generadas automaticamente
  //   - referencia a TournamentPlayer / TournamentMatch (ver issues #19-#25)
  // deckId y structure NO sirven tal cual para 'hosted': cada jugador podra
  // llevar su propio mazo, y structure pasara a condicionar tambien la
  // logica de pairings y calculo de standings, no solo el agrupado visual.

}, { timestamps: true });

// Valida los campos que son obligatorios solo en modo 'tracked'.
// En 'hosted' estos campos no aplican (deckId no tiene sentido porque cada
// jugador puede llevar un mazo distinto, y todavia no gestionamos jugadores).
tournamentSchema.pre('validate', function(next) {
  if (this.mode === 'tracked') {
    if (!this.structure) {
      return next(new Error('El campo structure es obligatorio en torneos de modo "tracked"'));
    }
    if (!this.deckId) {
      return next(new Error('El campo deckId es obligatorio en torneos de modo "tracked"'));
    }
  }
  next();
});

module.exports = mongoose.model('Tournament', tournamentSchema);
