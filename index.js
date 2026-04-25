const express = require('express');
const axios = require('axios');
const Stripe = require('stripe');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'camila2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const STRIPE_KEY = process.env.STRIPE_KEY;

const stripe = Stripe(STRIPE_KEY);
const sessions = {};

const PRECIOS = {
  zetina: [
    { nombre: 'Zumo de limon 5 litros', precio: 550 },
    { nombre: 'Zumo de limon 3 litros', precio: 350 },
    { nombre: 'Nican Ihuan Axcan', precio: 600 }
  ],
  petinc: [
    { nombre: 'Croquetas Mantenimiento 20kg', precio: 650 },
    { nombre: 'Croquetas Estandar 25kg', precio: 750 },
    { nombre: 'Croquetas Activo 20kg', precio: 800 },
    { nombre: 'Croquetas Cachorro 20kg', precio: 850 },
    { nombre: 'Croquetas Razas Pequenas 20kg', precio: 900 },
    { nombre: 'Catline Gatos 20kg', precio: 800 }
  ],
  chirimoya: [
    { nombre: 'Tratamiento Cabello Corto', precio: 599 },
    { nombre: 'Tratamiento Cabello Mediano', precio: 699 },
    { nombre: 'Tratamiento Cabello Largo', precio: 799 },
    { nombre: 'Shampoo Repelente', precio: 150 },
    { nombre: 'Gel Repelente', precio: 150 },
    { nombre: 'Repelente Concentrado', precio: 300 }
  ],
  hots: [
    { nombre: 'Top Deportivo', precio: 319 },
    { nombre: 'Leggin', precio: 399 },
    { nombre: 'Chamarra Deportiva', precio: 449 }
  ]
};

const BOTS = {
  zetina: {
    name: 'Casa Zetina',
    system: 'Eres Camila, asistente oficial de Casa Zetina. Responde en espanol con emojis y saltos de linea. Mensajes breves maximo 180 caracteres. Guia siempre hacia la venta.\n\nPRODUCTOS:\na) Zumo de limon 5 litros $550\nb) Zumo de limon 3 litros $350\nc) Nican Ihuan Axcan $600\n\nUBICACION: Av. Vista Hermosa 74, Tlalnepantla, EdoMex. CP 54080\nHORARIOS: L-V 9:00-17:00 S 9:00-13:00\nPAGOS: Efectivo, tarjeta en tienda o en linea\nENVIOS: Gratis dentro de 9 km. Entre 10 y 16 km costo fijo de $150. Mas de 16 km NO entregamos. Entregas los jueves.\n\nREGLAS: Mensajes muy breves con emojis. Cierra siempre con pregunta orientada a la venta. Cuando el cliente quiera pagar dile exactamente: Para pagar en linea escribe PAGAR nombre del producto. NUNCA prometas enviar el link despues.'
  },
  petinc: {
    name: 'Petinc',
    system: 'Eres Camila, asistente oficial de Petinc. Responde en espanol con emojis y saltos de linea. Mensajes breves maximo 180 caracteres. Guia siempre hacia la venta.\n\nCATALOGO:\n1. Mantenimiento 16% proteina, 20kg $650\n2. Estandar 18% proteina, 25kg $750\n3. Activo 25% proteina, 20kg $800\n4. Cachorro 28% proteina, 20kg $850\n5. Razas pequenas 22% proteina, 20kg $900\n6. Catline 30% proteina, 20kg $800 gatos\n\nUBICACION: Av. Vista Hermosa 74, Tlalnepantla.\nHORARIOS: L-V 9-13h y 15-17h Sab 9-13h\nENVIOS: Gratis dentro de 9 km. Entre 10 y 16 km costo fijo de $150. Mas de 16 km NO entregamos. Entregas los jueves.\n\nREGLAS: Recomienda el producto segun mascota. Cuando el cliente quiera pagar dile exactamente: Para pagar en linea escribe PAGAR nombre del producto.'
  },
  chirimoya: {
    name: 'Chirimoya',
    system: 'Eres Camila, asistente de Chirimoya, clinica especializada en eliminacion de piojos y liendres. SIEMPRE estas hablando de Chirimoya, NUNCA muestres menu de otros negocios.\n\nMENSAJE DE BIENVENIDA cuando llegue un cliente nuevo:\nHola! Bienvenida a Chiri, especialistas en eliminacion de piojos y liendres. Nuestros tratamientos: Cabello corto $599, Cabello mediano $699, Cabello largo $799. Una sola sesion, sin quimicos, garantizado. Para cuantas personas necesitas el tratamiento?\n\nPRECIOS dar siempre de forma inmediata si preguntan:\n- Cabello corto: $599\n- Cabello mediano: $699\n- Cabello largo: $799\n- Diagnostico gratuito: $0\n\nHORARIOS CONCRETOS:\nL-V: 9am, 11am, 1pm, 3pm, 5pm\nSabado: 9am, 11am, 1pm\n\nUBICACION: Av. Vista Hermosa 74, Tlalnepantla. Hay estacionamiento.\nGARANTIA: Revision gratis a los 7 dias.\nPAGOS: Efectivo, tarjeta, pago en linea.\n\nREGLAS CRITICAS:\n- MAXIMO UNA PREGUNTA POR MENSAJE\n- Si preguntan precio: da los 3 precios INMEDIATAMENTE sin preguntas previas\n- SIEMPRE ofrece horarios concretos: manana a las 10am o a las 3pm\n- NUNCA sugieras llamada de audio. Si insisten: Con gusto te llamamos, dame tu numero\n- NUNCA pidas correo antes de confirmar cita\n- Si dice lo voy a pensar: Claro, entre mas rapido se trata mas facil es eliminarlo. Te aparto lugar sin costo para manana a las 10am o 3pm. Cual prefieres?\n- Cuando el cliente quiera pagar dile: Para pagar en linea escribe PAGAR Tratamiento Cabello Corto'
  },
  hots: {
    name: 'Hots',
    system: 'Eres Camila, asistente oficial de Hots, ropa deportiva femenina de gran calidad. Energia y estilo. Mensajes breves con emojis.\n\nPRODUCTOS:\n1. Top deportivo $319\n2. Leggin $399\n3. Chamarra deportiva afelpada stretch $449\n\nUBICACION: Av. Vista Hermosa 74, Tlalnepantla.\nHORARIOS: L-V 9:00-17:00 S 9:00-13:00\nENVIOS: Gratis dentro de 9 km. Entre 10 y 16 km costo fijo de $150. Mas de 16 km NO entregamos. Entregas los jueves.\n\nREGLAS: Destaca calidad y estilo. Sugiere combinar prendas. Crea urgencia piezas limitadas. Cuando el cliente quiera pagar dile: Para pagar en linea escribe PAGAR nombre del producto.'
  }
};

async function callClaude(system, messages) {
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system,
    messages
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    }
  });
  return res.data.content[0].text;
}

async function detectarNegocio(mensaje) {
  const m = mensaje.toLowerCase();
  if (m.includes('limon') || m.includes('zumo') || m.includes('nican') || m.includes('zetina')) return 'zetina';
  if (m.includes('croqueta') || m.includes('mascota') || m.includes('perro') || m.includes('gato') || m.includes('petinc') || m.includes('cachorro') || m.includes('alimento')) return 'petinc';
  if (m.includes('piojo') || m.includes('liendre') || m.includes('chirimoya') || m.includes('chiri') || m.includes('piojos')) return 'chirimoya';
  if (m.includes('ropa') || m.includes('top') || m.includes('leggin') || m.includes('chamarra') || m.includes('hots') || m.includes('deportiva')) return 'hots';
  return 'desconocido';
}

async function crearLinkPago(nombreProducto, negocio) {
  try {
    const productos = PRECIOS[negocio] || [];
    let productoEncontrado = productos.find(function(p) {
      return nombreProducto.toLowerCase().includes(p.nombre.toLowerCase().split(' ')[0]) ||
        p.nombre.toLowerCase().includes(nombreProducto.toLowerCase().split(' ')[0]);
    });
    if (!productoEncontrado) productoEncontrado = productos[0];
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

async function procesarMensaje(from, texto) {
  if (!sessions[from]) {
    sessions[from] = { negocio: null, historial: [] };
  }
  var session = sessions[from];

  if (texto.toUpperCase().startsWith('PAGAR')) {
    var nombreProducto = texto.substring(5).trim() || 'producto';
    var negocioPago = session.negocio || 'zetina';
    console.log('Generando link de pago para: ' + nombreProducto);
    var resultado = await crearLinkPago(nombreProducto, negocioPago);
    if (resultado) {
      await sendMessage(from, 'Aqui tu link de pago seguro!\n\n' + resultado.producto.nombre + '\n$' + resultado.producto.precio + ' MXN\n\nPaga aqui:\n' + resultado.url + '\n\nLink valido por 24 horas');
    } else {
      await sendMessage(from, 'Hubo un error al generar el link. Por favor escribenos directamente al 55 5106 2364');
    }
    return;
  }

  if (!session.negocio) {
    var negocio = await detectarNegocio(texto);
    if (negocio !== 'desconocido') {
      session.negocio = negocio;
      session.historial = [];
    } else {
      var menu = 'Hola! Soy Camila, tu asistente virtual.\n\nCon cual negocio quieres hablar?\n\nCasa Zetina - Zumo de limon\nPetinc - Alimento para mascotas\nChirimoya - Eliminacion de piojos\nHots - Ropa deportiva\n\nSolo dime el nombre o el producto que buscas';
      await sendMessage(from, menu);
      return;
    }
  }

  var negocioNuevo = await detectarNegocio(texto);
  if (negocioNuevo !== 'desconocido' && negocioNuevo !== session.negocio) {
    session.negocio = negocioNuevo;
    session.historial = [];
  }

  var bot = BOTS[session.negocio];
  session.historial.push({ role: 'user', content: texto });
  if (session.historial.length > 20) {
    session.historial = session.historial.slice(-20);
  }

  var respuesta = await callClaude(bot.system, session.historial);
  session.historial.push({ role: 'assistant', content: respuesta });
  await sendMessage(from, respuesta);
}

app.get('/webhook', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.get('/gracias', function(req, res) {
  res.send('<h1>Pago exitoso! Gracias por tu compra.</h1>');
});

app.get('/cancelado', function(req, res) {
  res.send('<h1>Pago cancelado. Escribenos si necesitas ayuda.</h1>');
});

app.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    var entry = req.body && req.body.entry && req.body.entry[0];
    var changes = entry && entry.changes && entry.changes[0];
    var messages = changes && changes.value && changes.value.messages;
    if (!messages || messages.length === 0) return;
    var msg = messages[0];
    if (msg.type !== 'text') return;
    var from = msg.from;
    var texto = msg.text.body;
    console.log('Mensaje de ' + from + ': ' + texto);
    await procesarMensaje(from, texto);
  } catch (err) {
    console.error('Error:', err);
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Camila WhatsApp Bot corriendo en puerto ' + PORT);
});
