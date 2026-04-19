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
    { nombre: 'Zumo de limón 5 litros', precio: 550 },
    { nombre: 'Zumo de limón 3 litros', precio: 350 },
    { nombre: 'Nican Ihuan Axcan', precio: 600 }
  ],
  petinc: [
    { nombre: 'Croquetas Mantenimiento 20kg', precio: 650 },
    { nombre: 'Croquetas Estándar 25kg', precio: 750 },
    { nombre: 'Croquetas Activo 20kg', precio: 800 },
    { nombre: 'Croquetas Cachorro 20kg', precio: 850 },
    { nombre: 'Croquetas Razas Pequeñas 20kg', precio: 900 },
    { nombre: 'Catline Gatos 20kg', precio: 800 }
  ],
  chirimoya: [
    { nombre: 'Tratamiento Cabello Corto', precio: 599 },
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
    system: `Eres Camila, asistente oficial de Casa Zetina. Responde en español con emojis y saltos de línea. Mensajes breves (máximo 180 caracteres). Guía siempre hacia la venta.

PRODUCTOS:
a) Zumo de limón 5 litros — $550
b) Zumo de limón 3 litros — $350
c) Nican Ihuan Axcan — $600

UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla, EdoMex. CP 54080
HORARIOS: L-V 9:00-17:00 | S 9:00-13:00
PAGOS: Efectivo, tarjeta en tienda o en línea
ENVÍOS: Gratis dentro de 9 km. Entre 10 y 16 km costo fijo de $150. Mas de 16 km NO entregamos. Entregas los jueves.

REGLAS CRÍTICAS: 
- Mensajes muy breves con emojis
- Cuando el cliente quiera pagar, dile EXACTAMENTE: "Para pagar en línea escribe: PAGAR [nombre del producto]"
- Ejemplo: "PAGAR Zumo de limón 5 litros"
- NUNCA prometas enviar el link después, dile que escriba PAGAR`
  },
  petinc: {
    name: 'Petinc',
    system: `Eres Camila, asistente oficial de Petinc. Responde en español con emojis y saltos de línea. Mensajes breves. Guía hacia la venta.

CATÁLOGO:
1. Mantenimiento 16% proteína, 20kg — $650
2. Estándar 18% proteína, 25kg — $750
3. Activo 25% proteína, 20kg — $800
4. Cachorro 28% proteína, 20kg — $850
5. Razas pequeñas 22% proteína, 20kg — $900
6. Catline 30% proteína, 20kg — $800 (gatos)

UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla.
HORARIOS: L-V 9-13h y 15-17h | Sáb 9-13h
ENVÍOS: Gratis dentro de 9 km. Entre 10 y 16 km costo fijo de $150. Mas de 16 km NO entregamos. Entregas los jueves.

REGLAS CRÍTICAS:
- Cuando el cliente quiera pagar, dile EXACTAMENTE: "Para pagar en línea escribe: PAGAR [nombre del producto]"
- NUNCA prometas enviar el link después`
  },
  chirimoya: {
    name: 'Chirimoya',
    system: `Eres Camila, asistente oficial de Chirimoya, clínica de eliminación de piojos. Empatía y urgencia. Máximo 25 palabras por mensaje.

SERVICIOS:
- Diagnóstico gratuito — $0
- Tratamiento cabello corto — $599
- Tratamiento cabello largo — $799
- Shampoo repelente — $150
- Gel repelente — $150
- Repelente concentrado — $300

GARANTÍA: Revisión gratis a los 7 días.
UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla
HORARIOS: L-V 9:00-17:00 | S 9:00-13:00

REGLAS CRÍTICAS:
- Cuando el cliente quiera pagar, dile EXACTAMENTE: "Para pagar en línea escribe: PAGAR [nombre del servicio]"
- NUNCA prometas enviar el link después`
  },
  hots: {
    name: 'Hots',
    system: `Eres Camila, asistente oficial de Hots, ropa deportiva femenina. Energía y estilo. Mensajes breves con emojis.

PRODUCTOS:
1. Top deportivo — $319
2. Leggin — $399
3. Chamarra deportiva afelpada stretch — $449

UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla.
HORARIOS: L-V 9:00-17:00 | S 9:00-13:00
ENVÍOS: Gratis dentro de 9 km. Entre 10 y 16 km costo fijo de $150. Mas de 16 km NO entregamos. Entregas los jueves.

REGLAS CRÍTICAS:
- Cuando el cliente quiera pagar, dile EXACTAMENTE: "Para pagar en línea escribe: PAGAR [nombre del producto]"
- NUNCA prometas enviar el link después`
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
  if (m.includes('limon') || m.includes('limón') || m.includes('zumo') || m.includes('nican') || m.includes('zetina')) return 'zetina';
  if (m.includes('croqueta') || m.includes('mascota') || m.includes('perro') || m.includes('gato') || m.includes('petinc') || m.includes('cachorro') || m.includes('alimento')) return 'petinc';
  if (m.includes('piojo') || m.includes('liendre') || m.includes('chirimoya') || m.includes('cabello') || m.includes('piojos')) return 'chirimoya';
  if (m.includes('ropa') || m.includes('top') || m.includes('leggin') || m.includes('chamarra') || m.includes('hots') || m.includes('deportiva')) return 'hots';
  return 'desconocido';
}

async function crearLinkPago(nombreProducto, negocio) {
  try {
    // Buscar precio del producto
    const productos = PRECIOS[negocio] || [];
    let productoEncontrado = productos.find(p => 
      nombreProducto.toLowerCase().includes(p.nombre.toLowerCase().split(' ')[0]) ||
      p.nombre.toLowerCase().includes(nombreProducto.toLowerCase().split(' ')[0])
    );
    
    if (!productoEncontrado) {
      productoEncontrado = productos[0]; // usar primer producto si no encuentra
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: productoEncontrado.nombre },
          unit_amount: productoEncontrado.precio * 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://camila-bot-x6vl.onrender.com/gracias',
      cancel_url: 'https://camila-bot-x6vl.onrender.com/cancelado',
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
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Error enviando mensaje:', err.response?.data || err.message);
  }
}

async function procesarMensaje(from, texto) {
  if (!sessions[from]) {
    sessions[from] = { negocio: null, historial: [] };
  }

  const session = sessions[from];

  // Detectar comando PAGAR
  if (texto.toUpperCase().startsWith('PAGAR')) {
    const nombreProducto = texto.substring(5).trim() || 'producto';
    const negocio = session.negocio || 'zetina';
    
    console.log(`💳 Generando link de pago para: ${nombreProducto}`);
    const resultado = await crearLinkPago(nombreProducto, negocio);
    
    if (resultado) {
      await sendMessage(from, `✅ ¡Aquí tu link de pago seguro! 🔒\n\n*${resultado.producto.nombre}*\n💰 $${resultado.producto.precio} MXN\n\n👇 Paga aquí:\n${resultado.url}\n\n_Link válido por 24 horas_ ⏱️`);
    } else {
      await sendMessage(from, `❌ Hubo un error al generar el link. Por favor escríbenos directamente al 55 5106 2364 📱`);
    }
    return;
  }

  // Si no tiene negocio asignado
  if (!session.negocio) {
    const negocio = await detectarNegocio(texto);

    if (negocio !== 'desconocido') {
      session.negocio = negocio;
      session.historial = [];
    } else {
      const menu = `¡Hola! 👋 Soy Camila, tu asistente virtual.\n\n¿Con cuál negocio quieres hablar?\n\n🍋 *Casa Zetina* — Zumo de limón\n🐾 *Petinc* — Alimento para mascotas\n🪮 *Chirimoya* — Eliminación de piojos\n🏋️ *Hots* — Ropa deportiva\n\nSolo dime el nombre o el producto que buscas 😊`;
      await sendMessage(from, menu);
      return;
    }
  }

  // Verificar cambio de negocio
  const negocioNuevo = await detectarNegocio(texto);
  if (negocioNuevo !== 'desconocido' && negocioNuevo !== session.negocio) {
    session.negocio = negocioNuevo;
    session.historial = [];
  }

  const bot = BOTS[session.negocio];
  session.historial.push({ role: 'user', content: texto });

  if (session.historial.length > 20) {
    session.historial = session.historial.slice(-20);
  }

  const respuesta = await callClaude(bot.system, session.historial);
  session.historial.push({ role: 'assistant', content: respuesta });

  await sendMessage(from, respuesta);
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado ✅');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.get('/gracias', (req, res) => {
  res.send('<h1>✅ ¡Pago exitoso! Gracias por tu compra. Te contactaremos pronto.</h1>');
});

app.get('/cancelado', (req, res) => {
  res.send('<h1>❌ Pago cancelado. Escríbenos si necesitas ayuda.</h1>');
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;
    if (!messages || messages.length === 0) return;
    const msg = messages[0];
    if (msg.type !== 'text') return;
    const from = msg.from;
    const texto = msg.text.body;
    console.log(`📩 Mensaje de ${from}: ${texto}`);
    await procesarMensaje(from, texto);
  } catch (err) {
    console.error('Error:', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Camila WhatsApp Bot corriendo en puerto ${PORT}`);
});
