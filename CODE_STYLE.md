# Code Style Quick Reference

## Quick Commands

```bash
npm run lint          # Check for errors
npm run lint:fix      # Auto-fix errors
npm run format        # Format all code
npm run type-check    # TypeScript check
```

## Formatting Rules

### Quotes & Semicolons
```typescript
// ✅ Good
const name = 'John';
const greeting = `Hello, ${name}`;

// ❌ Bad
const name = "John";
const greeting = "Hello, " + name
```

### Line Length
```typescript
// ✅ Good (under 100 chars)
const shortFunction = (a: string, b: number) => {
  return doSomething(a, b);
};

// ❌ Bad (over 100 chars - will be wrapped by Prettier)
const longFunction = (parameterOne: string, parameterTwo: number, parameterThree: boolean) => doSomethingVeryLongHere(parameterOne, parameterTwo, parameterThree);
```

### Arrow Functions
```typescript
// ✅ Good (omit parens when single param)
const square = (n: number) => n * n;
const greet = name => `Hello, ${name}`;

// ❌ Bad (unnecessary parens)
const greet = (name) => `Hello, ${name}`;
```

### Trailing Commas
```typescript
// ✅ Good
const obj = {
  name: 'John',
  age: 30,
};

const arr = [
  'item1',
  'item2',
];

// ❌ Bad (missing trailing comma)
const obj = {
  name: 'John',
  age: 30
};
```

## TypeScript Best Practices

### Avoid `any`
```typescript
// ✅ Good
const fetchData = async (): Promise<Student[]> => {
  const response = await fetch('/api/students');
  return response.json();
};

// ❌ Bad
const fetchData = async (): Promise<any> => {
  const response = await fetch('/api/students');
  return response.json();
};
```

### Use Type Inference
```typescript
// ✅ Good (type inferred)
const numbers = [1, 2, 3];
const total = numbers.reduce((sum, n) => sum + n, 0);

// ❌ Bad (unnecessary explicit types)
const numbers: number[] = [1, 2, 3];
const total: number = numbers.reduce((sum: number, n: number): number => sum + n, 0);
```

### Interface vs Type
```typescript
// ✅ Good (use interface for objects)
interface Student {
  id: string;
  name: string;
}

// ✅ Good (use type for unions)
type Status = 'pending' | 'complete' | 'failed';

// ⚠️ Acceptable (but prefer interface)
type Student = {
  id: string;
  name: string;
};
```

### Unused Variables
```typescript
// ✅ Good (prefix with _ to mark as intentionally unused)
const handleClick = (_event: MouseEvent, index: number) => {
  console.log(index);
};

// ❌ Bad (unused var triggers warning)
const handleClick = (event: MouseEvent, index: number) => {
  console.log(index);
};
```

## React Best Practices

### Component Prop Types
```typescript
// ✅ Good
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function Button({ label, onClick, disabled = false }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

// ❌ Bad (no types)
export function Button({ label, onClick, disabled }) {
  // ...
}
```

### State Types
```typescript
// ✅ Good
const [user, setUser] = useState<User | null>(null);
const [count, setCount] = useState<number>(0);

// ❌ Bad (implicit any)
const [user, setUser] = useState(null);
```

### Event Handlers
```typescript
// ✅ Good
const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  // ...
};

const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  setValue(event.target.value);
};
```

## Tailwind CSS Guidelines

### Class Organization
```typescript
// ✅ Good (grouped logically, sorted by plugin)
<div className="flex items-center justify-between gap-4 rounded-lg border bg-white p-4 shadow-sm hover:shadow-md">

// ❌ Bad (random order)
<div className="shadow-sm p-4 flex bg-white border hover:shadow-md items-center rounded-lg gap-4 justify-between">
```

### Conditional Classes
```typescript
// ✅ Good
const buttonClass = `
  px-4 py-2 rounded-md
  ${isPrimary ? 'bg-primary text-white' : 'bg-secondary text-black'}
  ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}
`;

// ⚠️ Acceptable (for simple cases)
<button className={isPrimary ? 'btn-primary' : 'btn-secondary'}>
```

## Console Logs

```typescript
// ✅ Good (allowed)
console.error('Failed to fetch data:', error);
console.warn('Deprecated API usage');
console.info('Job processing started');

// ❌ Bad (triggers warning)
console.log('Debug message');

// ✅ Good (for debugging, remove before commit)
// eslint-disable-next-line no-console
console.log('Temporary debug info');
```

## Imports Organization

```typescript
// ✅ Good (grouped and ordered)
// 1. React/Next
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 2. External libraries
import { supabase } from '@supabase/supabase-js';

// 3. Internal components
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

// 4. Internal utilities
import { fetchStudents } from '@/lib/api';

// 5. Types
import type { Student } from '@/types/database';

// 6. Styles (if any)
import './styles.css';
```

## File Naming

```
✅ Components:     PascalCase          StudentGrid.tsx
✅ Pages:          lowercase           page.tsx, layout.tsx
✅ API Routes:     lowercase           route.ts
✅ Utilities:      camelCase           fetchData.ts
✅ Types:          camelCase           database.ts
✅ Constants:      camelCase           constants.ts
```

## Function Naming

```typescript
// ✅ Components
export function StudentGrid() { }
export const Button = () => { };

// ✅ Hooks
const useStudents = () => { };
const useFetchData = () => { };

// ✅ Utilities
const fetchStudents = async () => { };
const formatDate = (date: Date) => { };

// ✅ Handlers
const handleClick = () => { };
const handleSubmit = (e: FormEvent) => { };

// ✅ Predicates
const isValidEmail = (email: string) => boolean;
const hasPermission = (user: User) => boolean;
```

## Comments

```typescript
// ✅ Good (explain WHY)
// Use pagination to avoid loading 10k+ rows at once
const pageSize = 50;

// Retry with exponential backoff for transient failures
if (attempt < MAX_RETRIES) {
  await sleep(2 ** attempt * 1000);
}

// ❌ Bad (state the obvious)
// Set page size to 50
const pageSize = 50;

// Increment counter
counter++;
```

## ESLint Disable Comments

```typescript
// ✅ Good (specific rule, with reason)
// Edge case: admin users can bypass validation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = adminBypassValidation();

// ❌ Bad (disables all rules, no reason)
// eslint-disable-next-line
const data = doSomething();
```

## Auto-Format Shortcuts

### VS Code
- **Format Document**: `Shift + Alt + F` (Windows/Linux) or `Shift + Option + F` (Mac)
- **Format Selection**: `Cmd/Ctrl + K, Cmd/Ctrl + F`
- **Save + Format**: `Cmd/Ctrl + S` (if format on save enabled)

### Command Line
```bash
# Format all files
npm run format

# Format specific file
npx prettier --write src/app/page.tsx

# Check without changing
npm run format:check
```

---

**Remember**: Let the tools handle formatting. Focus on writing clean logic!
