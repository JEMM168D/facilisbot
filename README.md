# ⚡ FacilisBot
> **Plataforma autónoma, abierta y altamente personalizable para crear, operar y revender Chatbots de IA multicanal con Gemini 3.5 Flash Lite.**

Construido desde cero como una alternativa completa y evolucionada a Forja. Es 100% de código abierto, auto-hospedado (Cloudflare Workers, VPS o Node.js), sin suscripciones forzosas y con control total sobre tus datos, prompts y modelos de IA.

---

## ✨ Características Principales

- **🧠 Soporte Multi-LLM Universal:** Conecta **Google Gemini 3.5 Flash Lite** (`gemini-3.5-flash-lite` / `gemini-3.7-flash`), **Anthropic Claude** (Claude Sonnet 5 / Opus 5), **OpenAI** (GPT-5.6 Luna / Terra / Sol), **xAI Grok** (Grok 4.6), **Ollama / DeepSeek-V4 Local**, o usa el **Simulador Offline** integrado para pruebas sin costo de API keys.
- **📱 Multicanal Real:** Soporta **WhatsApp** (Cloud API directa de Meta + Twilio), **Telegram** (BotFather con modo Webhook y modo Polling local), **Instagram DMs**, **Facebook Messenger** y un **Widget Web flotante embebible** para cualquier sitio.
- **📊 Panel de Administración Moderno (`/admin`):**
  - **Métricas y KPIs en vivo:** Conversaciones, mensajes 24h, leads capturados, tasa de escalación humana, contador de tokens y estimación de costos en USD.
  - **Bandeja de Entrada en tiempo real:** Supervisa chats, filtra por canal, revisa historial y realiza intervención manual / takeover como asesor humano.
  - **CRM de Prospectos (Leads):** Registro de contactos con interés, teléfono, email, notas, estatus y exportación con 1-clic a **CSV** y **JSON**.
  - **Base de Conocimiento (RAG) visual:** Editor de archivos markdown y buscador semántico de prueba.
  - **Simulador Interactivo:** Playground para probar el comportamiento del bot y ver las herramientas disparadas en tiempo real.
- **🏬 15 Giros de Negocio Listos para Usar:** Plantillas pre-entrenadas para Barbería, Restaurante, Inmobiliaria, Clínica Médica, Dentista, Gimnasio, Spa, Salón de Belleza, Coach, Tienda E-commerce, CRM B2B, Hotelería, Cafetería, Panadería y Starter Universal.
- **🛠️ Herramientas de Negocio (Function Calling):**
  - `capture_lead`: Guarda automáticamente datos de clientes y motivo de contacto.
  - `book_appointment`: Agenda citas y turnos (compatible con Cal.com).
  - `create_payment_link`: Genera enlaces de cobro y anticipos (Stripe / Mercado Pago).
  - `search_catalog`: Consulta precisa de platillos, precios y servicios.
  - `escalate_to_human`: Transfiere con empatía a un humano ante reclamos o solicitudes complejas.
- **💼 Suite de Modo Agencia & Skills de Agente:**
  - `/reporte`: Genera informes mensuales de rendimiento y valor para tus clientes en Markdown/PDF.
  - `/exportar`: Descarga masiva de prospectos y transcripciones.
  - `/mantenimiento`: Auditoría mensual de salud, limpieza de base de conocimiento y métricas.
  - `/afinar`: Minería de conversaciones reales para detectar preguntas sin responder y sugerir mejoras.
  - `/campaña`: Redactor de campañas de reactivación y seguimiento con reglas de cumplimiento de 24h.
  - `/clonar`: Extrae información de cualquier sitio web para crear su base de conocimiento en segundos.
  - `/precios`: Actualiza tarifas, catálogos o menús rápidamente.
  - `/cliente-nuevo`, `/cotizar`, `/propuesta`, `/cobrar`: Flujo integral para vender chatbots a empresas.

---

## 🚀 Inicio Rápido en 3 Pasos

### 1. Iniciar el Asistente Interactivo
```bash
npm run init
# o directamente: node bin/facilisbot.js init
```
El asistente te preguntará el nombre de tu empresa, el giro de negocio (ej. `barberia`, `restaurante`, `inmobiliaria`), el tono y el proveedor de IA.

### 2. Iniciar el Servidor y Panel de Control
```bash
npm run dev
# o directamente: node bin/facilisbot.js serve
```
Abre en tu navegador:
- 📊 **Panel Administrativo:** [http://localhost:3000/admin](http://localhost:3000/admin)
- 🌐 **Prueba del Chat Widget Web:** [http://localhost:3000/](http://localhost:3000/)

### 3. Diagnóstico de Salud
```bash
npm run doctor
# o directamente: node bin/facilisbot.js doctor
```

---

## 🔌 Conectar Canales

### 🌐 Widget en tu Página Web
Agrega una sola línea antes de cerrar `</body>` en tu HTML:
```html
<script src="https://tu-bot.com/widget/widget.js" data-bot-id="default" async></script>
```

### ✈️ Telegram
1. Crea tu bot en Telegram con [@BotFather](https://t.me/BotFather) y copia el Token.
2. Pégalo en el panel `/admin` (pestaña Conexiones) o en tu archivo `member/config.local.json`.
3. Activa el modo **Polling** para probarlo en tu laptop sin necesidad de IP pública ni túneles.

### 💬 WhatsApp (Meta Cloud API Oficial)
1. En Meta for Developers, configura tu número y la URL del webhook: `https://tu-dominio.com/webhook/whatsapp`.
2. Asigna tu Verify Token (por defecto `yunque_verify_token_123`).
3. Guarda tu Phone Number ID y Access Token en el panel `/admin`.

---

## 🛠️ Comandos del CLI FacilisBot

| Comando | Descripción |
|---|---|
| `facilisbot init` | Asistente de configuración guiada (soporta flags no interactivas: `--yes --giro restaurante`). |
| `facilisbot list` | Catálogo de los 15 giros de negocio disponibles. |
| `facilisbot install <slug>` | Instala directamente una plantilla de negocio (ej. `facilisbot install barberia`). |
| `facilisbot doctor` | Chequeo profundo de salud de archivos, base de conocimiento y canales. |
| `facilisbot serve` | Inicia el servidor HTTP, el panel `/admin` y los webhooks. |
| `facilisbot backup` | Crea un respaldo seguro de la base de conocimiento y base de datos. |
| `facilisbot update` | Actualiza el motor manteniendo a salvo tu configuración y base de conocimiento. |
| `facilisbot deploy` | Instrucciones de despliegue a Cloudflare Workers o VPS. |

---

## 💼 Skills de Modo Agencia

Ejecutables desde tu terminal o por tu agente de IA (Claude Code, Codex, Antigravity):

```bash
# Crear una instancia independiente para un cliente
node skills/cliente-nuevo.js "Dental Clinic Plus" dentista

# Calcular cotización justa (Setup + Mensualidad)
node skills/cotizar.js "Dental Clinic Plus" dentista

# Generar propuesta comercial lista para cerrar
node skills/propuesta.js "Dental Clinic Plus"

# Generar link de cobro y registrar factura
node skills/cobrar.js "Dental Clinic Plus" 750

# Generar informe mensual de valor
node skills/reporte.js

# Exportar prospectos a CSV/JSON
node skills/exportar.js

# Clonar la base de conocimiento desde un sitio web
node skills/clonar.js https://sitio-cliente.com
```

---

---

## 🧪 Pruebas de Integración y Despliegue

```bash
# Ejecutar suite de pruebas de integración completa
npm test

# Desplegar en Cloudflare Workers y D1
npx wrangler deploy
```

---

## 📖 Documentación para Desarrolladores

Para conocer a fondo la arquitectura interna, el flujo de datos de los 12 superpoderes, la estructura multi-inquilino de base de datos D1 y cómo extender el sistema, consulta:
👉 **[Guía de Arquitectura Técnica y Developer Handoff (ARCHITECTURE.md)](./ARCHITECTURE.md)**

---

## 📄 Licencia
Distribuido bajo la Licencia **MIT**. Puedes usarlo, modificarlo, adaptarlo a tu empresa y revenderlo comercialmente sin restricciones.
