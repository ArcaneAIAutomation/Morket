# Requirements Document

## Introduction

This module establishes the core backend foundation for a modern GTM (Go-To-Market) data engine. It provides the API gateway, user authentication with JWT, workspace management, role-based access control, encrypted API credential storage, a consumption-based credit/billing system, and the transactional database layer. All future modules (enrichment orchestration, scraping microservices, spreadsheet UI) depend on this foundation.

## Glossary

- **API_Gateway**: The Express.js server that receives HTTP requests, applies middleware (auth, validation, rate limiting, logging), and routes them to controllers.
- **User**: A registered individual identified by UUID, email, and bcrypt-hashed password.
- **Workspace**: A multi-tenant organizational unit grouping Users, API Credentials, Credit Balances, and Billing data. Identified by UUID and unique slug.
- **Workspace_Membership**: The association between a User and a Workspace, including a role (owner, admin, member, viewer) and invitation/acceptance timestamps.
- **RBAC_Middleware**: Middleware that enforces Role-Based Access Control by checking a User's role within a Workspace against the minimum required role for an endpoint.
- **Authentication_Service**: The service responsible for user registration, login, JWT issuance, refresh token rotation, and logout.
- **Credential_Service**: The service responsible for encrypting, storing, listing, and deleting third-party API credentials using AES-256-GCM.
- **Credit_Service**: The service responsible for managing workspace credit balances, recording credit transactions, and enforcing auto-recharge logic.
- **Billing_Record**: A record associating a Workspace with its plan type, credit balance, credit limit, billing cycle dates, and auto-recharge configuration.
- **Credit_Transaction**: An immutable ledger entry recording a credit change (purchase, usage, refund, bonus) against a Workspace.
- **Access_Token**: A short-lived JWT (15-minute expiry) used to authorize API requests.
- **Refresh_Token**: A long-lived token (7-day expiry) used to obtain new Access_Tokens without re-authentication.
- **JSON_Envelope**: The standard API response format: `{ success: boolean, data: T | null, error: { code: string, message: string } | null, meta?: { page, limit, total } }`.
- **Encryption_Key**: A per-workspace AES-256-GCM key used to encrypt and decrypt stored API credentials.

## Requirements

### Requirement 1: PostgreSQL Database Schema

**User Story:** As a developer, I want a well-structured PostgreSQL database schema with proper constraints and indexes, so that the application has a reliable and performant data layer.

#### Acceptance Criteria

1. THE Database_Schema SHALL define a Users table with UUID primary key, email (unique), password_hash (bcrypt), name, avatar_url, created_at, and updated_at columns
2. THE Database_Schema SHALL define a Workspaces table with UUID primary key, name, slug (unique), owner_id (foreign key to Users), plan_type (enum: free, pro, enterprise), created_at, and updated_at columns
3. THE Database_Schema SHALL define a Workspace_Memberships table with user_id and workspace_id as a composite unique constraint, role (enum: owner, admin, member, viewer), invited_at, and accepted_at columns
4. THE Database_Schema SHALL define an API_Credentials table with UUID primary key, workspace_id (foreign key), provider_name, encrypted_key, encrypted_secret, iv, auth_tag, created_by (foreign key to Users), created_at, and last_used_at columns
5. THE Database_Schema SHALL define a Billing_Records table with workspace_id (foreign key) as primary key, plan_type, credit_balance (integer), credit_limit, billing_cycle_start, billing_cycle_end, auto_recharge (boolean), auto_recharge_threshold, and auto_recharge_amount columns
6. THE Database_Schema SHALL define a Credit_Transactions table with UUID primary key, workspace_id (foreign key), amount (integer, positive for credit, negative for debit), transaction_type (enum: purchase, usage, refund, bonus), description, reference_id (nullable), and created_at columns
7. THE Database_Schema SHALL define indexes on all foreign key columns and on frequently queried columns including Users.email, Workspaces.slug, and Credit_Transactions(workspace_id, created_at)
8. THE Database_Schema SHALL use UUID primary keys generated via gen_random_uuid() for all tables
9. THE Database_Schema SHALL enforce referential integrity through foreign key constraints between all related tables

### Requirement 2: User Authentication

**User Story:** As a user, I want to register and log in securely with email and password, so that I can access my workspaces and data.

#### Acceptance Criteria

1. WHEN a user submits a valid email and password to POST /api/v1/auth/register, THE Authentication_Service SHALL create a new User record with the password hashed using bcrypt with 12 rounds
2. WHEN a user submits a registration request with an email that already exists, THE Authentication_Service SHALL return a 409 status code with an appropriate error in the JSON_Envelope
3. WHEN a user submits valid credentials to POST /api/v1/auth/login, THE Authentication_Service SHALL return an Access_Token with 15-minute expiry and a Refresh_Token with 7-day expiry in the JSON_Envelope
4. WHEN a user submits invalid credentials to POST /api/v1/auth/login, THE Authentication_Service SHALL return a 401 status code without revealing whether the email or password was incorrect
5. WHEN a valid Refresh_Token is submitted to POST /api/v1/auth/refresh, THE Authentication_Service SHALL issue a new Access_Token and a new Refresh_Token, invalidating the previous Refresh_Token
6. WHEN an expired or invalid Refresh_Token is submitted to POST /api/v1/auth/refresh, THE Authentication_Service SHALL return a 401 status code
7. WHEN a user submits a request to POST /api/v1/auth/logout, THE Authentication_Service SHALL invalidate the associated Refresh_Token
8. THE Authentication_Service SHALL enforce rate limiting on all auth endpoints at a maximum of 5 requests per minute per IP address
9. WHEN a client exceeds the auth rate limit, THE API_Gateway SHALL return a 429 status code in the JSON_Envelope

### Requirement 3: Role-Based Access Control

**User Story:** As a workspace owner, I want to assign roles to members with enforced permissions, so that I can control who can view, edit, or administer workspace resources.

#### Acceptance Criteria

1. THE RBAC_Middleware SHALL enforce a role hierarchy where owner has the highest privilege, followed by admin, member, and viewer
2. WHEN a request requires a minimum role, THE RBAC_Middleware SHALL permit access for users with that role or any higher role and deny access for users with a lower role
3. WHEN a user has no Workspace_Membership for the target Workspace, THE RBAC_Middleware SHALL deny access with a 403 status code
4. WHEN a role check is performed, THE RBAC_Middleware SHALL use the User's role within the specific Workspace context, not a global role
5. THE RBAC_Middleware SHALL allow only the owner role to delete a Workspace or manage billing
6. THE RBAC_Middleware SHALL allow admin and owner roles to manage members and API credentials
7. THE RBAC_Middleware SHALL allow member, admin, and owner roles to read and write data and use credits
8. THE RBAC_Middleware SHALL restrict the viewer role to read-only access

### Requirement 4: Workspace Management

**User Story:** As a user, I want to create and manage workspaces, so that I can organize my team's data enrichment activities in isolated environments.

#### Acceptance Criteria

1. WHEN a user sends POST /api/v1/workspaces with a valid name, THE Workspace_Service SHALL create the Workspace and assign the creating User as owner
2. WHEN a user sends GET /api/v1/workspaces, THE Workspace_Service SHALL return only Workspaces where the User has an active Workspace_Membership
3. WHEN a user sends GET /api/v1/workspaces/:id, THE Workspace_Service SHALL return the Workspace details if the User is a member
4. WHEN an admin or owner sends PUT /api/v1/workspaces/:id, THE Workspace_Service SHALL update the Workspace name or settings
5. WHEN an owner sends DELETE /api/v1/workspaces/:id, THE Workspace_Service SHALL delete the Workspace and all associated data
6. WHEN an admin or owner sends POST /api/v1/workspaces/:id/members with a user email and role, THE Workspace_Service SHALL add the User as a member with the specified role
7. WHEN an admin or owner sends DELETE /api/v1/workspaces/:id/members/:userId, THE Workspace_Service SHALL remove the member from the Workspace
8. WHEN an admin or owner sends PUT /api/v1/workspaces/:id/members/:userId/role, THE Workspace_Service SHALL update the member's role
9. THE Workspace_Service SHALL prevent removal or role downgrade of the last owner of a Workspace

### Requirement 5: API Credential Management

**User Story:** As a workspace admin, I want to securely store and manage third-party API keys, so that enrichment actions can authenticate with external data providers.

#### Acceptance Criteria

1. WHEN an admin or owner sends POST /api/v1/workspaces/:id/credentials with a provider name and key/secret, THE Credential_Service SHALL encrypt the values using AES-256-GCM and store them in the database
2. WHEN a user sends GET /api/v1/workspaces/:id/credentials, THE Credential_Service SHALL return a list of credentials with keys masked (showing only the last 4 characters)
3. WHEN an admin or owner sends DELETE /api/v1/workspaces/:id/credentials/:credId, THE Credential_Service SHALL permanently remove the encrypted credential record
4. THE Credential_Service SHALL store each credential with a unique initialization vector (IV) and authentication tag for AES-256-GCM
5. THE Credential_Service SHALL use a per-workspace Encryption_Key derived from a master key and the workspace ID
6. THE Credential_Service SHALL prevent retrieval of raw credential values through any user-facing API endpoint

### Requirement 6: Credit and Billing System

**User Story:** As a workspace owner, I want a consumption-based credit system with billing management, so that my team's usage is tracked and billed accurately.

#### Acceptance Criteria

1. WHEN a user sends GET /api/v1/workspaces/:id/billing, THE Credit_Service SHALL return the current credit balance, plan type, and billing cycle information in the JSON_Envelope
2. WHEN an owner sends POST /api/v1/workspaces/:id/billing/credits with an amount, THE Credit_Service SHALL increase the credit balance and record a Credit_Transaction with type "purchase"
3. WHEN a user sends GET /api/v1/workspaces/:id/billing/transactions, THE Credit_Service SHALL return Credit_Transactions in reverse chronological order with pagination support
4. WHEN an internal service calls the debit function with a workspace ID and amount, THE Credit_Service SHALL decrease the credit balance and record a Credit_Transaction with type "usage"
5. IF a debit operation would cause the credit balance to go below zero, THEN THE Credit_Service SHALL reject the operation and return an insufficient credits error
6. WHEN the credit balance drops below the auto_recharge_threshold and auto_recharge is enabled, THE Credit_Service SHALL automatically add credits equal to auto_recharge_amount and record a Credit_Transaction with type "purchase"
7. THE Credit_Service SHALL execute all credit operations (balance update and transaction insert) within a single PostgreSQL transaction using SELECT FOR UPDATE to prevent concurrent modification
8. THE Credit_Service SHALL maintain an immutable Credit_Transaction ledger where entries are append-only and existing entries are never modified or deleted

### Requirement 7: API Response Format and Infrastructure

**User Story:** As a developer integrating with the API, I want consistent response formats and robust infrastructure, so that I can build reliable integrations.

#### Acceptance Criteria

1. THE API_Gateway SHALL return all responses in the JSON_Envelope format: `{ success: boolean, data: T | null, error: { code: string, message: string } | null, meta?: { page, limit, total } }`
2. THE API_Gateway SHALL include a unique request ID header (X-Request-Id) in every response for tracing
3. THE API_Gateway SHALL use proper HTTP status codes: 200 for success, 201 for creation, 400 for validation errors, 401 for authentication failures, 403 for authorization failures, 404 for not found, 409 for conflicts, 429 for rate limiting, and 500 for server errors
4. THE API_Gateway SHALL provide a health check endpoint at GET /api/v1/health that returns the service status
5. THE API_Gateway SHALL apply CORS configuration and Helmet security headers to all responses
6. THE API_Gateway SHALL use connection pooling via pg-pool for all database connections
7. THE API_Gateway SHALL load all configuration from environment variables validated by a Zod schema at startup
8. IF a required environment variable is missing or invalid at startup, THEN THE API_Gateway SHALL terminate with a descriptive error message
9. THE API_Gateway SHALL produce structured JSON logs for each request including method, path, status code, and response time
