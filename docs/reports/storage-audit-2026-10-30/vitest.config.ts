import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/reports/storage-audit-2026-10-30/reproduce.test.ts'],
  },
});
