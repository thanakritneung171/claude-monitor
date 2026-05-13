#!/usr/bin/env node
// Generate a PBKDF2 password hash compatible with worker/src/lib/auth.ts
// Usage:   node scripts/hash-password.mjs "your-password"
import { webcrypto as crypto } from 'node:crypto';

const ITER = 100_000;

const plain = process.argv[2];
if (!plain) {
	console.error('Usage: node scripts/hash-password.mjs "<password>"');
	process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(plain), { name: 'PBKDF2' }, false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');

const hash = `pbkdf2$${ITER}$${hex(salt)}$${hex(bits)}`;
console.log(hash);
