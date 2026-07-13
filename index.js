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
const sessions = {};
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const PRECIOS_CHIRIMOYA = [
  { nombre: 'Tratamiento Cabello Corto',   precio: 599 },
  { nombre: 'Tratamiento Cabello Mediano', precio: 699 },
  { nombre: 'Tratamiento Cabello Largo',   precio: 799 },
  { nombre: 'Shampoo Repelente',           precio: 150 },
  { nombre: 'Gel Repelente',               precio: 150 },
  { nombre: 'Repelente Concentrado',       precio: 300 }
];

const PRECIOS_PETINC = [
  { nombre: 'Petline Mantenimiento 20kg', precio: 650 }
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

REGLAS CRITICAS:
1. MAXIMO UNA PREGUNTA POR MENSAJE
2. Si preguntan precio: da los precios INMEDIATAMENTE sin preguntas previas
3. SIEMPRE ofrece horarios concretos: "manana a las 10am o a las 3pm, cual prefieres?"
4. NUNCA sugieras llamada de audio. Si insisten: "Con gusto te llamamos, me compartes tu numero?"
5. NUNCA pidas correo antes de confirmar la cita
6. Si dice "lo voy a pensar": "Claro, entre mas rapido se trata mas facil es eliminarlo. Te aparto lugar sin costo para manana a las 10am o 3pm. Cual prefieres?"
7. Si ya eligio horario: confirma cita con dia, hora y direccion, y pregunta solo el nombre
8. Cuando quiera pagar en linea: "Para pagar en linea escribe PAGAR Tratamiento Cabello Corto" (o el que corresponda)
9. Responde en espanol con emojis moderados, mensajes breves maximo 200 caracteres`;

const SYSTEM_PETINC = `Eres Camila, asistente de Petinc, distribuidora de alimento para perros en Tlalnepantla.

MENSAJE DE BIENVENIDA — usa esto exactamente cuando llegue un cliente nuevo:
"Hola! Bienvenido a Petinc, tu distribuidor de alimento para perros.

Tenemos disponible:
Petline Mantenimiento 20kg — $650
Envio GRATIS dentro de 9km de Tlalnepantla

Alimento balanceado con 15% proteina, ideal para perros adultos guardianes o de compania.

Antes de comprar, quieres que te mandemos una muestra gratis para que tu perro la pruebe?
Sin costo. Sin compromiso. Solo dinos tu colonia."

PRODUCTO:
- Petline Mantenimiento 20kg: $650
- Envio gratis dentro de 9km de Av. Vista Hermosa 74, Tlalnepantla
- Envio fuera de rango: NO disponible
- MUESTRA GRATIS disponible a domicilio dentro de los 9km

INFORMACION DEL PRODUCTO:
- 15% proteina minima, 6% grasa minima
- Ideal para perros adultos de poca actividad, guardianes y de compania
- Autorizado SAGARPA A-0200-016
- Ingredientes: cereales, subproductos de cereales, harina de carne y hueso bovino, grasa animal, vitaminas y minerales

GUIA DE ALIMENTACION:
- Perros 5-12kg: 1.5 a 2.5 tazas por dia
- Perros 12-25kg: 2.5 a 4 tazas por dia
- Perros 25-45kg: 4 a 7 tazas por dia
(1 taza = aprox 100g)

PROCESO DE PEDIDO:
1. Ofrecer muestra gratis primero si el cliente no ha probado el producto
2. Pedir colonia para verificar si esta dentro de 9km
3. Si esta dentro: confirmar envio gratis de muestra o saco
4. Si esta fuera: informar que no se puede entregar
5. Para pedido de saco: pago ANTICIPADO obligatorio
6. Indicar: "Para pagar escribe PAGAR Petline Mantenimiento 20kg"
7. Confirmar entrega el jueves

REGLAS CRITICAS:
1. MAXIMO UNA PREGUNTA POR MENSAJE
2. Precio SIEMPRE inmediato: $650 por saco de 20kg
3. NUNCA surtir sin pago anticipado confirmado
4. Verificar SIEMPRE si esta dentro de 9km
5. Entregas solo los JUEVES
6. Muestra gratis disponible dentro de 9km sin costo ni compromiso
7. Seguimiento 3 dias despues de muestra: "Como le fue a tu perro con la muestra? El saco completo es $650 con envio gratis el jueves."
8. Responde en espanol con emojis moderados, mensajes breves maximo 200 caracteres`;

function detectarNegocio(texto) {
  const m = texto.toLowerCase();
  if (m.includes('petinc') || m.includes('croqueta') || m.includes('perro') ||
      m.includes('alimento') || m.includes('mascota') || m.includes('cachorro') ||
      m.includes('petline') || m.includes('saco')) return 'petinc';
  if (m.includes('chirimoya') || m.includes('chiri') || m.includes('piojo') ||
      m.includes('liendre') || m.includes('piojos')) return 'chirimoya';
  return null;
}

async function callClaude(system, historial) {
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    system: system,
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

async function crearLinkPago(nombreProducto, negocio) {
  try {
    const busqueda = nombreProducto.toLowerCase();
    const precios = negocio === 'petinc' ? PRECIOS_PETINC : PRECIOS_CHIRIMOYA;
    let productoEncontrado = precios.find(function(p) {
      return busqueda.includes(p.nombre.toLowerCase());
    });

    if (!productoEncontrado && negocio === 'chirimoya') {
      if (busqueda.includes('largo')) {
        productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) { return p.nombre.toLowerCase().includes('largo'); });
      } else if (busqueda.includes('mediano') || busqueda.includes('medio')) {
        productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) { return p.nombre.toLowerCase().includes('mediano'); });
      } else if (busqueda.includes('corto')) {
        productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) { return p.nombre.toLowerCase().includes('corto'); });
      } else if (busqueda.includes('shampoo')) {
        productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) { return p.nombre.toLowerCase().includes('shampoo'); });
      } else if (busqueda.includes('gel')) {
        productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) { return p.nombre.toLowerCase().includes('gel'); });
      } else if (busqueda.includes('concentrado') || busqueda.includes('repelente')) {
        productoEncontrado = PRECIOS_CHIRIMOYA.find(function(p) { return p.nombre.toLowerCase().includes('concentrado'); });
      }
    }

    if (!productoEncontrado) {
      console.log('Producto no identificado: "' + nombreProducto + '" negocio: ' + negocio);
      productoEncontrado = precios[0];
    }

    let cantidad = 1;
    const matchCantidad = nombreProducto.match(/(\d+)\s*(saco|bolsa|kg|kilo)/i);
    if (matchCantidad && negocio === 'petinc') {
      const num = parseInt(matchCantidad[1]);
      if (num >= 1 && num <= 50) cantidad = num;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: productoEncontrado.nombre },
          unit_amount: productoEncontrado.precio * 100
        },
        quantity: cantidad
      }],
      mode: 'payment',
      success_url: 'https://camila-bot-x6vl.onrender.com/gracias?negocio=' + negocio,
      cancel_url: 'https://camila-bot-x6vl.onrender.com/cancelado'
    });
    return { url: session.url, producto: productoEncontrado, cantidad: cantidad };
  } catch (err) {
    console.error('Error Stripe:', err.message);
    return null;
  }
}

async function sendMessage(to, text) {
  try {
    await axios.post(
      'https://graph.facebook.com/v19.0/' + PHONE_NUMBER_ID + '/messages',
      { messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } },
      { headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error enviando mensaje:', err.response ? err.response.data : err.message);
  }
}

function obtenerSesion(from) {
  const ahora = Date.now();
  if (!sessions[from]) {
    sessions[from] = { negocio: null, historial: [], ultimaActividad: ahora };
  } else {
    if (ahora - sessions[from].ultimaActividad > SESSION_TIMEOUT_MS) {
      sessions[from] = { negocio: null, historial: [], ultimaActividad: ahora };
    } else {
      sessions[from].ultimaActividad = ahora;
    }
  }
  return sessions[from];
}

async function procesarMensaje(from, texto) {
  const session = obtenerSesion(from);

  if (!session.negocio) {
    const negocioDetectado = detectarNegocio(texto);
    if (negocioDetectado) {
      session.negocio = negocioDetectado;
      session.historial = [];
    } else {
      await sendMessage(from,
        'Hola! 👋 Para ayudarte mejor, dime:\n\n' +
        '🐾 Escribe *Petinc* para alimento para perros\n' +
        '🪮 Escribe *Chirimoya* para eliminacion de piojos'
      );
      return;
    }
  }

  const negocioNuevo = detectarNegocio(texto);
  if (negocioNuevo && negocioNuevo !== session.negocio) {
    session.negocio = negocioNuevo;
    session.historial = [];
  }

  if (texto.toUpperCase().startsWith('PAGAR')) {
    const nombreProducto = texto.substring(5).trim() ||
      (session.negocio === 'petinc' ? 'Petline Mantenimiento 20kg' : 'Tratamiento Cabello Corto');
    const resultado = await crearLinkPago(nombreProducto, session.negocio);
    if (resultado) {
      const total = resultado.producto.precio * resultado.cantidad;
      await sendMessage(from,
        'Aqui tu link de pago seguro! 🔒\n\n' +
        resultado.producto.nombre + (resultado.cantidad > 1 ? ' x' + resultado.cantidad : '') +
        '\n$' + total + ' MXN\n\n' +
        'Paga aqui:\n' + resultado.url + '\n\nLink valido por 24 horas ⏰'
      );
    } else {
      await sendMessage(from, 'Hubo un problema al generar el link. Por favor escribenos directamente y te ayudamos.');
    }
    return;
  }

  const system = session.negocio === 'petinc' ? SYSTEM_PETINC : SYSTEM_CHIRIMOYA;
  session.historial.push({ role: 'user', content: texto });
  if (session.historial.length > 20) session.historial = session.historial.slice(-20);
  const respuesta = await callClaude(system, session.historial);
  session.historial.push({ role: 'assistant', content: respuesta });
  await sendMessage(from, respuesta);
}

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

app.get('/gracias', function(req, res) {
  const negocio = req.query.negocio || 'chirimoya';
  if (negocio === 'petinc') {
    res.send('<h1>Pago exitoso! Tu pedido de Petinc sera entregado el jueves. Gracias!</h1>');
  } else {
    res.send('<h1>Pago exitoso! Te esperamos en Chirimoya. Gracias!</h1>');
  }
});

app.get('/cancelado', function(req, res) {
  res.send('<h1>Pago cancelado. Escribenos si necesitas ayuda.</h1>');
});

app.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    const entry = req.body && req.body.entry && req.body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const messages = changes && changes.value && changes.value.messages;
    if (!messages || messages.length === 0) return;
    const msg = messages[0];
    const from = msg.from;
    if (msg.type !== 'text') {
      await sendMessage(from,
        'Hola! Solo puedo leer mensajes de texto por el momento 😊\n\n' +
        'Escribe *Petinc* o *Chirimoya* para iniciar.'
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
  console.log('Bot Chirimoya + Petinc corriendo en puerto ' + PORT);
});
