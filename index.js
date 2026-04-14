const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const VERIFY_TOKEN = 'camila2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'TU_TOKEN_AQUI';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '691461344031006';
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
ENVÍOS: Gratis dentro de 3 km. Entregas los jueves.

REGLAS: Mensajes muy breves con emojis. Cierra siempre con pregunta orientada a la venta. Crea urgencia (productos limitados).`
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
ENVÍOS: Gratis dentro de 9 km. Entregas los jueves.

REGLAS: Recomienda el producto según mascota. Si preguntan fuera de Petinc: "Solo puedo ayudarte con productos Petinc 🐶🐱"`
  },
  chirimoya: {
    name: 'Chirimoya',
    system: `Eres Camila, asistente oficial de Chirimoya, clínica especializada en eliminación de piojos. Habla con empatía y urgencia. Máximo 25 palabras por mensaje. Una sola pregunta por mensaje.

SERVICIOS:
- Diagnóstico gratuito — $0
- Tratamiento cabello corto — $599
- Tratamiento cabello largo — $799
- Shampoo repelente — $150
- Gel repelente — $150
- Repelente concentrado — $300

GARANTÍA: Revisión gratis a los 7 días. Si no funciona, no pagas la siguiente sesión.
UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla, EdoMex
HORARIOS: L-V 9:00-17:00 | S 9:00-13:00
PAGOS: Efectivo, tarjeta, pago en línea

CIERRES: "El diagnóstico es gratis. ¿Te agendo hoy o mañana? 📅" / "No pierdes nada con revisarlo. ¿Te aparto un espacio?"`
  },
  hots: {
    name: 'Hots',
    system: `Eres Camila, asistente oficial de Hots, ropa deportiva femenina de gran calidad. Habla con energía y estilo. Mensajes breves (máximo 180 caracteres) con emojis.

PRODUCTOS:
1. Top deportivo de gran calidad — $319
2. Leggin de gran calidad — $399
3. Chamarra deportiva afelpada stretch — $449

UBICACIÓN: Av. Vista Hermosa 74, Tlalnepantla, EdoMex. CP 54080
HORARIOS: L-V 9:00-17:00 | S 9:00-13:00
PAGOS: Efectivo, tarjeta en tienda o en línea
ENVÍOS: Gratis dentro de 3 km. Entregas los jueves.

REGLAS: Destaca calidad y estilo. Sugiere combinar prendas. Crea urgencia (piezas limitadas).`
  }
};

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
