const express = require('express');
const axios = require('axios');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CORS para el portal CPBP ────────────────────────────────
app.use((req, res, next) => {
  const allowed = ['https://cpbp.com.mx', 'https://www.cpbp.com.mx'];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', 'https://cpbp.com.mx');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-panel-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── VARIABLES DE ENTORNO ────────────────────────────────────
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN || 'camila2024';
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_KEY;
const STRIPE_KEY       = process.env.STRIPE_KEY;
const GMAIL_USER       = process.env.GMAIL_USER || 'corporativopbp@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const EMAIL_DESTINO    = process.env.EMAIL_DESTINO || 'cesarzetina@outlook.com';
const PANEL_PASSWORD   = process.env.PANEL_PASSWORD || '123456789';
const NUMERO_RESPUESTA = process.env.NUMERO_RESPUESTA || '5551062364';
const MONGODB_URI      = process.env.MONGODB_URI;
const PANEL_API_KEY    = process.env.PANEL_API_KEY || 'cpbp-panel-2026';
const GOOGLE_MAPS_KEY  = process.env.GOOGLE_MAPS_KEY;

const stripe = Stripe(STRIPE_KEY);
const sessions = {};
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// ─── MONGODB ──────────────────────────────────────────────────
const MensajeSchema = new mongoose.Schema({
  numero: String,
  negocio: String,
  rol: String,
  texto: String,
  hora: String,
  leido: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const ConvMetaSchema = new mongoose.Schema({
  numero:    { type: String, unique: true },
  nombre:    { type: String, default: '' },
  archivado: { type: Boolean, default: false },
  negocio:   { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

const Mensaje  = mongoose.model('Mensaje', MensajeSchema);
const ConvMeta = mongoose.model('ConvMeta', ConvMetaSchema);

const conversaciones = {};

async function conectarMongo() {
  if (!MONGODB_URI) { console.log('Sin MONGODB_URI'); return; }
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB conectado');
    const ultimos = await Mensaje.find().sort({ createdAt: -1 }).limit(1000).lean();
    ultimos.reverse().forEach(m => {
      if (!conversaciones[m.numero]) {
        conversaciones[m.numero] = { numero: m.numero, negocio: m.negocio, mensajes: [], ultimaActividad: new Date(m.createdAt).getTime(), leido: true, nombre: '', archivado: false };
      }
      conversaciones[m.numero].mensajes.push({ rol: m.rol, texto: m.texto, hora: m.hora });
      if (m.rol === 'cliente' && !m.leido) conversaciones[m.numero].leido = false;
    });
    // Cargar metadatos (nombres, archivados)
    const metas = await ConvMeta.find().lean();
    metas.forEach(m => {
      if (conversaciones[m.numero]) {
        conversaciones[m.numero].nombre    = m.nombre || '';
        conversaciones[m.numero].archivado = m.archivado || false;
        conversaciones[m.numero].negocio   = m.negocio || conversaciones[m.numero].negocio;
      }
    });
    console.log('Conversaciones cargadas: ' + Object.keys(conversaciones).length);
  } catch (err) { console.error('Error MongoDB:', err.message); }
}
conectarMongo();

// ─── SEGUIMIENTO AUTOMATICO ──────────────────────────────────
const seguimientos = {}; // { numero: [timeout1, timeout2, timeout3] }

function programarSeguimiento(from, negocio) {
  // Cancelar seguimientos anteriores
  cancelarSeguimiento(from);
  
  const msgs = [
    { delay: 3 * 60 * 1000,  msg: '¡Hola! 😊 ¿Pudiste ver la información? Todavía tenemos disponibilidad para enviarte la muestra gratis esta semana.' },
    { delay: 6 * 60 * 1000,  msg: '¿Te quedó alguna duda sobre el alimento? Con gusto te ayudo. 🐕 Recuerda que la muestra es gratis y sin compromiso.' },
    { delay: 9 * 60 * 1000,  msg: 'Última oportunidad esta semana 🐾 Las entregas son los jueves. ¿Te apunto para recibir tu muestra gratis de Petline?' }
  ];

  seguimientos[from] = msgs.map(function(m) {
    return setTimeout(async function() {
      // Solo enviar si no ha respondido desde que programamos
      const conv = conversaciones[from];
      if (!conv) return;
      const ultimo = conv.mensajes[conv.mensajes.length - 1];
      if (ultimo && ultimo.rol === 'cliente') return; // Ya respondio
      console.log('Seguimiento automatico a ' + from);
      guardarMensaje(from, 'bot', m.msg, negocio);
      await sendMessage(from, m.msg);
    }, m.delay);
  });
}

function cancelarSeguimiento(from) {
  if (seguimientos[from]) {
    seguimientos[from].forEach(function(t) { clearTimeout(t); });
    delete seguimientos[from];
  }
}

// ─── GOOGLE MAPS DISTANCIA ───────────────────────────────────
const BODEGA_LAT = 19.5397; // Av. Vista Hermosa 74, Tlalnepantla
const BODEGA_LNG = -99.2097;
const RADIO_KM   = 9;

async function calcularDistanciaKm(direccion) {
  if (!GOOGLE_MAPS_KEY) return null;
  try {
    const query = encodeURIComponent(direccion + ', Mexico');
    const url   = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + query + '&key=' + GOOGLE_MAPS_KEY;
    const res   = await axios.get(url);
    if (res.data.status !== 'OK' || !res.data.results.length) return null;
    const loc   = res.data.results[0].geometry.location;
    // Fórmula Haversine
    const R     = 6371;
    const dLat  = (loc.lat - BODEGA_LAT) * Math.PI / 180;
    const dLng  = (loc.lng - BODEGA_LNG) * Math.PI / 180;
    const a     = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(BODEGA_LAT*Math.PI/180)*Math.cos(loc.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
    const dist  = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    console.log('Distancia a "' + direccion + '": ' + dist.toFixed(1) + 'km');
    return Math.round(dist * 10) / 10;
  } catch(err) {
    console.error('Error Google Maps:', err.message);
    return null;
  }
}

// ─── NODEMAILER ───────────────────────────────────────────────
const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });

async function enviarEmailNotificacion(from, mensaje, negocio) {
  // Desactivado temporalmente
  return;
}

// ─── ALMACENAR CONVERSACION ───────────────────────────────────
function guardarMensaje(from, rol, texto, negocio) {
  const hora = new Date().toLocaleString('es-MX');
  if (!conversaciones[from]) {
    conversaciones[from] = { numero: from, negocio: negocio || 'desconocido', mensajes: [], ultimaActividad: Date.now(), leido: true, nombre: '', archivado: false };
  }
  conversaciones[from].mensajes.push({ rol, texto, hora });
  conversaciones[from].ultimaActividad = Date.now();
  if (negocio) conversaciones[from].negocio = negocio;
  if (rol === 'cliente') conversaciones[from].leido = false;
  if (mongoose.connection.readyState === 1) {
    Mensaje.create({ numero: from, negocio: negocio || conversaciones[from].negocio, rol, texto, hora, leido: rol !== 'cliente' }).catch(err => console.error('Error MongoDB:', err.message));
  }
}

// ─── MIDDLEWARE API ───────────────────────────────────────────
function apiAuth(req, res, next) {
  const key = req.headers['x-panel-key'] || req.query.key;
  if (key === PANEL_API_KEY) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// ─── API ENDPOINTS PARA EL PORTAL ────────────────────────────

// GET /api/convs — lista de conversaciones
app.get('/api/convs', apiAuth, (req, res) => {
  const mostrarArchivados = req.query.archivados === '1';
  const convs = Object.values(conversaciones)
    .filter(c => mostrarArchivados ? c.archivado : !c.archivado)
    .sort((a, b) => b.ultimaActividad - a.ultimaActividad)
    .map(c => ({
      numero:    c.numero,
      nombre:    c.nombre || '',
      negocio:   c.negocio,
      leido:     c.leido,
      archivado: c.archivado || false,
      ultimaActividad: c.ultimaActividad,
      preview:   c.mensajes.length > 0 ? c.mensajes[c.mensajes.length - 1].texto.substring(0, 80) : '',
      hora:      c.mensajes.length > 0 ? c.mensajes[c.mensajes.length - 1].hora : '',
      total:     c.mensajes.length
    }));
  res.json({ convs, noLeidos: convs.filter(c => !c.leido && !c.archivado).length });
});

// GET /api/conv/:numero — mensajes de una conversación
app.get('/api/conv/:numero', apiAuth, (req, res) => {
  const conv = conversaciones[req.params.numero];
  if (!conv) return res.status(404).json({ error: 'No encontrada' });
  res.json({
    numero:    conv.numero,
    nombre:    conv.nombre || '',
    negocio:   conv.negocio,
    archivado: conv.archivado || false,
    mensajes:  conv.mensajes
  });
});

// POST /api/conv/:numero/leido — marcar como leído
app.post('/api/conv/:numero/leido', apiAuth, async (req, res) => {
  const conv = conversaciones[req.params.numero];
  if (!conv) return res.status(404).json({ error: 'No encontrada' });
  conv.leido = true;
  if (mongoose.connection.readyState === 1) {
    await Mensaje.updateMany({ numero: req.params.numero, leido: false }, { leido: true }).catch(() => {});
  }
  res.json({ ok: true });
});

// POST /api/conv/:numero/nombre — renombrar conversación
app.post('/api/conv/:numero/nombre', apiAuth, async (req, res) => {
  const conv = conversaciones[req.params.numero];
  if (!conv) return res.status(404).json({ error: 'No encontrada' });
  const nombre = (req.body.nombre || '').trim();
  conv.nombre = nombre;
  if (mongoose.connection.readyState === 1) {
    await ConvMeta.findOneAndUpdate(
      { numero: req.params.numero },
      { nombre, negocio: conv.negocio, updatedAt: new Date() },
      { upsert: true }
    ).catch(() => {});
  }
  res.json({ ok: true });
});

// POST /api/conv/:numero/archivar — archivar/desarchivar
app.post('/api/conv/:numero/archivar', apiAuth, async (req, res) => {
  const conv = conversaciones[req.params.numero];
  if (!conv) return res.status(404).json({ error: 'No encontrada' });
  const archivado = req.body.archivado === true || req.body.archivado === 'true';
  conv.archivado = archivado;
  if (mongoose.connection.readyState === 1) {
    await ConvMeta.findOneAndUpdate(
      { numero: req.params.numero },
      { archivado, negocio: conv.negocio, updatedAt: new Date() },
      { upsert: true }
    ).catch(() => {});
  }
  res.json({ ok: true });
});

// POST /api/leido-todo — marcar todas como leídas
app.post('/api/leido-todo', apiAuth, async (req, res) => {
  Object.values(conversaciones).forEach(c => c.leido = true);
  if (mongoose.connection.readyState === 1) {
    await Mensaje.updateMany({ leido: false }, { leido: true }).catch(() => {});
  }
  res.json({ ok: true });
});

// ─── PRODUCTOS ───────────────────────────────────────────────
const PRECIOS_CHIRIMOYA = [
  { nombre: 'Tratamiento Cabello Corto',   precio: 599 },
  { nombre: 'Tratamiento Cabello Mediano', precio: 699 },
  { nombre: 'Tratamiento Cabello Largo',   precio: 799 },
  { nombre: 'Shampoo Repelente',           precio: 150 },
  { nombre: 'Gel Repelente',               precio: 150 },
  { nombre: 'Repelente Concentrado',       precio: 300 }
];
const PRECIOS_PETINC = [{ nombre: 'Petline Mantenimiento 20kg', precio: 650 }];

// ─── SISTEMAS ────────────────────────────────────────────────
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

MENSAJE DE BIENVENIDA exacto para cliente nuevo:
"Hola! Bienvenido a Petinc, tu distribuidor de alimento para perros.

Petline Mantenimiento 20kg - $650
Envio GRATIS dentro de 9km de Tlalnepantla

Antes de comprar, quieres que te mandemos una muestra GRATIS a domicilio para que tu perro la pruebe? Sin costo ni compromiso."

PRODUCTO:
- Petline Mantenimiento 20kg: $650
- Envio gratis dentro de 9km de Av. Vista Hermosa 74, Tlalnepantla
- MUESTRA GRATIS a domicilio dentro de 9km, sin costo ni compromiso

ZONA DE ENTREGA:
El sistema calcula la distancia automaticamente. Tu trabajo es:
1. Pedir la direccion completa con colonia y municipio
2. Escribir exactamente: VERIFICAR_ZONA: [direccion completa]
3. El sistema te dira si esta dentro o fuera de los 9km
4. Si esta dentro: confirmar envio gratis
5. Si esta fuera: "Lo sentimos, tu zona esta fuera de nuestra area de entrega de 9km. Solo entregamos en Tlalnepantla, Naucalpan y zonas cercanas."

NUNCA confirmes ni niegues la zona sin haber escrito VERIFICAR_ZONA primero.

INFORMACION DEL PRODUCTO:
- 15% proteina minima, 6% grasa minima
- Ideal para perros adultos guardianes y de compania
- Autorizado SAGARPA A-0200-016
- Ingredientes: cereales, subproductos, harina de carne y hueso bovino, grasa animal, vitaminas y minerales

GUIA DE ALIMENTACION:
- Perros 5-12kg: 1.5 a 2.5 tazas/dia
- Perros 12-25kg: 2.5 a 4 tazas/dia
- Perros 25-45kg: 4 a 7 tazas/dia

PROCESO DE PEDIDO:
1. Si el cliente duda o pregunta por muestras: ofrecer muestra gratis inmediatamente
2. Pedir colonia para verificar zona
3. Si esta dentro: confirmar envio GRATIS
4. Pago ANTICIPADO para saco: "Para pagar escribe PAGAR Petline Mantenimiento 20kg"
5. Entregas los jueves

REGLAS CRITICAS:
1. MAXIMO UNA PREGUNTA POR MENSAJE
2. Precio siempre inmediato: $650 por 20kg
3. NUNCA surtir sin pago confirmado
4. Si duda si le gustara al perro: ofrecer muestra gratis INMEDIATAMENTE
5. Si pregunta si hay muestras: SI HAY, son gratis a domicilio dentro de 9km
6. Si dice "lo voy a pensar": "Mandarte una muestra gratis es la mejor forma de decidir. Solo dime tu colonia."
7. Responde en espanol, emojis moderados, maximo 200 caracteres`;

// ─── DETECTAR NEGOCIO ────────────────────────────────────────
function detectarNegocio(texto) {
  const m = texto.toLowerCase();
  if (m.includes('petinc') || m.includes('croqueta') || m.includes('perro') ||
      m.includes('alimento') || m.includes('mascota') || m.includes('cachorro') ||
      m.includes('petline') || m.includes('saco')) return 'petinc';
  if (m.includes('chirimoya') || m.includes('chiri') || m.includes('piojo') ||
      m.includes('liendre') || m.includes('piojos')) return 'chirimoya';
  return null;
}

// ─── CLAUDE ───────────────────────────────────────────────────
async function callClaude(system, historial) {
  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001', max_tokens: 300, system, messages: historial
    }, { headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' } });
    return res.data.content[0].text;
  } catch (err) {
    console.error('Error Claude:', JSON.stringify(err.response ? err.response.data : err.message));
    throw err;
  }
}

// ─── STRIPE ───────────────────────────────────────────────────
async function crearLinkPago(nombreProducto, negocio) {
  try {
    const busqueda = nombreProducto.toLowerCase();
    const precios = negocio === 'petinc' ? PRECIOS_PETINC : PRECIOS_CHIRIMOYA;
    let prod = precios.find(p => busqueda.includes(p.nombre.toLowerCase()));
    if (!prod && negocio === 'chirimoya') {
      if (busqueda.includes('largo'))                 prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('largo'));
      else if (busqueda.includes('mediano') || busqueda.includes('medio')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('mediano'));
      else if (busqueda.includes('corto'))            prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('corto'));
      else if (busqueda.includes('shampoo'))          prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('shampoo'));
      else if (busqueda.includes('gel'))              prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('gel'));
      else if (busqueda.includes('concentrado') || busqueda.includes('repelente')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('concentrado'));
    }
    if (!prod) prod = precios[0];
    let cantidad = 1;
    const mc = nombreProducto.match(/(\d+)\s*(saco|bolsa|kg|kilo)/i);
    if (mc && negocio === 'petinc') { const n = parseInt(mc[1]); if (n >= 1 && n <= 50) cantidad = n; }
    const s = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'mxn', product_data: { name: prod.nombre }, unit_amount: prod.precio * 100 }, quantity: cantidad }],
      mode: 'payment',
      success_url: 'https://camila-bot-x6vl.onrender.com/gracias?negocio=' + negocio,
      cancel_url:  'https://camila-bot-x6vl.onrender.com/cancelado'
    });
    return { url: s.url, producto: prod, cantidad };
  } catch (err) { console.error('Error Stripe:', err.message); return null; }
}

// ─── SEND ─────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post('https://graph.facebook.com/v19.0/' + PHONE_NUMBER_ID + '/messages',
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error('Error enviando:', err.response ? err.response.data : err.message); }
}

// ─── SESION ───────────────────────────────────────────────────
function obtenerSesion(from) {
  const ahora = Date.now();
  if (!sessions[from]) { sessions[from] = { negocio: null, historial: [], ultimaActividad: ahora }; }
  else {
    if (ahora - sessions[from].ultimaActividad > SESSION_TIMEOUT_MS) sessions[from] = { negocio: null, historial: [], ultimaActividad: ahora };
    else sessions[from].ultimaActividad = ahora;
  }
  return sessions[from];
}

// ─── PROCESAR ─────────────────────────────────────────────────
async function procesarMensaje(from, texto) {
  const session = obtenerSesion(from);
  let primerMensaje = false;
  if (!session.negocio) {
    const nd = detectarNegocio(texto);
    if (nd) { session.negocio = nd; session.historial = []; primerMensaje = true; }
    else {
      const resp = 'Hola! 👋 Para ayudarte mejor, dime:\n\n🐾 Escribe *Petinc* para alimento para perros\n🪮 Escribe *Chirimoya* para eliminacion de piojos';
      guardarMensaje(from, 'cliente', texto, null);
      guardarMensaje(from, 'bot', resp, null);
      await sendMessage(from, resp);
      return;
    }
  } else {
    const nn = detectarNegocio(texto);
    if (nn && nn !== session.negocio) { session.negocio = nn; session.historial = []; primerMensaje = true; }
  }
  guardarMensaje(from, 'cliente', texto, session.negocio);
  // Cancelar seguimiento cuando el cliente responde
  cancelarSeguimiento(from);

  // Interceptar VERIFICAR_ZONA generado por Claude
  if (texto.toUpperCase().includes('VERIFICAR_ZONA:')) {
    const dir = texto.split(':').slice(1).join(':').trim();
    const km  = await calcularDistanciaKm(dir);
    let respZona;
    if (km === null) {
      respZona = 'No pude verificar la zona automaticamente. Por favor confirma tu municipio para verificar manualmente.';
    } else if (km <= RADIO_KM) {
      respZona = 'ZONA_OK:' + km;
    } else {
      respZona = 'ZONA_FUERA:' + km;
    }
    // Inyectar resultado en el historial y pedir a Claude que responda
    session.historial.push({ role: 'user', content: 'Resultado de verificacion de zona para "' + dir + '": ' + respZona + '. Ahora responde al cliente.' });
    if (session.historial.length > 20) session.historial = session.historial.slice(-20);
    const system2 = session.negocio === 'petinc' ? SYSTEM_PETINC : SYSTEM_CHIRIMOYA;
    const resp2   = await callClaude(system2, session.historial);
    session.historial.push({ role: 'assistant', content: resp2 });
    guardarMensaje(from, 'bot', resp2, session.negocio);
    await sendMessage(from, resp2);
    return;
  }

  if (texto.toUpperCase().startsWith('PAGAR')) {
    const np = texto.substring(5).trim() || (session.negocio === 'petinc' ? 'Petline Mantenimiento 20kg' : 'Tratamiento Cabello Corto');
    const resultado = await crearLinkPago(np, session.negocio);
    let respPago;
    if (resultado) {
      const total = resultado.producto.precio * resultado.cantidad;
      respPago = 'Aqui tu link de pago seguro! 🔒\n\n' + resultado.producto.nombre + (resultado.cantidad > 1 ? ' x' + resultado.cantidad : '') + '\n$' + total + ' MXN\n\nPaga aqui:\n' + resultado.url + '\n\nLink valido por 24 horas ⏰';
    } else { respPago = 'Hubo un problema al generar el link. Escribenos directamente y te ayudamos.'; }
    guardarMensaje(from, 'bot', respPago, session.negocio);
    await sendMessage(from, respPago);
    return;
  }
  const system = session.negocio === 'petinc' ? SYSTEM_PETINC : SYSTEM_CHIRIMOYA;
  session.historial.push({ role: 'user', content: primerMensaje ? 'hola' : texto });
  if (session.historial.length > 20) session.historial = session.historial.slice(-20);
  const respuesta = await callClaude(system, session.historial);

  // Interceptar VERIFICAR_ZONA en la respuesta de Claude
  if (session.negocio === 'petinc' && respuesta.includes('VERIFICAR_ZONA:')) {
    const match = respuesta.match(/VERIFICAR_ZONA:\s*(.+?)(?:\n|$)/);
    if (match) {
      const dir = match[1].trim();
      // Enviar mensaje de espera al cliente
      const msgEspera = respuesta.replace(/VERIFICAR_ZONA:.*?(\n|$)/, '').trim() || 'Un momento, verifico tu zona... 🔍';
      await sendMessage(from, msgEspera);

      // Calcular distancia real con Google Maps
      const km = await calcularDistanciaKm(dir);
      console.log('Google Maps resultado para "' + dir + '": ' + km + 'km');

      let msgZona;
      if (km === null) {
        msgZona = 'No pude verificar tu zona automaticamente. ¿Puedes confirmarme tu municipio exacto?';
      } else if (km <= RADIO_KM) {
        msgZona = '¡Perfecto! Tu zona está dentro de nuestra área de entrega (' + km + 'km de distancia). 🎉\n\nEl envío es GRATIS. ¿Cuál es tu dirección completa para enviarte la muestra?';
      } else {
        msgZona = 'Lo sentimos, tu zona está a ' + km + 'km de nuestra bodega, fuera de nuestro radio de entrega de 9km. 😔\n\nSolo entregamos en Tlalnepantla, Naucalpan y zonas muy cercanas de CDMX.';
      }

      session.historial.push({ role: 'assistant', content: msgEspera });
      session.historial.push({ role: 'user', content: 'Resultado verificacion: ' + (km !== null ? km + 'km' : 'no disponible') });
      session.historial.push({ role: 'assistant', content: msgZona });
      guardarMensaje(from, 'bot', msgZona, session.negocio);
      await sendMessage(from, msgZona);
      return;
    }
  }

  session.historial.push({ role: 'assistant', content: respuesta });
  guardarMensaje(from, 'bot', respuesta, session.negocio);
  await sendMessage(from, respuesta);
  // Programar seguimiento automatico si es Petinc y el cliente no ha cerrado la venta
  if (session.negocio === 'petinc') {
    programarSeguimiento(from, 'petinc');
  }
}

// ─── PANEL WEB (mantenido para acceso directo) ────────────────
const panelSessions = new Set();
function generarTokenSesion() { return Math.random().toString(36).substr(2) + Date.now().toString(36); }
function authMiddleware(req, res, next) {
  const token = req.query.token || (req.cookies && req.cookies.panel_token);
  if (panelSessions.has(token)) return next();
  res.redirect('/panel/login');
}

app.get('/panel/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>CPBP Panel</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#f0f0f0;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#fff;border-radius:12px;padding:2rem;width:320px;box-shadow:0 4px 20px rgba(0,0,0,.1)}.logo{text-align:center;margin-bottom:1.5rem}h1{font-size:22px;font-weight:600;color:#534AB7}p{font-size:13px;color:#888;margin-top:4px}input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:12px}.btn{width:100%;background:#534AB7;color:#fff;border:none;padding:11px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}.err{color:#e53e3e;font-size:13px;margin-bottom:10px;text-align:center}</style>
</head><body><div class="card"><div class="logo"><h1>CPBP Panel</h1><p>Monitoreo de conversaciones</p></div>
${req.query.error ? '<p class="err">Contraseña incorrecta</p>' : ''}
<form method="POST" action="/panel/login"><input type="password" name="password" placeholder="Contraseña" required autofocus><button class="btn" type="submit">Entrar</button></form></div></body></html>`);
});

app.post('/panel/login', (req, res) => {
  if (req.body.password === (process.env.PANEL_PASSWORD || PANEL_PASSWORD)) {
    const token = generarTokenSesion();
    panelSessions.add(token);
    res.redirect('/panel?token=' + token);
  } else { res.redirect('/panel/login?error=1'); }
});

app.get('/panel', authMiddleware, (req, res) => {
  const token = req.query.token || '';
  const convs = Object.values(conversaciones).filter(c => !c.archivado).sort((a, b) => b.ultimaActividad - a.ultimaActividad);
  const noLeidos = convs.filter(c => !c.leido).length;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Panel</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#f5f4f0}
.hdr{background:#534AB7;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0}
.hdr h1{font-size:16px}.badge{background:#fff;color:#534AB7;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.ci{padding:12px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer}.ci:hover{background:#f0efff}
.btn{background:rgba(255,255,255,.2);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:6px}
.empty{text-align:center;padding:3rem;color:#888;font-size:14px}
</style></head><body>
<div class="hdr"><h1>CPBP Conversaciones ${noLeidos > 0 ? '<span class="badge">'+noLeidos+' nuevos</span>' : ''}</h1>
<div>${noLeidos > 0 ? '<button class="btn" onclick="fetch(\'/panel/marcar-leido?token=${token}\',{method:\'POST\'}).then(()=>location.reload())">Marcar leídos</button>' : ''}
</div></div>
${convs.length === 0 ? '<div class="empty">Sin conversaciones</div>' : convs.map(c => {
  const ul = c.mensajes[c.mensajes.length-1];
  const nc = c.negocio === 'chirimoya' ? '#E1306C' : '#E8A020';
  return `<div class="ci" onclick="location.href='/panel/conv/${c.numero}?token=${token}'" style="${!c.leido?'background:#EEEDFE':''}">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:14px;font-weight:${!c.leido?'600':'400'}">${c.nombre || '+'+c.numero}${!c.leido?' <span style="background:#534AB7;color:#fff;font-size:10px;padding:2px 8px;border-radius:20px">NUEVO</span>':''}</span>
      <span style="font-size:11px;color:#888">${ul?ul.hora:''}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;background:${nc}22;color:${nc};padding:2px 8px;border-radius:20px">${c.negocio}</span>
      <span style="font-size:12px;color:#666">${ul?ul.texto.substring(0,60):''}</span>
    </div>
  </div>`;
}).join('')}
</body></html>`);
});

app.get('/panel/conv/:numero', authMiddleware, async (req, res) => {
  const conv = conversaciones[req.params.numero];
  if (!conv) return res.redirect('/panel?token=' + (req.query.token||''));
  conv.leido = true;
  if (mongoose.connection.readyState === 1) await Mensaje.updateMany({ numero: req.params.numero, leido: false }, { leido: true }).catch(()=>{});
  const waLink = 'https://wa.me/' + NUMERO_RESPUESTA + '?text=' + encodeURIComponent('Hola, te contacto por tu mensaje sobre ' + conv.negocio);
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>+${req.params.numero}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#f0f0f0}
.hdr{background:#534AB7;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0}
.back{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
.msgs{padding:16px}.footer{position:sticky;bottom:0;background:#fff;padding:12px 16px;border-top:1px solid #eee}
.btn-wa{display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:#fff;border:none;padding:11px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;width:100%}
</style></head><body>
<div class="hdr"><button class="back" onclick="history.back()">←</button>
<div><div style="font-size:15px;font-weight:500">${conv.nombre || '+'+req.params.numero}</div>
<div style="font-size:11px;opacity:.8">${conv.negocio} · ${conv.mensajes.length} mensajes</div></div></div>
<div class="msgs">${conv.mensajes.map(m=>`<div style="display:flex;justify-content:${m.rol==='bot'?'flex-start':'flex-end'};margin-bottom:10px">
<div style="max-width:75%;background:${m.rol==='bot'?'#fff':'#DCF8C6'};border-radius:${m.rol==='bot'?'0 12px 12px 12px':'12px 0 12px 12px'};padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
<div style="font-size:12px;color:#888;margin-bottom:4px">${m.rol==='bot'?'🤖 Camila':'👤 Cliente'} · ${m.hora}</div>
<div style="font-size:13px;line-height:1.6;white-space:pre-wrap">${m.texto}</div></div></div>`).join('')}</div>
<div class="footer"><a href="${waLink}" target="_blank" class="btn-wa">📲 Responder por WhatsApp (${NUMERO_RESPUESTA})</a></div>
<script>window.scrollTo(0,document.body.scrollHeight)</script>
</body></html>`);
});

app.post('/panel/marcar-leido', authMiddleware, async (req, res) => {
  Object.values(conversaciones).forEach(c => c.leido = true);
  if (mongoose.connection.readyState === 1) await Mensaje.updateMany({ leido: false }, { leido: true }).catch(()=>{});
  res.json({ ok: true });
});

// ─── WEBHOOKS ─────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN)
    res.status(200).send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.get('/gracias', (req, res) => {
  const n = req.query.negocio || 'chirimoya';
  res.send(n === 'petinc' ? '<h1>Pago exitoso! Tu pedido de Petinc sera entregado el jueves.</h1>' : '<h1>Pago exitoso! Te esperamos en Chirimoya.</h1>');
});

app.get('/cancelado', (req, res) => res.send('<h1>Pago cancelado. Escribenos si necesitas ayuda.</h1>'));

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body && req.body.entry && req.body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const messages = changes && changes.value && changes.value.messages;
    if (!messages || !messages.length) return;
    const msg = messages[0];
    const from = msg.from;
    if (msg.type !== 'text') {
      const resp = 'Hola! Solo puedo leer mensajes de texto 😊\n\nEscribe *Petinc* o *Chirimoya* para iniciar.';
      guardarMensaje(from, 'cliente', '[Mensaje no-texto: ' + msg.type + ']', null);
      guardarMensaje(from, 'bot', resp, null);
      await sendMessage(from, resp);
      return;
    }
    const texto = msg.text.body;
    console.log('Mensaje de ' + from + ': ' + texto);
    await procesarMensaje(from, texto);
  } catch (err) { console.error('Error webhook:', err); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot CPBP corriendo en puerto ' + PORT));
