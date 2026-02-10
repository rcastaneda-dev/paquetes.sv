import { test as base } from '@playwright/test';
import { HomePage } from '../pages/home.page';
import { SchoolSearchFactory } from './school-search.factory';

type Fixtures = {
  homePage: HomePage;
  schoolSearch: SchoolSearchFactory;
};

export const test = base.extend<Fixtures>({
  homePage: async ({ page }, use) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await use(homePage);
  },

  schoolSearch: async ({ page, baseURL }, use) => {
    const factory = new SchoolSearchFactory(page, baseURL ?? 'https://paquetes-sv.vercel.app');
    await use(factory);
  },
});

export { expect } from '@playwright/test';
