const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendVerificationEmail } = require('../services/emailService');

// Issue #268: 24h de margen para que el enlace de verificacion no caduque
// demasiado rapido, pero sin dejarlo abierto indefinidamente.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Cooldown entre reenvios del correo de verificacion, independiente del
// rate limit por IP (que permite hasta 10 en 15 minutos -- demasiado para
// esto en concreto).
const RESEND_COOLDOWN_MS = 60 * 1000;

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
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      emailVerificationLastSentAt: new Date()
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

// Pagina HTML minima para el resultado de verificar el email (issue #268):
// quien hace clic en el enlace del correo llega aqui desde su navegador,
// no desde la app, asi que hace falta una pagina de verdad, no solo texto
// plano.
function verificationResultPage({ success, title, message }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deck Tracker</title>
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0f1115;
    color: #e8eaed;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .card {
    max-width: 420px;
    margin: 24px;
    padding: 32px 28px;
    background: #1a1d24;
    border-radius: 16px;
    text-align: center;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  }
  .icon { font-size: 48px; margin-bottom: 12px; }
  h1 { font-size: 20px; margin: 0 0 8px; color: ${success ? '#43a047' : '#e53935'}; }
  p { font-size: 15px; line-height: 1.5; color: #b0b3b8; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✅' : '⚠️'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(verificationResultPage({
        success: false,
        title: 'Enlace inválido',
        message: 'Este enlace de verificación no es válido.'
      }));
    }

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).send(verificationResultPage({
        success: false,
        title: 'Enlace caducado',
        message: 'Este enlace de verificación no es válido o ha caducado. Pide que se reenvíe desde tu perfil en la app.'
      }));
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    res.send(verificationResultPage({
      success: true,
      title: '¡Email verificado!',
      message: 'Tu cuenta de Deck Tracker ya está verificada. Ya puedes volver a la app.'
    }));
  } catch (error) {
    res.status(500).send(verificationResultPage({
      success: false,
      title: 'Error',
      message: 'No se ha podido verificar el email. Inténtalo de nuevo más tarde.'
    }));
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!user.email) return res.status(400).json({ error: 'Tu cuenta no tiene un email asociado' });
    if (user.emailVerified) return res.status(400).json({ error: 'Tu email ya está verificado' });

    if (user.emailVerificationLastSentAt) {
      const msSinceLastSend = Date.now() - user.emailVerificationLastSentAt.getTime();
      if (msSinceLastSend < RESEND_COOLDOWN_MS) {
        const secondsLeft = Math.ceil((RESEND_COOLDOWN_MS - msSinceLastSend) / 1000);
        return res.status(429).json({ error: `Espera ${secondsLeft}s antes de volver a pedir el correo`, secondsLeft });
      }
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
    user.emailVerificationLastSentAt = new Date();
    await user.save();

    await sendVerificationEmail(user.email, user.username, verificationToken);
    res.json({ message: 'Correo de verificación reenviado' });
  } catch (error) {
    console.error('Error al reenviar el correo de verificación:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'La contraseña actual y la nueva son requeridas' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Contraseña actualizada' });
  } catch (error) {
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