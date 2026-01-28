# ESLint & Prettier Setup

This project uses ESLint and Prettier for code quality and formatting.

## What's Configured

### ESLint

- **Next.js rules**: `next/core-web-vitals`
- **TypeScript rules**: `@typescript-eslint/recommended`
- **Prettier integration**: `plugin:prettier/recommended`

### Prettier

- **Single quotes** for strings
- **Semicolons** always
- **100 character** line width
- **2 spaces** for indentation
- **Trailing commas** in ES5 (objects, arrays)
- **Tailwind CSS** class sorting plugin

## Available Scripts

```bash
# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix

# Check code formatting
npm run format:check

# Format all files
npm run format

# Type checking
npm run type-check
```

## VS Code Integration

### Recommended Extensions

The project includes `.vscode/extensions.json` with recommended extensions:

- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- Tailwind CSS IntelliSense (`bradlc.vscode-tailwindcss`)
- TypeScript (`ms-vscode.vscode-typescript-next`)

Install them via:

1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Type "Show Recommended Extensions"
3. Install all

### Auto-Format on Save

The `.vscode/settings.json` enables:

- Format on save with Prettier
- Auto-fix ESLint errors on save
- Consistent line endings (LF)
- Trim trailing whitespace

## Pre-commit Hook (Optional)

To automatically lint and format before commits, install husky and lint-staged:

```bash
npm install --save-dev husky lint-staged
npx husky init
```

Then add to `package.json`:

```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,css,md}": ["prettier --write"]
  }
}
```

And in `.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
```

## ESLint Rules

### Key Rules Configured

- **Prettier integration**: Code formatting enforced
- **Unused vars**: Warning (allow `_` prefix for intentionally unused)
- **Explicit any**: Warning (avoid `any` when possible)
- **Console logs**: Warning (except `console.error`, `console.warn`, `console.info`)

### Customizing Rules

Edit `.eslintrc.json` to adjust rules:

```json
{
  "rules": {
    "your-rule": "error" | "warn" | "off"
  }
}
```

## Prettier Options

### Current Configuration

```json
{
  "semi": true, // Semicolons required
  "trailingComma": "es5", // Trailing commas where valid in ES5
  "singleQuote": true, // Single quotes for strings
  "printWidth": 100, // Max line length
  "tabWidth": 2, // 2 spaces per tab
  "arrowParens": "avoid", // Omit parens when possible
  "endOfLine": "lf" // Unix line endings
}
```

### Override for Specific Files

Create `.prettierrc.js` for conditional formatting:

```javascript
module.exports = {
  ...require('./.prettierrc.json'),
  overrides: [
    {
      files: '*.md',
      options: {
        printWidth: 80,
      },
    },
  ],
};
```

## Ignoring Files

### ESLint Ignore

Configured in `.eslintrc.json` under `ignorePatterns`:

- `node_modules/`
- `.next/`
- `out/`, `build/`, `dist/`
- `*.config.js`

### Prettier Ignore

Listed in `.prettierignore`:

- Build outputs
- Dependencies
- Lock files
- SQL files (preserve original formatting)

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Lint & Format Check

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run type-check
```

### Vercel Integration

Linting runs automatically on Vercel builds. To fail builds on lint errors, ensure:

```json
// package.json
{
  "scripts": {
    "build": "next build"
  }
}
```

Next.js will fail the build if ESLint errors exist (warnings won't fail).

## Common Issues

### Prettier vs ESLint Conflicts

If rules conflict:

1. `eslint-config-prettier` is already installed (disables conflicting ESLint rules)
2. Prettier runs last in the config chain
3. Use `npm run format` to auto-fix

### Formatting Not Working in VS Code

1. Check Prettier extension is installed
2. Verify it's the default formatter: `Cmd/Ctrl + Shift + P` → "Format Document With..." → Prettier
3. Restart VS Code
4. Check `.vscode/settings.json` exists

### ESLint Errors in Editor But Not CLI

- Editor might use different ESLint version
- Reload VS Code window
- Check "ESLint" output panel for errors

### Line Ending Issues (CRLF vs LF)

Enforced as LF (Unix) via:

- `.prettierrc.json` → `"endOfLine": "lf"`
- `.editorconfig` → `end_of_line = lf`
- `.vscode/settings.json` → `"files.eol": "\n"`

On Windows, configure git:

```bash
git config --global core.autocrlf false
```

## Best Practices

### During Development

1. **Let auto-format handle styling**: Don't manually format
2. **Fix linting errors promptly**: Don't accumulate warnings
3. **Use `_` prefix** for intentionally unused variables
4. **Avoid `any` type**: Use proper types or `unknown`

### Before Committing

```bash
npm run lint:fix
npm run format
npm run type-check
```

Or set up pre-commit hooks (see above).

### Code Review

- Formatting is automatic, don't comment on it
- Focus on logic, architecture, naming
- ESLint warnings should be addressed

## Disabling Rules

### For a Line

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = fetchData();
```

### For a File

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
// ... file content
```

### For a Block

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const data: any = fetchData();
/* eslint-enable @typescript-eslint/no-explicit-any */
```

**Note**: Only disable when necessary and document why.

## Troubleshooting

### Clear ESLint Cache

```bash
rm -rf .next
rm -rf node_modules/.cache
npm run lint
```

### Reset VS Code ESLint

1. Open Command Palette
2. "ESLint: Reset Library Decisions"
3. Reload window

### Update Dependencies

```bash
npm update eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

## Resources

- [ESLint Documentation](https://eslint.org/docs/latest/)
- [Prettier Documentation](https://prettier.io/docs/en/index.html)
- [Next.js ESLint](https://nextjs.org/docs/basic-features/eslint)
- [TypeScript ESLint](https://typescript-eslint.io/)
