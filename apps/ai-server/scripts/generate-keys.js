#!/usr/bin/env node
/**
 * RSA Key Pair Generation Script
 * Creates keys for the server and client (backend).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const CLIENTS_DIR = path.join(KEYS_DIR, 'clients');

// Create directories
if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}
if (!fs.existsSync(CLIENTS_DIR)) {
  fs.mkdirSync(CLIENTS_DIR, { recursive: true });
}

console.log('🔐 Generating RSA key pairs...\n');

// Generate server keys
console.log('📦 Generating AI Server keys...');
const serverKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

fs.writeFileSync(path.join(KEYS_DIR, 'public.pem'), serverKeys.publicKey);
fs.writeFileSync(path.join(KEYS_DIR, 'private.pem'), serverKeys.privateKey);
console.log('  ✅ Server public key: keys/public.pem');
console.log('  ✅ Server private key: keys/private.pem');

// Generate client (backend) keys
console.log('\n📦 Generating Backend Client keys...');
const clientKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

fs.writeFileSync(path.join(CLIENTS_DIR, 'sayknowai-backend.pub'), clientKeys.publicKey);
fs.writeFileSync(path.join(CLIENTS_DIR, 'sayknowai-backend.key'), clientKeys.privateKey);
console.log('  ✅ Client public key: keys/clients/sayknowai-backend.pub');
console.log('  ✅ Client private key: keys/clients/sayknowai-backend.key');

console.log('\n🎉 Key generation complete!\n');
console.log('📋 Setup Instructions:');
console.log('─'.repeat(50));
console.log('1. AI Server uses:');
console.log('   - keys/private.pem (for signing responses)');
console.log('   - keys/clients/sayknowai-backend.pub (to verify client requests)');
console.log('');
console.log('2. Backend Server needs:');
console.log('   - keys/clients/sayknowai-backend.key (for signing requests)');
console.log('   - keys/public.pem (to verify AI server responses)');
console.log('');
console.log('⚠️  Keep private keys secure! Never commit them to git.');
