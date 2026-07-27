/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/. The runtime data loader
  // (src/game/loadQuestions.ts) reads import.meta.env.BASE_URL, so it honors this.
  // Override with BASE_PATH env for other hosts (e.g. BASE_PATH=/ for a root deploy).
  base: process.env.BASE_PATH ?? '/ball-knowledge/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
