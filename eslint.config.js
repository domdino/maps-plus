import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/', '.wxt/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: {
      // Untrusted Google / user data must never reach innerHTML (see CLAUDE.md).
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Build DOM nodes or use textContent.' },
        { property: 'outerHTML', message: 'Build DOM nodes or use textContent.' },
        { property: 'insertAdjacentHTML', message: 'Build DOM nodes or use textContent.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
