#!/usr/bin/env node
'use strict';

// Starts one isolated process/socket for each released StoneFish model.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const StoneFish = require('./stonefish-node.cjs');

function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadEnvFile();

const environment = String(process.env.CBA_ENV || 'sandbox').toLowerCase();
if (!['sandbox', 'live'].includes(environment)) {
  console.error('CBA_ENV must be sandbox or live.');
  process.exit(1);
}
const url = process.env.CBA_BOT_URL || (environment === 'live'
  ? 'wss://chessbotarena.com/bot/v1'
  : 'wss://chessbotarena.com/bot/v1/sandbox');

const children = new Map();
let stopping = false;
function getToken(id) {
  const suffix = environment.toUpperCase();
  return process.env['CBA_BOT_TOKEN_' + id.toUpperCase() + '_' + suffix] ||
    process.env['CBA_BOT_TOKEN_' + id.toUpperCase()] || '';
}
function stopAll() {
  if (stopping) return;
  stopping = true;
  console.log('[arena-all] Stopping all local StoneFish Arena processes...');
  for (const child of children.values()) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
  }, 4000);
  force.unref();
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const missing = [];
for (const model of StoneFish.listModels()) {
  const token = getToken(model.id);
  if (!token) { missing.push(model.id); continue; }

  const child = spawn(process.execPath, [path.join(__dirname, 'chessbot-arena.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, STONEFISH_MODEL: model.id, CBA_BOT_TOKEN: token, CBA_BOT_URL: url }
  });
  children.set(model.id, child);
  console.log('[arena-all] Started ' + model.id + ' (' + model.name + ')');
  child.on('exit', (code, signal) => {
    children.delete(model.id);
    console.log('[arena-all] ' + model.id + ' exited (code=' + code + ', signal=' + (signal || 'none') + ')');
    if (!stopping && code !== 0) console.error('[arena-all] ' + model.id + ' stopped; other bots continue.');
  });
}
if (missing.length) console.warn('[arena-all] Missing ' + environment + ' token for: ' + missing.join(', '));
if (children.size === 0) {
  console.error('[arena-all] No bots started. Configure tokens in .env first.');
  process.exitCode = 1;
} else {
  console.log('[arena-all] ' + children.size + '/10 bots started against ' + environment + '. Press Ctrl+C to stop.');
}
