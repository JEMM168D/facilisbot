import fs from 'fs';
import path from 'path';

const templates = {
  coach: {
    config: {
      bot: {
        name: "CoachBot",
        niche: "coach",
        language: "es",
        personality: "inspirador, enfocado a resultados, reflexivo y estratégico",
        greeting: "¡Hola! Bienvenido al programa de Alto Rendimiento. ¿Te gustaría agendar una llamada de diagnóstico 1 a 1 o conocer nuestros programas de mentoría?",
        fallbackMessage: "¿Deseas agendar tu sesión estratégica gratuita de 20 minutos?",
        escalationMessage: "Te contacto directamente con el mentor principal para coordinar tu entrevista de admisión."
      },
      business: {
        name: "Impact Business Coaching",
        industry: "Coaching Ejecutivo y Consultoría de Negocios",
        description: "Mentoría y coaching estratégico para fundadores, CEOs y directivos que buscan escalar sus empresas y optimizar su liderazgo.",
        services: "Sesión de diagnóstico gratuita, Programa 1 a 1 de 12 semanas, Mastermind para CEOs, Taller de Liderazgo Corporativo",
        hours: "Lunes a Viernes de 8:00 AM a 6:00 PM (Sesiones virtuales vía Zoom/Google Meet).",
        location: "Sesiones Online globales / Oficinas en Torre Ejecutiva",
        phone: "+1 555-0108",
        email: "mentor@impactcoaching.com",
        website: "https://impactcoaching.com",
        paymentMethods: "Stripe, Transferencia internacional (Wire/Wise), Tarjeta de crédito"
      }
    },
    kb: {
      "programas.md": `# Programas de Coaching y Precios · Impact Coaching\n\n## 1. Sesión de Diagnóstico Estratégico (20 min)\n- **Costo**: 100% GRATIS para perfiles calificados.\n- Analizamos tus 3 principales cuellos de botella y definimos un plan de acción.\n\n## 2. Programa Ejecutivo 1 a 1 (12 Semanas)\n- **Inversión**: $2,500 USD.\n- Incluye 12 sesiones privadas semanales de 60 minutos, acceso directo por WhatsApp para consultas urgentes y plantillas de gestión.\n\n## 3. Mastermind para Emprendedores (Grupo Reducido)\n- **Inversión**: $650 USD / mes (mínimo 3 meses).\n- Sesiones quincenales en grupo de mastermind con otros dueños de negocio.`
    }
  },
  tienda: {
    config: {
      bot: {
        name: "ShopBot",
        niche: "tienda",
        language: "es",
        personality: "atento, rápido, servicial y orientado a resolver dudas de compra",
        greeting: "¡Hola! Bienvenido a Moda & Estilo Store. 🛍️ ¿Buscas algún producto en especial, consultar tu pedido o ver nuestras ofertas?",
        fallbackMessage: "¿Buscas conocer precios de productos, tallas o costo de envíos?",
        escalationMessage: "Te comunico con nuestro equipo de atención al cliente y soporte de envíos."
      },
      business: {
        name: "Moda & Estilo Store",
        industry: "E-commerce y Comercio Minorista",
        description: "Tienda online de ropa urbana, calzado y accesorios de moda con envíos rápidos a todo el país y garantía de satisfacción.",
        services: "Venta de ropa para dama y caballero, Calzado urbano, Accesorios, Envíos nacionales express, Cambios y devoluciones sin costo",
        hours: "Atención al cliente de Lunes a Sábado de 9:00 AM a 9:00 PM. Tienda online abierta 24/7.",
        location: "Centro de Distribución y Tienda Física: Av. Las Américas 500",
        phone: "+1 555-0109",
        email: "soporte@modayestilostore.com",
        website: "https://modayestilostore.com",
        paymentMethods: "Tarjeta de crédito/débito, PayPal, Mercado Pago, Pago contra entrega"
      }
    },
    kb: {
      "catalogo.md": `# Catálogo Destacado y Políticas · Moda & Estilo Store\n\n## 1. Productos Más Vendidos\n- **Hoodie Oversize Unisex (100% Algodón Premium)**: $38 USD. Tallas S, M, L, XL. Colores: Negro, Crema, Verde Olivo.\n- **Jeans Slim Fit Denim Elástico**: $42 USD. Tallas 28 a 38.\n- **Sneakers Urbanos Streetwear**: $65 USD. Tallas 25 a 30.\n\n## 2. Envíos y Tiempos de Entrega\n- **Envío Estándar (3 a 5 días hábiles)**: $4.50 USD (¡GRATIS en compras mayores a $50 USD!).\n- **Envío Express Día Siguiente**: $8.50 USD.\n\n## 3. Garantía y Cambios\n- Cuentas con 30 días naturales para cambios de talla sin costo de envío.`
    }
  },
  crm: {
    config: {
      bot: {
        name: "SalesBot B2B",
        niche: "crm",
        language: "es",
        personality: "corporativo, analítico, persuasivo y eficiente en calificación",
        greeting: "¡Hola! Bienvenido a TechSolutions Enterprise. ¿Buscas optimizar tus procesos con software de automatización o agendar una demo técnica?",
        fallbackMessage: "¿Te gustaría agendar una demostración de 15 minutos con un consultor de soluciones?",
        escalationMessage: "Te enlazo con un Ejecutivo de Cuentas Senior para coordinar una propuesta a la medida de tu empresa."
      },
      business: {
        name: "TechSolutions Enterprise",
        industry: "Software SaaS y Consultoría B2B",
        description: "Plataforma de automatización empresarial, CRM omnicanal y analítica de datos para medianas y grandes empresas.",
        services: "Implementación de CRM, Automatización de flujos de trabajo, Integración con ERP, Soporte técnico dedicado 24/7",
        hours: "Lunes a Viernes de 8:30 AM a 6:30 PM.",
        location: "Corporativo Sky Tower, Piso 15",
        phone: "+1 555-0110",
        email: "ventas@techsolutions.io",
        website: "https://techsolutions.io",
        paymentMethods: "Factura empresarial (30 días de crédito), Transferencia bancaria, Tarjeta corporativa"
      }
    },
    kb: {
      "soluciones.md": `# Soluciones Corporativas y Precios · TechSolutions\n\n## 1. Plan Growth (Equipos de 5 a 20 personas)\n- **Inversión**: $120 USD / mes (facturación anual).\n- Incluye: CRM comercial, hasta 5 canales integrados (WhatsApp, Web, Mail), analítica en vivo y soporte estándar.\n\n## 2. Plan Enterprise (Equipos de más de 20 personas)\n- **Inversión**: Cotización personalizada según volumen.\n- Incluye: Servidores dedicados, SLA 99.9%, integraciones a medida con ERP y onboarding presencial.`
    }
  },
  hoteleria: {
    config: {
      bot: {
        name: "HotelBot",
        niche: "hoteleria",
        language: "es",
        personality: "atento, elegante, hospitalario y servicial",
        greeting: "¡Hola! Bienvenido a Grand Hotel & Suites. 🛎️ ¿En qué fechas planeas tu estancia o qué tipo de habitación buscas?",
        fallbackMessage: "¿Deseas cotizar una habitación, consultar servicios de alberca o conocer las tarifas de temporada?",
        escalationMessage: "Te conecto con la recepción de reservas para confirmar la disponibilidad de tu suite."
      },
      business: {
        name: "Grand Hotel & Suites",
        industry: "Hotelería, Hospedaje y Turismo",
        description: "Hotel boutique de 4 estrellas con habitaciones de lujo, alberca climatizada, restaurante de autor, spa y salones de eventos.",
        services: "Habitaciones Estándar, Junior Suites, Master Suite con Jacuzzi, Desayuno buffet incluido, Salón para bodas y conferencias",
        hours: "Recepción 24 horas. Check-in: 3:00 PM / Check-out: 12:00 PM.",
        location: "Costera Miguel Alemán 200, Frente a la Bahía",
        phone: "+1 555-0111",
        email: "reservaciones@grandhotel.com",
        website: "https://grandhotel.com",
        paymentMethods: "Tarjetas de crédito/débito, Efectivo, Transferencia, Pago en recepción al llegar"
      }
    },
    kb: {
      "habitaciones.md": `# Habitaciones y Tarifas · Grand Hotel & Suites\n\n## 1. Tipos de Habitación y Tarifas por Noche\n- **Habitación Estándar (1 Cama King o 2 Matrimoniales)**: $85 USD/noche (hasta 2 adultos + 2 niños).\n- **Junior Suite con Vista al Mar**: $130 USD/noche. Balcón privado y sala de estar.\n- **Master Suite VIP con Jacuzzi en Terraza**: $210 USD/noche.\n\n## 2. Amenidades Incluidas\n- Desayuno buffet continental incluido de 7:00 AM a 11:00 AM.\n- Acceso libre a la alberca climatizada y gimnasio.\n- Wifi de alta velocidad en todo el hotel y estacionamiento privado con valet parking gratuito.`
    }
  },
  cafeteria: {
    config: {
      bot: {
        name: "CafeBot",
        niche: "cafeteria",
        language: "es",
        personality: "cálido, relajado, apasionado por el café de especialidad",
        greeting: "¡Hola! Bienvenido a Café de Origen. ☕ ¿Se te antoja un café de especialidad, ver el menú de desayunos o pedir para recoger?",
        fallbackMessage: "¿Buscas ver nuestra barra de café, postres o saber la contraseña del wifi?",
        escalationMessage: "Te paso con nuestro barista en barra para cualquier pedido especial."
      },
      business: {
        name: "Café de Origen - Barra de Especialidad",
        industry: "Cafetería y Tostaduría Artesanal",
        description: "Café 100% de origen seleccionado, métodos artesanales de extracción (V60, Chemex, Aeropress), repostería fresca y espacio pet friendly con wifi rápido.",
        services: "Bebidas frías y calientes, Desayunos ligeros, Repostería artesanal, Venta de café en grano o molido, Espacio para coworking",
        hours: "Lunes a Domingo de 7:30 AM a 9:30 PM.",
        location: "Callejón de las Letras 18, Zona Bohemio",
        phone: "+1 555-0112",
        email: "hola@cafedeorigen.com",
        website: "https://cafedeorigen.com",
        paymentMethods: "Efectivo, Tarjetas sin contacto, Apple/Google Pay, Transferencia"
      }
    },
    kb: {
      "menu.md": `# Menú de Café y Desayunos · Café de Origen\n\n## 1. Barra de Café Caliente\n- **Espresso Simple / Doble**: $2.50 / $3.20 USD.\n- **Cappuccino Artesanal / Flat White**: $3.80 USD.\n- **Latte con Esencia (Vainilla, Caramelo, Avellana)**: $4.20 USD.\n- **Métodos de Filtrado Manual (V60, Chemex)**: $4.50 USD.\n\n## 2. Bebidas Frías y Especiales\n- **Iced Latte / Cold Brew 18 Horas**: $4.50 USD.\n- **Frappé de Moka o Matcha Japonés**: $5.20 USD.\n\n## 3. Desayunos y Tostadas\n- **Avocado Toast con Huevo Poché y Semillas**: $6.50 USD.\n- **Croissant Francés con Mantequilla y Mermelada**: $3.50 USD.`
    }
  },
  panaderia: {
    config: {
      bot: {
        name: "PanBot",
        niche: "panaderia",
        language: "es",
        personality: "dulce, hogareño, tradicional y cordial",
        greeting: "¡Hola! Bienvenido a Panadería La Tradición. 🥖 ¿Deseas cotizar un pastel para tu evento o consultar los panes recién horneados del día?",
        fallbackMessage: "¿Buscas información de pasteles sobre pedido o variedades de pan del día?",
        escalationMessage: "Te comunico con nuestro maestro pastelero para tomar los detalles de tu pastel personalizado."
      },
      business: {
        name: "Panadería y Pastelería La Tradición",
        industry: "Panadería y Pastelería Artesanal",
        description: "Panadería con más de 30 años de tradición horneando pan dulce, hogazas de masa madre, pasteles para fiestas y repostería fina sin conservadores.",
        services: "Venta de pan dulce y salado diario, Pasteles personalizados para cumpleaños y bodas, Bocadillos para reuniones, Pedidos mayoristas para restaurantes",
        hours: "Lunes a Domingo de 6:30 AM a 9:00 PM.",
        location: "Plaza Central 40, Barrio San José",
        phone: "+1 555-0113",
        email: "pedidos@panaderialatradicion.com",
        website: "https://panaderialatradicion.com",
        paymentMethods: "Efectivo, Tarjetas bancarias, Transferencia"
      }
    },
    kb: {
      "pasteles.md": `# Catálogo de Pasteles y Panadería · La Tradición\n\n## 1. Pasteles Clásicos (10 a 20 personas)\n- **Pastel Tres Leches con Fruta Fresca**: $24 USD (15 personas).\n- **Pastel Selva Negra con Chocolate Belga**: $28 USD (15 personas).\n- **Cheesecake de Frutos Rojos estilo New York**: $26 USD.\n\n## 2. Pan de Masa Madre (Sourdough)\n- **Hogaza Rústica Tradicional (750 g)**: $4.50 USD.\n- **Hogaza de Arándanos y Nuez**: $6.00 USD.\n\n## 3. Pedidos Especiales\n- Para pasteles con diseño personalizado o fondant, se requiere encargar con al menos 48 horas de anticipación y 50% de anticipo.`
    }
  },
  clinica: {
    config: {
      bot: {
        name: "MediBot",
        niche: "clinica",
        language: "es",
        personality: "profesional, empático, claro y reconfortante",
        greeting: "¡Hola! Bienvenido al Centro Médico San Rafael. 🏥 ¿Te gustaría agendar una consulta médica, revisar horarios de especialistas o laboratorios?",
        fallbackMessage: "¿Deseas programar una cita médica o consultar disponibilidad de especialidades?",
        escalationMessage: "Te transfiero con nuestro módulo de enfermería y recepción para darte atención inmediata."
      },
      business: {
        name: "Centro Médico San Rafael",
        industry: "Salud, Medicina General y Especialidades",
        description: "Policlínica médica con especialistas en Medicina General, Pediatría, Ginecología, Cardiología, Nutrición y Laboratorio de análisis clínicos.",
        services: "Consultas de medicina general, Citas con especialistas, Análisis de laboratorio y ultrasonido, Chequeos preventivos integrales",
        hours: "Consultas de Lunes a Sábado de 8:00 AM a 8:00 PM. Urgencias 24/7.",
        location: "Av. Universidad Médica 1050",
        phone: "+1 555-0114",
        email: "recepcion@clinicasanrafael.com",
        website: "https://clinicasanrafael.com",
        paymentMethods: "Efectivo, Tarjetas bancarias, Convenio con aseguradoras médicas"
      }
    },
    kb: {
      "especialidades.md": `# Especialidades Médicas y Costos de Consulta · San Rafael\n\n## 1. Consultas Médicas\n- **Medicina General**: $25 USD.\n- **Pediatría / Ginecología**: $45 USD.\n- **Cardiología / Medicina Interna**: $55 USD.\n\n## 2. Laboratorio y Estudios\n- **Check-up Básico (Biometría hemática + Química sanguínea + EGO)**: $35 USD (resultados en 4 horas).\n- **Ultrasonido Diagnóstico**: desde $40 USD.\n\n## 3. Urgencias Médicas\n- Servicio de guardia médica las 24 horas del día.`
    }
  },
  starter: {
    config: {
      bot: {
        name: "Asistente Virtual",
        niche: "starter",
        language: "es",
        personality: "cercano, servicial, profesional y conciso",
        greeting: "¡Hola! Bienvenido a nuestro asistente virtual. ¿En qué te puedo ayudar hoy?",
        fallbackMessage: "Disculpa, ¿podrías darme más detalles de lo que buscas para poder orientarte?",
        escalationMessage: "Te comunico con un asesor de nuestro equipo para atenderte personalmente."
      },
      business: {
        name: "Mi Negocio",
        industry: "Servicios y Atención al Cliente",
        description: "Empresa comprometida con brindar la mejor atención, soluciones personalizadas y precios justos a todos nuestros clientes.",
        services: "Atención al cliente, Consultoría, Ventas, Soporte técnico, Asesoría personalizada",
        hours: "Lunes a Viernes de 9:00 AM a 6:00 PM. Sábados de 9:00 AM a 2:00 PM.",
        location: "Atención en línea y oficinas centrales",
        phone: "+1 555-0100",
        email: "contacto@minegocio.com",
        website: "https://minegocio.com",
        paymentMethods: "Efectivo, Tarjetas de débito/crédito, Transferencia bancaria, Pagos en línea"
      }
    },
    kb: {
      "faq.md": `# Preguntas Frecuentes · Información General\n\n## ¿Cuáles son sus horarios de atención?\nNuestro horario es de Lunes a Viernes de 9:00 AM a 6:00 PM y Sábados de 9:00 AM a 2:00 PM.\n\n## ¿Cómo puedo solicitar una cotización?\nDéjanos tu nombre, teléfono de WhatsApp y el servicio que te interesa; un asesor te enviará la cotización personalizada de inmediato.`
    }
  }
};

const templatesDir = path.join(process.cwd(), 'templates');

for (const [slug, data] of Object.entries(templates)) {
  const dir = path.join(templatesDir, slug);
  const kbDir = path.join(dir, 'kb');

  fs.mkdirSync(kbDir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'bot.config.json'), JSON.stringify(data.config, null, 2), 'utf8');

  for (const [file, content] of Object.entries(data.kb)) {
    fs.writeFileSync(path.join(kbDir, file), content, 'utf8');
  }

  console.log(`[Template Scaffolder] Generada plantilla para: ${slug}`);
}
console.log('¡Todas las plantillas generadas con éxito!');
