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

// player.wins/losses/points/prizeDifferential son acumulados de TODO el
// torneo (issue #205: en groups_elimination, una vez se pasa a la
// eliminatoria esos contadores se siguen incrementando, mezclando resultados
// de fase de grupos con los de bracket -- la clasificacion por grupo dejaba
// de tener sentido). Para esa estructura, se recalculan las stats de cada
// jugador solo a partir de las partidas completadas de 'group_stage',
// ignorando los contadores acumulados del documento.
async function computeGroupStageStats(tournamentId, players) {
  const matches = await TournamentMatch.find({
    tournamentId,
    phase: 'group_stage',
    status: 'completed'
  });

  const statsByPlayer = new Map(players.map((p) => [
    p._id.toString(),
    { wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, opponentIds: [] }
  ]));

  for (const match of matches) {
    const id1 = match.player1Id.toString();
    const id2 = match.player2Id?.toString();
    if (!id2) continue; // bye: no cuenta para OMW ni enfrentamientos
    const s1 = statsByPlayer.get(id1);
    const s2 = statsByPlayer.get(id2);
    if (!s1 || !s2) continue; // jugador borrado desde entonces

    s1.opponentIds.push(id2);
    s2.opponentIds.push(id1);

    const diff = (match.player1Prizes || 0) - (match.player2Prizes || 0);
    s1.prizeDifferential += diff;
    s2.prizeDifferential -= diff;

    if (match.isDraw) {
      s1.draws += 1;
      s2.draws += 1;
      s1.points += 1;
      s2.points += 1;
    } else if (String(match.winnerId) === id1) {
      s1.wins += 1;
      s1.points += 3;
      s2.losses += 1;
    } else {
      s2.wins += 1;
      s2.points += 3;
      s1.losses += 1;
    }
  }

  return statsByPlayer;
}

exports.getHostedStandings = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id });

    const groupStageStats = tournament.structure === 'groups_elimination'
      ? await computeGroupStageStats(tournament._id, players)
      : null;

    const statsFor = (p) => groupStageStats?.get(p._id.toString()) ?? {
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      points: p.points,
      prizeDifferential: p.prizeDifferential,
      opponentIds: p.opponentIds.map((id) => id.toString())
    };

    const omwMap = calculateOMW(players.map((p) => {
      const stats = statsFor(p);
      return { id: p._id.toString(), wins: stats.wins, losses: stats.losses, draws: stats.draws, opponentIds: stats.opponentIds };
    }));

    const sorted = [...players].sort((a, b) => {
      const statsA = statsFor(a);
      const statsB = statsFor(b);
      if (statsB.points !== statsA.points) return statsB.points - statsA.points;
      if (statsB.prizeDifferential !== statsA.prizeDifferential) return statsB.prizeDifferential - statsA.prizeDifferential;
      return omwMap.get(b._id.toString()) - omwMap.get(a._id.toString());
    });

    let last = null;
    let lastPosition = 0;

    const standings = sorted.map((p, index) => {
      const stats = statsFor(p);
      const omwPercentage = omwMap.get(p._id.toString());
      const tiedWithPrevious = last
        && stats.points === last.points
        && stats.prizeDifferential === last.prizeDifferential
        && omwPercentage === last.omwPercentage;
      const position = tiedWithPrevious ? lastPosition : index + 1;
      last = { points: stats.points, prizeDifferential: stats.prizeDifferential, omwPercentage };
      lastPosition = position;

      return {
        position,
        playerId: p._id,
        name: p.name,
        deckArchetype: p.deckArchetype,
        points: stats.points,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        prizeDifferential: stats.prizeDifferential,
        omwPercentage: Math.round(omwPercentage * 1000) / 10, // 0-100, 1 decimal
        dropped: p.dropped,
        groupName: p.groupName
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
