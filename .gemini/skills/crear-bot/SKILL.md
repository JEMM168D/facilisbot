---
name: crear-bot
description: Skill de asistente para crear, configurar, redactar la base de conocimiento y probar nuevos chatbots de IA para empresas con Gemini 3.5 Flash Lite y arquitectura multi-tenant.
---

# Skill: Crear Chatbot con FacilisBot

Esta skill guía al usuario en la creación conversacional de un nuevo chatbot para cualquier negocio, redactando automáticamente la base de conocimiento en Markdown optimizada para RAG y probando las respuestas con **Gemini 3.5 Flash Lite**.

## Cuándo activar esta Skill
- Cuando el usuario pida: *"crea un bot para mi negocio"*, *"quiero un bot para una clínica/restaurante/barbería"*, *"hazme un bot nuevo"*, o ejecute `/crear-bot`.

## Flujo de Trabajo del Agente

1. **Entrevista Breve y Empática**:
   Pregunta al usuario los datos mínimos si no los ha especificado:
   - Nombre de la empresa o cliente.
   - Giro o tipo de negocio (`restaurante`, `clinica`, `dentista`, `inmobiliaria`, `barberia`, `gimnasio`, `spa`, `salon`, `coach`, `tienda`, etc.).
   - Servicios principales y precios de referencia.
   - Horario, teléfono o WhatsApp de contacto.

2. **Ejecución del Creador de Bot**:
   Ejecuta el script programático:
   ```bash
   node skills/crear-bot.js --name "Nombre Empresa" --niche "giro" --services "Servicio 1 ($XX), Servicio 2 ($YY)" --hours "Horario" --phone "+1 555-0100"
   ```

3. **Verificación y Entrega**:
   - Muestra al usuario la respuesta de prueba generada en el simulador.
   - Proporciona el código del widget para su sitio web:
     ```html
     <script src="https://tu-dominio.com/widget/widget.js" data-bot-id="nombre-empresa" async></script>
     ```
   - Indica las rutas de webhooks para WhatsApp y Telegram.
