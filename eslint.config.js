import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'release', '**/*.refactored.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'framer-motion',
              message:
                'Framer Motion is not used in this project. Use plain elements with Tailwind/CSS transitions.'
            },
            {
              name: 'motion',
              message:
                'The Motion package is not used in this project. Use plain elements with Tailwind/CSS transitions.'
            },
            {
              name: 'motion/react',
              message:
                'The Motion package is not used in this project. Use plain elements with Tailwind/CSS transitions.'
            }
          ],
          patterns: [
            {
              group: ['framer-motion/*', 'motion/*'],
              message:
                'Framer Motion / Motion is not used in this project. Use plain elements with Tailwind/CSS transitions.'
            }
          ]
        }
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }]
    }
  },
  {
    files: ['src/PageManager.tsx'],
    rules: {
      // File exports hooks + `PageManager` + helpers; Vite uses `// @refresh reset` instead of Fast Refresh.
      'react-refresh/only-export-components': 'off'
    }
  }
)
