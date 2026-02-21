import { expect } from '@playwright/test';
import { test } from './fixtures';
import { CsvFactory } from './fixtures/csv.factory';

/**
 * E2E Scenario 1 — Estudiantes: CSV Upload → Bulk Job → PDF Download
 *
 * Flow:
 *   / → /staging (upload 21-col CSV, validate, migrate) → /bulk (create category job) → /bulk/[jobId]
 */
test.describe('Estudiantes Upload Flow', { tag: '@estudiantes' }, () => {
  // ─── UI / Validation ────────────────────────────────────────────────────

  test(
    'submit button is disabled until a file is attached',
    { tag: ['@ui', '@smoke'] },
    async ({ stagingPage }) => {
      await expect(stagingPage.submitButton).toBeDisabled();
      await expect(stagingPage.uploadZone).toBeVisible();
    }
  );

  test(
    'shows format banner with required and optional column info',
    { tag: ['@ui', '@smoke'] },
    async ({ stagingPage }) => {
      await expect(stagingPage.formatBanner).toBeVisible();
      await expect(stagingPage.formatBanner).toContainText('21 columnas requeridas');
      await expect(stagingPage.formatBanner).toContainText('CODIGO_CE');
      await expect(stagingPage.formatBanner).toContainText('TRANSPORTE');
      await expect(stagingPage.formatBanner).toContainText('REF_KITS');
      await expect(stagingPage.formatBanner).toContainText('REF_UNIFORMES');
      await expect(stagingPage.formatBanner).toContainText('REF_ZAPATOS');
    }
  );

  test('shows warning banner about data replacement', { tag: ['@ui'] }, async ({ stagingPage }) => {
    await expect(stagingPage.warningBanner).toBeVisible();
    await expect(stagingPage.warningBanner).toContainText('reemplazará');
  });

  test('shows sample download link', { tag: ['@ui'] }, async ({ stagingPage }) => {
    await expect(stagingPage.sampleDownloadLink).toBeVisible();
  });

  test(
    'enables submit button after attaching a file',
    { tag: ['@ui', '@smoke'] },
    async ({ stagingPage }) => {
      await stagingPage.attachFile('students.csv', CsvFactory.validEstudiantes());
      await expect(stagingPage.submitButton).toBeEnabled();
    }
  );

  test(
    'shows filename in upload zone after file selection',
    { tag: ['@ui'] },
    async ({ stagingPage }) => {
      await stagingPage.attachFile('students.csv', CsvFactory.validEstudiantes());
      await expect(stagingPage.page.getByText('students.csv')).toBeVisible();
      await expect(stagingPage.changeFileButton).toBeVisible();
    }
  );

  test(
    'shows column validation error when required columns are missing',
    { tag: ['@e2e', '@smoke'] },
    async ({ stagingPage }) => {
      // Arrange: CSV missing the first 3 required columns
      const missingCols = CsvFactory.missingEstudiantesColumns(3);
      await stagingPage.attachFile('bad.csv', CsvFactory.invalidEstudiantes(3));

      // Act
      await stagingPage.submitButton.click();

      // Assert
      const errorText = await stagingPage.getErrorText();
      expect(errorText).toContain('Columnas faltantes');
      for (const col of missingCols) {
        expect(errorText).toContain(col);
      }
    }
  );

  test(
    'flow stepper shows 3 steps with Cargar CSV as active',
    { tag: ['@ui'] },
    async ({ stagingPage }) => {
      await expect(stagingPage.flowStepper).toBeVisible();
      await expect(stagingPage.flowStepper.getByText('Cargar CSV')).toBeVisible();
      await expect(stagingPage.flowStepper.getByText('Procesar')).toBeVisible();
      await expect(stagingPage.flowStepper.getByText('Descargar')).toBeVisible();
    }
  );

  // ─── Integration (API intercepted) ─────────────────────────────────────

  test(
    'happy path: valid CSV triggers migration and shows stats',
    { tag: ['@e2e', '@integration'] },
    async ({ stagingPage }) => {
      // Arrange: intercept API calls to avoid mutating the real DB
      await stagingPage.page.route('/api/staging', async route => {
        const body = route.request().postDataJSON() as { action: string };

        if (body.action === 'truncate') {
          await route.fulfill({ json: { ok: true } });
        } else if (body.action === 'insert') {
          await route.fulfill({ json: { inserted: 1 } });
        } else if (body.action === 'migrate') {
          await route.fulfill({
            json: { data: { schools: 1, students: 1, sizes: 1 } },
          });
        } else {
          await route.continue();
        }
      });

      // Act
      await stagingPage.attachFile('students.csv', CsvFactory.validEstudiantes());
      await stagingPage.submitButton.click();

      // Assert: migration success panel visible with stats
      await expect(stagingPage.successPanel).toBeVisible({ timeout: 15_000 });
      const stats = await stagingPage.getMigrationStats();
      expect(Number(stats.schools)).toBeGreaterThan(0);
      expect(Number(stats.students)).toBeGreaterThan(0);
    }
  );

  test(
    'happy path: "Ir a Reportes Masivos" navigates to /bulk after migration',
    { tag: ['@e2e'] },
    async ({ stagingPage }) => {
      await stagingPage.page.route('/api/staging', async route => {
        const body = route.request().postDataJSON() as { action: string };
        if (body.action === 'truncate') await route.fulfill({ json: { ok: true } });
        else if (body.action === 'insert') await route.fulfill({ json: { inserted: 1 } });
        else if (body.action === 'migrate')
          await route.fulfill({ json: { data: { schools: 1, students: 1, sizes: 1 } } });
        else await route.continue();
      });

      await stagingPage.attachFile('students.csv', CsvFactory.validEstudiantes());
      await stagingPage.submitButton.click();
      await expect(stagingPage.goToBulkButton).toBeVisible({ timeout: 15_000 });

      await stagingPage.goToBulkButton.click();
      await expect(stagingPage.page).toHaveURL(/\/bulk$/);
    }
  );

  // ─── Bulk Job Creation ──────────────────────────────────────────────────

  test(
    'bulk page: "Crear Trabajo" is disabled until a date is selected',
    { tag: ['@ui', '@smoke'] },
    async ({ bulkPage }) => {
      await bulkPage.openCategoryForm();
      await expect(bulkPage.createJobButton).toBeDisabled();
    }
  );

  test(
    'bulk page: selecting a date enables "Crear Trabajo"',
    { tag: ['@ui'] },
    async ({ bulkPage }) => {
      await bulkPage.openCategoryForm();
      await bulkPage.selectToday();
      await expect(bulkPage.createJobButton).toBeEnabled();
    }
  );

  test(
    'bulk page: creating a job via intercepted API shows it in the list',
    { tag: ['@e2e', '@integration'] },
    async ({ bulkPage }) => {
      // Arrange
      const fakeJobId = 'aabbccdd-0000-0000-0000-000000000001';

      await bulkPage.page.route('/api/bulk/jobs/category', route =>
        route.fulfill({
          json: { jobId: fakeJobId },
        })
      );
      await bulkPage.page.route('/api/bulk/jobs', route =>
        route.fulfill({
          json: {
            jobs: [
              {
                id: fakeJobId,
                status: 'queued',
                created_at: new Date().toISOString(),
                error: null,
              },
            ],
          },
        })
      );

      // Act
      await bulkPage.openCategoryForm();
      await bulkPage.selectToday();
      await bulkPage.createJobButton.click();

      // Assert: job appears in the list
      await expect(bulkPage.page.getByText(fakeJobId.slice(0, 8))).toBeVisible({ timeout: 10_000 });
    }
  );
});
