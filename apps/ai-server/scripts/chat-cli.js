#!/usr/bin/env node
/**
 * AI Server Chat CLI
 * Chat with AI directly from the terminal.
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG = {
  aiServer: process.env.AI_SERVER_URL || 'http://localhost:4000',
  clientId: 'sayknowai-backend',
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
};

// Load RSA key
let privateKey = null;
const keysDir = path.join(__dirname, '..', 'keys');
const clientKeyPath = path.join(keysDir, 'clients', 'sayknowai-backend.key');

try {
  privateKey = fs.readFileSync(clientKeyPath, 'utf8');
} catch (e) {
  console.log(`${colors.yellow}⚠️  RSA key not found. Testing without authentication.${colors.reset}`);
  console.log(`   Generate keys: npm run generate-keys\n`);
}

// Generate signature
function signRequest(payload) {
  if (!privateKey) return null;
  
  const timestamp = Date.now().toString();
  const dataToSign = `${timestamp}.${payload}`;
  
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(dataToSign);
  const signature = signer.sign(privateKey, 'base64');
  
  return { signature, timestamp };
}

// Conversation history
const conversationHistory = [];

// Chat request
async function chat(userMessage, options = {}) {
  conversationHistory.push({ role: 'user', content: userMessage });
  
  const payload = JSON.stringify({
    messages: conversationHistory,
    enableSearch: options.search || false,
    systemPrompt: options.systemPrompt,
  });
  
  const headers = { 'Content-Type': 'application/json' };
  
  if (privateKey) {
    const { signature, timestamp } = signRequest(payload);
    headers['X-Client-Id'] = CONFIG.clientId;
    headers['X-Timestamp'] = timestamp;
    headers['X-Signature'] = signature;
  }
  
  try {
    // Streaming response
    const response = await axios.post(
      `${CONFIG.aiServer}/ai/chat`,
      JSON.parse(payload),
      {
        headers,
        responseType: 'stream',
        timeout: 120000,
      }
    );
    
    process.stdout.write(`${colors.green}AI: ${colors.reset}`);
    
    let fullResponse = '';
    
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.content) {
                process.stdout.write(data.content);
                fullResponse += data.content;
              }
              
              if (data.done) {
                console.log('\n');
                conversationHistory.push({ role: 'assistant', content: fullResponse });
                
                if (data.meta?.hasSearch) {
                  console.log(`${colors.dim}[Web search used]${colors.reset}\n`);
                }
                
                resolve(fullResponse);
              }
              
              if (data.error) {
                console.log(`\n${colors.yellow}Error: ${data.error}${colors.reset}\n`);
                reject(new Error(data.error));
              }
            } catch (e) {
              // Ignore JSON parse failures
            }
          }
        }
      });
      
      response.data.on('error', (error) => {
        console.log(`\n${colors.yellow}Stream error: ${error.message}${colors.reset}\n`);
        reject(error);
      });
    });
  } catch (error) {
    if (error.response?.status === 401) {
      console.log(`${colors.yellow}Auth failed. Please check your RSA keys.${colors.reset}\n`);
    } else {
      console.log(`${colors.yellow}Error: ${error.message}${colors.reset}\n`);
    }
    throw error;
  }
}

// Help
function showHelp() {
  console.log(`
${colors.cyan}Commands:${colors.reset}
  /help     - Show help
  /clear    - Clear conversation history
  /search   - Enable web search for next message
  /history  - Show conversation history
  /exit     - Exit

${colors.cyan}Examples:${colors.reset}
  Hello!
  /search What's the weather today?
  Write code: Fibonacci in Python
`);
}

// Main loop
async function main() {
  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════╗
║          SayKnowAI AI Server - Chat CLI                ║
╚════════════════════════════════════════════════════════╝${colors.reset}

Server: ${CONFIG.aiServer}
Auth: ${privateKey ? '✅ RSA key loaded' : '❌ No auth'}

${colors.dim}Type /help for commands${colors.reset}
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let enableSearch = false;

  const prompt = () => {
    const searchIndicator = enableSearch ? `${colors.blue}[Search] ${colors.reset}` : '';
    rl.question(`${searchIndicator}${colors.cyan}You: ${colors.reset}`, async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }
      
      // Command handling
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.toLowerCase();
        
        if (cmd === '/exit' || cmd === '/quit') {
          console.log('\n👋 Goodbye!\n');
          rl.close();
          process.exit(0);
        }
        
        if (cmd === '/help') {
          showHelp();
          prompt();
          return;
        }
        
        if (cmd === '/clear') {
          conversationHistory.length = 0;
          console.log(`${colors.green}Conversation history cleared.${colors.reset}\n`);
          prompt();
          return;
        }
        
        if (cmd === '/search') {
          enableSearch = true;
          console.log(`${colors.blue}Web search enabled for next message.${colors.reset}\n`);
          prompt();
          return;
        }
        
        if (cmd === '/history') {
          console.log(`\n${colors.cyan}Conversation history (${conversationHistory.length} messages):${colors.reset}`);
          conversationHistory.forEach((msg, i) => {
            const role = msg.role === 'user' ? 'You' : 'AI';
            const color = msg.role === 'user' ? colors.cyan : colors.green;
            console.log(`${color}[${i + 1}] ${role}: ${msg.content.substring(0, 50)}...${colors.reset}`);
          });
          console.log('');
          prompt();
          return;
        }
        
        // /search message format
        if (cmd.startsWith('/search ')) {
          const message = trimmed.slice(8);
          try {
            await chat(message, { search: true });
          } catch (e) {
            // Error already printed
          }
          prompt();
          return;
        }
        
        console.log(`${colors.yellow}Unknown command: ${trimmed}${colors.reset}\n`);
        prompt();
        return;
      }
      
      // Normal chat
      try {
        await chat(trimmed, { search: enableSearch });
        enableSearch = false; // Reset search flag
      } catch (e) {
        // Error already printed
      }
      
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
