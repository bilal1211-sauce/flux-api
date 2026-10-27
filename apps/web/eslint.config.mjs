import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
export default defineConfig(
  js.configs.recommended,
  ts.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], plugins: { 'react-hooks': hooks }, rules: hooks.configs.recommended.rules },
  globalIgnores(['.next/**', '.next-phase7-*/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'])
);
