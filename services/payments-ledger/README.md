# BORJIE Payments & Ledger Service

Core financial services for the BORJIE property management platform.

## Overview

This service provides:

- **Payment Orchestration**: Pluggable payment provider abstraction supporting multiple providers (Stripe, M-PESA, etc.)
- **Immutable Ledger**: Double-entry bookkeeping with strict tenant isolation
- **Reconciliation**: Bank and provider reconciliation capabilities
- **Statement Generation**: Automated financial statements for owners and customers
- **Disbursement**: Automated owner payouts with scheduling

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Gateway                              │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                    Payments & Ledger Service                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  Payment    │ │   Ledger    │ │ Reconcile   │ │ Statement │ │
│  │ Orchestrate │ │   Service   │ │   Service   │ │  Service  │ │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────┬─────┘ │
│         │               │               │              │        │
│  ┌──────▼──────────────▼───────────────▼──────────────▼─────┐  │
│  │                   Event Publisher (Outbox)                │  │
│  └───────────────────────────┬──────────────────────────────┘  │
│                              │                                  │
│  ┌─────────────┐ ┌──────────▼────────┐ ┌──────────────────┐   │
│  │  Providers  │ │   Repositories    │ │  Background Jobs │   │
│  │ ┌─────────┐ │ │ ┌──────────────┐  │ │ ┌──────────────┐ │   │
│  │ │ Stripe  │ │ │ │ PaymentIntent│  │ │ │ Reconcile    │ │   │
│  │ ├─────────┤ │ │ ├──────────────┤  │ │ ├──────────────┤ │   │
│  │ │ M-PESA  │ │ │ │   Ledger     │  │ │ │ Statements   │ │   │
│  │ └─────────┘ │ │ ├──────────────┤  │ │ ├──────────────┤ │   │
│  └─────────────┘ │ │   Account    │  │ │ │ Disbursement │ │   │
│                  │ ├──────────────┤  │ │ └──────────────┘ │   │
│                  │ │  Statement   │  │ └──────────────────┘   │
│                  │ └──────────────┘  │                         │
│                  └───────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

### Payment Orchestration

- **Pluggable Providers**: Easy integration with multiple payment providers
- **Stripe Connect**: Support for platform/marketplace model with splits and fees
- **M-PESA Integration**: STK Push and B2C payments for East African markets
- **Idempotency**: Built-in idempotency for safe retries
- **Refunds**: Full and partial refund support

### Immutable Ledger

- **Double-Entry**: Every transaction creates balanced debit/credit entries
- **Immutability**: Entries cannot be modified or deleted after creation
- **Sequence Tracking**: Gap detection for integrity verification
- **Running Balances**: Each entry records the balance after posting

### Account Types

| Type | Purpose |
|------|---------|
| `CUSTOMER_LIABILITY` | What customers owe (receivables) |
| `CUSTOMER_DEPOSIT` | Security deposits held |
| `OWNER_OPERATING` | Owner's operating account |
| `OWNER_RESERVE` | Owner's reserve fund |
| `PLATFORM_REVENUE` | Platform fees earned |
| `PLATFORM_HOLDING` | Funds held before disbursement |
| `TRUST_ACCOUNT` | Trust/escrow account |

### Ledger Entry Types

| Type | Description |
|------|-------------|
| `RENT_CHARGE` | Monthly rent charge |
| `RENT_PAYMENT` | Rent payment received |
| `DEPOSIT_CHARGE` | Security deposit charge |
| `DEPOSIT_PAYMENT` | Security deposit payment |
| `DEPOSIT_REFUND` | Security deposit refund |
| `LATE_FEE` | Late payment fee |
| `OWNER_CONTRIBUTION` | Owner investment |
| `OWNER_DISBURSEMENT` | Payout to owner |
| `PLATFORM_FEE` | Platform service fee |

### Statement Generation

- **Owner Statements**: Monthly/quarterly financial summaries
- **Customer Statements**: Account activity and balances
- **Automated Generation**: Scheduled statement creation
- **PDF/HTML/CSV**: Multiple output formats

### Reconciliation

- **Provider Sync**: Reconcile payment status with providers
- **Bank Reconciliation**: Match payments with bank transactions
- **Ledger Verification**: Verify balance integrity
- **Exception Handling**: Flag and track discrepancies

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (production)
- Redis 6+ (for job queues)

### Installation

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/borjie

# Redis (for job queues)
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# M-PESA
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORT_CODE=...
MPESA_PASS_KEY=...
MPESA_ENVIRONMENT=sandbox
MPESA_CALLBACK_URL=https://...

# Service
PORT=3001
LOG_LEVEL=info
NODE_ENV=development
```

## API Endpoints

### Payments

```
POST   /api/v1/payments              Create payment intent
GET    /api/v1/payments/:id          Get payment details
POST   /api/v1/payments/:id/confirm  Confirm payment
POST   /api/v1/payments/:id/refund   Refund payment
```

### Ledger

```
GET    /api/v1/accounts/:id/entries  Get ledger entries
GET    /api/v1/accounts/:id/balance  Get account balance
POST   /api/v1/journal               Post journal entry
```

### Statements

```
GET    /api/v1/statements            List statements
GET    /api/v1/statements/:id        Get statement details
POST   /api/v1/statements/generate   Generate statement
```

### Disbursements

```
POST   /api/v1/disbursements         Create disbursement
GET    /api/v1/disbursements/:id     Get disbursement status
```

### Webhooks

```
POST   /webhooks/stripe              Stripe webhook handler
POST   /webhooks/mpesa/stk           M-PESA STK callback
POST   /webhooks/mpesa/b2c/result    M-PESA B2C result
```

## Domain Events

The service publishes domain events for integration:

| Event | Description |
|-------|-------------|
| `PAYMENT_INTENT_CREATED` | New payment initiated |
| `PAYMENT_SUCCEEDED` | Payment completed |
| `PAYMENT_FAILED` | Payment failed |
| `PAYMENT_REFUNDED` | Refund processed |
| `LEDGER_ENTRIES_CREATED` | Journal posted |
| `ACCOUNT_BALANCE_UPDATED` | Balance changed |
| `STATEMENT_GENERATED` | Statement created |
| `DISBURSEMENT_COMPLETED` | Payout completed |
| `RECONCILIATION_EXCEPTION` | Discrepancy found |

## Background Jobs

### Reconciliation Job

- Runs every 15 minutes
- Syncs payment statuses with providers
- Flags stuck or expired payments

### Statement Generation Job

- Runs on 1st of each month
- Generates owner and customer statements
- Sends notifications

### Disbursement Job

- Configurable schedule (daily/weekly/monthly)
- Processes payouts to eligible owners
- Respects minimum balance thresholds

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- ledger.service.test.ts
```

## Security Considerations

- **Tenant Isolation**: All queries scoped by tenant ID
- **Audit Trail**: Immutable ledger entries with timestamps
- **Idempotency**: Safe payment retries
- **Webhook Verification**: Signature validation for all webhooks
- **Data Encryption**: Sensitive data encrypted at rest

## License

Proprietary - BORJIE
