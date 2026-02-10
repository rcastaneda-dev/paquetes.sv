import { type Locator, type Page, expect } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly schoolSearchInput: Locator;
  readonly gradeSelect: Locator;
  readonly buscarButton: Locator;
  readonly limpiarButton: Locator;
  readonly autocompleteDropdown: Locator;
  readonly studentsTable: Locator;
  readonly resultsSummary: Locator;
  readonly selectedSchoolInfo: Locator;
  readonly reportButtons: Locator;
  readonly paginationNextButton: Locator;
  readonly paginationPrevButton: Locator;
  readonly paginationInfo: Locator;

  constructor(page: Page) {
    this.page = page;
    this.schoolSearchInput = page.getByRole('textbox', { name: 'Código CE o Nombre' });
    this.gradeSelect = page.getByRole('combobox', { name: 'Grado' });
    this.buscarButton = page.getByRole('button', { name: 'Buscar' });
    this.limpiarButton = page.getByRole('button', { name: 'Limpiar' });
    this.autocompleteDropdown = page.locator('.absolute.z-10');
    this.studentsTable = page.getByRole('table');
    this.resultsSummary = page.getByText(/Mostrando \d+ - \d+ de \d+ estudiantes/);
    this.selectedSchoolInfo = page.getByText(/Código CE seleccionado:/);
    this.reportButtons = page.getByText('Generar Reportes:').locator('..');
    this.paginationNextButton = page.getByRole('button', { name: 'Siguiente' });
    this.paginationPrevButton = page.getByRole('button', { name: 'Anterior' });
    this.paginationInfo = page.getByText(/Página \d+ de \d+/);
  }

  async goto() {
    await this.page.goto('/');
  }

  async searchSchool(query: string) {
    await this.schoolSearchInput.click();
    await this.schoolSearchInput.fill(query);
    await this.autocompleteDropdown.waitFor({ state: 'visible' });
  }

  getAutocompleteOptions(): Locator {
    return this.autocompleteDropdown.getByRole('button');
  }

  async selectFirstAutocompleteOption(): Promise<{ code: string; name: string }> {
    const firstOption = this.getAutocompleteOptions().first();
    await firstOption.waitFor({ state: 'visible' });

    const code = await firstOption.locator('.font-medium').textContent();
    const name = await firstOption.locator('.text-sm').textContent();

    await firstOption.click();

    return { code: code?.trim() ?? '', name: name?.trim() ?? '' };
  }

  async clickBuscar() {
    await this.buscarButton.click();
  }

  async clickLimpiar() {
    await this.limpiarButton.click();
  }

  async searchAndSelectFirstSchool(query: string): Promise<{ code: string; name: string }> {
    await this.searchSchool(query);
    const selected = await this.selectFirstAutocompleteOption();
    await expect(this.gradeSelect).toBeEnabled({ timeout: 10000 });
    return selected;
  }

  async searchSchoolAndFetchStudents(
    query: string
  ): Promise<{ selected: { code: string; name: string }; studentCount: number }> {
    const selected = await this.searchAndSelectFirstSchool(query);
    await this.clickBuscar();
    await this.waitForStudentsLoaded();
    const studentCount = await this.getStudentCount();
    return { selected, studentCount };
  }

  async waitForStudentsLoaded() {
    await this.resultsSummary.waitFor({ state: 'visible', timeout: 15000 });
  }

  async getStudentCount(): Promise<number> {
    const text = await this.resultsSummary.textContent();
    const match = text?.match(/de (\d+) estudiantes/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getTableRowCount(): Promise<number> {
    return this.studentsTable.locator('tbody tr').count();
  }

  async getTableHeaders(): Promise<string[]> {
    const headers = this.studentsTable.locator('thead th');
    return headers.allTextContents();
  }

  async getGradeOptions(): Promise<string[]> {
    const options = this.gradeSelect.locator('option');
    return options.allTextContents();
  }

  async isGradeSelectEnabled(): Promise<boolean> {
    return this.gradeSelect.isEnabled();
  }

  async hasReportButtons(): Promise<boolean> {
    return this.reportButtons.isVisible();
  }
}
