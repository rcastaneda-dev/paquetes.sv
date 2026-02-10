# Tests

End-to-end test suite built with [Playwright](https://playwright.dev/) and TypeScript.

## Directory Structure

```
tests/
├── fixtures/
│   ├── index.ts                    # Custom fixture definitions (dependency injection)
│   └── school-search.factory.ts    # Test data factory for school search
├── pages/
│   └── home.page.ts                # Page Object Model for the home page
└── buscar-students.spec.ts         # Student search test suite
```

## Architecture

### Page Object Model (POM)

Page objects live in `pages/` and encapsulate all locators and interactions for a given page. They expose:

- **Locators** as `readonly` properties initialized in the constructor.
- **Action methods** (`searchSchool`, `clickBuscar`, `clickLimpiar`) for single-step operations.
- **Composite methods** (`searchSchoolAndFetchStudents`) that chain common multi-step workflows.
- **Query methods** (`getStudentCount`, `getTableHeaders`) that extract and return structured data.

### Fixtures

Custom Playwright fixtures in `fixtures/index.ts` extend the base `test` object to inject:

- `homePage` — auto-navigates to the home page before each test.
- `schoolSearch` — provides a `SchoolSearchFactory` instance for test data and API helpers.

All spec files import `test` and `expect` from `fixtures/index.ts` instead of `@playwright/test`.

### Factories

Factories in `fixtures/` centralize test data and API helpers. `SchoolSearchFactory` provides predefined search queries and a method to call the backend API directly, enabling API-vs-UI consistency checks.

## Conventions

### File Naming

| Type       | Pattern                | Example                        |
| ---------- | ---------------------- | ------------------------------ |
| Test suite | `*.spec.ts`            | `buscar-students.spec.ts`      |
| Page object| `*.page.ts`            | `home.page.ts`                 |
| Factory    | `*.factory.ts`         | `school-search.factory.ts`     |
| Fixtures   | `index.ts` in fixtures | `fixtures/index.ts`            |

### Locator Strategy

Use accessibility-first selectors in this order of preference:

1. `getByRole()` — buttons, textboxes, comboboxes, tables, rows.
2. `getByText()` — visible text and labels.
3. `.locator()` with CSS selectors — only when no semantic role is available.
4. Regex patterns for dynamic text (e.g., `/Mostrando \d+ - \d+ de \d+ estudiantes/`).

### Test Tags

Tests are tagged for flexible filtering. A test can have multiple tags.

| Tag            | Purpose                     |
| -------------- | --------------------------- |
| `@e2e`         | Full end-to-end user flows  |
| `@smoke`       | Critical happy-path checks  |
| `@ui`          | UI state validation         |
| `@integration` | API contract verification   |
| `@pagination`  | Pagination behavior         |
| `@filters`     | Filter/clear functionality  |
| `@search`      | Suite-level search tag       |

### Wait Strategy

- Use `await expect(locator).toBeVisible()` or `.toBeEnabled({ timeout })` for assertions that wait.
- Use `locator.waitFor({ state: 'visible', timeout })` when you need an explicit wait outside an assertion.
- Never use `page.waitForTimeout()` with arbitrary delays.

### Assertions

```ts
// Visibility & state
await expect(locator).toBeVisible();
await expect(locator).toBeDisabled();
await expect(locator).toBeEnabled({ timeout: 10000 });

// Content
await expect(locator).toContainText('expected');
expect(value).toBeGreaterThan(0);
expect(array).toEqual(expectedArray);
```

## Running Tests

```bash
# All tests (all browsers, with trace)
npm test

# By tag
npm run test:e2e
npm run test:smoke
npm run test:ui
npm run test:integration

# Debug & headed modes
npm run test:debug
npm run test:headed
```

### Environment Variables

| Variable   | Default                              | Description       |
| ---------- | ------------------------------------ | ----------------- |
| `BASE_URL` | `https://paquetes-sv.vercel.app`     | Application URL   |
| `CI`       | —                                    | Enables CI mode (retries, single worker, forbidOnly) |

## Cross-Browser Support

Tests run against three browser engines configured in `playwright.config.ts`:

- Chromium
- Firefox
- WebKit

In CI, tests run with **1 worker** and **2 retries**. Locally, workers are unlimited and retries are disabled.

## Adding a New Test

1. **Create or reuse a page object** in `pages/` if you need new locators or actions.
2. **Add test data** to an existing factory or create a new `*.factory.ts` in `fixtures/`.
3. **Register new fixtures** in `fixtures/index.ts` if needed.
4. **Write the spec** in a `*.spec.ts` file, importing `test` and `expect` from `fixtures/index.ts`.
5. **Tag the test** with relevant tags (`@e2e`, `@smoke`, etc.) in the test title.

```ts
import { test, expect } from './fixtures';

test.describe('Feature Name @feature-tag', () => {
  test('should do something @e2e @smoke', async ({ homePage }) => {
    // Use page object methods
    // Assert expected outcomes
  });
});
```
