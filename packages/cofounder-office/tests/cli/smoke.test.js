/**
 * cofounder-office CLI Smoke Tests
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
} = require('../../../../tests/helpers/cli-test-utils');

const PKG = 'cofounder-office';
const BIN = getBinPath(PKG);

// doer persona'nın fire testi bıraktığı status.json'ı temizle
const DOER_STATUS = path.join(__dirname, '..', '..', 'brains', 'personas', 'doer', 'status.json');

afterAll(() => {
  teardownOutputDir(PKG);
  if (fs.existsSync(DOER_STATUS)) fs.unlinkSync(DOER_STATUS);
});

describe('cofounder-office CLI', () => {

  // ─── P0 — Smoke ───────────────────────────────────────────────────────────

  describe('P0 — Smoke', () => {
    test('--help exits 0 and prints usage', () => {
      const r = execCli(BIN, ['--help']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/usage|cofounder-office|roster/i);
    });

    test('--version exits 0 and prints a version number', () => {
      const r = execCli(BIN, ['--version']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/\d+\.\d+\.\d+/);
    });

    test('unknown subcommand exits non-zero', () => {
      const r = execCli(BIN, ['unknowncmd']);
      expect(r.exitCode).not.toBe(0);
    });
  });

  // ─── P0 — Error Handling ──────────────────────────────────────────────────

  describe('P0 — Error Handling', () => {
    test('consult without --input exits non-zero and reports missing flag', () => {
      const r = execCli(BIN, ['consult', '--persona', 'cvo']);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/input|required|missing/i);
    });

    test('consult with nonexistent persona exits non-zero and reports persona name', () => {
      const r = execCli(BIN, [
        'consult',
        '--input', path.join(FIXTURES, 'raw', 'sample-paper.txt'),
        '--persona', 'ghost',
      ]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/ghost|not found|persona/i);
    });

    test('consult with nonexistent input file exits non-zero and reports path', () => {
      const r = execCli(BIN, ['consult', '--input', '/nonexistent/file.txt']);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/not found|no such|cannot|file/i);
    });

    test('digest without --output exits non-zero and reports missing flag', () => {
      const r = execCli(BIN, ['digest']);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/output|required|missing/i);
    });

    test('fire without --input exits non-zero and reports missing flag', () => {
      const r = execCli(BIN, ['fire']);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/input|required|missing/i);
    });

    test('eval without --input exits non-zero and reports missing flag', () => {
      const r = execCli(BIN, [
        'eval',
        '--baseline', path.join(FIXTURES, 'json', 'baseline-v1.json'),
      ]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/input|required|missing/i);
    });

    test('eval without --baseline exits non-zero and reports missing flag', () => {
      const r = execCli(BIN, [
        'eval',
        '--input', path.join(FIXTURES, 'json', 'new-output-v2.json'),
      ]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/baseline|required|missing/i);
    });

    test('roster --format invalid exits non-zero and reports valid options', () => {
      const r = execCli(BIN, ['roster', '--format', 'csv']);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/csv|invalid|format|json|markdown/i);
    });
  });

  // ─── P1 — Dry Run ─────────────────────────────────────────────────────────

  describe('P1 — Dry Run', () => {
    test('digest --dry-run exits 0, no output file created', () => {
      const outDir = setupOutputDir(PKG, 'dry-run');
      const outFile = path.join(outDir, 'digest.json');
      const r = execCli(BIN, ['digest', '--output', outFile, '--dry-run']);
      expect(r.exitCode).toBe(0);
      expect(fs.existsSync(outFile)).toBe(false);
    });

    test('digest --dry-run stdout reports active persona count', () => {
      const outDir = setupOutputDir(PKG, 'dry-run-stdout');
      const outFile = path.join(outDir, 'digest.json');
      const r = execCli(BIN, ['digest', '--output', outFile, '--dry-run']);
      expect(r.exitCode).toBe(0);
      // must print "Active Personas: N" (N >= 1)
      expect(r.stdout + r.stderr).toMatch(/Active Personas:\s*[1-9]\d*/i);
    });
  });

  // ─── P1 — Happy Path ──────────────────────────────────────────────────────

  describe('P1 — Happy Path', () => {
    test('roster returns valid JSON array with at least 3 active personas', () => {
      const r = execCli(BIN, ['roster', '--format', 'json']);
      expect(r.exitCode).toBe(0);
      let parsed;
      expect(() => { parsed = JSON.parse(r.stdout); }).not.toThrow();
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(3);
      parsed.forEach(p => {
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('role');
        expect(p).toHaveProperty('status', 'active');
      });
    });

    test('roster --format markdown outputs proper markdown structure', () => {
      const r = execCli(BIN, ['roster', '--format', 'markdown']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/^#\s+.+/m);   // en az bir # başlığı
      expect(r.stdout).toMatch(/- \*\*/);       // - ** list item formatı
    });

    test('digest generates office summary file', () => {
      const outDir = setupOutputDir(PKG, 'digest');
      const outFile = path.join(outDir, 'summary.json');
      const r = execCli(BIN, ['digest', '--output', outFile, '--format', 'json']);
      expect(r.exitCode).toBe(0);   // exit 0 zorunlu, if guard yok
      expectFileExists(outFile);
    });

    test('digest --format yaml exits 0 and writes a file', () => {
      const outDir = setupOutputDir(PKG, 'digest-yaml');
      const outFile = path.join(outDir, 'summary.yaml');
      const r = execCli(BIN, ['digest', '--output', outFile, '--format', 'yaml']);
      expect(r.exitCode).toBe(0);
      expectFileExists(outFile);
    });

    test('digest with valid config exits 0', () => {
      const outDir = setupOutputDir(PKG, 'digest-config');
      const outFile = path.join(outDir, 'summary.json');
      const r = execCli(BIN, [
        'digest',
        '--output', outFile,
        '--config', path.join(FIXTURES, 'config', 'summary-10min.yaml'),
      ]);
      expect(r.exitCode).toBe(0);
    });

    test('fire with valid persona exits 0', () => {
      // "or not-implemented" toleransı kaldırıldı — kesinlikle exit 0 bekleniyor
      const r = execCli(BIN, ['fire', '--input', 'doer']);
      expect(r.exitCode).toBe(0);
    });
  });
});
