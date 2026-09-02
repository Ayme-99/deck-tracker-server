const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendVerificationEmail } = require('../services/emailService');

// Issue #268: 24h de margen para que el enlace de verificacion no caduque
// demasiado rapido, pero sin dejarlo abierto indefinidamente.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Usuario, contraseña y email son requeridos' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'El email no es válido' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    }
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(400).json({ error: 'Ese email ya está en uso' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = new User({
      username,
      password,
      email,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)
    });
    await user.save();

    // Best-effort: si el envio falla (ej. credenciales SMTP mal
    // configuradas), la cuenta ya se ha creado igualmente -- el usuario
    // puede pedir que se reenvie el correo desde el perfil.
    try {
      await sendVerificationEmail(user.email, user.username, verificationToken);
    } catch (emailError) {
      console.error('Error al enviar el correo de verificación:', emailError.message);
    }

    const token = generateToken(user._id);
    res.status(201).json({ token, username: user.username, userId: user._id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('Enlace de verificación inválido.');
    }

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).send('El enlace de verificación no es válido o ha caducado. Pide que se reenvíe desde tu perfil en la app.');
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    res.send('¡Email verificado correctamente! Ya puedes volver a la app.');
  } catch (error) {
    res.status(500).send('Error al verificar el email.');
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!user.email) return res.status(400).json({ error: 'Tu cuenta no tiene un email asociado' });
    if (user.emailVerified) return res.status(400).json({ error: 'Tu email ya está verificado' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
    await user.save();

    await sendVerificationEmail(user.email, user.username, verificationToken);
    res.json({ message: 'Correo de verificación reenviado' });
  } catch (error) {
    console.error('Error al reenviar el correo de verificación:', error);
    res.status(500).json({ error: error.message });
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