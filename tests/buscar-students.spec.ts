import { test, expect } from './fixtures';

test.describe('Buscar Students', { tag: '@search' }, () => {
  test(
    'should search for a school via autocomplete and display students',
    {
      tag: ['@e2e', '@smoke'],
    },
    async ({ homePage, schoolSearch }) => {
      const query = schoolSearch.getDefaultQuery();

      // Type in the search field and verify autocomplete shows results
      await homePage.searchSchool(query.term);
      const options = homePage.getAutocompleteOptions();
      expect(await options.count()).toBeGreaterThanOrEqual(query.minResults);

      // Select the first option and verify school selection state
      const selected = await homePage.selectFirstAutocompleteOption();
      expect(selected.code).toBeTruthy();
      expect(selected.name).toBeTruthy();
      await expect(homePage.schoolSearchInput).toHaveValue(selected.code);
      await expect(homePage.selectedSchoolInfo).toBeVisible();
      await expect(homePage.selectedSchoolInfo).toContainText(selected.code);

      // Verify grade dropdown enabled with options
      await expect(homePage.gradeSelect).toBeEnabled({ timeout: 10000 });
      const gradeOptions = await homePage.getGradeOptions();
      expect(gradeOptions.length).toBeGreaterThanOrEqual(2);

      // Buscar and verify results
      await homePage.clickBuscar();
      await homePage.waitForStudentsLoaded();

      const studentCount = await homePage.getStudentCount();
      expect(studentCount).toBeGreaterThan(0);

      const rowCount = await homePage.getTableRowCount();
      expect(rowCount).toBeGreaterThan(0);
      expect(rowCount).toBeLessThanOrEqual(50);

      // Verify table structure
      const headers = await homePage.getTableHeaders();
      expect(headers).toEqual([
        'NIE',
        'Nombre Estudiante',
        'Sexo',
        'Edad',
        'Grado',
        'Tipo de Camisa',
        'Camisa',
        'T. Pantalón/Falda Short',
        'Pantalón/Falda',
        'Zapato',
      ]);

      // Verify report buttons
      expect(await homePage.hasReportButtons()).toBe(true);
      await expect(homePage.reportButtons.getByRole('button', { name: /Cajas/ })).toBeVisible();
      await expect(homePage.reportButtons.getByRole('button', { name: /Camisas/ })).toBeVisible();
      await expect(
        homePage.reportButtons.getByRole('button', { name: /Pantalones/ })
      ).toBeVisible();
      await expect(homePage.reportButtons.getByRole('button', { name: /Zapatos/ })).toBeVisible();
    }
  );

  test(
    'should show pagination when results exceed page size',
    {
      tag: ['@e2e', '@pagination'],
    },
    async ({ homePage, schoolSearch }) => {
      const query = schoolSearch.getDefaultQuery();
      const { studentCount } = await homePage.searchSchoolAndFetchStudents(query.term);

      if (studentCount > 50) {
        await expect(homePage.paginationInfo).toBeVisible();
        await expect(homePage.paginationInfo).toContainText('Página 1');
        await expect(homePage.paginationPrevButton).toBeDisabled();
        await expect(homePage.paginationNextButton).toBeEnabled();

        // Navigate to page 2
        await homePage.paginationNextButton.click();
        await homePage.waitForStudentsLoaded();
        await expect(homePage.paginationInfo).toContainText('Página 2');
        await expect(homePage.paginationPrevButton).toBeEnabled();
      }
    }
  );

  test(
    'should clear filters and results when Limpiar is clicked',
    {
      tag: ['@e2e', '@filters'],
    },
    async ({ homePage, schoolSearch }) => {
      const query = schoolSearch.getDefaultQuery();
      await homePage.searchSchoolAndFetchStudents(query.term);

      await homePage.clickLimpiar();

      await expect(homePage.schoolSearchInput).toHaveValue('');
      await expect(homePage.gradeSelect).toBeDisabled();
      await expect(homePage.selectedSchoolInfo).not.toBeVisible();
    }
  );

  test(
    'should match autocomplete results with API response',
    {
      tag: ['@integration', '@api'],
    },
    async ({ homePage, schoolSearch }) => {
      const query = schoolSearch.getDefaultQuery();

      const apiSchools = await schoolSearch.fetchSchoolsFromAPI(query.term);
      expect(apiSchools.length).toBeGreaterThan(0);

      await homePage.searchSchool(query.term);

      const firstApiCode = apiSchools[0].codigo_ce;
      await expect(homePage.autocompleteDropdown.getByText(firstApiCode)).toBeVisible();
    }
  );

  test(
    'should disable grade dropdown when no school is selected',
    {
      tag: ['@ui', '@filters', '@smoke'],
    },
    async ({ homePage }) => {
      await expect(homePage.gradeSelect).toBeDisabled();
      await expect(homePage.gradeSelect).toContainText('Seleccione un código CE primero');
    }
  );
});
