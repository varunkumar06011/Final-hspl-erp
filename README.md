# Hospital ERP System

A comprehensive Enterprise Resource Planning (ERP) system designed specifically for hospital construction projects. This system manages all aspects of construction operations including procurement, finance, inventory, site operations, approvals, and progress tracking.

## 🏗️ Project Overview

This ERP system is built for hospital construction projects to streamline and automate:

- **Procurement**: Quotation management, purchase orders, and vendor management
- **Finance**: Invoice processing, payment requests with multi-level approvals, and payment tracking
- **Inventory**: Stock management, inward/outward transactions, and stock level tracking
- **Site Operations**: Gate passes, site photos, issue tracking, and inspections
- **Construction Progress**: Phase and activity management with progress tracking
- **Labor Management**: Labour attendance tracking with headcount and cost monitoring
- **Contract Management**: Contract creation with milestone tracking
- **Governance**: Audit trails, document management, and role-based access control

## 📋 Features

### Multi-Project Support
- Manage multiple hospital construction projects simultaneously
- Data isolation between projects
- Cross-project reporting capabilities

### Role-Based Access Control (RBAC)
- **PROJECT_HEAD**: Full access to project operations
- **HEAD_OF_CONSTRUCTION**: Construction phase and activity management
- **ADMIN**: General administrative access
- **ADMIN_2**: Secondary administrative access

### Approval Workflow Engine
- Generic, reusable approval system
- Configurable multi-step approval workflows
- Automatic route based on entity type and amount thresholds

### Real-time Collaboration
- WebSocket-based real-time updates
- Live notifications for status changes
- Simultaneous access support

### Comprehensive Audit Trail
- All user actions logged
- Change tracking with before/after values
- Project-based audit search

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Firebase Authentication
- **Storage**: Local file system or Supabase Storage
- **Real-time**: Socket.io
- **Validation**: Zod
- **Security**: Helmet.js, rate limiting

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: React Router DOM
- **UI Library**: Material-UI (MUI)
- **State Management**: Zustand, React Query
- **Real-time**: Socket.io Client
- **Build Tool**: Vite

## 📁 Project Structure

```
FINAL HOSPITAL ERP/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Prisma schema and models
│   │   ├── migrations/            # Database migrations
│   │   └── seed.ts                # Development data seeding
│   ├── src/
│   │   ├── config/                # Configuration files
│   │   │   ├── env.ts
│   │   │   ├── firebase.ts
│   │   │   └── prisma.ts
│   │   ├── controllers/           # Route controllers
│   │   ├── middleware/            # Express middleware (auth, error, rbac, validate)
│   │   ├── routes/                # API route definitions
│   │   ├── services/              # Business logic services
│   │   ├── utils/                 # Utility functions
│   │   ├── index.ts               # Main entry point
│   │   └── socket.ts              # WebSocket setup
│   ├── tests/                     # Test files
│   ├── .env                       # Environment variables
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/            # Reusable UI components
│   │   ├── config/                # Frontend configuration
│   │   │   ├── api.ts
│   │   │   ├── firebase.ts
│   │   │   └── theme.ts
│   │   ├── pages/                 # Page components
│   │   ├── stores/                # Zustand state stores
│   │   ├── utils/                 # Utility functions
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── tsconfig.json
└── shared/                        # Shared code (enums, types)
```

## 🚀 Getting Started

### Prerequisites

- Node.js v20+ and npm
- PostgreSQL v14+
- Firebase project (for authentication)
- Python 3.6+ and `uv` (for MCP servers, optional)

### Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd "FINAL HOSPITAL ERP"
```

2. **Backend Setup**

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Update .env with your configuration
# - Set DATABASE_URL for PostgreSQL
# - Configure Firebase credentials
# - Adjust other settings as needed

# Run database migrations
npx prisma migrate dev

# Seed development data (optional)
npx prisma db seed

# Start development server
npm run dev
```

Backend runs on `http://localhost:4000`

3. **Frontend Setup**

```bash
cd ../frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Update .env.local with your configuration
# - Set VITE_API_URL to your backend URL
# - Configure Firebase credentials

# Start development server
npm run dev
```

Frontend runs on `http://localhost:5173`

### Default Login Credentials

After seeding the database, use these credentials:

| Role | Name | Phone Number |
|------|------|--------------|
| PROJECT_HEAD | Admin One | +91 9000000001 |
| HEAD_OF_CONSTRUCTION | Admin Two | +91 9000000002 |
| ADMIN | Admin Three | +91 9000000003 |
| ADMIN_2 | Admin Four | +91 9000000004 |

**Note**: The system uses Firebase Authentication with phone OTP. For development, you can use any phone number and check the browser console for the OTP.

## 📖 API Documentation

Once the backend is running, visit:

- Swagger/OpenAPI (if configured): `http://localhost:4000/api-docs`
- Health check: `http://localhost:4000/health`

## 🗄️ Database Schema

Key models include:

- **Users & Projects**: Authentication and project management
- **Vendors**: Vendor management with GST/pan details
- **Quotations**: Quotation creation and management
- **Purchase Orders**: PO generation from quotations
- **Vendor Invoices**: Invoice processing and verification
- **Payment Requests**: Payment processing with approval workflows
- **Gate Passes**: Inward/outward gate pass management
- **Inventory**: Stock management with transactions
- **Phases & Activities**: Construction progress tracking
- **Site Photos**: Visual documentation of site progress
- **Issues**: Issue tracking and resolution
- **Inspections**: Quality inspection management
- **Contracts**: Contract management with milestones
- **Labour Attendance**: Labour tracking and cost monitoring
- **Audit Logs**: Comprehensive audit trail

See `backend/prisma/schema.prisma` for complete schema details.

## 🔐 Security Features

- Firebase Authentication for secure login
- Role-based access control (RBAC)
- Rate limiting on API endpoints
- Helmet.js for HTTP security headers
- SQL injection protection via Prisma
- Cross-project data isolation
- Audit trail for all sensitive operations

## 🧪 Testing

```bash
# Run backend tests
cd backend
npm test

# Run type checks
npm run typecheck
```

## 📝 Environment Variables

### Backend (.env)

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://user:pass@localhost:5432/hospital_erp
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-supabase-key
FRONTEND_URL=http://localhost:5173
STORAGE_MODE=local  # or supabase
LOCAL_STORAGE_PATH=./uploads
```

### Frontend (.env.local)

```env
VITE_API_URL=http://localhost:4000
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
```

## 🔄 Development Workflow

1. Make changes to the code
2. Backend automatically restarts (tsx watch)
3. Frontend hot-reloads automatically
4. Check browser console and backend logs for errors
5. Run tests before committing

## 📚 Additional Resources

- [Express.js Documentation](https://expressjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Material-UI Documentation](https://mui.com/)
- [Firebase Documentation](https://firebase.google.com/docs)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and type checks
4. Commit with clear messages
5. Push and create a pull request

## 📄 License

This project is proprietary and confidential.