// Exportar/importar un torneo hosted completo entre usuarios (issue #115:
// extraido de tournamentController.js).

const Tournament = require('../../models/Tournament');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');

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
