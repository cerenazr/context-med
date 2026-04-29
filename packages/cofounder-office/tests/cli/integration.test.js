/**
 * cofounder-office CLI Integration Tests
 * Content validation, state consistency, and eval scenarios.
 */
const path = require('path');
const fs = require('fs');
const {
  execCli,
  getBinPath,
  FIXTURES,
  setupOutputDir,
  teardownOutputDir,
  expectFileExists,
  expectValidJson,
} = require('../../../../tests/helpers/cli-test-utils');

const PKG = 'cofounder-office';
const BIN = getBinPath(PKG);

// pm persona'nın fire testi bıraktığı status.json'ı temizle
const PM_STATUS = path.join(__dirname, '..', '..', 'brains', 'personas', 'pm', 'status.json');

afterAll(() => {
  teardownOutputDir(PKG);
  if (fs.existsSync(PM_STATUS)) fs.unlinkSync(PM_STATUS);
});

// ─── P1 — Content Validation ────────────────────────────────────────────────

describe('cofounder-office CLI — Content Validation', () => {
  test('roster output is a valid JSON array with 3 personas', () => {
    const r = execCli(BIN, ['roster', '--format', 'json']);
    expect(r.exitCode).toBe(0);
    let parsed;
    expect(() => { parsed = JSON.parse(r.stdout); }).not.toThrow();
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);  // cvo, pm, doer — tam 3 persona
  });

  test('roster JSON entries each have id, name, role, status fields with correct types', () => {
    const r = execCli(BIN, ['roster', '--format', 'json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    parsed.forEach(p => {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.role).toBe('string');
      expect(['active', 'inactive']).toContain(p.status);
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
    });
  });

  test('digest output file is valid JSON', () => {
    const outDir = setupOutputDir(PKG, 'int-digest-json');
    const outFile = path.join(outDir, 'digest.json');
    const r = execCli(BIN, ['digest', '--output', outFile, '--format', 'json']);
    expect(r.exitCode).toBe(0);
    expectValidJson(outFile);
  });

  test('digest output has personas array and valid ISO 8601 timestamp', () => {
    const outDir = setupOutputDir(PKG, 'int-digest-fields');
    const outFile = path.join(outDir, 'digest.json');
    const r = execCli(BIN, ['digest', '--output', outFile, '--format', 'json']);
    expect(r.exitCode).toBe(0);
    const parsed = expectValidJson(outFile);
    expect(Array.isArray(parsed.personas)).toBe(true);
    expect(parsed.personas.length).toBeGreaterThanOrEqual(1);
    // timestamp geçerli ISO 8601 olmalı
    expect(parsed).toHaveProperty('timestamp');
    const ts = new Date(parsed.timestamp);
    expect(ts.getTime()).not.toBeNaN();
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('consult response is at least 50 characters long', () => {
    const r = execCli(BIN, [
      'consult',
      '--input', path.join(FIXTURES, 'raw', 'sample-meeting-notes.txt'),
    ]);
    expect(r.exitCode).toBe(0);
    const out = r.stdout.trim();
    expect(out.length).toBeGreaterThan(50);
  });
});

// ─── P1 — Eval Tests ────────────────────────────────────────────────────────

describe('cofounder-office CLI — Eval', () => {
  test('eval with valid input and baseline exits 0', () => {
    const r = execCli(BIN, [
      'eval',
      '--input',    path.join(FIXTURES, 'json', 'new-output-v2.json'),
      '--baseline', path.join(FIXTURES, 'json', 'baseline-v1.json'),
    ]);
    expect(r.exitCode).toBe(0);
  });

  test('eval --output writes valid JSON result file', () => {
    const outDir = setupOutputDir(PKG, 'int-eval-output');
    const outFile = path.join(outDir, 'eval-result.json');
    const r = execCli(BIN, [
      'eval',
      '--input',    path.join(FIXTURES, 'json', 'new-output-v2.json'),
      '--baseline', path.join(FIXTURES, 'json', 'baseline-v1.json'),
      '--output', outFile,
    ]);
    expect(r.exitCode).toBe(0);
    expectFileExists(outFile);
    expectValidJson(outFile);
  });

  test('eval result score is a number between 0 and 100', () => {
    const outDir = setupOutputDir(PKG, 'int-eval-score');
    const outFile = path.join(outDir, 'eval-result.json');
    const r = execCli(BIN, [
      'eval',
      '--input',    path.join(FIXTURES, 'json', 'new-output-v2.json'),
      '--baseline', path.join(FIXTURES, 'json', 'baseline-v1.json'),
      '--output', outFile,
    ]);
    expect(r.exitCode).toBe(0);
    const parsed = expectValidJson(outFile);
    const score = parsed.eval_score ?? parsed.score;
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('eval with invalid-schema input exits 2 and reports validation error', () => {
    const r = execCli(BIN, [
      'eval',
      '--input',    path.join(FIXTURES, 'json', 'invalid-schema-sample.json'),
      '--baseline', path.join(FIXTURES, 'json', 'baseline-v1.json'),
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/invalid|schema|validation|error/i);
  });

  test('eval with nonexistent baseline exits 1 and reports file path', () => {
    const r = execCli(BIN, [
      'eval',
      '--input',    path.join(FIXTURES, 'json', 'new-output-v2.json'),
      '--baseline', '/nonexistent/baseline.json',
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/not found|baseline|no such/i);
  });
});

// ─── P2 — State Consistency ───────────────────────────────────────────────────

describe('cofounder-office CLI — State Consistency', () => {
  test('fire pm then roster shows pm as inactive', () => {
    // fire: pm'i deaktive et
    const fireResult = execCli(BIN, ['fire', '--input', 'pm']);
    expect(fireResult.exitCode).toBe(0);

    // roster: pm artık inactive görünmeli
    const rosterResult = execCli(BIN, ['roster', '--format', 'json']);
    expect(rosterResult.exitCode).toBe(0);
    const list = JSON.parse(rosterResult.stdout);
    const pm = list.find(p => p.id === 'pm' || p.role === 'arabulucu');
    expect(pm).toBeDefined();
    expect(pm.status).toBe('inactive');
  });
});
