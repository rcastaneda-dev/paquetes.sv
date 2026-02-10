import type { Page } from '@playwright/test';

interface SchoolSearchQuery {
  term: string;
  minResults: number;
}

const SEARCH_QUERIES: SchoolSearchQuery[] = [
  { term: 'escuela', minResults: 1 },
  { term: 'centro', minResults: 1 },
  { term: 'complejo', minResults: 1 },
];

export class SchoolSearchFactory {
  private page: Page;
  private baseURL: string;

  constructor(page: Page, baseURL: string) {
    this.page = page;
    this.baseURL = baseURL;
  }

  getSearchQueries(): SchoolSearchQuery[] {
    return SEARCH_QUERIES;
  }

  getDefaultQuery(): SchoolSearchQuery {
    return SEARCH_QUERIES[0];
  }

  async fetchSchoolsFromAPI(query: string): Promise<{ codigo_ce: string; nombre_ce: string }[]> {
    const response = await this.page.request.get(
      `${this.baseURL}/api/schools/search?q=${encodeURIComponent(query)}`
    );
    const data = await response.json();
    return data.schools ?? [];
  }
}
