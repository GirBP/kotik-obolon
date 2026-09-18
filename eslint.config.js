import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'scratchpad/**', 'data/**', 'icons/**', 'public/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        L: 'readonly', // Leaflet (CDN global)
        mqtt: 'readonly', // mqtt.js (CDN global)
      },
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      // caughtErrors лишено вимкненим: 340 порушень (переважно порожні catch(e){} —
      // те саме, що тримає no-empty послабленим нижче).
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 224 порожні блоки, переважно навмисні catch(e){}, що ковтають помилки мережі/DOM
      // (traces.js, speed.js). Приведення в порядок по одному — окрема робота, не тут.
      'no-constant-condition': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // null: 'ignore' — код навмисно використовує `== null`/`!= null` для перевірки
      // і null, і undefined одним порівнянням (live.js, sfx.js, speed.js, hud.js).
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  prettier,
];
