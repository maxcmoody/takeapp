# TAKE - Restaurant Ranking App

## Overview

TAKE is a mobile-first web application designed for users to rank restaurants and bars through head-to-head matchup tournaments. It employs a unique binary insertion sort algorithm with neighbor verification for dynamic ranking. The application features **separate ranking universes** for Restaurants vs Bars (venue buckets), with automatic classification via Google types + name heuristics and user override capability. Hybrid venues (e.g., gastropubs) can be ranked in both buckets independently. The application offers personal and group rankings, a global leaderboard, a search/map view, an infinite-scroll discovery feed, and shareable collages (e.g., Top 9). Scores are displayed as "TAKE scores" (0-100) with trophy icons. The project aims to provide an engaging way for users to discover and curate their favorite dining spots.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

- **Framework**: React 18 with TypeScript, Vite
- **Routing**: Wouter
- **State Management**: Zustand for UI preferences; main ranking data is server-authoritative and managed in memory, synced to the server.
- **Data Fetching**: TanStack React Query
- **UI Components**: shadcn/ui (Radix UI + Tailwind CSS v4)
- **Styling**: Tailwind CSS, custom fonts (DM Sans, Outfit)
- **Animations**: Framer Motion, react-confetti
- **Design**: Mobile-first, `max-w-md` constraint, bottom tab navigation, native app feel.

### Key Features and Pages
- **Home (`/`)**: Infinite-scroll discovery feed, dynamic leaderboard bars, progressive radius widening for restaurant discovery, mission progress display.
- **Add Restaurant (`/add`)**: Search via Google Places API or manual entry, batch selection, seed mode for new users.
- **Matchup (`/matchup`)**: Core head-to-head comparison for ranking.
- **My TAKE (`/my-list`)**: Personal ranked lists ("takes"), category-specific collages.
- **Leaderboard (`/leaderboard`)**: Global Top 100 with filters.
- **Groups (`/groups`)**: Collaborative ranking with friends.
- **Discover (`/discover`)**: Map-based exploration integrated with Google Places.
- **Restaurant Detail (`/restaurant/:id`)**: Comprehensive restaurant information, Google Maps integration.
- **Profile (`/profile`)**: User profile, Top 9 collage export, discovery preferences, Friends section with invite links.
- **Invite Redeem (`/invite/:code`)**: Invite link redemption, auto-follow inviter.
- **Compare (`/compare/:userId`)**: Taste overlap comparison with friend, region selector, Spearman correlation, Top30 disagreements.

### Backend

- **Runtime**: Node.js with Express 5, TypeScript
- **API Pattern**: RESTful JSON API
- **Development**: Vite dev server middleware
- **Production**: Static asset serving via Express.

### API Routes
- **Google Places Proxies**: Autocomplete, Details, Photo, Area Autocomplete, Nearby, Nearby by Category.
- **Restaurant Management**: Create restaurant.
- **Ranking Management**: Sync user rankings, start/active/vote/cancel ranking sessions, log pairwise matchups.
- **Leaderboard**: Aggregate leaderboard with Bayesian smoothing.
- **Weekly Recap**: GET /api/recap/weekly (lazy weekly snapshot, movers computation), POST /api/recap/weekly/dismiss.
- **Data Export**: GET /api/export returns full user data (rankings, groups, matchups, sessions).
- **Deletion Requests**: GET /api/account-deletion-request/mine returns user's latest request status. Admin can complete deletion (anonymize user) via POST /api/admin/deletion-requests/:id/complete.
- **User Info**: GET /api/me returns authenticated user profile and admin status.
- **Invites**: POST /api/invites (create invite code), POST /api/invites/redeem (validate + auto-follow inviter).
- **Follows**: GET /api/follows (following/followers lists), POST /api/follows/:userId, DELETE /api/follows/:userId.
- **Compare**: GET /api/compare/:userId/regions (shared regions), GET /api/compare/:userId?regionKey=... (Spearman correlation, agreements, disagreements, side-by-side Top10).

### Data Storage

- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**:
  - `users`: User authentication (includes `deletedAt` for soft-delete/anonymization).
  - `restaurants`: Restaurant details.
  - `user_rankings`: Individual user's ranked lists.
  - `ranking_sessions`: Durable server-side state for ongoing ranking sessions.
  - `pairwise_matchups`: Logs of every 1v1 comparison for analytics.
  - `place_details_cache`: L2 cache for Google Place Details.
  - `places_search_cache`: TTL cache for Google Places search results.
  - `follows`: One-way follow relationships between users.
  - `invite_links`: Shareable invite codes with usage tracking and expiration.
- **Schema Validation**: Zod.
- **Migrations**: `drizzle-kit push`.

### Places API Cost Optimization
- **DB Caching**: Postgres-backed TTL cache for search results and Place Details.
- **In-Memory Caching**: 24h PLACES_CACHE for details, 24h PHOTO_CACHE (max 500) for photo bytes, 60s autocomplete cache.
- **Stale-While-Revalidate**: Cached Place Details served immediately; background refresh triggered if >30 days old.
- **Request Deduplication**: In-flight promise maps for both Details and Photo requests prevent duplicate Google API calls.
- **Field Reduction**: Place Details requests use Essentials-tier fields only (no opening_hours, editorial_summary Pro-tier fields).
- **Rate Limiting**: In-memory rate limiting per user/IP.
- **Hard Caps**: Max 60 results per request, deduplication.
- **API Counters**: Per-session counters for nearby, details, photo, autocomplete, bgRefresh, newApiTypes. Admin endpoint at `/api/admin/api-counters`. Periodic console logging every 10 minutes.
- **Periodic Cache Cleanup**: Every 10 minutes, expired entries are evicted from in-memory caches.

### Authentication

- **Provider**: Replit Auth.
- **Session Management**: Express session with `connect-pg-simple` (PostgreSQL).
- **Client-side**: `useAuth()` and `use-auth-sync.ts` hooks for authentication state and data synchronization.
- **Security**: Protected pages and API routes require authentication. Rankings are tied to authenticated user IDs and are server-authoritative.

### Email Notifications
- **Provider**: Resend (Manual Integration via `RESEND_API_KEY` secret).
- **Triggers**: New restaurant reports and account deletion requests.
- **Admin Recipient**: Configured via `ADMIN_NOTIFY_EMAIL` (required) and `ADMIN_NOTIFY_EMAIL_CC` (optional).
- **Rate Limiting**: Simple in-memory rate limiting (max 5 emails/hour per user) implemented in `server/adminNotify.ts`.
- **Note**: The app uses a custom `server/adminNotify.ts` module instead of the native Replit Resend integration at the user's request.

## External Dependencies

- **PostgreSQL**: Primary database for all application data.
- **Google Places API (New)**: All calls use the new Places API v1 (`places.googleapis.com/v1/...`). Photo references use full resource names (`places/{placeId}/photos/{ref}`). Legacy API is NOT enabled. Photo URLs always include `placeId` param. DB photo cache is per-reference only (no placeId fallback to prevent duplicate thumbnails). `savePhotoToCache` only updates existing cache rows (never creates empty details entries). `refreshOldPhotoRefs` runs at startup to migrate old `AcnlKN...` photo refs to new `places/` format (10 per restart).
- **Sentry**: Error tracking and performance monitoring for both frontend and backend.
- **Replit Auth**: User authentication provider.