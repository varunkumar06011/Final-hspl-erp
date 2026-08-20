// Test setup for REAL database E2E tests — loads real .env
import { config } from 'dotenv';
config({ path: '.env' });

process.env.NODE_ENV = 'development'; // Must be 'development' for dev-token auth
process.env.PORT = '4099';
process.env.STORAGE_MODE = 'local';
process.env.LOCAL_STORAGE_PATH = './test-uploads';
