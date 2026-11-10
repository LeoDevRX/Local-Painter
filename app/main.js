// LocalPaint desktop app (Electron). Runs LocalPaint.html in its own window with the fast GPU,
// direct access to the presets folder next to LocalPaint.exe, and .lp project files (open / save / save as,
// double-click a .lp in Explorer to open it).
const { app, BrowserWindow, ipcMain, session, shell, dialog, net } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Use the dedicated (high-performance) GPU on laptops with two, and never fall back to software.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

const exeDir = path.dirname(process.execPath);
// LocalPaint used to be called LMP: keep using the old settings folder (settings, recent files, caches) if it's there.
{
  const old = path.join(app.getPath('appData'), 'LMP');
  app.setPath('userData', fs.existsSync(old) ? old : path.join(app.getPath('appData'), 'LocalPaint'));
}
/** Scanned materials downloaded on first use live in presets/<SCANS>/<category>/<name>/. */
const SCANS = 'Scanned materials';
const PROJECT_EXTS = ['.lp', '.lmp', '.tpaint'];

// presets folder: next to LocalPaint.exe, else the user's documents.
function presetsDir() {
  const candidates = [path.join(exeDir, 'presets'), path.join(exeDir, '..', 'presets'), path.join(app.getPath('documents'), 'LocalPaint', 'presets')];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const d = candidates[0];
  try { fs.mkdirSync(d, { recursive: true }); return d; } catch { return candidates[2]; }
}

function walk(dir, depth, rel, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile()) out.push({ name: e.name, dir: rel, path: full, size: fs.statSync(full).size });
    else if (e.isDirectory() && depth > 0 && !(rel === '' && e.name === SCANS)) walk(full, depth - 1, rel ? `${rel}/${e.name}` : e.name, out);
  }
}

ipcMain.handle('presets:list', () => { const out = []; walk(presetsDir(), 3, '', out); return { root: presetsDir(), files: out }; });
ipcMain.handle('presets:read', (_e, p) => {
  const root = path.resolve(presetsDir());
  const full = path.resolve(p);
  if (!full.startsWith(root)) throw new Error('outside the presets folder');
  const b = fs.readFileSync(full);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
ipcMain.handle('presets:write', (_e, name, data) => {
  const safe = String(name).replace(/[\\/:*?"<>|]+/g, '_');
  const full = path.join(presetsDir(), safe);
  fs.writeFileSync(full, Buffer.from(data));
  return full;
});
ipcMain.handle('presets:open', () => shell.openPath(presetsDir()));

// ---------------------------------------------------------------- .lp project files (.lmp / .tpaint from older versions still open)

let lastDir = '';
function projectsDir() {
  if (lastDir && fs.existsSync(lastDir)) return lastDir;
  const d = path.join(app.getPath('documents'), 'LocalPaint Projects');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* fine */ }
  return d;
}
const safeName = (n) => (String(n || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled');

/** Save a project. With a path and !saveAs it overwrites silently; otherwise asks where. Returns the path or null. */
ipcMain.handle('project:save', async (e, name, data, filePath, saveAs) => {
  let target = filePath && !saveAs ? filePath : null;
  if (!target) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const def = filePath ? filePath.replace(/\.(tpaint|lmp)$/i, '.lp') : path.join(projectsDir(), `${safeName(name)}.lp`);
    const r = await dialog.showSaveDialog(win, {
      title: saveAs ? 'Save LocalPaint project as' : 'Save LocalPaint project', defaultPath: def,
      filters: [{ name: 'LocalPaint project', extensions: ['lp'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath.toLowerCase().endsWith('.lp') ? r.filePath : r.filePath + '.lp';
  }
  const tmp = target + '.saving';
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, target); // a crash mid-save never leaves a broken project
  lastDir = path.dirname(target);
  if (!isAutosave(target)) addRecent(target);
  return target;
});

/** Ask for a project to open. Returns { path, data } or null. */
ipcMain.handle('project:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Open LocalPaint project', defaultPath: projectsDir(), properties: ['openFile'],
    filters: [{ name: 'LocalPaint project', extensions: ['lp', 'lmp', 'tpaint'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  // The renderer checks the file type before requesting the contents. An accidental
  // .spp selection can be several GB and must not be read as a JSON project.
  return { path: r.filePaths[0] };
});
ipcMain.handle('project:read', (_e, p, autosave) => readProject(p, autosave));
function readProject(p, autosave = false) {
  const b = fs.readFileSync(p);
  if (!autosave && !isAutosave(p)) { lastDir = path.dirname(p); addRecent(p); }
  return { path: p, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}

/** Any file to import (model, HDR, Substance file, textures...). */
ipcMain.handle('file:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Import into LocalPaint', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Everything LocalPaint can open', extensions: ['lp', 'lmp', 'tpaint', 'glb', 'gltf', 'fbx', 'obj', 'hdr', 'sbsar', 'spsm', 'spmsk', 'tpsmart', 'tpmat', 'tptex', 'tpbrush', 'tpgraph', 'png', 'jpg', 'jpeg', 'webp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (r.canceled) return [];
  return r.filePaths.map((p) => {
    // Retain the filename so the renderer can explain this unsupported format.
    const b = /\.spp$/i.test(p) ? Buffer.alloc(0) : fs.readFileSync(p);
    return { path: p, name: path.basename(p), data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  });
});

/** Reimport mesh: read a model file again (only 3D model files). */
const MODEL_EXT = /\.(fbx|obj|glb|gltf)$/i;
function readModelFile(p) {
  if (!p || !MODEL_EXT.test(p) || !fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  return { path: p, name: path.basename(p), data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}
ipcMain.handle('model:read', (_e, p) => readModelFile(p));
ipcMain.handle('model:pick', async (e, near) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Reimport mesh', properties: ['openFile'],
    defaultPath: near && fs.existsSync(path.dirname(near)) ? near : lastDir,
    filters: [{ name: '3D model', extensions: ['fbx', 'obj', 'glb', 'gltf'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readModelFile(r.filePaths[0]);
});

/** Make .lp (and old .lmp) files open in LocalPaint and show its icon in Explorer (current user only, no admin needed). */
function registerFileType() {
  if (process.platform !== 'win32' || process.env.LMP_NO_ASSOC || process.env.LOCALPAINT_NO_ASSOC) return;
  const exe = process.execPath;
  if (/electron\.exe$/i.test(exe)) return; // not when running from a dev copy
  const icon = path.join(exeDir, 'localpaint-file.ico');
  const iconRef = fs.existsSync(icon) ? `"${icon}"` : `"${exe}",0`;
  const P = 'HKCU\\Software\\Classes\\LocalPaint.Project';
  const keys = [
    ...['.lp', '.lmp'].flatMap((ext) => [
      [`HKCU\\Software\\Classes\\${ext}`, '', 'LocalPaint.Project'],
      [`HKCU\\Software\\Classes\\${ext}`, 'Content Type', 'application/x-localpaint-project'],
    ]),
    [P, '', 'LocalPaint project'],
    [P + '\\DefaultIcon', '', iconRef],
    [P + '\\shell\\open', 'FriendlyAppName', 'LocalPaint'],
    [P + '\\shell\\open\\command', '', `"${exe}" "%1"`],
  ];
  let i = 0;
  const next = () => {
    if (i >= keys.length) { execFile('ie4uinit.exe', ['-show'], () => {}); return; }
    const [k, v, d] = keys[i++];
    const args = ['add', k, ...(v ? ['/v', v] : ['/ve']), '/d', d, '/f'];
    execFile('reg.exe', args, { windowsHide: true }, () => next());
  };
  next();
}

// ---------------------------------------------------------------- autosave, crash recovery, recent files

function autosaveDir() {
  const tries = [];
  if (process.platform === 'win32' && fs.existsSync('D:\\')) tries.push('D:\\LocalPaint\\autosave');
  tries.push(path.join(exeDir, 'autosave'), path.join(app.getPath('userData'), 'autosave'));
  for (const d of tries) {
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { /* next */ }
  }
  return tries[tries.length - 1];
}
const metaOf = (f) => f.replace(/\.(lp|lmp)$/i, '.json');

/** Autosave copies ("Name__2026-11-06T18-15-…lp" or anything in an autosave folder) stay out of the recent lists. */
function isAutosave(p) {
  const f = String(p || '');
  return /__\d{4}-\d{2}-\d{2}T\d{2}-\d{2}/.test(path.basename(f)) || /[\\/]autosave[\\/][^\\/]+$/i.test(f);
}
const sameFile = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
/** Add to the in-app recent list's order and to Windows' taskbar / Start recent list. */
function addRecent(p) {
  try { app.addRecentDocument(p); } catch { /* fine */ }
}
/**
 * Rebuild Windows' taskbar recent list from LocalPaint's own list: only real projects that still exist, each once,
 * newest 10. This clears out autosave copies older versions put there.
 */
function rebuildJumpList() {
  if (process.platform !== 'win32') return;
  try {
    const seen = [];
    for (const r of readRecent()) {
      if (!r?.path || isAutosave(r.path) || !fs.existsSync(r.path) || seen.some((s) => sameFile(s, r.path))) continue;
      seen.push(r.path);
      if (seen.length >= 10) break;
    }
    app.clearRecentDocuments();
    for (const p of seen.reverse()) app.addRecentDocument(p); // oldest first, so the newest ends up on top
  } catch { /* fine */ }
}

/** Write an autosave (keeps the newest `keep` per project). */
ipcMain.handle('autosave:write', (_e, name, data, thumb, projectPath, keep) => {
  const dir = autosaveDir();
  const base = safeName(name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${base}__${stamp}.lp`);
  fs.writeFileSync(file + '.saving', Buffer.from(data));
  fs.renameSync(file + '.saving', file);
  fs.writeFileSync(metaOf(file), JSON.stringify({ name, time: Date.now(), projectPath: projectPath || '', thumb: thumb || '' }));
  const mine = fs.readdirSync(dir).filter((f) => f.startsWith(base + '__') && /\.(lp|lmp)$/i.test(f)).sort().reverse();
  for (const old of mine.slice(Math.max(1, keep || 5))) {
    try { fs.unlinkSync(path.join(dir, old)); fs.unlinkSync(metaOf(path.join(dir, old))); } catch { /* fine */ }
  }
  return file;
});
ipcMain.handle('autosave:list', () => {
  const dir = autosaveDir();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.(lp|lmp)$/i.test(f)); } catch { return []; }
  return files.map((f) => {
    const full = path.join(dir, f);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaOf(full), 'utf8')); } catch { /* no meta */ }
    const st = fs.statSync(full);
    return { path: full, name: meta.name || f.replace(/__.*$/, ''), time: meta.time || st.mtimeMs, thumb: meta.thumb || '', projectPath: meta.projectPath || '', size: st.size };
  }).sort((a, b) => b.time - a.time);
});
ipcMain.handle('autosave:open-folder', () => shell.openPath(autosaveDir()));

const lockFile = () => path.join(app.getPath('userData'), 'session.lock');
/** Was the last session closed properly? (A crash leaves the lock file behind.) */
ipcMain.handle('session:start', () => {
  const crashed = fs.existsSync(lockFile());
  try { fs.writeFileSync(lockFile(), String(Date.now())); } catch { /* fine */ }
  return { crashed };
});
app.on('will-quit', () => { try { fs.unlinkSync(lockFile()); } catch { /* fine */ } });

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
function readRecent() { try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')); } catch { return []; } }
ipcMain.handle('recent:list', () => readRecent().filter((r) => !isAutosave(r.path) && fs.existsSync(r.path)));
ipcMain.handle('recent:add', (_e, p, name, thumb) => {
  if (isAutosave(p)) return false;
  const list = readRecent().filter((r) => !isAutosave(r.path) && !sameFile(r.path, p));
  list.unshift({ path: p, name, thumb: thumb || '', time: Date.now() });
  try { fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 12))); } catch { /* fine */ }
  return true;
});
ipcMain.handle('recent:remove', (_e, p) => { try { fs.writeFileSync(recentFile(), JSON.stringify(readRecent().filter((r) => r.path !== p))); } catch { /* fine */ } return true; });

// ---------------------------------------------------------------- updates (GitHub releases)

const REPO = 'LeoDevRX/LMP';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
async function getJSON(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'LocalPaint-updater', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r.json();
}
async function getBytes(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'LocalPaint-updater' } });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
/** The small update zip of a release (LocalPaint-vX.XX-update.zip; LMP-… before the rename). */
const updateAsset = (rel) => (rel.assets || []).find((a) => /^(LocalPaint|LMP)-v[\d.]+-update\.zip$/i.test(a.name));
/** The newest release: { version, notes, url, hasUpdateFiles } or { error } when offline. */
ipcMain.handle('update:check', async () => {
  try {
    const rel = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`);
    return { version: String(rel.tag_name || '').replace(/^v/i, ''), notes: rel.body || '', url: rel.html_url || RELEASES, hasUpdateFiles: !!updateAsset(rel) };
  } catch (e) { return { error: String(e.message || e) }; }
});

/** Read the files of a zip (stored or deflated entries; enough for LocalPaint's own update zips). */
function unzip(buf) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The update file is damaged');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The update file is damaged');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + ln + lx, off + 30 + ln + lx + csize);
    out.set(name, method === 0 ? Buffer.from(data) : method === 8 ? zlib.inflateRawSync(data) : null);
  }
  return out;
}

/** Download the newest release's small update zip, check it, and swap the app files in. Needs a restart after. */
ipcMain.handle('update:install', async () => {
  const appDir = __dirname;
  try {
    const rel = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = updateAsset(rel);
    if (!asset) throw new Error('This release has no update file');
    const zip = await getBytes(asset.browser_download_url);
    if (asset.size && zip.length !== asset.size) throw new Error('The download was cut off');
    const want = String(asset.digest || '').replace(/^sha256:/i, '');
    if (want && crypto.createHash('sha256').update(zip).digest('hex') !== want) throw new Error('The update didn\'t download correctly');
    // Only the app's own files (LocalPaint/resources/app/*), never anything outside that folder.
    const files = [...unzip(zip)].filter(([n, b]) => b && /^(LocalPaint|LMP)\/resources\/app\/[\w.-]+$/.test(n)).map(([n, b]) => [n.split('/').pop(), b]);
    if (!files.some(([n]) => n === 'LocalPaint.html' || n === 'LMP.html')) throw new Error('The update file is missing the app page');
    fs.accessSync(appDir, fs.constants.W_OK);
    for (const [name, b] of files) fs.writeFileSync(path.join(appDir, name + '.new'), b);
    for (const [name] of files) {
      const target = path.join(appDir, name);
      if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
      fs.renameSync(target + '.new', target);
    }
    return { ok: true, version: String(rel.tag_name || '').replace(/^v/i, '') };
  } catch (e) {
    const msg = String(e.message || e);
    return { ok: false, error: /EACCES|EPERM|EROFS/.test(msg) ? 'LocalPaint can\'t write to its own folder (it may be in a protected place like Program Files).' : msg, url: RELEASES };
  }
});
// ---------------------------------------------------------------- scanned materials (download on first use)

const MAT_BASE = `https://github.com/${REPO}/releases/download/materials/`;
const catalogCache = () => path.join(app.getPath('userData'), 'materials-catalog.json');
const safePart = (n) => String(n).replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim() || 'Material';
const scanDir = (m) => path.join(presetsDir(), SCANS, safePart(m.cat), safePart(m.name));
function readCatalog(p) { try { const c = JSON.parse(fs.readFileSync(p, 'utf8')); return c && Array.isArray(c.materials) ? c : null; } catch { return null; } }
/** The catalog of scanned materials: online if possible (and cached), else the cached or bundled copy. */
ipcMain.handle('cloud:catalog', async (_e, online) => {
  let cat = null;
  if (online) {
    try {
      const r = await net.fetch(MAT_BASE + 'materials-catalog.json', { headers: { 'User-Agent': 'LocalPaint' } });
      if (r.ok) { const txt = await r.text(); cat = JSON.parse(txt); if (cat?.materials) fs.writeFileSync(catalogCache(), txt); }
    } catch { /* offline */ }
  }
  cat = (cat?.materials && cat) || readCatalog(catalogCache()) || readCatalog(path.join(presetsDir(), 'materials-catalog.json'));
  if (!cat) return null;
  for (const m of cat.materials) m.downloaded = fs.existsSync(scanDir(m));
  return cat;
});
/** Make sure a scanned material is on this PC (download + unpack it the first time). Returns its files. */
ipcMain.handle('cloud:get', async (_e, m) => {
  const dir = scanDir(m);
  try {
    if (!fs.existsSync(dir)) {
      if (!/^mat-[\w.-]+\.zip$/.test(String(m.file))) throw new Error('Unknown material');
      const zip = await getBytes(MAT_BASE + m.file);
      const files = [...unzip(zip)].filter(([n, b]) => b && /^[^/\\]+\.(jpg|jpeg|png)$/i.test(n));
      if (!files.length) throw new Error('The download was empty');
      const tmp = dir + '.part';
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      for (const [n, b] of files) fs.writeFileSync(path.join(tmp, n), b);
      fs.renameSync(tmp, dir);
    }
    return { ok: true, files: fs.readdirSync(dir).map((n) => ({ name: n, path: path.join(dir, n) })) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// CC0 grunge library (grunges-catalog.json + grunge-*.jpg in the materials release), downloaded the first time a mask uses one.
const grungeDir = () => path.join(app.getPath('userData'), 'grunges');
ipcMain.handle('grunge:catalog', async () => {
  const cache = path.join(grungeDir(), 'grunges-catalog.json');
  try {
    const r = await net.fetch(MAT_BASE + 'grunges-catalog.json', { headers: { 'User-Agent': 'LocalPaint' } });
    if (r.ok) { const txt = await r.text(); const cat = JSON.parse(txt); if (cat?.grunges) { fs.mkdirSync(grungeDir(), { recursive: true }); fs.writeFileSync(cache, txt); return cat; } }
  } catch { /* offline */ }
  try { return JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { return null; }
});
ipcMain.handle('grunge:get', async (_e, file) => {
  const n = String(file || '');
  if (!/^grunge-[\w.-]+\.(jpg|png)$/.test(n)) return null;
  const f = path.join(grungeDir(), n);
  try {
    if (!fs.existsSync(f)) {
      const b = await getBytes(MAT_BASE + n);
      fs.mkdirSync(grungeDir(), { recursive: true });
      fs.writeFileSync(f + '.part', b);
      fs.renameSync(f + '.part', f);
    }
    return new Uint8Array(fs.readFileSync(f));
  } catch { return null; }
});

ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('shell:open', (_e, url) => {
  if (/^https:\/\/github\.com\/LeoDevRX\//i.test(String(url))) shell.openExternal(String(url));
});

// ---------------------------------------------------------------- Substance materials
//
// .sbsar files are compiled graphs. If Adobe's own renderer (sbsrender.exe, part of Substance 3D
// Designer and the Automation Toolkit) is on this PC, LocalPaint runs the real graph with it, so materials
// look exactly like they do in Painter. LocalPaint never ships Adobe's engine; it only calls the copy the
// user already has installed.

const os = require('os');
const SBS_DIRS = () => {
  const roots = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramW6432,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const out = [];
  for (const r of [...new Set(roots)]) for (const vendor of ['Adobe', 'Allegorithmic']) {
    const d = path.join(r, vendor);
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) if (/substance/i.test(n)) out.push(path.join(d, n));
  }
  return out;
};
function findFile(dir, re, depth, found) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && re.test(e.name)) found.push(full);
    else if (e.isDirectory() && depth > 0 && !/^(node_modules|\.git)$/.test(e.name)) findFile(full, re, depth - 1, found);
    if (found.length > 4000) return;
  }
}
const isSbsrender = (p) => typeof p === 'string' && /(^|[\\/])sbsrender(\.exe)?$/i.test(p) && fs.existsSync(p);
let sbsFound;
function findSbsrender(custom) {
  if (isSbsrender(custom)) return custom;
  if (sbsFound !== undefined) return sbsFound;
  // Designer / Automation Toolkit first (they ship sbsrender), then anything else from Adobe Substance.
  const dirs = SBS_DIRS().sort((a, b) => (/designer|automation/i.test(b) ? 1 : 0) - (/designer|automation/i.test(a) ? 1 : 0));
  for (const d of dirs) {
    const found = [];
    findFile(d, /^sbsrender(\.exe)?$/i, 3, found);
    if (found.length) { sbsFound = found[0]; return sbsFound; }
  }
  sbsFound = null;
  return null;
}
ipcMain.handle('sbs:engine', (_e, custom) => { const p = findSbsrender(custom); return p ? { path: p } : null; });
ipcMain.handle('sbs:pick', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Where is sbsrender.exe? (in your Substance 3D Designer folder)', properties: ['openFile'],
    filters: [{ name: 'sbsrender', extensions: ['exe'] }], defaultPath: SBS_DIRS()[0],
  });
  const p = r.canceled ? null : r.filePaths[0];
  return isSbsrender(p) ? { path: p } : (p ? { error: 'That file isn\'t sbsrender.exe.' } : null);
});

const sbsTmp = () => { const d = path.join(os.tmpdir(), 'LocalPaint-substance'); fs.mkdirSync(path.join(d, 'mesh'), { recursive: true }); return d; };
const sbsSafe = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 120);
const ID_RE = /^[$A-Za-z_][\w$]*$/;
/**
 * req: { exe, key, sbsar?, graph?, values: [id, "v1,v2"][], entries: [id, name][], meshes?: [name, Uint8Array][] }
 * Returns { files: [{ name, data }], log } or { need: { sbsar?: true, meshes?: string[] } } or { error }.
 */
ipcMain.handle('sbs:render', async (_e, req) => {
  if (!isSbsrender(req && req.exe)) return { error: 'Adobe\'s renderer (sbsrender.exe) wasn\'t found.' };
  const dir = sbsTmp();
  const sbs = path.join(dir, sbsSafe(req.key) + '.sbsar');
  if (req.sbsar) fs.writeFileSync(sbs, Buffer.from(req.sbsar));
  for (const [n, data] of req.meshes || []) fs.writeFileSync(path.join(dir, 'mesh', sbsSafe(n) + '.png'), Buffer.from(data));
  const need = {};
  if (!fs.existsSync(sbs)) need.sbsar = true;
  const missing = (req.entries || []).map((x) => x[1]).filter((n) => !fs.existsSync(path.join(dir, 'mesh', sbsSafe(n) + '.png')));
  if (missing.length) need.meshes = missing;
  if (need.sbsar || need.meshes) return { need };
  const job = path.join(dir, 'job-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(job);
  const args = ['render', '--input', sbs, '--output-path', job, '--output-name', '{outputNodeName}', '--output-format', 'png'];
  if (req.graph) args.push('--input-graph', String(req.graph));
  for (const [id, v] of req.values || []) if (ID_RE.test(id) && /^[-\d.,e]+$/i.test(String(v))) args.push('--set-value', `${id}@${v}`);
  for (const [id, n] of req.entries || []) if (ID_RE.test(id)) args.push('--set-entry', `${id}@${path.join(dir, 'mesh', sbsSafe(n) + '.png')}`);
  const res = await new Promise((resolve) => {
    execFile(req.exe, args, { windowsHide: true, timeout: 240000, maxBuffer: 32 * 1024 * 1024, cwd: path.dirname(req.exe) }, (err, stdout, stderr) => {
      resolve({ err, log: `${stdout || ''}\n${stderr || ''}`.trim().slice(-4000) });
    });
  });
  const files = [];
  try {
    for (const n of fs.readdirSync(job)) if (/\.(png|jpe?g)$/i.test(n)) files.push({ name: n, data: fs.readFileSync(path.join(job, n)) });
  } catch { /* none */ }
  try { fs.rmSync(job, { recursive: true, force: true }); } catch { /* fine */ }
  if (!files.length) return { error: (res.err ? String(res.err.message || res.err) + '\n' : '') + res.log };
  return { files, log: res.log };
});

/** Materials from the user's Substance 3D Painter (its starter assets and their own assets folder). */
let sbsLibRoots = [];
ipcMain.handle('sbs:library', () => {
  const roots = [];
  for (const d of SBS_DIRS()) if (/painter/i.test(d)) roots.push({ dir: path.join(d, 'resources'), source: 'Substance Painter' });
  for (const docs of [app.getPath('documents'), path.join(os.homedir(), 'OneDrive', 'Documents')]) {
    for (const sub of ['Adobe', 'Allegorithmic']) for (const n of ['Adobe Substance 3D Painter', 'Substance Painter']) roots.push({ dir: path.join(docs, sub, n, 'assets'), source: 'Your Painter assets' });
  }
  const live = roots.filter((r) => fs.existsSync(r.dir));
  sbsLibRoots = live.map((r) => r.dir);
  const out = [];
  const seen = new Set();
  for (const r of live) {
    const found = [];
    findFile(r.dir, /\.sbsar$/i, 5, found);
    for (const f of found) {
      const rel = path.relative(r.dir, f).replace(/\\/g, '/');
      // only materials (not the filters, generators and grunges Painter also ships as .sbsar)
      if (!/(^|\/)materials?\//i.test(rel)) continue;
      const k = path.basename(f).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      let size = 0;
      try { size = fs.statSync(f).size; } catch { /* fine */ }
      out.push({ name: path.basename(f, path.extname(f)), path: f, size, source: r.source });
    }
  }
  return out;
});
ipcMain.handle('sbs:read', (_e, p) => {
  const full = path.resolve(String(p));
  if (!/\.sbsar$/i.test(full) || !sbsLibRoots.some((r) => full.toLowerCase().startsWith(path.resolve(r).toLowerCase() + path.sep))) return null;
  try { return fs.readFileSync(full); } catch { return null; }
});

// ---------------------------------------------------------------- texture export (output directory)

/** Default output folder: D:\LocalPaint\export when there is a D: drive, else Documents\LocalPaint\export. */
function defaultExportDir() {
  if (process.platform === 'win32' && fs.existsSync('D:\\')) return 'D:\\LocalPaint\\export';
  return path.join(app.getPath('documents'), 'LocalPaint', 'export');
}
ipcMain.handle('export:defaultDir', () => defaultExportDir());
ipcMain.handle('export:pickDir', async (e, current) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Output directory', properties: ['openDirectory', 'createDirectory'], defaultPath: current || defaultExportDir(),
  });
  return r.canceled ? null : r.filePaths[0];
});
/** files: [{ name, data }] — plain file names only, written into dir (created if needed). */
ipcMain.handle('export:write', (_e, dir, files) => {
  try {
    const d = path.resolve(String(dir || defaultExportDir()));
    fs.mkdirSync(d, { recursive: true });
    const written = [];
    for (const f of files || []) {
      const n = path.basename(String(f.name)).replace(/[\\/:*?"<>|]+/g, '_');
      if (!n || n === '.' || n === '..') continue;
      fs.writeFileSync(path.join(d, n), Buffer.from(f.data));
      written.push(n);
    }
    return { ok: true, dir: d, written };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('export:open', (_e, dir) => {
  const d = path.resolve(String(dir || defaultExportDir()));
  if (fs.existsSync(d)) shell.openPath(d);
  return fs.existsSync(d);
});

// ---------------------------------------------------------------- window

let mainWin = null;
let pendingOpen = null;
const projectArg = (argv) => argv.slice(1).find((a) => PROJECT_EXTS.includes(path.extname(a).toLowerCase()) && fs.existsSync(a)) || null;
function sendOpen(p) {
  if (!p) return;
  if (mainWin && mainWin.webContents && !mainWin.webContents.isLoading()) mainWin.webContents.send('project:open-path', p);
  else pendingOpen = p;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 960, show: false, backgroundColor: '#17181a', icon: path.join(__dirname, 'localpaint.ico'), title: 'LocalPaint',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  mainWin = win;
  win.removeMenu();
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'LocalPaint.html'));
  win.webContents.on('did-finish-load', () => { if (pendingOpen) { const p = pendingOpen; pendingOpen = null; win.webContents.send('project:open-path', p); } });
  // F12 = developer tools (for reporting problems), F11 = full screen.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Links open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Closing: LocalPaint shows its own "unsaved changes" dialog (Save now / Quit without saving / Cancel).
  let allowClose = false;
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    let acked = false;
    const onAck = (ev) => { if (ev.sender === win.webContents) acked = true; };
    ipcMain.once('app:close-ack', onAck);
    win.webContents.send('app:close-request');
    // If the page doesn't answer (it crashed or hung), fall back to a plain question.
    setTimeout(() => {
      ipcMain.removeListener('app:close-ack', onAck);
      if (acked || allowClose) return;
      const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Quit', 'Cancel'], defaultId: 1, message: 'LocalPaint is not responding. Quit anyway?' });
      if (r === 0) { allowClose = true; win.destroy(); }
    }, 2500);
  });
  ipcMain.on('app:quit', (ev) => { if (ev.sender === win.webContents) { allowClose = true; win.close(); } });
}

// One LocalPaint at a time: double-clicking another .lp opens it in the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
    sendOpen(projectArg(argv));
  });
  app.setAppUserModelId('LeoDevRX.LocalPaint');
  app.whenReady().then(() => {
    // Folder / file pickers (File System Access API) and clipboard without prompts.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    pendingOpen = projectArg(process.argv);
    createWindow();
    registerFileType();
    rebuildJumpList();
  });
  app.on('window-all-closed', () => app.quit());
}
