'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// FamilyCare SMTP email support - no external npm dependencies.
const net = require('net');
const tls = require('tls');

function mailEnabled() {
  return String(process.env.MAIL_ENABLED || '').toLowerCase() === 'true';
}
function inferSmtp(email) {
  const address = String(email || '').trim().toLowerCase();
  const domain = (address.split('@')[1] || '').trim();
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { host:'smtp.gmail.com', port:587, secure:false, provider:'Gmail' };
  if (domain === 'yahoo.com' || domain === 'yahoo.ro' || domain === 'ymail.com') return { host:'smtp.mail.yahoo.com', port:587, secure:false, provider:'Yahoo' };
  if (['outlook.com','hotmail.com','live.com','msn.com'].includes(domain)) return { host:'smtp.office365.com', port:587, secure:false, provider:'Outlook' };
  if (domain) return { host:'smtp.' + domain, port:587, secure:false, provider:domain };
  return { host:process.env.SMTP_HOST || '', port:Number(process.env.SMTP_PORT || 587), secure:String(process.env.SMTP_SECURE || '').toLowerCase()==='true', provider:'manual' };
}
function isActiveMailValue(v) {
  const x = String(v ?? '').trim().toLowerCase();
  return !['nu','no','false','0','inactiv','inactive','off'].includes(x);
}
async function mailCfg() {
  let dbCfg = null;
  try {
    const sql = `select coalesce((
      select payload::text
      from ${dqIdent(PGSCHEMA)}.config_record
      where section_key='mail-settings'
      order by id desc
      limit 1
    ), '{}');`;
    dbCfg = JSON.parse(await runPsql(sql) || '{}');
  } catch (_) { dbCfg = null; }

  const uiEmail = dbCfg && (dbCfg.Email || dbCfg['Email expeditor'] || dbCfg.Username || dbCfg.User || dbCfg['Adresă email']);
  const uiPass = dbCfg && (dbCfg['Parolă'] || dbCfg.Parola || dbCfg.Password || dbCfg['Parolă aplicație'] || dbCfg['App password']);
  if (uiEmail && uiPass) {
    const inferred = inferSmtp(uiEmail);
    const active = isActiveMailValue(dbCfg.Activ ?? dbCfg.Active ?? 'da');
    return {
      enabled: active,
      host: inferred.host,
      port: inferred.port,
      secure: inferred.secure,
      user: String(uiEmail).trim(),
      pass: String(uiPass).trim(),
      from: 'FamilyCare <' + String(uiEmail).trim() + '>',
      provider: inferred.provider,
      source: 'interfață'
    };
  }

  return {
    enabled: mailEnabled(),
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    provider: 'environment',
    source: 'sistem'
  };
}
function normalizeEmailList(value) {
  return String(value || '').split(/[;,\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}
function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = data => {
      buf += data.toString('utf8');
      const lines = buf.split(/\r?\n/).filter(Boolean);
      if (lines.length && /^\d{3} /.test(lines[lines.length - 1])) cleanup(resolve, buf);
    };
    const onError = err => cleanup(reject, err);
    const cleanup = (fn, val) => { socket.off('data', onData); socket.off('error', onError); fn(val); };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}
async function smtpCmd(socket, cmd, expect) {
  if (cmd) socket.write(cmd + '\r\n');
  const res = await smtpRead(socket);
  const code = Number(String(res).slice(0,3));
  const allowed = Array.isArray(expect) ? expect : [expect];
  if (expect && !allowed.includes(code)) throw new Error('SMTP ' + code + ': ' + String(res).trim());
  return res;
}
function smtpConnect(cfg) {
  return new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: cfg.port, servername: cfg.host };
    const socket = cfg.secure ? tls.connect(opts, () => resolve(socket)) : net.connect(opts, () => resolve(socket));
    socket.setTimeout(20000, () => { try { socket.destroy(); } catch(_) {} reject(new Error('SMTP timeout')); });
    socket.once('error', reject);
  });
}
function startTls(socket, cfg) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: cfg.host }, () => resolve(secure));
    secure.once('error', reject);
  });
}
function mimeMessage({from,to,subject,text}) {
  const encSubject = '=?UTF-8?B?' + Buffer.from(String(subject || ''), 'utf8').toString('base64') + '?=';
  return [
    'From: ' + from,
    'To: ' + to.join(', '),
    'Subject: ' + encSubject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || '')
  ].join('\r\n').replace(/\r?\n\./g, '\r\n..');
}
async function sendMailSMTP({to, subject, text}) {
  const cfg = await mailCfg();
  const recipients = normalizeEmailList(to);
  if (!cfg.enabled) return { ok:false, skipped:true, reason:'MAIL_ENABLED=false' };
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.from) return { ok:false, skipped:true, reason:'SMTP incomplet' };
  if (!recipients.length) return { ok:false, skipped:true, reason:'Fără destinatari' };
  let socket = await smtpConnect(cfg);
  try {
    await smtpCmd(socket, null, 220);
    await smtpCmd(socket, 'EHLO familycare.local', 250);
    if (!cfg.secure && cfg.port !== 465) {
      await smtpCmd(socket, 'STARTTLS', 220);
      socket = await startTls(socket, cfg);
      await smtpCmd(socket, 'EHLO familycare.local', 250);
    }
    await smtpCmd(socket, 'AUTH LOGIN', 334);
    await smtpCmd(socket, Buffer.from(cfg.user).toString('base64'), 334);
    await smtpCmd(socket, Buffer.from(cfg.pass).toString('base64'), 235);
    const fromEmail = (String(cfg.from).match(/<([^>]+)>/) || [null, cfg.from])[1];
    await smtpCmd(socket, 'MAIL FROM:<' + fromEmail + '>', 250);
    for (const r of recipients) await smtpCmd(socket, 'RCPT TO:<' + r + '>', [250,251]);
    await smtpCmd(socket, 'DATA', 354);
    socket.write(mimeMessage({ from: cfg.from, to: recipients, subject, text }) + '\r\n.\r\n');
    await smtpCmd(socket, null, 250);
    try { await smtpCmd(socket, 'QUIT', 221); } catch(_) {}
    return { ok:true, recipients };
  } finally {
    try { socket.end(); } catch(_) {}
  }
}
async function logEmailStatus(kind, recipients, subject, message, status, detail) {
  try {
    const payload = JSON.stringify({ Tip:kind, Către:recipients, Subiect:subject, Mesaj:message, Status:status, Detalii:detail || '', Data:new Date().toISOString() });
    await runPsql(`insert into ${dqIdent(PGSCHEMA)}.config_record(section_key,payload,sort_order) values ('email-outbox', ${dollar(payload)}::jsonb, 10);`);
  } catch(_) {}
}
async function sendAndLog(kind, recipients, subject, message) {
  if (!normalizeEmailList(recipients).length) return { ok:false, skipped:true, reason:'Fără destinatari' };
  try {
    const result = await sendMailSMTP({ to:recipients, subject, text:message });
    await logEmailStatus(kind, recipients, subject, message, result.ok ? 'trimis' : 'neexpediat', result.reason || '');
    return result;
  } catch (e) {
    await logEmailStatus(kind, recipients, subject, message, 'eșuat', e.message || String(e));
    return { ok:false, error:e.message || String(e) };
  }
}


const PORT = Number(process.env.PORT || 31000);
const HOST = process.env.HOST || ((process.env.RENDER || process.env.NODE_ENV === 'production') ? '0.0.0.0' : '127.0.0.1');
const ROOT = __dirname;
const PGSCHEMA = process.env.PGSCHEMA || 'familycare';
const PSQL_BIN = process.env.PSQL_BIN || 'psql';
const HTTPS_ENABLED = String(process.env.HTTPS || '').toLowerCase() === 'true';
const TLS_PFX_PATH = process.env.TLS_PFX_PATH || path.join(ROOT, 'certs', 'familycare-local.pfx');
const TLS_PFX_PASSPHRASE = process.env.TLS_PFX_PASSPHRASE || 'familycare-local';
const PROTOCOL = HTTPS_ENABLED ? 'https' : 'http';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};
const SENIOR_PORT = Number(process.env.SENIOR_PORT || 31001);
const SENIOR_BASE_URL = String(process.env.SENIOR_BASE_URL || '').replace(/\/$/, '');
function safeOrigin(value) { try { return new URL(value).origin; } catch (_) { return ''; } }
function seniorFrameSourcesFor(req) {
  const configured = safeOrigin(SENIOR_BASE_URL);
  let localSources = '';
  try {
    const hostname = new URL(PROTOCOL + '://' + String(req.headers.host || 'localhost')).hostname;
    if (/^[a-z0-9.:-]+$/i.test(hostname)) {
      const host = hostname.includes(':') ? '[' + hostname + ']' : hostname;
      localSources = ' http://' + host + ':' + SENIOR_PORT + ' https://' + host + ':' + SENIOR_PORT;
    }
  } catch (_) {}
  return (configured ? ' ' + configured : '') + localSources;
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'self'" + (res.familyCareSeniorFrameSources || '') + "; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    ...(HTTPS_ENABLED ? { 'Strict-Transport-Security': 'max-age=31536000' } : {})
  });
  res.end(body);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || PROTOCOL).split(',')[0].trim();
    return parsed.protocol === forwardedProto + ':' && parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch (_) { return false; }
}

function sectionOk(section) {
  return /^[a-z0-9-]+$/.test(section || '');
}
function idOk(id) {
  return /^[0-9]+$/.test(String(id || ''));
}
function dqIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function dollar(text) {
  let tag = 'fc';
  while (String(text).includes('$' + tag + '$')) tag += 'x';
  return '$' + tag + '$' + String(text) + '$' + tag + '$';
}

let pgPool = null;
let PgPoolCtor = null;
function getPgPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!PgPoolCtor) {
    try { PgPoolCtor = require('pg').Pool; }
    catch (e) { throw new Error('Lipsește dependența pg. Rulează npm install sau verifică package.json.'); }
  }
  if (!pgPool) {
    const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
    const sslDisabled = ['disable','disabled','false','0','no'].includes(sslMode) || String(process.env.DATABASE_SSL || '').toLowerCase() === 'false';
    const sslRequired = ['require','true','1','yes'].includes(sslMode) || String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' || !!process.env.RENDER;
    pgPool = new PgPoolCtor({
      connectionString: process.env.DATABASE_URL,
      ssl: sslDisabled ? false : (sslRequired ? { rejectUnauthorized: false } : undefined),
      max: Number(process.env.PGPOOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    });
  }
  return pgPool;
}
function stringifyPgValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function formatPgOutput(result) {
  const results = Array.isArray(result) ? result : [result];
  const lastWithRows = [...results].reverse().find(r => r && Array.isArray(r.rows));
  if (!lastWithRows || !lastWithRows.rows.length) return '';
  return lastWithRows.rows.map(row => {
    const vals = Object.values(row);
    if (vals.length === 1) return stringifyPgValue(vals[0]);
    return vals.map(stringifyPgValue).join('|');
  }).join('\n').trim();
}
function runPsql(sql) {
  const pool = getPgPool();
  if (pool) {
    return pool.query(sql).then(formatPgOutput).catch(err => {
      throw new Error(err && err.message ? err.message : 'PostgreSQL query failed');
    });
  }
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), 'familycare_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '.sql');
    fs.writeFileSync(file, sql, 'utf8');
    const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', file];
    const env = { ...process.env };
    execFile(PSQL_BIN, args, { env, windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(file); } catch (_) {}
      if (err) {
        const msg = (stderr || err.message || '').trim();
        reject(new Error(msg || 'PostgreSQL command failed'));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2_000_000) reject(new Error('Body too large')); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}





async function handleMailSettingsApi(req, res, url) {
  if (url.pathname !== '/api/mail-settings') return false;
  try {
    if (req.method === 'GET') {
      const sql = `select coalesce((
        select jsonb_build_object(
          'ok', true,
          'configured', true,
          'email', payload->>'Email',
          'provider', case
            when lower(coalesce(payload->>'Email','')) like '%@gmail.com' then 'Gmail'
            when lower(coalesce(payload->>'Email','')) like '%@yahoo.%' then 'Yahoo'
            when lower(coalesce(payload->>'Email','')) ~ '@(outlook|hotmail|live)\.com$' then 'Outlook'
            else 'Auto'
          end,
          'active', coalesce(payload->>'Activ','da')
        )::text
        from ${dqIdent(PGSCHEMA)}.config_record
        where section_key='mail-settings'
        order by id desc
        limit 1
      ), jsonb_build_object('ok',true,'configured',false)::text);`;
      send(res, 200, await runPsql(sql) || '{"ok":true,"configured":false}', 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || b.Email || '').trim();
      const password = String(b.password || b['Parolă'] || '').trim();
      const active = b.active === false ? 'nu' : 'da';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 400, 'Email expeditor invalid.'); return true; }
      if (!password) { send(res, 400, 'Parola este obligatorie.'); return true; }
      const payload = JSON.stringify({ Email: email, 'Parolă': password, Activ: active, Provider: inferSmtp(email).provider, 'Setat din interfață': 'da' });
      const sql = `with old as (delete from ${dqIdent(PGSCHEMA)}.config_record where section_key='mail-settings')
        insert into ${dqIdent(PGSCHEMA)}.config_record(section_key,payload,sort_order)
        values ('mail-settings', ${dollar(payload)}::jsonb, 1)
        returning json_build_object('ok',true,'provider',payload->>'Provider','email',payload->>'Email')::text;`;
      send(res, 200, await runPsql(sql) || '{"ok":true}', 'application/json; charset=utf-8');
      return true;
    }
    send(res,405,'Method not allowed');
    return true;
  } catch(e) {
    send(res, 500, e.message || 'Mail settings error');
    return true;
  }
}

async function handleFamilyContactApi(req, res, url) {
  if (url.pathname !== '/api/family-contact') return false;
  try {
    const sql = `select coalesce((
      select jsonb_build_object(
        'Nume', coalesce(payload->>'Nume', 'Contact familie'),
        'Email', coalesce(payload->>'Email', 'contact@example.com'),
        'Mesaj SMS', coalesce(payload->>'Mesaj SMS', payload->>'Mesaj implicit', 'Te rog să mă contactezi.'),
        'Mesaj ajutor', coalesce(payload->>'Mesaj ajutor', payload->>'Mesaj implicit', 'Am nevoie de ajutor. Te rog să mă contactezi.'),
        'Contacte', jsonb_build_array(
          jsonb_build_object('Etichetă','Principal','Nume',coalesce(payload->>'Nume principal', payload->>'Nume', 'Contact principal'),'Telefon',coalesce(payload->>'Telefon principal', payload->>'Telefon', '0700000001')),
          jsonb_build_object('Etichetă','Secundar','Nume',coalesce(payload->>'Nume secundar','Contact secundar'),'Telefon',coalesce(payload->>'Telefon secundar','0700000002')),
          jsonb_build_object('Etichetă','Al treilea','Nume',coalesce(payload->>'Nume al treilea','Contact rezervă'),'Telefon',coalesce(payload->>'Telefon al treilea', payload->>'Telefon urgență', '0700000003'))
        )
      )::text
      from ${dqIdent(PGSCHEMA)}.config_record
      where section_key='family-contact'
      order by sort_order, id
      limit 1
    ), jsonb_build_object(
        'Nume','Contact familie',
        'Email','contact@example.com',
        'Mesaj SMS','Te rog să mă contactezi.',
        'Mesaj ajutor','Am nevoie de ajutor. Te rog să mă contactezi.',
        'Contacte', jsonb_build_array(
          jsonb_build_object('Etichetă','Principal','Nume','Contact principal','Telefon','0700000001'),
          jsonb_build_object('Etichetă','Secundar','Nume','Contact secundar','Telefon','0700000002'),
          jsonb_build_object('Etichetă','Al treilea','Nume','Contact rezervă','Telefon','0700000003')
        )
      )::text);`;
    const out = await runPsql(sql);
    send(res, 200, out || '{}', 'application/json; charset=utf-8');
    return true;
  } catch(e) {
    send(res, 200, JSON.stringify({
      Nume:'Contact familie', Email:'contact@example.com',
      'Mesaj SMS':'Te rog să mă contactezi.',
      'Mesaj ajutor':'Am nevoie de ajutor. Te rog să mă contactezi.',
      Contacte:[
        {'Etichetă':'Principal', Nume:'Contact principal', Telefon:'0700000001'},
        {'Etichetă':'Secundar', Nume:'Contact secundar', Telefon:'0700000002'},
        {'Etichetă':'Al treilea', Nume:'Contact rezervă', Telefon:'0700000003'}
      ]
    }), 'application/json; charset=utf-8');
    return true;
  }
}

async function handleQuickActionApi(req, res, url) {
  if (url.pathname !== '/api/quick-action') return false;
  if (req.method !== 'POST') { send(res,405,'Method not allowed'); return true; }
  try {
    const b = await readJson(req);
    const payload = JSON.stringify({
      Actiune: b.action || 'actiune',
      Entitate: b.entityName || '',
      Mesaj: b.message || '',
      Data: new Date().toISOString()
    });
    const sql = `insert into ${dqIdent(PGSCHEMA)}.config_record(section_key,payload,sort_order) values ('senior-actions', ${dollar(payload)}::jsonb, 100) returning json_build_object('ok',true,'id',id)::text;`;
    const out = await runPsql(sql);
    send(res, 200, out || '{"ok":true}', 'application/json; charset=utf-8');
    return true;
  } catch(e) {
    send(res, 500, e.message || 'Database error');
    return true;
  }
}

async function handleSeniorEntitiesApi(req, res, url) {
  if (url.pathname !== '/api/senior/entities' && url.pathname !== '/api/entities') return false;
  try {
    const branchCode = url.searchParams.get('branchCode') || '';
    const filter = branchCode ? `where coalesce(b.branch_code,'')=${dollar(branchCode)} or coalesce(to_jsonb(e)->>'branch_name','') in (select name from ${dqIdent(PGSCHEMA)}.care_branch where branch_code=${dollar(branchCode)})` : '';
    const sql = `select coalesce(json_agg(row_to_json(t))::text,'[]') from (
      select
        e.id,
        e.entity_code,
        coalesce(to_jsonb(e)->>'name', to_jsonb(e)->>'display_name', e.entity_code) as name,
        e.entity_type,
        coalesce(b.branch_code, to_jsonb(e)->>'branch_code') as branch_code,
        coalesce(b.name, to_jsonb(e)->>'branch_name') as branch_name,
        coalesce(to_jsonb(e)->>'address_details', concat_ws(', ', to_jsonb(e)->>'country', to_jsonb(e)->>'city', to_jsonb(e)->>'street', to_jsonb(e)->>'street_no')) as address_details,
        coalesce(to_jsonb(e)->>'responsible_name', '') as responsible_name,
        coalesce(to_jsonb(e)->>'allows_senior_screen','false') as allows_senior_screen,
        coalesce(card_style.card_color,'') as card_color,
        coalesce(card_style.card_text_color,'') as card_text_color
      from ${dqIdent(PGSCHEMA)}.managed_entity e
      left join ${dqIdent(PGSCHEMA)}.care_branch b on b.id=e.care_branch_id
      left join lateral (
        select
          c.payload->>'Culoare fundal' as card_color,
          c.payload->>'Culoare text' as card_text_color
        from ${dqIdent(PGSCHEMA)}.config_record c
        where c.section_key='senior-card-colors'
          and coalesce(c.payload->>'Cod entitate','')=e.entity_code
        order by c.id desc
        limit 1
      ) card_style on true
      ${filter}
      order by b.sort_order nulls last, coalesce(to_jsonb(e)->>'name', to_jsonb(e)->>'display_name', e.entity_code)
    ) t;`;
    const out = await runPsql(sql);
    send(res, 200, out || '[]', 'application/json; charset=utf-8');
    return true;
  } catch(e) {
    send(res, 500, e.message || 'Database error');
    return true;
  }
}

async function handleTreatmentApi(req, res, url) {
  const m = url.pathname.match(/^\/api\/treatment\/?([0-9]+)?$/);
  if (!m) return false;
  const itemId = m[1] ? Number(m[1]) : null;
  const table = dqIdent(PGSCHEMA) + '.calendar_series';
  try {
    if (req.method === 'GET' && !itemId) {
      const sql = `select coalesce(json_agg(row_to_json(t))::text,'[]') from (
        select
          cs.id, cs.section_key, cs.task_type, cs.title, cs.description,
          cs.start_date, cs.end_date, cs.start_time, cs.recurrence_rule,
          cs.repeat_every_days, cs.active_weekdays, cs.escalation_minutes,
          cs.email_on_create, cs.email_on_finish, cs.email_recipients,
          cs.status,
          e.entity_code,
          coalesce(to_jsonb(e)->>'name', to_jsonb(e)->>'display_name', e.entity_code) as entity_name,
          br.branch_code,
          br.name as branch_name
        from ${table} cs
        left join ${dqIdent(PGSCHEMA)}.managed_entity e on e.id=cs.entity_id
        left join ${dqIdent(PGSCHEMA)}.care_branch br on br.id=cs.care_branch_id
        where cs.section_key='treatment'
          and coalesce(cs.active,true)=true
          and lower(coalesce(cs.status,'active')) not in ('cancelled','canceled','anulat','anulată','anulata')
        order by cs.start_time nulls last, cs.id desc
      ) t;`;
      const out = await runPsql(sql);
      send(res, 200, out || '[]', 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'POST' && !itemId) {
      const b = await readJson(req);
      const title = b.treatmentName || 'Tratament';
      const desc = [b.treatmentType, b.dose, b.instructions, b.responsible].filter(Boolean).join(' · ');
      const startDate = b.startDate || new Date().toISOString().slice(0,10);
      const endDate = b.endDate || startDate;
      const startTime = b.startTime || '09:00';
      const recurrence = b.recurrenceRule || 'selected_weekdays';
      const repeatDays = Number(b.repeatEveryDays || 0) || null;
      const weekdays = b.activeWeekdays || '';
      const esc = Number(b.escalationMinutes || 30) || 30;
      const emailOnCreate = b.emailOnCreate ? 'true' : 'false';
      const emailOnFinish = b.emailOnFinish ? 'true' : 'false';
      const recipients = b.emailRecipients || '';
      const entityCodes = Array.isArray(b.entityCodes) && b.entityCodes.length ? b.entityCodes : [b.entityCode || 'ME-0001'];
      const entityList = entityCodes.map(x => dollar(x)).join(',');
      const sql = `
        with src as (
          select e.care_header_id as header_id, e.care_branch_id as branch_id, e.id as entity_id
          from ${dqIdent(PGSCHEMA)}.managed_entity e
          where e.entity_code in (${entityList})
        ), ins as (
          insert into ${table}(care_header_id, care_branch_id, entity_id, section_key, task_type, title, description, start_date, end_date, start_time, recurrence_rule, repeat_every_days, active_weekdays, escalation_minutes, email_on_create, email_on_finish, email_recipients, status, active)
          select header_id, branch_id, entity_id, 'treatment', ${dollar(b.treatmentType || 'medication')}, ${dollar(title)}, ${dollar(desc)}, ${dollar(startDate)}::date, ${dollar(endDate)}::date, ${dollar(startTime)}::time, ${dollar(recurrence)}, ${repeatDays === null ? 'null' : repeatDays}, ${dollar(weekdays)}, ${esc}, ${emailOnCreate}, ${emailOnFinish}, ${dollar(recipients)}, 'active', true
          from src
          returning id
        ), mailq as (
          insert into ${dqIdent(PGSCHEMA)}.config_record(section_key,payload,sort_order)
          select 'email-outbox', jsonb_build_object(
            'Status','pregătit',
            'Tip','Tratament creat',
            'Către',${dollar(recipients)},
            'Subiect',${dollar('FamilyCare - tratament nou: ' + title)},
            'Mesaj',${dollar('A fost creat un tratament nou în FamilyCare. Tratament: ' + title + '. Ora: ' + startTime + '.')},
            'Tratament',${dollar(title)},
            'Ora',${dollar(startTime)},
            'Creat la',now()::text
          ), 10
          where ${emailOnCreate} and length(trim(${dollar(recipients)})) > 0 and exists(select 1 from ins)
          returning id
        ), cnt as (select count(*)::int as inserted from ins), mcnt as (select count(*)::int as email_queued from mailq)
        select case when (select inserted from cnt) > 0 then
          json_build_object('ok',true,'inserted',(select inserted from cnt),'email_queued',(select email_queued from mcnt),'entity_codes',${dollar(entityCodes.join(','))},'entity_label',${dollar(b.entityLabel || '')})::text
        else
          json_build_object('ok',false,'error','Nu am găsit persoana/entitatea selectată în baza de date.')::text
        end;`;
      const out = await runPsql(sql);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch (_) {}
      if (!out || (parsed && parsed.ok === false)) {
        send(res, 400, parsed && parsed.error ? parsed.error : (out || 'Tratamentul nu a fost inserat.'));
        return true;
      }
      if (parsed && parsed.ok && b.emailOnCreate && recipients) {
        const subject = 'FamilyCare - tratament nou: ' + title;
        const msg = [
          'A fost creat un tratament nou în FamilyCare.',
          '',
          'Seniori / persoane: ' + (b.entityLabel || entityCodes.join(', ')),
          'Tratament: ' + title,
          'Ora: ' + startTime,
          'Începe la: ' + startDate,
          'Până la: ' + endDate
        ].join('\n');
        const mailRes = await sendAndLog('Tratament creat', recipients, subject, msg);
        parsed.email_sent = !!mailRes.ok;
        parsed.email_status = mailRes.ok ? 'trimis' : (mailRes.reason || mailRes.error || 'neexpediat');
        send(res, 200, JSON.stringify(parsed), 'application/json; charset=utf-8');
        return true;
      }
      send(res, 200, out, 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'PUT' && itemId) {
      const b = await readJson(req);
      const title = b.treatmentName || b.title || 'Tratament';
      const desc = [b.treatmentType, b.dose, b.instructions, b.responsible].filter(Boolean).join(' · ');
      const startDate = b.startDate || new Date().toISOString().slice(0,10);
      const endDate = b.endDate || startDate;
      const startTime = b.startTime || '09:00';
      const recurrence = b.recurrenceRule || 'selected_weekdays';
      const repeatDays = Number(b.repeatEveryDays || 0) || null;
      const weekdays = b.activeWeekdays || '';
      const esc = Number(b.escalationMinutes || 30) || 30;
      const emailOnCreate = b.emailOnCreate ? 'true' : 'false';
      const emailOnFinish = b.emailOnFinish ? 'true' : 'false';
      const recipients = b.emailRecipients || '';
      const entityCode = (Array.isArray(b.entityCodes) && b.entityCodes[0]) || b.entityCode || '';
      const entityUpdate = entityCode ? `, care_header_id = e.care_header_id, care_branch_id = e.care_branch_id, entity_id = e.id` : '';
      const fromJoin = entityCode ? ` from ${dqIdent(PGSCHEMA)}.managed_entity e where cs.id=${itemId} and e.entity_code=${dollar(entityCode)} ` : ` where cs.id=${itemId} `;
      const sql = `
        update ${table} cs set
          task_type=${dollar(b.treatmentType || 'medication')},
          title=${dollar(title)},
          description=${dollar(desc)},
          start_date=${dollar(startDate)}::date,
          end_date=${dollar(endDate)}::date,
          start_time=${dollar(startTime)}::time,
          recurrence_rule=${dollar(recurrence)},
          repeat_every_days=${repeatDays === null ? 'null' : repeatDays},
          active_weekdays=${dollar(weekdays)},
          escalation_minutes=${esc},
          email_on_create=${emailOnCreate},
          email_on_finish=${emailOnFinish},
          email_recipients=${dollar(recipients)},
          updated_at=now()
          ${entityUpdate}
        ${fromJoin}
        returning json_build_object('ok',true,'id',cs.id)::text;`;
      const out = await runPsql(sql);
      if (!out) { send(res, 404, 'Tratamentul nu a fost găsit.'); return true; }
      send(res, 200, out, 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'DELETE' && itemId) {
      const sql = `update ${table} set active=false, status='cancelled', updated_at=now() where id=${itemId}; select json_build_object('ok',true,'id',${itemId})::text;`;
      const out = await runPsql(sql);
      send(res, 200, out.split('\n').pop() || '{"ok":true}', 'application/json; charset=utf-8');
      return true;
    }
    send(res, 405, 'Method not allowed');
    return true;
  } catch(e) {
    send(res, 500, e.message || 'Database error');
    return true;
  }
}


async function handleTreatmentConfirmApi(req, res, url) {
  if (url.pathname !== '/api/treatment/confirm') return false;
  if (req.method !== 'POST') { send(res, 405, 'Method not allowed'); return true; }
  try {
    const b = await readJson(req);
    const treatmentId = Number(b.treatmentId || b.id || 0);
    const title = b.title || 'Tratament';
    const entityName = b.entityName || '';
    const startTime = b.startTime || '';
    const occurrenceKey = b.occurrenceKey || '';
    const payload = JSON.stringify({
      Tip:'confirmare-tratament', Tratament:title, Senior:entityName, Ora:startTime,
      OccurrenceKey:occurrenceKey, ConfirmatLa:new Date().toISOString()
    });
    let cfg = null;
    if (treatmentId) {
      const q = `select coalesce((select jsonb_build_object('email_on_finish',email_on_finish,'email_recipients',email_recipients,'title',title,'start_time',start_time::text)::text from ${dqIdent(PGSCHEMA)}.calendar_series where id=${treatmentId}), '{}');`;
      try { cfg = JSON.parse(await runPsql(q) || '{}'); } catch(_) { cfg = {}; }
    }
    await runPsql(`insert into ${dqIdent(PGSCHEMA)}.config_record(section_key,payload,sort_order) values ('treatment-confirmations', ${dollar(payload)}::jsonb, 10);`);
    let mailRes = { ok:false, skipped:true };
    const recipients = (cfg && cfg.email_recipients) || b.emailRecipients || '';
    const shouldSend = (cfg && cfg.email_on_finish) || b.emailOnFinish;
    if (shouldSend && recipients) {
      const subject = 'FamilyCare - tratament confirmat: ' + (cfg.title || title);
      const msg = [
        'Tratamentul a fost confirmat.', '',
        'Senior / persoană: ' + entityName,
        'Tratament: ' + (cfg.title || title),
        'Ora planificată: ' + (startTime || cfg.start_time || ''),
        'Confirmat la: ' + new Date().toLocaleString('ro-RO')
      ].join('\n');
      mailRes = await sendAndLog('Tratament confirmat', recipients, subject, msg);
    }
    send(res, 200, JSON.stringify({ ok:true, email_sent:!!mailRes.ok, email_status: mailRes.ok ? 'trimis' : (mailRes.reason || mailRes.error || 'neexpediat') }), 'application/json; charset=utf-8');
    return true;
  } catch(e) {
    send(res, 500, e.message || 'Database error');
    return true;
  }
}

async function handleAgendaApi(req, res, url) {
  if (url.pathname !== '/api/agenda') return false;
  const table = dqIdent(PGSCHEMA) + '.calendar_series';
  try {
    if (req.method === 'GET') {
      const sql = `select coalesce(json_agg(row_to_json(t))::text,'[]') from (
        select cs.id, cs.section_key, cs.task_type, cs.title, cs.description,
          cs.start_date, cs.end_date, cs.start_time, cs.recurrence_rule,
          cs.repeat_every_days, cs.active_weekdays, cs.escalation_minutes,
          cs.status,
          e.entity_code,
          coalesce(to_jsonb(e)->>'name', to_jsonb(e)->>'display_name', e.entity_code) as entity_name,
          br.branch_code, br.name as branch_name
        from ${table} cs
        left join ${dqIdent(PGSCHEMA)}.managed_entity e on e.id=cs.entity_id
        left join ${dqIdent(PGSCHEMA)}.care_branch br on br.id=cs.care_branch_id
        where cs.section_key='agenda'
        order by cs.start_time nulls last, cs.id desc
      ) t;`;
      const out = await runPsql(sql);
      send(res, 200, out || '[]', 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const title = b.title || 'Activitate';
      const desc = b.description || '';
      const startDate = b.startDate || new Date().toISOString().slice(0,10);
      const endDate = b.endDate || startDate;
      const startTime = b.startTime || '09:00';
      const recurrence = b.recurrenceRule || 'selected_weekdays';
      const repeatDays = Number(b.repeatEveryDays || 0) || 1;
      const weekdays = b.activeWeekdays || '';
      const entityCodes = Array.isArray(b.entityCodes) && b.entityCodes.length ? b.entityCodes : [b.entityCode || 'ME-0001'];
      const entityList = entityCodes.map(x => dollar(x)).join(',');
      const sql = `
        with src as (
          select e.care_header_id as header_id, e.care_branch_id as branch_id, e.id as entity_id
          from ${dqIdent(PGSCHEMA)}.managed_entity e
          where e.entity_code in (${entityList})
        ), ins as (
          insert into ${table}(care_header_id, care_branch_id, entity_id, section_key, task_type, title, description, start_date, end_date, start_time, recurrence_rule, repeat_every_days, active_weekdays, escalation_minutes)
          select header_id, branch_id, entity_id, 'agenda', 'agenda', ${dollar(title)}, ${dollar(desc)}, ${dollar(startDate)}::date, ${dollar(endDate)}::date, ${dollar(startTime)}::time, ${dollar(recurrence)}, ${repeatDays}, ${dollar(weekdays)}, 30
          from src
          returning id
        ), cnt as (select count(*)::int as inserted from ins)
        select case when (select inserted from cnt) > 0 then json_build_object('ok',true,'inserted',(select inserted from cnt))::text
        else json_build_object('ok',false,'error','Nu am găsit seniorii selectați în baza de date.')::text end;`;
      const out = await runPsql(sql);
      let parsed=null; try{parsed=JSON.parse(out)}catch(_){}
      if (!out || (parsed && parsed.ok === false)) { send(res, 400, parsed && parsed.error ? parsed.error : 'Activitatea nu a fost inserată.'); return true; }
      send(res, 200, out, 'application/json; charset=utf-8');
      return true;
    }
    send(res, 405, 'Method not allowed'); return true;
  } catch(e) { send(res, 500, e.message || 'Database error'); return true; }
}


async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api config section id
  if (parts[0] !== 'api' || parts[1] !== 'config') return false;
  const section = parts[2];
  const id = parts[3];
  if (!sectionOk(section)) { send(res, 400, 'Invalid section'); return true; }
  const table = dqIdent(PGSCHEMA) + '.config_record';
  try {
    if (req.method === 'GET' && !id) {
      const sql = `select coalesce(json_agg(row_to_json(t))::text,'[]') from (select id, section_key, payload, sort_order from ${table} where section_key=${dollar(section)} order by sort_order, id) t;`;
      const out = await runPsql(sql);
      send(res, 200, out || '[]', 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'POST' && !id) {
      const body = await readJson(req);
      const sql = `insert into ${table}(section_key,payload,sort_order) values (${dollar(section)}, ${dollar(JSON.stringify(body))}::jsonb, 100) returning json_build_object('ok',true,'id',id)::text;`;
      const out = await runPsql(sql);
      send(res, 200, out || '{"ok":true}', 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'PUT' && idOk(id)) {
      const body = await readJson(req);
      const sql = `update ${table} set payload=${dollar(JSON.stringify(body))}::jsonb, updated_at=now() where id=${Number(id)} and section_key=${dollar(section)} returning json_build_object('ok',true,'id',id)::text;`;
      const out = await runPsql(sql);
      send(res, 200, out || '{"ok":true}', 'application/json; charset=utf-8');
      return true;
    }
    if (req.method === 'DELETE' && idOk(id)) {
      const sql = `delete from ${table} where id=${Number(id)} and section_key=${dollar(section)}; select json_build_object('ok',true)::text;`;
      const out = await runPsql(sql);
      send(res, 200, out.split('\n').pop() || '{"ok":true}', 'application/json; charset=utf-8');
      return true;
    }
    send(res, 405, 'Method not allowed');
    return true;
  } catch (e) {
    send(res, 500, e.message || 'Database error');
    return true;
  }
}

const requestHandler = async (req, res) => {
  res.familyCareSeniorFrameSources = seniorFrameSourcesFor(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/runtime-config') {
    send(res, 200, JSON.stringify({ ok:true, version:'1.0.62', seniorBaseUrl: SENIOR_BASE_URL }), 'application/json; charset=utf-8');
    return;
  }
  if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !originAllowed(req)) {
    send(res, 403, 'Origin not allowed');
    return;
  }
  if (await handleMailSettingsApi(req, res, url)) return;
  if (await handleFamilyContactApi(req, res, url)) return;
  if (await handleTreatmentConfirmApi(req, res, url)) return;
  if (await handleQuickActionApi(req, res, url)) return;
  if (await handleSeniorEntitiesApi(req, res, url)) return;
  if (await handleTreatmentApi(req, res, url)) return;
  if (await handleAgendaApi(req, res, url)) return;
  if (await handleApi(req, res, url)) return;
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/pages/dashboard.html';
  const file = path.resolve(ROOT, pathname.replace(/^[/\\]+/, ''));
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { send(res, 403, 'Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { send(res, 404, 'Not found'); return; }
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
};

let server;
if (HTTPS_ENABLED) {
  if (!fs.existsSync(TLS_PFX_PATH)) {
    console.error('ERROR: HTTPS este activ, dar certificatul lipsește: ' + TLS_PFX_PATH);
    process.exit(1);
  }
  server = https.createServer({ pfx: fs.readFileSync(TLS_PFX_PATH), passphrase: TLS_PFX_PASSPHRASE }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') console.error('ERROR: Portul ' + PORT + ' este deja folosit. Oprește instanța existentă sau schimbă PORT.');
  else console.error('ERROR server:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
const PID_FILE = path.join(ROOT, '.familycare-main.pid');
try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch (_) {}
function removePidFile(){try{if(fs.existsSync(PID_FILE)&&fs.readFileSync(PID_FILE,'utf8').trim()===String(process.pid))fs.unlinkSync(PID_FILE)}catch(_){}}
process.on('exit', removePidFile);
function shutdown(){server.close(() => process.exit(0));if(typeof server.closeAllConnections==='function')server.closeAllConnections();setTimeout(() => process.exit(0),1500).unref();}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log('============================================================');
  console.log('FamilyCare V1.0.62 Universal PWA is running');
  console.log('URL: ' + PROTOCOL + '://localhost:' + PORT + '/pages/dashboard.html');
  console.log('Database: ' + (process.env.PGDATABASE || '(from PostgreSQL defaults)') + ' / schema ' + PGSCHEMA);
  console.log('DB mode: ' + (process.env.DATABASE_URL ? 'DATABASE_URL / pg' : 'local psql'));
  if (SENIOR_BASE_URL) console.log('Senior URL: ' + SENIOR_BASE_URL);
  console.log('Press CTRL+C in this window to stop the server.');
  console.log('============================================================');
});
