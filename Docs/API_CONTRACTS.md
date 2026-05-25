# BORJIE API Contracts

## Overview

This document defines the API contracts for the BORJIE platform. All APIs follow REST conventions and use JSON for request/response bodies.

## Base URL

```
Production: https://api.borjie.com/v1
Staging:    https://api.staging.borjie.com/v1
Local:      http://localhost:4000/api/v1
```

## Authentication

All endpoints (except public ones) require a Bearer token:

```
Authorization: Bearer <jwt_token>
```

## Common Headers

| Header | Required | Description |
|--------|----------|-------------|
| Authorization | Yes* | JWT Bearer token |
| Content-Type | Yes | application/json |
| X-Request-ID | No | Client-generated request ID for tracing |
| X-Tenant-ID | No | Tenant context (usually from token) |

## Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error message",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "requestId": "req_abc123"
  }
}
```

## Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Request validation failed |
| UNAUTHORIZED | 401 | Missing or invalid authentication |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource conflict (e.g., duplicate) |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

## Pagination

List endpoints support pagination:

```
GET /properties?page=1&pageSize=20
```

Response includes pagination metadata:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 150,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## Authentication API

### POST /auth/login

Login with email and password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "mfaCode": "123456"
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 3600,
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "roles": ["property_manager"]
  }
}
```

### POST /auth/refresh

Refresh access token.

### POST /auth/logout

Invalidate current session.

---

## Tenants API

### GET /tenants/:id

Get tenant details (admin only).

### PUT /tenants/:id

Update tenant settings.

---

## Users API

### GET /users

List users in current tenant.

### POST /users

Create a new user.

**Request:**
```json
{
  "email": "newuser@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "roleIds": ["role_property_manager"]
}
```

### GET /users/:id

Get user by ID.

### PUT /users/:id

Update user.

### DELETE /users/:id

Deactivate user.

---

## Properties API

### GET /properties

List properties.

**Query Parameters:**
- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 20, max: 100)
- `status` - Filter by status
- `type` - Filter by property type
- `search` - Search by name/address

### POST /properties

Create a new property.

**Request:**
```json
{
  "name": "Sunrise Apartments",
  "type": "residential_apartment",
  "address": {
    "line1": "123 Main Street",
    "city": "Nairobi",
    "country": "KE"
  },
  "ownerId": "own_abc123"
}
```

### GET /properties/:id

Get property details.

### PUT /properties/:id

Update property.

### DELETE /properties/:id

Archive property.

---

## Units API

### GET /properties/:propertyId/units

List units for a property.

### POST /properties/:propertyId/units

Create a new unit.

### GET /units/:id

Get unit details.

### PUT /units/:id

Update unit.

---

## Leases API

### GET /leases

List leases.

### POST /leases

Create a new lease.

**Request:**
```json
{
  "unitId": "unit_abc123",
  "customerId": "cust_abc123",
  "type": "fixed_term",
  "term": {
    "startDate": "2024-01-01",
    "endDate": "2024-12-31"
  },
  "rentAmount": {
    "amount": 5000000,
    "currency": "KES"
  },
  "depositAmount": {
    "amount": 10000000,
    "currency": "KES"
  },
  "paymentDay": 5
}
```

### GET /leases/:id

Get lease details.

### POST /leases/:id/renew

Renew a lease.

### POST /leases/:id/terminate

Terminate a lease.

---

## Payments API

### GET /payments

List payment transactions.

### POST /payments

Create a payment intent.

### POST /payments/:id/process

Process a payment.

### GET /payments/:id

Get payment details.

---

## Invoices API

### GET /invoices

List invoices.

### POST /invoices

Create an invoice.

### GET /invoices/:id

Get invoice details.

### POST /invoices/:id/send

Send invoice to customer.

---

## Work Orders API

### GET /work-orders

List work orders.

### POST /work-orders

Create a work order.

**Request:**
```json
{
  "propertyId": "prop_abc123",
  "unitId": "unit_abc123",
  "category": "plumbing",
  "priority": "high",
  "title": "Leaking faucet",
  "description": "Kitchen faucet is leaking and needs repair"
}
```

### GET /work-orders/:id

Get work order details.

### PUT /work-orders/:id

Update work order.

### POST /work-orders/:id/assign

Assign work order to manager/vendor.

### POST /work-orders/:id/complete

Mark work order as complete.

---

## Disbursements API

### GET /disbursements

List disbursements for owner.

### POST /disbursements

Create disbursement request.

### POST /disbursements/:id/approve

Approve disbursement.

---

## Reports API

### GET /reports/portfolio-summary

Get portfolio performance summary.

### GET /reports/collections

Get rent collection report.

### GET /reports/maintenance

Get maintenance summary report.

### GET /reports/financial-statement

Generate financial statement.

---

## Webhooks

BORJIE can send webhooks for key events:

### Event Types

- `payment.completed`
- `payment.failed`
- `lease.created`
- `lease.renewed`
- `lease.terminated`
- `work_order.created`
- `work_order.completed`

### Webhook Payload

```json
{
  "id": "evt_abc123",
  "type": "payment.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "paymentId": "pay_abc123",
    "amount": 5000000,
    "currency": "KES"
  }
}
```
