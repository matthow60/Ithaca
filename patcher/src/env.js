// Load the shared .env at the repo root (the dashboard reads the same file).
// Import this first, before anything that reads process.env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
