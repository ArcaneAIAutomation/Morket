# Tasks — Module 8.6: Team & Collaboration

## 1. Database
- [x] Migration 022: activity_feed, audit_log, workspace_invitations tables with indexes

## 2. Schemas
- [x] Zod schemas for pagination, audit filters, invite body, invitation token

## 3. Repository
- [x] Activity feed (create, list paginated)
- [x] Audit log (create, list with filters, export)
- [x] Invitations (create, find by token, update status, list pending)

## 4. Service
- [x] Activity logging + listing
- [x] Audit logging + listing + CSV export
- [x] Invite user (duplicate check, 7-day token expiry)
- [x] Accept/decline invitation with validation
- [x] List pending invitations

## 5. Controller & Routes
- [x] Controller factory with all HTTP handlers
- [x] Workspace routes (activity, audit, invitations) with RBAC
- [x] Public routes (accept/decline invitation — token-based, no auth)

## 6. App Wiring
- [x] Mount team workspace routes + public invitation routes

## 7. Validation
- [x] Zero TypeScript diagnostics
