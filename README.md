# 🤖 Camila — WhatsApp Bot (4 Negocios)

## ¿Qué hace?
Camila responde automáticamente en WhatsApp detectando a cuál negocio
quiere hablar el cliente:
- 🍋 Casa Zetina
- 🐾 Petinc
- 🪮 Chirimoya
- 🏋️ Hots

## Instalación en tu computadora

### Paso 1 — Descargar archivos
Copia la carpeta `whatsapp-camila` en tu computadora.

### Paso 2 — Instalar dependencias
Abre CMD o PowerShell dentro de la carpeta y ejecuta:
```
npm install
```

### Paso 3 — Configurar el archivo .env
Abre el archivo `.env` y reemplaza:
- `ANTHROPIC_KEY` → Tu API Key de Anthropic (https://console.anthropic.com)

### Paso 4 — Exponer el servidor a internet (ngrok)
WhatsApp necesita una URL pública. Instala ngrok:
```
npm install -g ngrok
ngrok http 3000
```
Copia la URL que aparece, ejemplo: `https://abc123.ngrok.io`

### Paso 5 — Configurar Webhook en Meta
1. Ve a Meta for Developers → tu app → WhatsApp → Configuración
2. En "Webhook" pon:
   - URL: `https://abc123.ngrok.io/webhook`
   - Token de verificación: `camila2024`
3. Haz clic en "Verificar y guardar"
4. Suscríbete a: `messages`

### Paso 6 — Iniciar el bot
```
npm start
```

## ¡Listo! 🎉
Ahora cuando alguien escriba a tu WhatsApp Business,
Camila responderá automáticamente.

## Notas importantes
- El token de WhatsApp dura 24 horas. Debes renovarlo cada día
  o crear un System User permanente en Meta Business Manager.
- El servidor debe estar corriendo para que funcione.
- Si reinicias la computadora, debes volver a ejecutar `npm start`.

## Para producción (servidor 24/7)
Se recomienda subir el bot a Railway.app o Render.com
para que funcione sin necesidad de tener la computadora encendida.
