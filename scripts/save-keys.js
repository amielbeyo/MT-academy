#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.resolve(process.cwd(), '.env');
const examplePath = path.resolve(process.cwd(), '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log("I couldn't find .env, so I copied .env.example for you.\n");
  } else {
    const blankTemplate = ['OPENAI_API_KEY=', 'GEMINI_API_KEY='].join('\n');
    fs.writeFileSync(envPath, `${blankTemplate}\n`);
    console.log("I made a brand-new .env file for you.\n");
  }
}

const envText = fs.readFileSync(envPath, 'utf8');
const lines = envText.split(/\r?\n/);
const keyNames = ['OPENAI_API_KEY', 'GEMINI_API_KEY'];
const placeholders = {
  OPENAI_API_KEY: 'sk-your-openai-key-here',
  GEMINI_API_KEY: 'your-gemini-key-here',
};
const currentValues = {};

for (const key of keyNames) {
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (line) {
    const rawValue = line.slice(key.length + 1);
    currentValues[key] = rawValue === placeholders[key] ? '' : rawValue;
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askForKey(index, answers) {
  if (index >= keyNames.length) {
    rl.close();
    saveKeys({ ...currentValues, ...answers });
    return;
  }

  const key = keyNames[index];
  const friendlyName = key === 'OPENAI_API_KEY' ? 'OpenAI' : 'Gemini';
  const prompt = `Paste your ${friendlyName} key (or press Enter to skip): `;

  rl.question(prompt, (value) => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      answers[key] = trimmed;
    }
    askForKey(index + 1, answers);
  });
}

function saveKeys(values) {
  const updatedLines = lines.map((line) => {
    for (const key of keyNames) {
      if (line.startsWith(`${key}=`)) {
        return `${key}=${values[key] ?? ''}`;
      }
    }
    return line;
  });

  for (const key of keyNames) {
    if (!updatedLines.some((line) => line.startsWith(`${key}=`))) {
      updatedLines.push(`${key}=${values[key] ?? ''}`);
    }
  }

  const output = updatedLines.join('\n').replace(/\n+$/, '\n');
  fs.writeFileSync(envPath, output);
  console.log('\nAll set! Your keys are saved safely inside .env.');
}

console.log('Hi friend! Let me tuck your keys into .env for you.');
askForKey(0, {});
