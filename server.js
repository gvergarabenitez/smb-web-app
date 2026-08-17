const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// Demo sessions (in-memory, ephemeral)
const demoSessions = new Map();

async function notificarDemo(demo) {
  if (!process.env.RESEND_API_KEY) return;
  const resumen = demo.history
    .map(m => `${m.role === 'user' ? '👤 Prospecto' : '🧠 SMB'}: ${m.content}`)
    .join('\n\n');
  try {
    await resend.emails.send({
      from: 'Smart Mentor Bot <onboarding@resend.dev>',
      to: 'g.vergarabenitez@gmail.com',
      subject: `🧠 Demo SMB completado — ${demo.nombre} (${demo.empresa.substring(0, 40)})`,
      text: `Un prospecto completó el demo del Smart Mentor Bot.\n\n📋 CONTACTO\nNombre: ${demo.nombre}\nEmail: ${demo.email}\nTeléfono: ${demo.telefono}\nEmpresa: ${demo.empresa}\n\n--- CONVERSACIÓN ---\n\n${resumen}\n\n--- PERFIL EXPRESS GENERADO ---\n\n${demo.shocExpress}`
    });
  } catch (e) {
    console.error('Error enviando email notificación:', e.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'smb-admin-2026';
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');

// Ensure directories exist
if (!existsSync(path.join(__dirname, 'data'))) mkdirSync(path.join(__dirname, 'data'));
if (!existsSync(path.join(__dirname, 'uploads'))) mkdirSync(path.join(__dirname, 'uploads'));
if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, '[]');

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'smb-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Helpers
function loadSubmissions() {
  return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
}
function saveSubmissions(data) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
}

// ─── PUBLIC ROUTES ───────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/onboarding', (req, res) => {
  res.render('onboarding');
});

const uploadFields = upload.fields([
  { name: 'archivo_plan_estrategico', maxCount: 1 },
  { name: 'archivo_politicas', maxCount: 1 },
  { name: 'archivo_financiero', maxCount: 1 },
  { name: 'archivos_adicionales', maxCount: 5 },
]);

app.post('/onboarding', uploadFields, (req, res) => {
  const submissions = loadSubmissions();
  const id = uuidv4();

  const archivos = {};
  if (req.files) {
    for (const [field, files] of Object.entries(req.files)) {
      archivos[field] = files.map(f => ({ nombre: f.originalname, ruta: f.filename }));
    }
  }

  const submission = {
    id,
    fecha: new Date().toISOString(),
    estado: 'pendiente',
    datos: req.body,
    archivos,
  };

  submissions.push(submission);
  saveSubmissions(submissions);

  res.redirect('/gracias');
});

app.get('/gracias', (req, res) => {
  res.render('gracias');
});

// ─── DEMO ROUTES ──────────────────────────────────────────────────────────────

app.get('/demo', (req, res) => {
  res.render('demo');
});

app.post('/demo', async (req, res) => {
  const { nombre, email, telefono, web, empresa, cliente_ideal, desafio_principal, competidores, canales_clientes, objetivos, obstaculos } = req.body;

  const respuestas = `
1. Empresa y descripción: ${empresa}
2. Web: ${web || 'no indicada'}
3. Cliente ideal: ${cliente_ideal}
4. Mayor desafío o problema hoy: ${desafio_principal}
5. Competidores y diferenciación: ${competidores}
6. Cómo consigue clientes: ${canales_clientes}
7. Resultado en 6 meses: ${objetivos}
8. Obstáculos para lograrlo: ${obstaculos}
`.trim();

  const systemBase = `Eres el Smart Mentor Bot, una herramienta de mentoría estratégica basada en IA y Neuroestrategia Aplicada, desarrollada por Neuroinnova Chile SpA. No eres una IA genérica — eres un mentor especializado con metodología propia.

Tienes 17 modos de especialización: Estratega Comercial, Neuroestrategia, Prospección Inteligente, Cierre de Ventas, Propuesta de Valor, NeuroCopywriting, Análisis de Competencia, Mapa Estratégico, Misiones, Desafío Comercial, Identidad CEO, Planificación Estratégica, y Documentación de Procesos.

Tu metodología central es el Modelo SHoC (Sujeto, Hábitat, Obstáculos, Conducta) — un framework neuroestratégico que analiza cómo toman decisiones reales los clientes, no suposiciones.

Cuando respondas:
- Sé directo, concreto y accionable
- Menciona qué modo estás usando cuando sea relevante
- Muestra que conoces la empresa específica del usuario
- Da pasos concretos, no teoría genérica
- Cuando corresponda, indica qué haría el producto completo que el demo no puede mostrar`;

  let shocExpress = '';
  try {
    const r1 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Eres un experto en Neuroestrategia Aplicada. Basándote en estas respuestas, genera un perfil estratégico express (SHoC Express) en máximo 500 palabras. Incluye: contexto del negocio, cliente ideal, dolores y desafíos reales, análisis de competencia, oportunidades clave y riesgos críticos.\n\n${respuestas}`
      }]
    });
    shocExpress = r1.content[0].text;
  } catch (e) {
    shocExpress = `Empresa: ${empresa}. Cliente ideal: ${cliente_ideal}. Desafío: ${desafio_principal}. Objetivos: ${objetivos}.`;
  }

  // Primer mensaje de impacto automático
  let primerMensaje = '';
  try {
    const r2 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: systemBase,
      messages: [{
        role: 'user',
        content: `Preséntate brevemente como Smart Mentor Bot a este prospecto. Demuestra que ya analizaste su empresa usando el Modelo SHoC. Menciona 2-3 patrones críticos que detectaste en su negocio específico. Indica que tienes 17 modos de especialización disponibles. Termina preguntando cuál es el desafío más urgente que quieren resolver hoy. Sé directo e impactante — en máximo 200 palabras. No uses saludos genéricos.\n\nPerfil de la empresa:\n${shocExpress}`
      }]
    });
    primerMensaje = r2.content[0].text;
  } catch (e) {
    primerMensaje = `Analicé el perfil de **${empresa}** usando el Modelo SHoC. Tengo 17 modos de especialización disponibles para ti. ¿Cuál es el desafío más urgente que quieres resolver hoy?`;
  }

  const sessionId = uuidv4();
  demoSessions.set(sessionId, {
    nombre: nombre || 'Sin nombre',
    email: email || '',
    telefono: telefono || '',
    web: web || '',
    empresa,
    shocExpress,
    systemBase,
    primerMensaje,
    history: [],
    count: 0,
    createdAt: Date.now()
  });

  // Clean old sessions (>2 hours)
  for (const [id, s] of demoSessions) {
    if (Date.now() - s.createdAt > 2 * 60 * 60 * 1000) demoSessions.delete(id);
  }

  res.redirect(`/demo/chat/${sessionId}`);
});

app.get('/demo/chat/:id', (req, res) => {
  const demo = demoSessions.get(req.params.id);
  if (!demo) return res.redirect('/demo');
  res.render('demo-chat', { demo, sessionId: req.params.id, max: 5 });
});

app.post('/demo/chat/:id', async (req, res) => {
  const demo = demoSessions.get(req.params.id);
  if (!demo) return res.json({ error: 'Sesión expirada' });
  if (demo.count >= 5) return res.json({ error: 'límite alcanzado' });

  const userMessage = req.body.mensaje?.trim();
  if (!userMessage) return res.json({ error: 'Mensaje vacío' });

  demo.history.push({ role: 'user', content: userMessage });

  // Split system prompt: static block (cacheable) vs dynamic block (turn number changes each turn)
  const staticSystemBlock = `${demo.systemBase}

Estás en modo DEMO para la empresa "${demo.empresa}". Perfil estratégico (SHoC Express):

---
${demo.shocExpress}
---`;

  const dynamicSystemBlock = `Esta es la interacción ${demo.count + 1} de 5 del demo. Da respuestas concretas, personalizadas y accionables. Cuando sea útil, indica qué modo de especialización estás usando. Si el usuario pregunta algo que el producto completo haría mejor, menciónalo brevemente al final.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: [
        { type: 'text', text: staticSystemBlock, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicSystemBlock }
      ],
      messages: demo.history
    });

    const reply = response.content[0].text;
    demo.history.push({ role: 'assistant', content: reply });
    demo.count++;

    if (demo.count >= 5) notificarDemo(demo);

    res.json({ reply, count: demo.count, max: 5 });
  } catch (e) {
    res.json({ error: 'Error al procesar tu consulta. Intenta de nuevo.' });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Contraseña incorrecta' });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
  const submissions = loadSubmissions().reverse();
  res.render('admin/dashboard', { submissions });
});

app.get('/admin/cliente/:id', requireAdmin, (req, res) => {
  const submissions = loadSubmissions();
  const cliente = submissions.find(s => s.id === req.params.id);
  if (!cliente) return res.status(404).send('No encontrado');
  res.render('admin/cliente', { cliente });
});

app.post('/admin/cliente/:id/estado', requireAdmin, (req, res) => {
  const submissions = loadSubmissions();
  const idx = submissions.findIndex(s => s.id === req.params.id);
  if (idx !== -1) {
    submissions[idx].estado = req.body.estado;
    saveSubmissions(submissions);
  }
  res.redirect(`/admin/cliente/${req.params.id}`);
});

app.get('/admin/cliente/:id/archivo/:campo/:filename', requireAdmin, (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  res.download(filePath);
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`SMB Web App corriendo en puerto ${PORT}`);
});
