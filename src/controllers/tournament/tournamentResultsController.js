// (issue #78: dividido a partir de tournamentRoundsController.js,
// que agrupaba TODO el modo hosted en un unico archivo de 670 lineas.
// Se separa por formato/dominio en vez de mantener un unico bucket
// de "rondas" -- ese bucket es justo el que se habia convertido en
// el nuevo monolito tras la Fase 3 original (#115/#76).

const Tournament = require('../../models/Tournament');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');
const Match = require('../../models/Match');
const { calculateOMW } = require('../../services/tiebreakerService');

// --- Resultados y clasificacion (transversal a todos los formatos) ---

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

exports.getHostedMatches = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const matches = await TournamentMatch.find({ tournamentId: tournament._id })
      .sort({ phase: 1, round: 1 });

    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
