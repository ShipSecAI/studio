# Services Directory

API service layer that abstracts all backend communication.

All API calls go through `api.ts` which:
- Centralizes backend URL configuration
- Validates responses using Zod schemas
- Provides typed responses
- Handles errors consistently

Never import axios directly in components - always use the service layer.