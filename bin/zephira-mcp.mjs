#!/usr/bin/env node
import { startStdioBridge } from '../lib/bridge.mjs';

const apiKey = process.env.ZEPHIRA_API_KEY?.trim();
if (!apiKey || !apiKey.startsWith('zph_live_')) {
  process.stderr.write('Set ZEPHIRA_API_KEY to an active production Zephira dashboard key (zph_live_...). API v2 Token credentials are separate.\n');
  process.exitCode = 1;
} else {
  startStdioBridge({ input: process.stdin, output: process.stdout, apiKey });
}
