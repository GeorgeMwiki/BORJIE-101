# BORJIE API Reference

## Overview

The BORJIE API is a RESTful API served by the API Gateway at `/api/v1`. All endpoints (except auth login and webhooks) require JWT authentication.

- **Base URL**: `http://localhost:4000/api/v1` (development)
- **Content-Type**: `application/json`
- **API Version**: 1.0.0

## Authentication

### JWT Bearer Token

Protected endpoints require the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "user-123",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "TENANT_ADMIN",
      "tenantId": "tenant-abc"
    },
    "tenant": {
      "id": "tenant-abc",
      "name": "Acme Properties",
      "slug": "acme-properties"
    },
    "permissions": ["properties:*", "units:*", "leases:*"],
    "expiresAt": "2026-02-20T10:00:00.000Z"
  }
}
```

### Refresh Token

```http
POST /api/v1/auth/refresh
Authorization: Bearer <access_token>
```

### Get Current User

```http
GET /api/v1/auth/me
Authorization: Bearer <access_token>
```

### Auth Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/login` | No | Login with email/password |
| POST | `/auth/logout` | No | Logout (client-side invalidation) |
| POST | `/auth/refresh` | Yes | Refresh access token |
| GET | `/auth/me` | Yes | Current user and tenant |
| POST | `/auth/register` | No | Self-registration |
| POST | `/auth/change-password` | Yes | Change password |
| POST | `/auth/forgot-password` | No | Request password reset |
| GET | `/auth/demo-users` | No | Demo logins (dev only) |

---

## Endpoints by Category

### Tenants

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/tenants` | SUPER_ADMIN | List tenants (paginated) |
| POST | `/tenants` | SUPER_ADMIN | Create tenant |
| GET | `/tenants/current` | Any | Get current tenant |
| PATCH | `/tenants/current` | TENANT_ADMIN | Update current tenant |
| GET | `/tenants/current/settings` | Any | Get tenant settings |
| PATCH | `/tenants/current/settings` | TENANT_ADMIN | Update tenant settings |
| GET | `/tenants/current/subscription` | Any | Get subscription info |
| GET | `/tenants/:id` | Own/Super | Get tenant by ID |
| PATCH | `/tenants/:id` | TENANT_ADMIN | Update tenant |
| DELETE | `/tenants/:id` | SUPER_ADMIN | Soft delete tenant |

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List users (tenant-scoped) |
| POST | `/users` | Create user |
| GET | `/users/:id` | Get user by ID |
| PATCH | `/users/:id` | Update user |
| DELETE | `/users/:id` | Delete user |

### Properties

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/properties` | List properties (paginated, filtered) |
| POST | `/properties` | Create property |
| GET | `/properties/:id` | Get property by ID |
| PUT | `/properties/:id` | Update property |
| DELETE | `/properties/:id` | Delete property |

### Units

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/units` | List units (paginated, filtered) |
| POST | `/units` | Create unit |
| GET | `/units/:id` | Get unit by ID |
| PUT | `/units/:id` | Update unit |
| DELETE | `/units/:id` | Delete unit |

### Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/customers` | List customers |
| GET | `/customers/:id` | Get customer by ID |
| POST | `/customers` | Create customer |
| PUT | `/customers/:id` | Update customer |
| DELETE | `/customers/:id` | Delete customer |

### Leases

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/leases` | List leases |
| GET | `/leases/:id` | Get lease by ID |
| POST | `/leases` | Create lease |
| PUT | `/leases/:id` | Update lease |
| DELETE | `/leases/:id` | Terminate lease |
| POST | `/leases/:id/renew` | Renew lease |
| POST | `/leases/:id/transfer` | Transfer lease |

### Invoices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoices` | List invoices |
| GET | `/invoices/:id` | Get invoice by ID |
| GET | `/invoices/:id/pdf` | Get invoice PDF |
| POST | `/invoices` | Create invoice |
| PUT | `/invoices/:id` | Update invoice |
| DELETE | `/invoices/:id` | Delete invoice |
| POST | `/invoices/:id/send` | Send invoice |

### Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/payments` | Yes | List payments |
| GET | `/payments/reconciliation` | Yes | Unreconciled payments |
| GET | `/payments/:id` | Yes | Get payment by ID |
| GET | `/payments/:id/receipt` | Yes | Get receipt |
| POST | `/payments` | Yes | Record manual payment |
| POST | `/payments/mpesa` | Yes | Initiate M-Pesa STK push |
| POST | `/payments/mpesa/callback` | No | M-Pesa webhook |
| POST | `/payments/:id/refund` | Yes | Process refund |

### Work Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/work-orders` | List work orders (paginated) |
| GET | `/work-orders/sla-breaches` | List SLA breaches |
| GET | `/work-orders/stats` | Work order statistics |
| POST | `/work-orders` | Create work order |
| GET | `/work-orders/:id` | Get work order |
| PUT | `/work-orders/:id` | Update work order |
| DELETE | `/work-orders/:id` | Cancel work order |
| POST | `/work-orders/:id/triage` | Triage work order |
| POST | `/work-orders/:id/assign` | Assign to vendor |
| POST | `/work-orders/:id/auto-assign` | Auto-assign vendor |
| POST | `/work-orders/:id/schedule` | Schedule work |
| POST | `/work-orders/:id/start` | Start work |
| POST | `/work-orders/:id/complete` | Complete work |
| POST | `/work-orders/:id/verify` | Verify completion |
| POST | `/work-orders/:id/escalate` | Escalate |
| POST | `/work-orders/:id/pause-sla` | Pause SLA |
| POST | `/work-orders/:id/resume-sla` | Resume SLA |

### Vendors

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vendors` | List vendors |
| POST | `/vendors` | Create vendor |
| GET | `/vendors/:id` | Get vendor |
| PATCH | `/vendors/:id` | Update vendor |
| DELETE | `/vendors/:id` | Delete vendor |

### Inspections

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/inspections` | List inspections |
| POST | `/inspections` | Create inspection |
| GET | `/inspections/:id` | Get inspection |
| PUT | `/inspections/:id` | Update inspection |

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/documents/:customerId` | List documents for customer |
| GET | `/documents/document/:id` | Get document |
| POST | `/documents/upload` | Upload document |
| POST | `/documents/verify` | Verify document |

### Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/messaging/conversations` | List conversations |
| POST | `/messaging/conversations` | Create conversation |
| GET | `/messaging/conversations/:id/messages` | Get messages |
| POST | `/messaging/conversations/:id/messages` | Send message |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications` | List notifications |
| PATCH | `/notifications/:id/read` | Mark as read |
| PATCH | `/notifications/read-all` | Mark all as read |

### Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/reports` | List available reports |
| GET | `/reports/:type` | Get report data |
| POST | `/reports/:type/export` | Export report |

### Onboarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/onboarding/procedures` | Get onboarding procedures |
| POST | `/onboarding/start` | Start onboarding session |
| POST | `/onboarding/checklist` | Submit checklist |
| POST | `/onboarding/move-in-report` | Submit move-in report |
| GET | `/onboarding/:sessionId` | Get session status |
| POST | `/onboarding/:sessionId/step` | Complete step |
| POST | `/onboarding/:sessionId/inspection` | Submit inspection |

### Feedback & Complaints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/feedback` | Submit feedback |
| GET | `/complaints` | List complaints |
| POST | `/complaints` | Create complaint |
| GET | `/complaints/:id` | Get complaint |

### Cases (Legal/Dispute)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cases` | List cases |
| GET | `/cases/stats` | Case statistics |
| POST | `/cases` | Create case |
| GET | `/cases/:id` | Get case |
| PUT | `/cases/:id` | Update case |
| POST | `/cases/:id/timeline` | Add timeline event |
| POST | `/cases/:id/notices` | Create notice |
| POST | `/cases/:id/evidence` | Add evidence |
| POST | `/cases/:id/escalate` | Escalate case |
| POST | `/cases/:id/resolve` | Resolve case |
| POST | `/cases/:id/close` | Close case |

### Scheduling

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/scheduling` | List scheduled items |
| POST | `/scheduling` | Create schedule |
| PUT | `/scheduling/:id` | Update schedule |

---

## Request/Response Examples

### Pagination

List endpoints support `page` and `pageSize` query params:

```http
GET /api/v1/properties?page=1&pageSize=20&status=active
```

**Response:**

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": { ... }
  }
}
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid Authorization header |
| `TOKEN_EXPIRED` | 401 | JWT has expired |
| `INVALID_TOKEN` | 401 | JWT signature invalid or malformed |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `NO_TENANT_ACCESS` | 401 | User has no tenant access |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate or state conflict |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `BAD_REQUEST` | 400 | Invalid request parameters |

---

## Health Check

```http
GET /health
```

**Response (200):**

```json
{
  "status": "ok",
  "service": "api-gateway",
  "timestamp": "2026-02-13T12:00:00.000Z"
}
```
