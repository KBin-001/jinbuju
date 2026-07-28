/**
 * Generates two short mechanical tick sounds for the duration slider.
 * - tick-minor.wav: 5-minute crossing — short, soft, crisp
 * - tick-major.wav: 30-minute crossing — slightly more noticeable
 *
 * Run: node scripts/gen-tick-sounds.js
 */
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function generateTick(durationMs, frequency, volume, decayTauMs) {
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const samples = new Float32Array(numSamples);
  const attackSamples = Math.floor((SAMPLE_RATE * 0.4) / 1000);
  const decayTau = decayTauMs / 1000;

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    let envelope;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else {
      const dt = (i - attackSamples) / SAMPLE_RATE;
      envelope = Math.exp(-dt / decayTau);
    }
    const fundamental = Math.sin(2 * Math.PI * frequency * t);
    const harmonic = 0.25 * Math.sin(2 * Math.PI * frequency * 2.76 * t);
    const wave = fundamental + harmonic;
    samples[i] = wave * envelope * volume;
  }
  return samples;
}

const minorTick = generateTick(22, 2000, 0.14, 5.5);
const majorTick = generateTick(32, 1600, 0.22, 9);

const outDir = path.join(__dirname, "..", "miniprogram", "assets", "sounds");
writeWav(path.join(outDir, "tick-minor.wav"), minorTick);
writeWav(path.join(outDir, "tick-major.wav"), majorTick);

console.log("Generated:", path.join(outDir, "tick-minor.wav"), path.join(outDir, "tick-major.wav"));
