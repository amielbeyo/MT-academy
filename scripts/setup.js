#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();

function runStep(stepName, command, args) {
  console.log(`\n➡️  ${stepName}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error(`\n✖️  ${stepName} failed. Please fix the problem above and try again.`);
    process.exit(result.status ?? 1);
  }
}

function ensureEnvFile() {
  const envPath = path.join(projectRoot, '.env');
  const examplePath = path.join(projectRoot, '.env.example');

  if (fs.existsSync(envPath)) {
    return;
  }

  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log("\n📄 Copied .env.example to .env for you.");
  } else {
    const template = ['OPENAI_API_KEY=', 'GEMINI_API_KEY='].join('\n');
    fs.writeFileSync(envPath, `${template}\n`);
    console.log("\n📄 Created a fresh .env file for you.");
  }
}

console.log('Hello! I will set everything up for you.');

runStep('Installing everything the app needs', 'npm', ['install']);

ensureEnvFile();

runStep('Saving your secret keys', process.execPath, [path.join('scripts', 'save-keys.js')]);

console.log('\n✅ All done! Run "npm start" next, then open http://localhost:3000.');
