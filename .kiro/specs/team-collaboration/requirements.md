# Requirements — Module 8.6: Team & Collaboration

## Overview
Extends workspace roles, adds activity feed, audit log, and workspace invitations.

## Functional Requirements

### 8.6.1 Extended Roles
- Add viewer (read-only) and billing_admin (manage subscription only) roles
- Viewer can read all data but cannot create, update, or delete
- Billing admin can access billing endpoints but not data operations

### 8.6.2 Activity Feed
- Real-time log of team actions within a workspace
- Actions: enrichment_started, enrichment_completed, import, export, integration_connected, workflow_executed, member_joined, settings_changed
- Paginated list endpoint

### 8.6.3 Audit Log
- Detailed, immutable log of all workspace operations
- Includes: actor (user ID), action, resource type, resource ID, metadata, IP address, timestamp
- Filterable by action, actor, date range
- Exportable as CSV

### 8.6.4 Workspace Invitations
- Invite users by email with a specific role
- Invitation tokens expire after 7 days
- Accept/decline invitation endpoints
- List pending invitations per workspace

## Non-Functional Requirements
- All endpoints workspace-scoped under /api/v1/workspaces/:id/team/
- Zod validation on all inputs
- RBAC: member+ for activity/audit read, owner for invitations and role management
