import { defineConfig } from 'drizzle-kit';
import { readConfig } from './src/config.js';

export default defineConfig({ dialect: 'sqlite', schema: './src/db/schema.ts', out: './drizzle', dbCredentials: { url: readConfig().DATABASE_PATH } });
