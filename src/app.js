require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const deckRoutes = require('./routes/deckRoutes');
const matchRoutes = require('./routes/matchRoutes');
const authRoutes = require('./routes/authRoutes');
const statsRoutes = require('./routes/statsRoutes');
const pokemonRoutes = require('./routes/pokemonRoutes');
const opponentArchetypeRoutes = require('./routes/opponentArchetypeRoutes');

const app = express();
connectDB();

app.use(cors());
app.use(express.json());

app.use('/api/decks', deckRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/pokemon', pokemonRoutes);
app.use('/api/opponent-archetypes', opponentArchetypeRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));