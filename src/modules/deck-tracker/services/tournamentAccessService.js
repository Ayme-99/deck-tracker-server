const Tournament = require('../models/Tournament');
const TournamentPlayer = require('../models/TournamentPlayer');

// Issue server#102: hasta ahora, un torneo solo era visible/accesible para
// su dueño (Tournament.userId). Un usuario invitado a un torneo hosted
// (TournamentPlayer.linkedUserId, server#94/#95) tambien debe poder
// CONSULTARLO -- no editarlo, ni gestionar jugadores, ni registrar
// resultados de otros, solo verlo. Se usa exclusivamente en los endpoints
// de solo lectura; el resto de controllers de torneos siguen exigiendo
// ser el dueño tal cual (Tournament.findOne({_id, userId})).
async function findReadableTournament(tournamentId, userId) {
  const tournament = await Tournament.findOne({ _id: tournamentId, userId });
  if (tournament) return tournament;

  const linkedPlayer = await TournamentPlayer.findOne({ tournamentId, linkedUserId: userId });
  if (!linkedPlayer) return null;

  return Tournament.findById(tournamentId);
}

module.exports = { findReadableTournament };
