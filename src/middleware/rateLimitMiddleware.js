const rateLimit = require('express-rate-limit');

// Limite estricto para login/registro: previene fuerza bruta y spam de cuentas
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // ventana de 15 minutos
  max: 10, // maximo 10 intentos por IP en esa ventana
  message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' },
  standardHeaders: true, // incluye info de limite en los headers RateLimit-*
  legacyHeaders: false, // desactiva los headers X-RateLimit-* antiguos
});

module.exports = { authLimiter };