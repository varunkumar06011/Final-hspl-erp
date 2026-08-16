// Test setup — sets env vars before modules load
process.env.NODE_ENV = 'test';
process.env.PORT = '4099';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/hospital_erp_test?schema=public';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = 'test-key';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.STORAGE_MODE = 'local';
process.env.LOCAL_STORAGE_PATH = './test-uploads';
