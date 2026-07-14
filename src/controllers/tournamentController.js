const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const mongoose = require('mongoose');
const TournamentPlayer = require('../models/TournamentPlayer');
const TournamentMatch = require('../models/TournamentMatch');
const { generateSwissPairings } = require('../services/swissPairingService');
const { generateBracket } = require('../services/eliminationPairingService');
const { assignGroups, calculateEliminationEntry } = require('../services/groupsEliminationService');
const { calculateOMW } = require('../services/tiebreakerService');
const { generateRoundRobinSchedule } = require('../services/roundRobinService');

exports.getTournaments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [tournaments, total] = await Promise.all([
      Tournament.find({ userId: req.userId })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      Tournament.countDocuments({ userId: req.userId })
    ]);

    res.json({
      data: tournaments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTournamentById = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    // Partidas del torneo, agrupadas visualmente por fase/ronda en el propio
    // orden de llegada (el front se encarga de agruparlas si lo necesita)
    const matches = await Match.find({ tournamentId: tournament._id, userId: req.userId })
      .sort({ phase: 1, round: 1, playedAt: 1 });

    res.json({ ...tournament.toObject(), matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createTournament = async (req, res) => {
  try {
    const tournament = new Tournament({ ...req.body, userId: req.userId });
    await tournament.save();
    res.status(201).json(tournament);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
    res.json(tournament);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    // A diferencia del borrado de mazos, aqui NO se borran las partidas en
    // cascada: quedan como partidas sueltas (se limpia su referencia al
    // torneo) para no perder historial ni stats del mazo.
    const { modifiedCount } = await Match.updateMany(
      { tournamentId: tournament._id, userId: req.userId },
      { $set: { tournamentId: null, phase: null, round: null } }
    );

    res.json({
      message: 'Torneo eliminado correctamente',
      unlinkedMatches: modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Añade un snapshot manual de puntos/posición (solo tiene sentido cuando
// structure es 'league', ya que ahi no hay forma de calcular la clasificacion
// a partir de los matches propios: hace falta que el usuario la introduzca
// a mano cuando quiera)
exports.addStandingSnapshot = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    if (tournament.structure !== 'league') {
      return res.status(400).json({ error: 'Los snapshots de standing solo aplican a torneos de tipo "league"' });
    }

    const { points, position, notes } = req.body;
    tournament.standingSnapshots.push({ points, position, notes });
    await tournament.save();

    res.status(201).json(tournament);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Resumen W-L-T del torneo, global y desglosado por fase
exports.getTournamentSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await Tournament.findOne({ _id: id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const byPhase = await Match.aggregate([
      { $match: { tournamentId: new mongoose.Types.ObjectId(id), userId: req.userId } },
      {
        $group: {
          _id: '$phase',
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          ties: { $sum: { $cond: [{ $eq: ['$result', 'tie'] }, 1, 0] } }
        }
      },
      {
        $project: {
          _id: 0,
          phase: '$_id',
          totalMatches: 1,
          wins: 1,
          losses: 1,
          ties: 1,
          winRate: {
            $round: [{ $multiply: [{ $divide: ['$wins', '$totalMatches'] }, 100] }, 1]
          }
        }
      },
      { $sort: { phase: 1 } }
    ]);

    // El global se calcula sumando el desglose por fase, en vez de lanzar
    // una segunda query, ya que byPhase ya cubre todas las partidas del torneo
    const overall = byPhase.reduce((acc, phase) => ({
      totalMatches: acc.totalMatches + phase.totalMatches,
      wins: acc.wins + phase.wins,
      losses: acc.losses + phase.losses,
      ties: acc.ties + phase.ties
    }), { totalMatches: 0, wins: 0, losses: 0, ties: 0 });

    overall.winRate = overall.totalMatches > 0
      ? Math.round((overall.wins / overall.totalMatches) * 1000) / 10
      : 0;

    res.json({ overall, byPhase });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Modo hosted (issue #21) ---

// Genera la siguiente ronda swiss: empareja jugadores activos (no dropped)
// segun puntos, evitando repetir rivales, y crea los TournamentMatch
// correspondientes. Actualiza opponentIds/byeReceived de los jugadores.
exports.generateSwissRound = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const activePlayers = await TournamentPlayer.find({
      tournamentId: tournament._id,
      dropped: false
    });

    if (activePlayers.length < 2) {
      return res.status(400).json({ error: 'Hacen falta al menos 2 jugadores activos para emparejar una ronda' });
    }

    // Adapta los documentos de Mongoose al formato plano que espera el
    // servicio de pairing (logica pura, sin dependencia de Mongoose)
    const playersForPairing = activePlayers.map((p) => ({
      id: p._id.toString(),
      points: p.points,
      opponentIds: p.opponentIds.map((id) => id.toString()),
      byeReceived: p.byeReceived
    }));

    const { pairings } = generateSwissPairings(playersForPairing);

    // Siguiente numero de ronda para la fase swiss de este torneo
    const existingSwissMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase: 'swiss' });
    const nextRound = existingSwissMatches.length > 0
      ? Math.max(...existingSwissMatches.map((m) => m.round || 0)) + 1
      : 1;

    const createdMatches = [];
    for (const pairing of pairings) {
      const match = await TournamentMatch.create({
        tournamentId: tournament._id,
        phase: 'swiss',
        round: nextRound,
        player1Id: pairing.player1Id,
        player2Id: pairing.player2Id,
        // Un bye se resuelve automaticamente como victoria del jugador 1,
        // sin necesidad de que el organizador registre resultado
        status: pairing.player2Id === null ? 'completed' : 'pending',
        winnerId: pairing.player2Id === null ? pairing.player1Id : null
      });
      createdMatches.push(match);

      // Actualiza opponentIds (evitar repetir rival) y byeReceived
      if (pairing.player2Id) {
        await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, { $addToSet: { opponentIds: pairing.player2Id } });
        await TournamentPlayer.findByIdAndUpdate(pairing.player2Id, { $addToSet: { opponentIds: pairing.player1Id } });
      } else {
        await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, {
          byeReceived: true,
          $inc: { points: 3, wins: 1 }
        });
      }
    }

    res.status(201).json({ round: nextRound, matches: createdMatches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Clasificacion del torneo hosted. Orden: points desc, prizeDifferential
// desc (1er criterio), omwPercentage desc (2º criterio, issue #45).
// Jugadores empatados en los 3 criterios comparten posicion.
exports.getHostedStandings = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id });

    const omwMap = calculateOMW(players.map((p) => ({
      id: p._id.toString(),
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      opponentIds: p.opponentIds.map((id) => id.toString())
    })));

    const sorted = [...players].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.prizeDifferential !== a.prizeDifferential) return b.prizeDifferential - a.prizeDifferential;
      return omwMap.get(b._id.toString()) - omwMap.get(a._id.toString());
    });

    let last = null;
    let lastPosition = 0;

    const standings = sorted.map((p, index) => {
      const omwPercentage = omwMap.get(p._id.toString());
      const tiedWithPrevious = last
        && p.points === last.points
        && p.prizeDifferential === last.prizeDifferential
        && omwPercentage === last.omwPercentage;
      const position = tiedWithPrevious ? lastPosition : index + 1;
      last = { points: p.points, prizeDifferential: p.prizeDifferential, omwPercentage };
      lastPosition = position;

      return {
        position,
        playerId: p._id,
        name: p.name,
        deckArchetype: p.deckArchetype,
        points: p.points,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        prizeDifferential: p.prizeDifferential,
        omwPercentage: Math.round(omwPercentage * 1000) / 10, // 0-100, 1 decimal
        dropped: p.dropped
      };
    });

    res.json({ standings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Jugadores (hosted) ---

exports.createPlayer = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const player = new TournamentPlayer({ ...req.body, tournamentId: tournament._id });
    await player.save();
    res.status(201).json(player);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getPlayers = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id }).sort({ name: 1 });
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePlayer = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const player = await TournamentPlayer.findOneAndUpdate(
      { _id: req.params.playerId, tournamentId: tournament._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(player);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deletePlayer = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    // No se borran en cascada los TournamentMatch ya jugados por este
    // jugador -- quedan como historial, igual que al borrar un torneo
    // tracked no se borran sus Match.
    const player = await TournamentPlayer.findOneAndDelete({
      _id: req.params.playerId,
      tournamentId: tournament._id
    });
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json({ message: 'Jugador eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Resultados (hosted) ---

// Registra el resultado de un TournamentMatch: actualiza el match, los
// puntos/W-L-D/prizeDifferential de ambos jugadores, y si alguno de los
// dos es el organizador (isOrganizer), genera automaticamente un Match
// normal vinculado a su deckId real para que cuente en sus stats.
exports.registerMatchResult = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const tMatch = await TournamentMatch.findOne({ _id: req.params.matchId, tournamentId: tournament._id });
    if (!tMatch) return res.status(404).json({ error: 'Partida no encontrada' });

    const { player1Prizes, player2Prizes, winnerId, isDraw } = req.body;

    tMatch.player1Prizes = player1Prizes;
    tMatch.player2Prizes = player2Prizes;
    tMatch.isDraw = !!isDraw;
    tMatch.winnerId = isDraw ? null : winnerId;
    tMatch.status = 'completed';
    await tMatch.save();

    const player1 = await TournamentPlayer.findById(tMatch.player1Id);
    const player2 = await TournamentPlayer.findById(tMatch.player2Id);

    const diff1 = (player1Prizes || 0) - (player2Prizes || 0);
    const diff2 = -diff1;

    if (isDraw) {
      player1.draws += 1;
      player2.draws += 1;
      player1.points += 1;
      player2.points += 1;
    } else if (String(winnerId) === String(player1._id)) {
      player1.wins += 1;
      player1.points += 3;
      player2.losses += 1;
    } else {
      player2.wins += 1;
      player2.points += 3;
      player1.losses += 1;
    }
    player1.prizeDifferential += diff1;
    player2.prizeDifferential += diff2;
    await player1.save();
    await player2.save();

    // Si alguno de los dos es el organizador, genera un Match real
    // (modelo de tracked) vinculado a su deckId, para que cuente en sus
    // stats/rachas/matchups sin tener que registrarlo dos veces a mano
    const createMatchIfOrganizer = async (self, opponent, ownPrizes, opponentPrizes) => {
      if (!self.isOrganizer || !self.deckId) return;
      await Match.create({
        deckId: self.deckId,
        userId: req.userId,
        opponentDeck: opponent.deckArchetype || opponent.name,
        userPrizes: ownPrizes,
        opponentPrizes: opponentPrizes,
        endReason: 'normal',
        tournamentId: tournament._id,
        phase: tMatch.phase,
        round: tMatch.round
      });
    };
    await createMatchIfOrganizer(player1, player2, player1Prizes, player2Prizes);
    await createMatchIfOrganizer(player2, player1, player2Prizes, player1Prizes);

    res.json({ match: tMatch, player1, player2 });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Genera el bracket inicial de eliminatoria directa (issue #42).
// body: { playerIds: [...], seeded: bool } -- playerIds ya debe venir en el
// orden deseado (por standing si seeded=true, o cualquier orden si false,
// ya que el shuffle se aplica internamente).
// Respeta tournament.eliminationFormat (single_match / two_legs): a doble
// partido crea first_leg + second_leg enlazados via tiedMatchId.
exports.generateEliminationBracket = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { playerIds, seeded } = req.body;
    const { phase, pairings } = generateBracket(playerIds, { seeded: !!seeded });

    const createdMatches = [];
    for (const pairing of pairings) {
      if (tournament.eliminationFormat === 'two_legs') {
        const firstLeg = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          player1Id: pairing.player1Id,
          player2Id: pairing.player2Id,
          leg: 'first_leg'
        });
        const secondLeg = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          // vuelta: se invierten local/visitante, pero a efectos de
          // agregado solo importa la suma de premios de cada jugador
          player1Id: pairing.player2Id,
          player2Id: pairing.player1Id,
          leg: 'second_leg',
          tiedMatchId: firstLeg._id
        });
        firstLeg.tiedMatchId = secondLeg._id;
        await firstLeg.save();
        createdMatches.push(firstLeg, secondLeg);
      } else {
        const match = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          player1Id: pairing.player1Id,
          player2Id: pairing.player2Id,
          leg: 'single'
        });
        createdMatches.push(match);
      }
    }

    res.status(201).json({ phase, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Grupos + Eliminacion (issue #43) ---

// Reparte los jugadores del torneo en grupos (body: { groupSize }) y guarda
// el grupo asignado en cada TournamentPlayer.groupName ("Grupo 1", "Grupo 2"...)
exports.assignPlayerGroups = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const playerIds = players.map((p) => p._id.toString());
    const groups = assignGroups(playerIds, req.body.groupSize);

    for (let i = 0; i < groups.length; i++) {
      const groupName = `Grupo ${i + 1}`;
      await TournamentPlayer.updateMany(
        { _id: { $in: groups[i] } },
        { groupName }
      );
    }

    res.json({ groups: groups.map((ids, i) => ({ groupName: `Grupo ${i + 1}`, playerIds: ids })) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Genera el calendario round-robin (todos contra todos) dentro de cada
// grupo ya asignado, creando los TournamentMatch de phase: 'group_stage'
exports.generateGroupStageRounds = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const groupNames = [...new Set(players.map((p) => p.groupName).filter(Boolean))];
    if (groupNames.length === 0) {
      return res.status(400).json({ error: 'Los jugadores no tienen grupo asignado todavia (ver assignPlayerGroups)' });
    }

    const createdMatches = [];
    for (const groupName of groupNames) {
      const groupPlayerIds = players.filter((p) => p.groupName === groupName).map((p) => p._id.toString());
      const schedule = generateRoundRobinSchedule(groupPlayerIds);

      for (let roundIndex = 0; roundIndex < schedule.length; roundIndex++) {
        for (const pairing of schedule[roundIndex]) {
          const match = await TournamentMatch.create({
            tournamentId: tournament._id,
            phase: 'group_stage',
            round: roundIndex + 1,
            player1Id: pairing.player1Id,
            player2Id: pairing.player2Id,
            status: pairing.player2Id === null ? 'completed' : 'pending',
            winnerId: pairing.player2Id === null ? pairing.player1Id : null
          });
          createdMatches.push(match);

          if (pairing.player2Id === null) {
            await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, { $inc: { points: 3, wins: 1 } });
          }
        }
      }
    }

    res.status(201).json({ matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Calcula la entrada a la fase eliminatoria a partir de los clasificados
// (body: { classifiedIds: [...] }, ya ordenados de mejor a peor seed) y
// crea los TournamentMatch: byes directos (completados) + ronda previa
// reducida si el nº de clasificados no es potencia de 2.
exports.generateGroupsEliminationEntry = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { classifiedIds } = req.body;
    const result = await createEliminationEntryMatches(tournament, classifiedIds);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Liga (issue #44) ---

// Genera el calendario round-robin completo de la liga (phase: 'league_round').
// Si tournament.leagueDoubleRound es true, añade una segunda vuelta con
// local/visitante invertidos, continuando la numeracion de rondas.
exports.generateLeagueRounds = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const playerIds = players.map((p) => p._id.toString());

    const firstLegSchedule = generateRoundRobinSchedule(playerIds);
    let fullSchedule = firstLegSchedule;

    if (tournament.leagueDoubleRound) {
      // Vuelta: mismos enfrentamientos con local/visitante invertidos
      const secondLegSchedule = firstLegSchedule.map((round) =>
        round.map((pairing) => ({
          player1Id: pairing.player2Id,
          player2Id: pairing.player1Id
        }))
      );
      fullSchedule = [...firstLegSchedule, ...secondLegSchedule];
    }

    const createdMatches = [];
    for (let roundIndex = 0; roundIndex < fullSchedule.length; roundIndex++) {
      for (const pairing of fullSchedule[roundIndex]) {
        // Un bye de round-robin (jugador impar) puede quedar como null tras
        // invertir player1/player2 en la vuelta -- se preserva igual que
        // en la ida, marcando victoria automatica sin partida que jugar.
        const match = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase: 'league_round',
          round: roundIndex + 1,
          player1Id: pairing.player1Id || pairing.player2Id,
          player2Id: pairing.player1Id ? pairing.player2Id : null,
          status: (pairing.player1Id && pairing.player2Id) ? 'pending' : 'completed',
          winnerId: (pairing.player1Id && pairing.player2Id) ? null : (pairing.player1Id || pairing.player2Id)
        });
        createdMatches.push(match);

        if (!pairing.player1Id || !pairing.player2Id) {
          const byePlayerId = pairing.player1Id || pairing.player2Id;
          await TournamentPlayer.findByIdAndUpdate(byePlayerId, { $inc: { points: 3, wins: 1 } });
        }
      }
    }

    res.status(201).json({ totalRounds: fullSchedule.length, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Transicion de fase (issue #24) ---

// Crea las partidas (byes + ronda previa si aplica) para la entrada a la
// fase eliminatoria, respetando tournament.eliminationFormat (single_match
// / two_legs) en la ronda previa. Reutilizada por swiss_elimination y
// groups_elimination -- ambas comparten la misma logica de entrada.
async function createEliminationEntryMatches(tournament, classifiedIds) {
  const { targetPhase, byeIds, preliminary } = calculateEliminationEntry(classifiedIds);
  const createdMatches = [];

  for (const playerId of byeIds) {
    const match = await TournamentMatch.create({
      tournamentId: tournament._id,
      phase: targetPhase,
      player1Id: playerId,
      player2Id: null,
      status: 'completed',
      winnerId: playerId
    });
    createdMatches.push(match);
  }

  if (preliminary) {
    for (const pairing of preliminary.pairings) {
      if (tournament.eliminationFormat === 'two_legs') {
        const firstLeg = await TournamentMatch.create({
          tournamentId: tournament._id, phase: preliminary.phase,
          player1Id: pairing.player1Id, player2Id: pairing.player2Id, leg: 'first_leg'
        });
        const secondLeg = await TournamentMatch.create({
          tournamentId: tournament._id, phase: preliminary.phase,
          player1Id: pairing.player2Id, player2Id: pairing.player1Id,
          leg: 'second_leg', tiedMatchId: firstLeg._id
        });
        firstLeg.tiedMatchId = secondLeg._id;
        await firstLeg.save();
        createdMatches.push(firstLeg, secondLeg);
      } else {
        const match = await TournamentMatch.create({
          tournamentId: tournament._id, phase: preliminary.phase,
          player1Id: pairing.player1Id, player2Id: pairing.player2Id, leg: 'single'
        });
        createdMatches.push(match);
      }
    }
  }

  return { targetPhase, preliminaryPhase: preliminary?.phase || null, matches: createdMatches };
}

// Cierra la fase de swiss o grupos y genera la entrada a la fase eliminatoria.
// body: { topCut } para swiss_elimination, { qualifiersPerGroup } para
// groups_elimination. El orden de seeding sale del standing real (puntos +
// prizeDifferential), no de un orden arbitrario.
exports.closePhaseToElimination = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    if (!['swiss_elimination', 'groups_elimination'].includes(tournament.structure)) {
      return res.status(400).json({ error: 'Esta accion solo aplica a swiss_elimination o groups_elimination' });
    }

    let classifiedIds;

    if (tournament.structure === 'swiss_elimination') {
      const { topCut } = req.body;
      const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false })
        .sort({ points: -1, prizeDifferential: -1 });
      classifiedIds = players.slice(0, topCut).map((p) => p._id.toString());
    } else {
      const { qualifiersPerGroup } = req.body;
      const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false })
        .sort({ points: -1, prizeDifferential: -1 });

      const groupNames = [...new Set(players.map((p) => p.groupName).filter(Boolean))];
      let qualifiers = [];
      for (const groupName of groupNames) {
        const groupPlayers = players.filter((p) => p.groupName === groupName);
        qualifiers.push(...groupPlayers.slice(0, qualifiersPerGroup));
      }
      // Reordena el conjunto combinado de clasificados de todos los grupos
      // por standing real, para que el seeding de la eliminatoria sea justo
      qualifiers.sort((a, b) => b.points - a.points || b.prizeDifferential - a.prizeDifferential);
      classifiedIds = qualifiers.map((p) => p._id.toString());
    }

    const result = await createEliminationEntryMatches(tournament, classifiedIds);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Exportar / Importar (issue #46) ---

// Exporta el torneo completo (Tournament + todos los TournamentPlayer +
// todos los TournamentMatch) a un JSON que otro usuario pueda importar.
// Se incluyen los _id originales solo para poder remapear las relaciones
// (opponentIds, player1Id/2Id, winnerId, tiedMatchId) durante la importacion;
// no tienen validez fuera de este documento exportado.
exports.exportTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id });
    const matches = await TournamentMatch.find({ tournamentId: tournament._id });

    res.json({
      tournament: {
        name: tournament.name,
        format: tournament.format,
        date: tournament.date,
        location: tournament.location,
        structure: tournament.structure,
        status: tournament.status,
        eliminationFormat: tournament.eliminationFormat,
        thirdPlacePlayoff: tournament.thirdPlacePlayoff,
        leagueDoubleRound: tournament.leagueDoubleRound,
        notes: tournament.notes
      },
      players: players.map((p) => ({
        _id: p._id,
        name: p.name,
        deckArchetype: p.deckArchetype,
        dropped: p.dropped,
        points: p.points,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        prizeDifferential: p.prizeDifferential,
        opponentIds: p.opponentIds,
        byeReceived: p.byeReceived,
        groupName: p.groupName
        // isOrganizer/deckId NO se exportan: son propios de quien exporta,
        // sin sentido para quien importa (vera esa inscripcion como un
        // jugador normal, salvo que la marque como "yo" al importar)
      })),
      matches: matches.map((m) => ({
        _id: m._id,
        phase: m.phase,
        round: m.round,
        player1Id: m.player1Id,
        player2Id: m.player2Id,
        winnerId: m.winnerId,
        status: m.status,
        notes: m.notes,
        player1Prizes: m.player1Prizes,
        player2Prizes: m.player2Prizes,
        isDraw: m.isDraw,
        leg: m.leg,
        tiedMatchId: m.tiedMatchId
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Importa un torneo exportado por otro usuario. body: { data, selfPlayerId?,
// selfDeckId? }. Si se indica selfPlayerId (el _id ORIGINAL del jugador que
// eres tu dentro del JSON exportado), esa inscripcion se marca isOrganizer y
// requiere selfDeckId (tu mazo real) -- el modelo exige deckId cuando
// isOrganizer es true.
exports.importTournament = async (req, res) => {
  try {
    const { data, selfPlayerId, selfDeckId } = req.body;
    if (selfPlayerId && !selfDeckId) {
      return res.status(400).json({ error: 'selfDeckId es obligatorio si se indica selfPlayerId' });
    }

    const newTournament = await Tournament.create({
      ...data.tournament,
      mode: 'hosted',
      userId: req.userId
    });

    // 1ª pasada: crear jugadores, guardando el mapeo id-original -> id-nuevo
    const playerIdMap = new Map();
    for (const p of data.players) {
      const isSelf = selfPlayerId && String(p._id) === String(selfPlayerId);
      const newPlayer = await TournamentPlayer.create({
        tournamentId: newTournament._id,
        name: p.name,
        deckArchetype: p.deckArchetype,
        dropped: p.dropped,
        points: p.points,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        prizeDifferential: p.prizeDifferential,
        byeReceived: p.byeReceived,
        groupName: p.groupName,
        isOrganizer: !!isSelf,
        deckId: isSelf ? selfDeckId : null
      });
      playerIdMap.set(String(p._id), newPlayer._id);
    }

    // 2ª pasada: remapear opponentIds (dependen de que todos los jugadores ya existan)
    for (const p of data.players) {
      const remapped = p.opponentIds.map((oid) => playerIdMap.get(String(oid))).filter(Boolean);
      await TournamentPlayer.findByIdAndUpdate(playerIdMap.get(String(p._id)), { opponentIds: remapped });
    }

    // 1ª pasada: crear partidas remapeando player1Id/player2Id/winnerId
    const matchIdMap = new Map();
    for (const m of data.matches) {
      const newMatch = await TournamentMatch.create({
        tournamentId: newTournament._id,
        phase: m.phase,
        round: m.round,
        player1Id: playerIdMap.get(String(m.player1Id)),
        player2Id: m.player2Id ? playerIdMap.get(String(m.player2Id)) : null,
        winnerId: m.winnerId ? playerIdMap.get(String(m.winnerId)) : null,
        status: m.status,
        notes: m.notes,
        player1Prizes: m.player1Prizes,
        player2Prizes: m.player2Prizes,
        isDraw: m.isDraw,
        leg: m.leg
      });
      matchIdMap.set(String(m._id), newMatch._id);
    }

    // 2ª pasada: remapear tiedMatchId (depende de que todas las partidas ya existan)
    for (const m of data.matches) {
      if (m.tiedMatchId) {
        const newTied = matchIdMap.get(String(m.tiedMatchId));
        if (newTied) {
          await TournamentMatch.findByIdAndUpdate(matchIdMap.get(String(m._id)), { tiedMatchId: newTied });
        }
      }
    }

    res.status(201).json({
      tournament: newTournament,
      playersCreated: playerIdMap.size,
      matchesCreated: matchIdMap.size
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};