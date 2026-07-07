const mongoose = require('mongoose');
const dns = require('dns');

// Fuerza el uso de DNS de Google, evita problemas de resolucion SRV en algunas redes/Windows
dns.setServers(['8.8.8.8', '8.8.4.4']);

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB conectado');
  } catch (error) {
    console.error('Error al conectar MongoDB:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;