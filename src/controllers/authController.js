const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Caducidad de sesion (issue #82): antes los JWT no caducaban nunca.
// El middleware ya trataba TokenExpiredError como un 401 generico ("Token
// invalido o expirado"), y el cliente ya reacciona a cualquier 401 cerrando
// sesion (ver ApiService._handleSessionExpired), asi que anadir expiresIn
// es un cambio puramente aditivo, sin tocar nada mas.
//
// Se lee process.env en cada llamada (no en una constante de modulo) para
// que sea configurable sin reiniciar el proceso en tests/scripts.
const generateToken = (userId) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn });
};

exports.register = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    }

    const user = new User({ username, password });
    await user.save();

    const token = generateToken(user._id);
    res.status(201).json({ token, username: user.username, userId: user._id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = generateToken(user._id);
    res.json({ token, username: user.username, userId: user._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};