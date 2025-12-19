// Production config - uses same origin (Vercel serves both frontend and backend from same domain)
// Frontend and API are on the same domain via Vercel routing:
//   - /api/* → backend (website/backend/server.js)
//   - /*     → frontend (website/site/)
const API_BASE_URL = window.location.origin;
