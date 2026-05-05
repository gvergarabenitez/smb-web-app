import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
