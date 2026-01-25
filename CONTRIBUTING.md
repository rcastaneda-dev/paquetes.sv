# Contributing Guide

## Development Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Fill in your Supabase credentials
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```

## Code Quality Standards

### Before Committing

Run these commands to ensure code quality:

```bash
# 1. Type check
npm run type-check

# 2. Lint and fix issues
npm run lint:fix

# 3. Format code
npm run format

# 4. Build to catch any issues
npm run build
```

### VS Code Setup

1. **Install recommended extensions**:
   - Open Command Palette (Cmd/Ctrl + Shift + P)
   - Type "Show Recommended Extensions"
   - Install all recommended extensions

2. **Verify auto-format on save**:
   - Settings should be automatically loaded from `.vscode/settings.json`
   - Try editing a file and saving - it should auto-format

### Code Style

- **TypeScript**: Strict mode enabled
- **Quotes**: Single quotes for strings
- **Semicolons**: Always required
- **Line width**: 100 characters max
- **Indentation**: 2 spaces
- **Trailing commas**: ES5 style

### Naming Conventions

- **Components**: PascalCase (`StudentGrid.tsx`)
- **Files**: camelCase for utilities (`generatePDF.ts`)
- **Folders**: kebab-case (`api/bulk-jobs/`)
- **Functions**: camelCase (`fetchStudents`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_PAGE_SIZE`)
- **Types/Interfaces**: PascalCase (`StudentQueryRow`)

## Git Workflow

### Branch Naming

- Feature: `feature/description-here`
- Bug fix: `fix/description-here`
- Hotfix: `hotfix/description-here`
- Chore: `chore/description-here`

Example: `feature/add-excel-export`

### Commit Messages

Follow conventional commits:

```
type(scope): description

[optional body]
[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding/updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(bulk): add excel export functionality
fix(api): handle missing student sizes correctly
docs(readme): update setup instructions
chore(deps): update dependencies
```

### Pull Request Process

1. **Create feature branch** from `main`
2. **Make changes** following code standards
3. **Run quality checks**:
   ```bash
   npm run type-check
   npm run lint:fix
   npm run format
   npm run build
   ```
4. **Commit changes** with conventional commit messages
5. **Push branch** and create PR
6. **Fill PR template** (description, screenshots if UI)
7. **Wait for review** and address feedback
8. **Merge** after approval

## Project Structure Guidelines

### Where to Add New Code

**New UI Component**:
```
src/components/YourComponent.tsx
```

**New API Route**:
```
src/app/api/your-feature/route.ts
```

**New Page**:
```
src/app/your-page/page.tsx
```

**New Utility Function**:
```
src/lib/your-category/yourUtil.ts
```

**New Type Definition**:
```
src/types/yourTypes.ts  (or add to database.ts if DB-related)
```

**Database Migration**:
```
supabase/migrations/00X_description.sql
```

### Component Organization

```typescript
// 1. Imports
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { Student } from '@/types/database';

// 2. Types/Interfaces
interface YourComponentProps {
  data: Student[];
  onSelect: (id: string) => void;
}

// 3. Component
export function YourComponent({ data, onSelect }: YourComponentProps) {
  // 3a. State
  const [selected, setSelected] = useState<string | null>(null);

  // 3b. Effects
  useEffect(() => {
    // ...
  }, []);

  // 3c. Handlers
  const handleClick = (id: string) => {
    setSelected(id);
    onSelect(id);
  };

  // 3d. Render
  return (
    <div>
      {/* JSX */}
    </div>
  );
}
```

## Testing Guidelines

### Manual Testing Checklist

Before submitting PR:

- [ ] Feature works in dev mode (`npm run dev`)
- [ ] Feature works in production build (`npm run build && npm start`)
- [ ] No console errors
- [ ] Responsive (mobile, tablet, desktop)
- [ ] Loading states handled
- [ ] Error states handled
- [ ] Empty states handled

### Future: Automated Tests

When implementing tests:
- Unit tests: Vitest
- Component tests: React Testing Library
- E2E tests: Playwright or Cypress

## Documentation

### When to Document

Always document:
- New features (update README.md)
- API changes (update ARCHITECTURE.md)
- Setup changes (update SETUP.md)
- Complex algorithms (inline comments)

### Code Comments

```typescript
// Good: Explain WHY, not WHAT
// Skip validation for admin users to allow bulk imports
if (user.role === 'admin') {
  // ...
}

// Bad: States the obvious
// Check if user is admin
if (user.role === 'admin') {
  // ...
}
```

### JSDoc for Complex Functions

```typescript
/**
 * Generates a PDF report for a specific school and grade.
 * Uses streaming to handle large datasets without memory issues.
 *
 * @param options - Configuration for PDF generation
 * @param options.schoolName - Name of the school
 * @param options.grade - Grade level (e.g., "1st", "2nd")
 * @param options.students - Array of student data
 * @returns Readable stream of PDF data
 */
export function generateStudentReportPDF(options: PDFGeneratorOptions): Readable {
  // ...
}
```

## Common Tasks

### Adding a New API Endpoint

1. Create route file: `src/app/api/your-endpoint/route.ts`
2. Implement handler:
   ```typescript
   import { NextRequest, NextResponse } from 'next/server';
   import { supabaseServer } from '@/lib/supabase/server';

   export async function GET(request: NextRequest) {
     try {
       // Your logic here
       return NextResponse.json({ data });
     } catch (error) {
       console.error('Error:', error);
       return NextResponse.json(
         { error: 'Internal server error' },
         { status: 500 }
       );
     }
   }
   ```
3. Add types to `src/types/database.ts` if needed
4. Test locally

### Adding a New Database Table

1. Create migration: `supabase/migrations/00X_add_your_table.sql`
2. Add table creation SQL
3. Add indexes
4. Add RPC functions if needed
5. Add types to `src/types/database.ts`
6. Update `scripts/verify-setup.sql`
7. Document in ARCHITECTURE.md

### Adding a New UI Component

1. Create component file
2. Implement with TypeScript
3. Export from component
4. Use in your page
5. Style with Tailwind CSS
6. Test responsiveness

## Getting Help

- Check existing documentation (README, SETUP, ARCHITECTURE)
- Search closed issues/PRs for similar problems
- Ask in discussions (if enabled)
- Create an issue with:
  - Clear description
  - Steps to reproduce
  - Expected vs actual behavior
  - Environment (OS, Node version, etc.)

## Code Review Guidelines

### As Author

- Self-review before requesting review
- Keep PRs focused and reasonably sized
- Respond to feedback promptly
- Be open to suggestions

### As Reviewer

- Be constructive and kind
- Focus on logic, not personal preferences
- Approve if no blocking issues
- Don't nitpick formatting (automated)

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md (if exists)
3. Create release notes
4. Tag release: `git tag v1.0.0`
5. Push tag: `git push origin v1.0.0`
6. Deploy to production

---

**Thank you for contributing!** 🎉
