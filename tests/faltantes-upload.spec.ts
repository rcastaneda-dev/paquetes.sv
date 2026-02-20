import { expect } from '@playwright/test';
import { test } from './fixtures';
import { CsvFactory } from './fixtures/csv.factory';

/**
 * E2E Scenario 2 — Faltantes: Demand CSV Upload → Report Download
 *
 * Flow:
 *   / → /staging/demand (upload 11-col CSV, validate, migrate) → /reports/demand (download reports)
 */
test.describe('Faltantes Upload Flow', { tag: '@faltantes' }, () => {
  // ─── UI / Validation ────────────────────────────────────────────────────

  test(
    'submit button is disabled until a file is attached',
    { tag: ['@ui', '@smoke'] },
    async ({ demandPage }) => {
      await expect(demandPage.submitButton).toBeDisabled();
      await expect(demandPage.uploadZone).toBeVisible();
    }
  );

  test(
    'shows format banner with column list',
    { tag: ['@ui', '@smoke'] },
    async ({ demandPage }) => {
      await expect(demandPage.formatBanner).toBeVisible();
      await expect(demandPage.formatBanner).toContainText('CSV con 11 columnas');
      await expect(demandPage.formatBanner).toContainText('CODIGO');
      await expect(demandPage.formatBanner).toContainText('CANTIDAD');
    }
  );

  test(
    'shows warning banner about demand data replacement',
    { tag: ['@ui'] },
    async ({ demandPage }) => {
      await expect(demandPage.warningBanner).toBeVisible();
      await expect(demandPage.warningBanner).toContainText('reemplazará');
    }
  );

  test('shows sample download link', { tag: ['@ui'] }, async ({ demandPage }) => {
    await expect(demandPage.sampleDownloadLink).toBeVisible();
  });

  test(
    'enables submit button after attaching a file',
    { tag: ['@ui', '@smoke'] },
    async ({ demandPage }) => {
      await demandPage.attachFile('demand.csv', CsvFactory.validDemand());
      await expect(demandPage.submitButton).toBeEnabled();
    }
  );

  test(
    'shows filename in upload zone after file selection',
    { tag: ['@ui'] },
    async ({ demandPage }) => {
      await demandPage.attachFile('demand.csv', CsvFactory.validDemand());
      await expect(demandPage.page.getByText('demand.csv')).toBeVisible();
      await expect(demandPage.changeFileButton).toBeVisible();
    }
  );

  test(
    'shows column validation error when required columns are missing',
    { tag: ['@e2e', '@smoke'] },
    async ({ demandPage }) => {
      // Arrange: CSV missing the first 2 required columns
      const missingCols = CsvFactory.missingDemandColumns(2);
      await demandPage.attachFile('bad.csv', CsvFactory.invalidDemand(2));

      // Act
      await demandPage.submitButton.click();

      // Assert
      const errorText = await demandPage.getErrorText();
      expect(errorText).toContain('faltantes');
      for (const col of missingCols) {
        expect(errorText).toContain(col);
      }
    }
  );

  test(
    'flow stepper shows 2 steps with Cargar CSV as active',
    { tag: ['@ui'] },
    async ({ demandPage }) => {
      await expect(demandPage.flowStepper).toBeVisible();
      await expect(demandPage.flowStepper.getByText('Cargar CSV')).toBeVisible();
      await expect(demandPage.flowStepper.getByText('Descargar')).toBeVisible();
    }
  );

  // ─── Integration (API intercepted) ─────────────────────────────────────

  test(
    'happy path: valid CSV triggers migration and shows stats',
    { tag: ['@e2e', '@integration'] },
    async ({ demandPage }) => {
      // Arrange
      await demandPage.page.route('/api/staging/demand', async route => {
        const body = route.request().postDataJSON() as { action: string };

        if (body.action === 'truncate') {
          await route.fulfill({ json: { ok: true } });
        } else if (body.action === 'insert') {
          await route.fulfill({ json: { inserted: 1 } });
        } else if (body.action === 'migrate') {
          await route.fulfill({
            json: { data: { schools: 1, demand_rows: 1 } },
          });
        } else {
          await route.continue();
        }
      });

      // Act
      await demandPage.attachFile('demand.csv', CsvFactory.validDemand());
      await demandPage.submitButton.click();

      // Assert
      await expect(demandPage.successPanel).toBeVisible({ timeout: 15_000 });
      const stats = await demandPage.getMigrationStats();
      expect(Number(stats.schools)).toBeGreaterThan(0);
      expect(Number(stats.demandRows)).toBeGreaterThan(0);
    }
  );

  test(
    'happy path: "Ver Reporte de Faltantes" is visible after migration',
    { tag: ['@e2e'] },
    async ({ demandPage }) => {
      await demandPage.page.route('/api/staging/demand', async route => {
        const body = route.request().postDataJSON() as { action: string };
        if (body.action === 'truncate') await route.fulfill({ json: { ok: true } });
        else if (body.action === 'insert') await route.fulfill({ json: { inserted: 1 } });
        else if (body.action === 'migrate')
          await route.fulfill({ json: { data: { schools: 1, demand_rows: 1 } } });
        else await route.continue();
      });

      await demandPage.attachFile('demand.csv', CsvFactory.validDemand());
      await demandPage.submitButton.click();

      await expect(demandPage.viewReportButton).toBeVisible({ timeout: 15_000 });
    }
  );

  test(
    'API error is surfaced as a readable error message',
    { tag: ['@e2e', '@integration'] },
    async ({ demandPage }) => {
      await demandPage.page.route('/api/staging/demand', async route => {
        const body = route.request().postDataJSON() as { action: string };
        if (body.action === 'truncate')
          await route.fulfill({ json: { error: 'DB connection timeout' } });
        else await route.continue();
      });

      await demandPage.attachFile('demand.csv', CsvFactory.validDemand());
      await demandPage.submitButton.click();

      const errorText = await demandPage.getErrorText();
      expect(errorText).toContain('DB connection timeout');
    }
  );
});
