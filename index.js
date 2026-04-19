const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const VERIFY_TOKEN = 'camila2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'TU_TOKEN_AQUI';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '691461344031006';
const stripe = require('stripe')(process.env.STRIPE_KEY);
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || 'TU_ANTHROPIC_KEY';

// ─── MEMORIA DE CONVERSACIONES ────────────────────────────────
// Guardamos historial y negocio seleccionado por usuario
const sessions = {};

// ─── PROMPTS DE CADA NEGOCIO ─────────────────────────────────
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
ENVÍOS: El radio de entrega GRATUITA es exactamente 9 km desde Tlalnepantla de baz. Repite siempre "9 km" cuando menciones envío gratis. Entregas los jueves.

REGLAS: CRÍTICO: El envío gratis es a 9 km, NUNCA menciones 3 km. Mensajes muy breves con emojis. Cierra siempre con pregunta orientada a la venta. Crea urgencia (productos limitados). IMPORTANTE: El envío es GRATIS dentro de 9 km. NUNCA digas 3 km. Siempre di 9 km cuando hables de envío gratis. Si el cliente da una dirección, siempre confirma si está dentro de los 9 km antes de decir que es de pago.`
  },
  petinc: {
    name: 'Petinc',
    system: `Eres Camila, asistente oficial de Petinc. Responde en español con emojis y saltos de línea. Mensajes breves (máximo 180 caracteres). Guía siempre hacia la venta.

CATÁLOGO:
1. Mantenimiento 16% proteína, 20kg — $650
2. Estándar 18% proteína, 25kg — $750
3. Activo 25% proteína, 20kg — $800
4. Cachorro 28% proteína, 20kg — $850
5. Razas pequeñas 22% proteína, 20kg — $900
6. Catline 30% proteína, 20kg — $800 (gatos)

UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla, Edo. Méx.
HORARIOS: L-V 9-13h y 15-17h | Sáb 9-13h
PAGOS: Tarjeta
ENVÍOS: Gratis dentro de 9 km. Entre 10 y 16 km el costo es $150 fijo. Más de 16 km NO entregamos. Si el cliente pregunta por envío fuera de 9 km, dile SIEMPRE: "El costo de envío es $150 fijos 🚚". Entregas los jueves.

REGLAS: Recomienda el producto según mascota. Si preguntan fuera de Petinc: "Solo puedo ayudarte con productos Petinc 🐶🐱"`
  },
  chirimoya: {
    name: 'Chirimoya',
    system: `Eres Camila, asistente oficial de Chirimoya, clínica especializada en eliminación de piojos y liendres. Habla con empatía, calidez y urgencia. MÁXIMO UNA PREGUNTA POR MENSAJE.

MENSAJE DE BIENVENIDA:
¡Hola! 👋 Bienvenida a Chiri, especialistas en eliminación de piojos y liendres. Nuestros tratamientos completos: 💇 Cabello corto: $599 💇‍♀️ Cabello mediano: $699 💇‍♀️ Cabello largo: $799 ✅ Una sola sesión · Sin químicos · Garantizado ¿Para cuántas personas necesitas el tratamiento?

PRECIOS (dar siempre de forma directa si preguntan):
- Cabello corto: $599
- Cabello mediano: $699
- Cabello largo: $799
- Diagnóstico gratuito: $0

HORARIOS CONCRETOS:
Lunes a viernes: 9:00, 11:00, 13:00, 15:00, 17:00
Sábado: 9:00, 11:00, 13:00

UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla, CDMX. Hay estacionamiento.
PAGOS: Efectivo, tarjeta, pago en línea.

FLUJO DE CONVERSACIÓN:
1. Preguntar cuántas personas y tipo de cabello
2. Responder: "Perfecto 😊 El tratamiento incluye inspección con lupa, escarmiento profesional y aspirado europeo — todo en una sola sesión, sin químicos agresivos. ¿Te viene mejor mañana a las 10am o a las 3pm?"
3. Confirmar cita: "¡Perfecto! Te agendo para ese horario 🗓️ 📍 Av. Vista Hermosa 74, Tlalnepantla ¿Me dices tu nombre para apartar el lugar?"
4. Mensaje final: "¡Listo! Tu cita está apartada ✅ 📅 [DÍA] a las [HORA] 📍 Av. Vista Hermosa 74 💰 $[PRECIO] Te esperamos 😊"

REGLAS CRÍTICAS:
- NUNCA pidas correo antes de confirmar la cita (es opcional después)
- NUNCA hagas más de una pregunta por mensaje
- NUNCA sugieras llamada de audio — si insisten di: "Con gusto te llamamos — ¿cuál es tu número?" 
- SIEMPRE ofrece horarios concretos: "¿mañana a las 10am o a las 3pm?"
- SIEMPRE da precios directamente sin preguntas previas
- Si dice "lo voy a pensar": "Claro 😊 Solo te cuento que entre más rápido se trata, más fácil es eliminarlo. ¿Te aparto un lugar para pasado mañana? No tiene costo y puedes cancelar sin problema 🗓️"
- Si no responde en 2 horas enviar: "¡Hola! ¿Pudiste ver la información? Todavía tenemos lugares disponibles hoy 😊"
- Recordatorio 2 horas antes: "¡Hola! 👋 Te recordamos tu cita con Chiri hoy a las [HORA]. 📍 Av. Vista Hermosa 74 ¿Confirmamos tu asistencia? 😊"

// ─── PROMPT PARA DETECTAR NEGOCIO ────────────────────────────
const SELECTOR_SYSTEM = `Eres Camila, asistente de 4 negocios. Cuando alguien te escriba por primera vez, preséntate y pregúntale con cuál negocio quiere hablar.

Responde SIEMPRE con este formato JSON exacto:
{"accion": "menu", "mensaje": "tu mensaje aquí"}

El mensaje debe ser amigable, con emojis, máximo 200 caracteres, y mostrar los 4 negocios:
🍋 Casa Zetina (zumo de limón)
🐾 Petinc (alimento para mascotas)
🪮 Chirimoya (eliminación de piojos)
🏋️ Hots (ropa deportiva)`;

const DETECTOR_SYSTEM = `Analiza el mensaje del usuario y determina a cuál negocio quiere hablar. Responde SOLO con JSON:
{"negocio": "zetina"} o {"negocio": "petinc"} o {"negocio": "chirimoya"} o {"negocio": "hots"} o {"negocio": "desconocido"}

Palabras clave:
- zetina: limón, zumo, limon, nican, zetina, casa zetina
- petinc: croqueta, mascota, perro, gato, alimento, petinc, cachorro
- chirimoya: piojo, liendre, cabello, chirimoya, tratamiento cabeza
- hots: ropa, top, leggin, chamarra, deportiva, hots, gym`;

// ─── FUNCIONES DE IA ──────────────────────────────────────────
async function callClaude(system, messages) {
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
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
  try {
    const resp = await callClaude(DETECTOR_SYSTEM, [{ role: 'user', content: mensaje }]);
    const clean = resp.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed.negocio || 'desconocido';
  } catch {
    return 'desconocido';
  }
}

// ─── ENVIAR MENSAJE POR WHATSAPP ─────────────────────────────
async function crearPagoStripe(monto, descripcion) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: descripcion },
          unit_amount: monto * 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://camila-bot-x6vl.onrender.com/gracias',
      cancel_url: 'https://camila-bot-x6vl.onrender.com/cancelado',
    });
    return session.url;
  } catch (err) {
    console.error('Error Stripe:', err);
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

// ─── PROCESAR MENSAJE ENTRANTE ────────────────────────────────
async function procesarMensaje(from, texto) {
  if (!sessions[from]) {
    sessions[from] = { negocio: null, historial: [] };
  }

  const session = sessions[from];

  // Si no tiene negocio asignado, detectar o mostrar menú
  if (!session.negocio) {
    const negocio = await detectarNegocio(texto);

    if (negocio !== 'desconocido') {
      session.negocio = negocio;
      const bot = BOTS[negocio];
      session.historial = [];
      session.historial.push({ role: 'user', content: texto });

      const respuesta = await callClaude(bot.system, session.historial);
      session.historial.push({ role: 'assistant', content: respuesta });
      await sendMessage(from, respuesta);
    } else {
      // Mostrar menú de negocios
      const menu = `¡Hola! 👋 Soy Camila, tu asistente virtual.

¿Con cuál negocio quieres hablar?

🍋 *Casa Zetina* — Zumo de limón
🐾 *Petinc* — Alimento para mascotas
🪮 *Chirimoya* — Eliminación de piojos
🏋️ *Hots* — Ropa deportiva

Solo dime el nombre o el producto que buscas 😊`;
      await sendMessage(from, menu);
    }
    return;
  }

  // Verificar si el usuario quiere cambiar de negocio
  const negocioNuevo = await detectarNegocio(texto);
  if (negocioNuevo !== 'desconocido' && negocioNuevo !== session.negocio) {
    session.negocio = negocioNuevo;
    session.historial = [];
  }

  // Responder con el bot del negocio
  const bot = BOTS[session.negocio];
  session.historial.push({ role: 'user', content: texto });

  // Limitar historial a últimos 10 mensajes
  if (session.historial.length > 20) {
    session.historial = session.historial.slice(-20);
  }

  const respuesta = await callClaude(bot.system, session.historial);
  session.historial.push({ role: 'assistant', content: respuesta });

  await sendMessage(from, respuesta);
}

// ─── WEBHOOK VERIFICATION ─────────────────────────────────────
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

// ─── RECIBIR MENSAJES ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

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
// Detectar si el mensaje contiene confirmación de pedido
if (texto.toLowerCase().includes('confirmo') || texto.toLowerCase().includes('quiero pagar') || texto.toLowerCase().includes('pagar')) {
  const session = sessions[from];
  if (session) {
  if (!session.negocio) session.negocio = 'zetina';
    const precios = {
      zetina: { monto: 550, desc: 'Zumo de limón 5L - Casa Zetina' },
      petinc: { monto: 750, desc: 'Croquetas Petinc' },
      chirimoya: { monto: 599, desc: 'Tratamiento Chirimoya' },
      hots: { monto: 399, desc: 'Leggin Hots' }
    };
    const prod = precios[session.negocio];
    if (prod) {
      const linkPago = await crearPagoStripe(prod.monto, prod.desc);
      if (linkPago) {
        await sendMessage(from, `✅ ¡Perfecto! Aquí tu link de pago seguro 👇\n\n${linkPago}\n\n💳 Acepta tarjetas de crédito y débito.`);
        return;
      }
    }
  }
}    
await procesarMensaje(from, texto);

  } catch (err) {
    console.error('Error procesando mensaje:', err);
  }
});

// ─── INICIO ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Camila WhatsApp Bot corriendo en puerto ${PORT}`);
});
