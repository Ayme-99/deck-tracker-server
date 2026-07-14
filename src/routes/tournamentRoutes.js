const express = require('express');
const router = express.Router();
const tournamentController = require('../controllers/tournamentController');
const protect = require('../middleware/authMiddleware');

router.use(protect); // aplica el middleware a TODAS las rutas de este archivo

router.get('/', tournamentController.getTournaments);
router.get('/:id', tournamentController.getTournamentById);
router.post('/', tournamentController.createTournament);
router.put('/:id', tournamentController.updateTournament);
router.delete('/:id', tournamentController.deleteTournament);
router.post('/:id/standing', tournamentController.addStandingSnapshot);
router.get('/:id/summary', tournamentController.getTournamentSummary);
router.post('/:id/swiss-round', tournamentController.generateSwissRound);
router.get('/:id/hosted-standings', tournamentController.getHostedStandings);
router.post('/:id/players', tournamentController.createPlayer);
router.get('/:id/players', tournamentController.getPlayers);
router.put('/:id/players/:playerId', tournamentController.updatePlayer);
router.delete('/:id/players/:playerId', tournamentController.deletePlayer);
router.put('/:id/hosted-matches/:matchId/result', tournamentController.registerMatchResult);
router.post('/:id/elimination-bracket', tournamentController.generateEliminationBracket);
router.post('/:id/assign-groups', tournamentController.assignPlayerGroups);
router.post('/:id/group-stage-rounds', tournamentController.generateGroupStageRounds);
router.post('/:id/groups-elimination-entry', tournamentController.generateGroupsEliminationEntry);
router.post('/:id/league-rounds', tournamentController.generateLeagueRounds);
router.post('/:id/close-phase', tournamentController.closePhaseToElimination);

module.exports = router;