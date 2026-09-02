const nodemailer = require('nodemailer');

// Issue #268: envio de correos via Gmail SMTP (contraseña de aplicacion,
// no la contraseña normal de la cuenta -- se genera en la configuracion
// de seguridad de Google). Sin dominio propio, es la opcion mas simple de
// montar: Resend/SendGrid exigen verificar un dominio para enviar a
// destinatarios reales.
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  return transporter;
}

async function sendVerificationEmail(toEmail, username, token) {
  const baseUrl = process.env.SERVER_BASE_URL || 'http://localhost:5000';
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  await getTransporter().sendMail({
    from: `"Deck Tracker" <${process.env.GMAIL_USER}>`,
    to: toEmail,
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
