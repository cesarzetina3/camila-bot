const express = require('express');
const axios = require('axios');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── VARIABLES DE ENTORNO ────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'camila2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const STRIPE_KEY = process.env.STRIPE_KEY;
const GMAIL_USER = process.env.GMAIL_USER || 'corporativopbp@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const EMAIL_DESTINO = process.env.EMAIL_DESTINO || 'cesarzetina@outlook.com';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '123456789';
const NUMERO_RESPUESTA = process.env.NUMERO_RESPUESTA || '5551062364';

const stripe = Stripe(STRIPE_KEY);
const sessions = {};
const conversaciones = {}; // almacen de conversaciones para el panel
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// ─── NODEMAILER ───────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
});

async function enviarEmailNotificacion(from, mensaje, negocio) {
  try {
    await transporter.sendMail({
      from: '"Camila Bot" <' + GMAIL_USER + '>',
      to: EMAIL_DESTINO,
      subject: '💬 Nuevo mensaje — ' + (negocio || 'Sin negocio') + ' — ' + from,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#534AB7">Nuevo mensaje de WhatsApp</h2>
          <p><strong>Número:</strong> +${from}</p>
          <p><strong>Negocio:</strong> ${negocio || 'No detectado'}</p>
          <p><strong>Mensaje:</strong> ${mensaje}</p>
          <p><strong>Hora:</strong> ${new Date().toLocaleString('es-MX')}</p>
          <a href="https://wa.me/${NUMERO_RESPUESTA}?text=Hola,%20te%20contacto%20por%20tu%20mensaje%20en%20WhatsApp" 
             style="display:inline-block;background:#25D366;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:10px">
            Responder desde WhatsApp
          </a>
          <p style="margin-top:20px;font-size:12px;color:#888">
            <a href="https://camila-bot-x6vl.onrender.com/panel">Ver panel de conversaciones</a>
          </p>
        </div>
      `
    });
  } catch (err) {
    console.error('Error enviando email:', err.message);
  }
}

// ─── ALMACENAR CONVERSACION ───────────────────────────────────
function guardarMensaje(from, rol, texto, negocio) {
  if (!conversaciones[from]) {
    conversaciones[from] = {
      numero: from,
      negocio: negocio || 'desconocido',
      mensajes: [],
      ultimaActividad: Date.now(),
      leido: false
    };
  }
  conversaciones[from].mensajes.push({
    rol: rol,
    texto: texto,
    hora: new Date().toLocaleString('es-MX')
  });
  conversaciones[from].ultimaActividad = Date.now();
  if (negocio) conversaciones[from].negocio = negocio;
  if (rol === 'cliente') conversaciones[from].leido = false;
}

// ─── PRODUCTOS ───────────────────────────────────────────────
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

ZONAS CON ENVIO GRATIS (dentro de 9km):
Tlalnepantla de Baz, Naucalpan de Juarez, Jardines de San Mateo, Ampliacion Vista Hermosa, San Andres Atoto, Industrial Vallejo, Vallejo, Potrero del Llano, San Javier, Buenavista, Nicolas Romero sur, Lopez Mateos sur, Satelite, Prado Vallejo, San Lucas Patoni, La Florida, Barrientos, Xocoyahualco, Lomas Lindas.
Si la colonia no esta en la lista pero es de Tlalnepantla o Naucalpan, confirmar que SI aplica.
Solo rechazar si es claramente lejos: Cuautitlan, Ecatepec, Tultitlan, CDMX centro o sur.

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
      model: 'claude-haiku-4-5-20251001',
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
      if (busqueda.includes('largo')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('largo'));
      else if (busqueda.includes('mediano') || busqueda.includes('medio')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('mediano'));
      else if (busqueda.includes('corto')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('corto'));
      else if (busqueda.includes('shampoo')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('shampoo'));
      else if (busqueda.includes('gel')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('gel'));
      else if (busqueda.includes('concentrado') || busqueda.includes('repelente')) prod = PRECIOS_CHIRIMOYA.find(p => p.nombre.toLowerCase().includes('concentrado'));
    }
    if (!prod) prod = precios[0];
    let cantidad = 1;
    const m = nombreProducto.match(/(\d+)\s*(saco|bolsa|kg|kilo)/i);
    if (m && negocio === 'petinc') { const n = parseInt(m[1]); if (n >= 1 && n <= 50) cantidad = n; }
    const s = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'mxn', product_data: { name: prod.nombre }, unit_amount: prod.precio * 100 }, quantity: cantidad }],
      mode: 'payment',
      success_url: 'https://camila-bot-x6vl.onrender.com/gracias?negocio=' + negocio,
      cancel_url: 'https://camila-bot-x6vl.onrender.com/cancelado'
    });
    return { url: s.url, producto: prod, cantidad };
  } catch (err) { console.error('Error Stripe:', err.message); return null; }
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post('https://graph.facebook.com/v19.0/' + PHONE_NUMBER_ID + '/messages',
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error('Error enviando mensaje:', err.response ? err.response.data : err.message); }
}

// ─── SESION ───────────────────────────────────────────────────
function obtenerSesion(from) {
  const ahora = Date.now();
  if (!sessions[from]) { sessions[from] = { negocio: null, historial: [], ultimaActividad: ahora }; }
  else {
    if (ahora - sessions[from].ultimaActividad > SESSION_TIMEOUT_MS) { sessions[from] = { negocio: null, historial: [], ultimaActividad: ahora }; }
    else { sessions[from].ultimaActividad = ahora; }
  }
  return sessions[from];
}

// ─── PROCESAR MENSAJE ────────────────────────────────────────
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
      enviarEmailNotificacion(from, texto, null); // sin await
      return;
    }
  } else {
    const nn = detectarNegocio(texto);
    if (nn && nn !== session.negocio) { session.negocio = nn; session.historial = []; primerMensaje = true; }
  }

  guardarMensaje(from, 'cliente', texto, session.negocio);
  enviarEmailNotificacion(from, texto, session.negocio); // sin await para no bloquear el bot

  if (texto.toUpperCase().startsWith('PAGAR')) {
    const np = texto.substring(5).trim() || (session.negocio === 'petinc' ? 'Petline Mantenimiento 20kg' : 'Tratamiento Cabello Corto');
    const resultado = await crearLinkPago(np, session.negocio);
    let respPago;
    if (resultado) {
      const total = resultado.producto.precio * resultado.cantidad;
      respPago = 'Aqui tu link de pago seguro! 🔒\n\n' + resultado.producto.nombre + (resultado.cantidad > 1 ? ' x' + resultado.cantidad : '') + '\n$' + total + ' MXN\n\nPaga aqui:\n' + resultado.url + '\n\nLink valido por 24 horas ⏰';
    } else {
      respPago = 'Hubo un problema al generar el link. Por favor escribenos directamente y te ayudamos.';
    }
    guardarMensaje(from, 'bot', respPago, session.negocio);
    await sendMessage(from, respPago);
    return;
  }

  const system = session.negocio === 'petinc' ? SYSTEM_PETINC : SYSTEM_CHIRIMOYA;
  session.historial.push({ role: 'user', content: primerMensaje ? 'hola' : texto });
  if (session.historial.length > 20) session.historial = session.historial.slice(-20);
  const respuesta = await callClaude(system, session.historial);
  session.historial.push({ role: 'assistant', content: respuesta });
  guardarMensaje(from, 'bot', respuesta, session.negocio);
  await sendMessage(from, respuesta);
}

// ─── PANEL WEB ────────────────────────────────────────────────
const panelSessions = new Set();

function generarTokenSesion() {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

function authMiddleware(req, res, next) {
  const token = req.query.token || req.cookies && req.cookies.panel_token;
  if (panelSessions.has(token)) return next();
  res.redirect('/panel/login');
}

app.get('/panel/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CPBP Panel</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f0f0;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#fff;border-radius:12px;padding:2rem;width:320px;box-shadow:0 4px 20px rgba(0,0,0,.1)}.logo{text-align:center;margin-bottom:1.5rem}.logo h1{font-size:22px;font-weight:600;color:#534AB7}.logo p{font-size:13px;color:#888;margin-top:4px}input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:12px}.btn{width:100%;background:#534AB7;color:#fff;border:none;padding:11px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}.error{color:#e53e3e;font-size:13px;margin-bottom:10px;text-align:center}</style>
</head><body><div class="card"><div class="logo"><h1>CPBP Panel</h1><p>Monitoreo de conversaciones</p></div>
${req.query.error ? '<p class="error">Contraseña incorrecta</p>' : ''}
<form method="POST" action="/panel/login"><input type="password" name="password" placeholder="Contraseña" required autofocus><button class="btn" type="submit">Entrar</button></form></div></body></html>`);
});

app.post('/panel/login', (req, res) => {
  const pwd = req.body.password;
  const currentPwd = process.env.PANEL_PASSWORD || PANEL_PASSWORD;
  if (pwd === currentPwd) {
    const token = generarTokenSesion();
    panelSessions.add(token);
    res.redirect('/panel?token=' + token);
  } else {
    res.redirect('/panel/login?error=1');
  }
});

app.get('/panel', authMiddleware, (req, res) => {
  const token = req.query.token || '';
  const convs = Object.values(conversaciones).sort((a, b) => b.ultimaActividad - a.ultimaActividad);
  const noLeidos = convs.filter(c => !c.leido).length;

  const listaHTML = convs.map(c => {
    const ultimo = c.mensajes[c.mensajes.length - 1];
    const hora = ultimo ? ultimo.hora : '';
    const preview = ultimo ? ultimo.texto.substring(0, 60) + (ultimo.texto.length > 60 ? '...' : '') : '';
    const badge = !c.leido ? '<span style="background:#534AB7;color:#fff;font-size:10px;padding:2px 8px;border-radius:20px;margin-left:6px">NUEVO</span>' : '';
    const negocioColor = c.negocio === 'chirimoya' ? '#E1306C' : c.negocio === 'petinc' ? '#E8A020' : '#888';
    return `<div class="conv-item" onclick="verConv('${c.numero}', '${token}')" style="padding:12px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer;${!c.leido ? 'background:#EEEDFE' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:14px;font-weight:${!c.leido ? '600' : '400'}">+${c.numero}${badge}</span>
        <span style="font-size:11px;color:#888">${hora}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;background:${negocioColor}22;color:${negocioColor};padding:2px 8px;border-radius:20px">${c.negocio}</span>
        <span style="font-size:12px;color:#666">${preview}</span>
      </div>
    </div>`;
  }).join('');

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CPBP Panel</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f4f0}
.header{background:#534AB7;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.header h1{font-size:16px;font-weight:500}.badge{background:#fff;color:#534AB7;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.conv-item:hover{background:#f0efff!important}.empty{text-align:center;padding:3rem;color:#888;font-size:14px}
.btn-refresh{background:rgba(255,255,255,.2);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px}
</style>
<script>
function verConv(numero, token) {
  window.location.href = '/panel/conv/' + numero + '?token=' + token;
}
function marcarTodoLeido(token) {
  fetch('/panel/marcar-leido?token=' + token, {method:'POST'}).then(() => location.reload());
}
// Notificacion del navegador
if('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
// Auto-refresh cada 30 segundos
setTimeout(() => location.reload(), 30000);
</script>
</head><body>
<div class="header">
  <h1>CPBP — Conversaciones ${noLeidos > 0 ? '<span class="badge">' + noLeidos + ' nuevos</span>' : ''}</h1>
  <div style="display:flex;gap:8px">
    ${noLeidos > 0 ? '<button class="btn-refresh" onclick="marcarTodoLeido(\'' + token + '\')">Marcar leídos</button>' : ''}
    <button class="btn-refresh" onclick="location.reload()">Actualizar</button>
  </div>
</div>
${convs.length === 0 ? '<div class="empty">No hay conversaciones todavía.<br>Aparecerán aquí cuando lleguen mensajes.</div>' : '<div>' + listaHTML + '</div>'}
</body></html>`);
});

app.get('/panel/conv/:numero', authMiddleware, (req, res) => {
  const numero = req.params.numero;
  const token = req.query.token || '';
  const conv = conversaciones[numero];

  if (!conv) { res.redirect('/panel?token=' + token); return; }

  // Marcar como leido
  conv.leido = true;

  const mensajesHTML = conv.mensajes.map(m => {
    const esBotOsistema = m.rol === 'bot';
    return `<div style="display:flex;justify-content:${esBotOsistema ? 'flex-start' : 'flex-end'};margin-bottom:10px">
      <div style="max-width:75%;background:${esBotOsistema ? '#fff' : '#DCF8C6'};border-radius:${esBotOsistema ? '0 12px 12px 12px' : '12px 0 12px 12px'};padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <div style="font-size:12px;color:#888;margin-bottom:4px">${esBotOsistema ? '🤖 Camila' : '👤 Cliente'} · ${m.hora}</div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap">${m.texto}</div>
      </div>
    </div>`;
  }).join('');

  const waLink = 'https://wa.me/' + NUMERO_RESPUESTA + '?text=' + encodeURIComponent('Hola, te contacto por tu mensaje sobre ' + conv.negocio);

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>+${numero}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f0f0}
.header{background:#534AB7;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0}
.back{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:4px 8px}
.msgs{padding:16px;min-height:calc(100vh - 120px)}
.footer{position:sticky;bottom:0;background:#fff;padding:12px 16px;border-top:1px solid #eee;display:flex;gap:10px}
.btn-wa{flex:1;background:#25D366;color:#fff;border:none;padding:11px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px}
</style>
</head><body>
<div class="header">
  <button class="back" onclick="history.back()">←</button>
  <div>
    <div style="font-size:15px;font-weight:500">+${numero}</div>
    <div style="font-size:11px;opacity:.8">${conv.negocio} · ${conv.mensajes.length} mensajes</div>
  </div>
</div>
<div class="msgs">${mensajesHTML}</div>
<div class="footer">
  <a href="${waLink}" target="_blank" class="btn-wa">📲 Responder por WhatsApp (${NUMERO_RESPUESTA})</a>
</div>
<script>window.scrollTo(0, document.body.scrollHeight);</script>
</body></html>`);
});

app.post('/panel/marcar-leido', authMiddleware, (req, res) => {
  Object.values(conversaciones).forEach(c => c.leido = true);
  res.json({ ok: true });
});

app.post('/panel/cambiar-password', authMiddleware, (req, res) => {
  const nueva = req.body.nueva;
  if (nueva && nueva.length >= 6) {
    process.env.PANEL_PASSWORD = nueva;
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: 'Minimo 6 caracteres' });
  }
});

// ─── WEBHOOK ─────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else { res.sendStatus(403); }
});

app.get('/gracias', (req, res) => {
  const negocio = req.query.negocio || 'chirimoya';
  res.send(negocio === 'petinc' ? '<h1>Pago exitoso! Tu pedido de Petinc sera entregado el jueves. Gracias!</h1>' : '<h1>Pago exitoso! Te esperamos en Chirimoya. Gracias!</h1>');
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
      const resp = 'Hola! Solo puedo leer mensajes de texto por el momento 😊\n\nEscribe *Petinc* o *Chirimoya* para iniciar.';
      guardarMensaje(from, 'cliente', '[Mensaje no-texto: ' + msg.type + ']', sessions[from] ? sessions[from].negocio : null);
      guardarMensaje(from, 'bot', resp, sessions[from] ? sessions[from].negocio : null);
      await sendMessage(from, resp);
      enviarEmailNotificacion(from, '[Mensaje no-texto: ' + msg.type + ']', null); // sin await
      return;
    }
    const texto = msg.text.body;
    console.log('Mensaje de ' + from + ': ' + texto);
    await procesarMensaje(from, texto);
  } catch (err) { console.error('Error webhook:', err); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot CPBP corriendo en puerto ' + PORT));
