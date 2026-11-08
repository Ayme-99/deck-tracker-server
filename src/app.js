require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const deckRoutes = require('./modules/deck-tracker/routes/deckRoutes');
const matchRoutes = require('./modules/deck-tracker/routes/matchRoutes');
const authRoutes = require('./modules/usuarios/routes/authRoutes');
const statsRoutes = require('./modules/deck-tracker/routes/statsRoutes');
const pokemonRoutes = require('./modules/deck-tracker/routes/pokemonRoutes');
const opponentArchetypeRoutes = require('./modules/deck-tracker/routes/opponentArchetypeRoutes');
const tournamentRoutes = require('./modules/deck-tracker/routes/tournamentRoutes');
const cardCatalogRoutes = require('./modules/deck-tracker/routes/cardCatalogRoutes');
const friendRoutes = require('./modules/usuarios/routes/friendRoutes');
const tournamentInviteRoutes = require('./modules/deck-tracker/routes/tournamentInviteRoutes');
const montarIncursiones = require('./modules/tcg-raid-battles/montar');

const app = express();
connectDB();

// Render (y la mayoria de PaaS) ponen la app detras de un proxy inverso,
// que reenvia la IP real del cliente via X-Forwarded-For. Sin esto,
// express-rate-limit no confia en esa cabecera y no puede identificar
// bien a cada cliente para el limite de peticiones (ver auth routes).
app.set('trust proxy', 1);

app.use(cors());
// Issue #269: el limite por defecto (100kb) de express.json() no basta
// para el avatar en base64. Este middleware especifico para la ruta del
// avatar tiene que ir ANTES del express.json() global -- si no, el global
// (sin path, coincide con toda peticion) intercepta el body primero con su
// limite de 100kb y devuelve 413 antes de que este llegue a aplicarse.
app.use('/api/auth/change-avatar', express.json({ limit: '2mb' }));
// Incursiones: un registro de partida lleva todos los eventos y puede pasar
// de 100kb. Igual que con el avatar, este limite tiene que ir ANTES del
// express.json() global.
app.use('/api/incursiones', express.json({ limit: '1mb' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/decks', deckRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/pokemon', pokemonRoutes);
app.use('/api/opponent-archetypes', opponentArchetypeRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/cards', cardCatalogRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/tournament-invites', tournamentInviteRoutes);
app.use('/api/incursiones', montarIncursiones());

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));