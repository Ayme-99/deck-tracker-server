const sgMail = require('@sendgrid/mail');

// Issue #268: envio de correos via SendGrid (API HTTP, puerto 443).
// Render bloquea/restringe las conexiones SMTP salientes (probado con
// Gmail SMTP: la conexion se quedaba colgada hasta dar timeout), asi que
// hace falta un proveedor que envie via API en vez de SMTP puro.
//
// EMAIL_FROM debe ser una direccion verificada en SendGrid (Single Sender
// Verification) -- sin dominio propio, es la unica forma de poder enviar
// a cualquier destinatario real y no solo a la cuenta del propio remitente.
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  initialized = true;
}

async function sendVerificationEmail(toEmail, username, token) {
  ensureInitialized();
  const baseUrl = process.env.SERVER_BASE_URL || 'http://localhost:5000';
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  await sgMail.send({
    to: toEmail,
    from: process.env.EMAIL_FROM,
    subject: 'Verifica tu email en Deck Tracker',
    html: `
      <p>Hola ${username},</p>
      <p>Confirma tu email para verificar tu cuenta de Deck Tracker:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Si no has creado esta cuenta, puedes ignorar este correo.</p>
    `
  });
}

module.exports = { sendVerificationEmail };
