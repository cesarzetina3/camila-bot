const express = require('express');
const axios = require('axios');
const Stripe = require('stripe');
const app = express();
app.use(express.json());
 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'camila2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const STRIPE_KEY = process.env.STRIPE_KEY;
 
const stripe = Stripe(STRIPE_KEY);
 
// Sesiones en memoria — se limpian si Render reinicia (plan gratuito)
// Para persistencia real se recomienda Redis o una base de datos
const sessions = {};
 
// Tiempo máximo de inactividad antes de reiniciar sesión: 4 horas
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
 
const PRECIOS_CHIRIMOYA = [
  { nombre: 'Tratamiento Cabello Corto', precio: 599 },
  { nombre: 'Tratamiento Cabello Mediano', precio: 699 },
  { nombre: 'Tratamiento Cabello Largo', precio: 799 },
  { nombre: 'Shampoo Repelente', precio: 150 },
  { nombre: 'Gel Repelente', precio: 150 },
  { nombre: 'Repelente Concentrado', precio: 300 }
];
 
const SYSTEM_CHIRIMOYA = `Eres Camila, asistente de Chirimoya, clinica especializada en eliminacion de piojos y liendres en Tlalnepantla.
 
MENSAJE DE BIENVENIDA — usa esto exactamente cuando llegue un cliente nuevo:
"Hola! Bienvenida a Chiri, especialistas en eliminacion de piojos y liendres.
 
Nuestros tratamientos:
Cabello corto $599
Cabello mediano $699
Cabello largo $799
 
Una sola sesion, sin quimicos, garantizado.
 
Para cuantas personas necesitas el tratamiento?"
 
PRECIOS — dar siempre de inmediato si preguntan, sin preguntas previas:
- Cabello corto: $599
- Cabello mediano: $699
- Cabello largo: $799
- Diagnostico gratuito: $0
- Shampoo repelente: $150
- Gel repelente: $150
- Repelente concentrado: $300
 
HORARIOS CONCRETOS:
Lunes a viernes: 9am, 11am, 1pm, 3pm, 5pm
Sabado: 9am, 11am, 1pm
 
UBICACION: Av. Vista Hermosa 74, Tlalnepantla. Hay estacionamiento.
GARANTIA: Revision gratis a los 7 dias si hay reincidencia.
PAGOS: Efectivo, tarjeta o pago en linea.
 
REGLAS CRITICAS — seguir siempre:
1. MAXIMO UNA PREGUNTA POR MENSAJE
2. Si preguntan precio: da los precios INMEDIATAMENTE sin preguntas previas
3. SIEMPRE ofrece horarios concretos: "manana a las 10am o a las 3pm, cual prefieres?"
4. NUNCA sugieras llamada de audio. Si insisten en llamar responde: "Con gusto te llamamos, me compartes tu numero?"
5. NUNCA pidas correo antes de confirmar la cita
6. Si dice "lo voy a pensar" o similar: "Claro, entre mas rapido se trata mas facil es eliminarlo. Te aparto lugar sin costo para manana a las 10am o 3pm. Cual prefieres?"
7. Si ya eligio horario: confirma la cita con dia, hora y direccion, y pregunta solo el nombre
8. Cuando el cliente quiera pagar en linea dile exactamente: "Para pagar en linea escribe PAGAR Tratamiento Cabello Corto" (o el que corresponda)
9. Responde siempre en espanol con emojis moderados
10. Mensajes breves y directos — maximo 200 caracteres por mensaje`;
 
async function callClaude(historial) {
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_CHIRIMOYA,
    messages: historial
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    }
  });
  return res.data.content[0].text;
}
 
async function crearLinkPago(nombreProducto) {
  try {
    let productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) {
      return p.nombre.toLowerCase().includes(nombreProducto.toLowerCase().split(' ')[0]) ||
        nombreProducto.toLowerCase().includes(p.nombre.toLowerCase().split(' ')[0]);
    });
    if (!productoEncontrado) productoEncontrado = PRECIOS_CHIRIMOYA[0];
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: productoEncontrado.nombre },
          unit_amount: productoEncontrado.precio * 100
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: 'https://camila-bot-x6vl.onrender.com/gracias',
      cancel_url: 'https://camila-bot-x6vl.onrender.com/cancelado'
    });
    return { url: session.url, producto: productoEncontrado };
  } catch (err) {
    console.error('Error Stripe:', err.message);
    return null;
  }
}
 
async function sendMessage(to, text) {
  try {
    await axios.post(
      'https://graph.facebook.com/v19.0/' + PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: 'Bearer ' + WHATSAPP_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Error enviando mensaje:', err.response ? err.response.data : err.message);
  }
}
 
function obtenerSesion(from) {
  const ahora = Date.now();
  if (!sessions[from]) {
    sessions[from] = { historial: [], ultimaActividad: ahora };
  } else {
    // Si lleva mas de 4 horas inactivo, reiniciar historial
    if (ahora - sessions[from].ultimaActividad > SESSION_TIMEOUT_MS) {
      sessions[from] = { historial: [], ultimaActividad: ahora };
    } else {
      sessions[from].ultimaActividad = ahora;
    }
  }
  return sessions[from];
}
 
async function procesarMensaje(from, texto) {
  const session = obtenerSesion(from);
 
  // Manejo de pago
  if (texto.toUpperCase().startsWith('PAGAR')) {
    const nombreProducto = texto.substring(5).trim() || 'Tratamiento Cabello Corto';
    const resultado = await crearLinkPago(nombreProducto);
    if (resultado) {
      await sendMessage(from,
        'Aqui tu link de pago seguro!\n\n' +
        resultado.producto.nombre + '\n$' + resultado.producto.precio + ' MXN\n\n' +
        'Paga aqui:\n' + resultado.url + '\n\nLink valido por 24 horas'
      );
    } else {
      await sendMessage(from, 'Hubo un problema al generar el link. Por favor escribenos directamente y te ayudamos.');
    }
    return;
  }
 
  session.historial.push({ role: 'user', content: texto });
 
  // Mantener historial maximo de 20 mensajes para no exceder contexto
  if (session.historial.length > 20) {
    session.historial = session.historial.slice(-20);
  }
 
  const respuesta = await callClaude(session.historial);
  session.historial.push({ role: 'assistant', content: respuesta });
  await sendMessage(from, respuesta);
}
 
// Webhook verificacion
app.get('/webhook', function(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});
 
// Paginas de resultado de pago
app.get('/gracias', function(req, res) {
  res.send('<h1>Pago exitoso! Gracias por tu compra en Chirimoya.</h1>');
});
 
app.get('/cancelado', function(req, res) {
  res.send('<h1>Pago cancelado. Escribenos si necesitas ayuda.</h1>');
});
 
// Webhook principal
app.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    const entry = req.body && req.body.entry && req.body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const messages = changes && changes.value && changes.value.messages;
    if (!messages || messages.length === 0) return;
 
    const msg = messages[0];
    const from = msg.from;
 
    // MEJORA 1: Responder a mensajes que no son texto
    if (msg.type !== 'text') {
      console.log('Mensaje no-texto de ' + from + ' tipo: ' + msg.type);
      await sendMessage(from,
        'Hola! Solo puedo leer mensajes de texto por el momento 😊\n\n' +
        'Escribe "Chirimoya" para iniciar o hazme tu pregunta directamente.'
      );
      return;
    }
 
    const texto = msg.text.body;
    console.log('Mensaje de ' + from + ': ' + texto);
    await procesarMensaje(from, texto);
 
  } catch (err) {
    console.error('Error procesando webhook:', err);
  }
});
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Chirimoya Bot corriendo en puerto ' + PORT);
});
 
