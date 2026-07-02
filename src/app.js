require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const deckRoutes = require('./routes/deckRoutes');
const matchRoutes = require('./routes/matchRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
connectDB();

app.use(cors());
app.use(express.json());

app.use('/api/decks', deckRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));