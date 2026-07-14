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

module.exports = router;