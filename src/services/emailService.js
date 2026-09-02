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
      <div style="max-width:480px;margin:0 auto;padding:32px 24px;background:#1a1d24;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e8eaed;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1e88e5;">🃏 Deck Tracker</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">Hola <strong>${username}</strong>,</p>
        <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#b0b3b8;">
          Confirma tu email para verificar tu cuenta y asegurarla del todo.
        </p>
        <a href="${verifyUrl}"
           style="display:inline-block;padding:12px 28px;background:#1e88e5;color:#ffffff;
                  text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
          Verificar mi email
        </a>
        <p style="font-size:12px;line-height:1.5;margin:24px 0 0;color:#7a7d85;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
          <a href="${verifyUrl}" style="color:#7a7d85;">${verifyUrl}</a>
        </p>
        <p style="font-size:12px;line-height:1.5;margin:16px 0 0;color:#7a7d85;">
          Si no has creado esta cuenta, puedes ignorar este correo.
        </p>
      </div>
    `
  });
}

module.exports = { sendVerificationEmail };
