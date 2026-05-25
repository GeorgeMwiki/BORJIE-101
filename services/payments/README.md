# BORJIE Payments Service

Mobile money integration for M-Pesa, Airtel Money, and Tigo Pesa.

## Structure

```
src/
├── common/           # Logger, retry, errors, types
├── providers/
│   ├── mpesa/       # M-Pesa (Kenya): STK push, callbacks, query, B2C
│   ├── airtel-money/ # Airtel Money (TZ, UG, KE)
│   └── tigopesa/    # Tigo Pesa (Tanzania)
├── reconciliation/  # Match payments with invoices
└── index.ts         # Unified PaymentService API
```

## Usage

```typescript
import { createPaymentService } from '@borjie/payments-service';

const service = createPaymentService({
  mpesa: {
    consumerKey: process.env.MPESA_CONSUMER_KEY!,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET!,
    shortCode: process.env.MPESA_SHORTCODE!,
    passKey: process.env.MPESA_PASSKEY!,
    environment: 'sandbox',
    callbackBaseUrl: process.env.API_URL!,
  },
  mpesaSecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL, // For B2C refunds
  mpesaCallbackSecret: process.env.MPESA_CALLBACK_SECRET,
});

// Initiate payment
const result = await service.initiatePayment({
  amount: { amountMinorUnits: 5000, currency: 'KES' },
  phone: '254712345678',
  reference: 'INV-001',
});

// Process webhook callback
const callback = service.processCallback('mpesa', payload, {
  rawBody: req.rawBody,
  signature: req.headers['x-signature'],
});

// Query status (M-Pesa only)
const status = await service.queryStatus('mpesa', checkoutRequestId);

// Refund (M-Pesa B2C)
const refund = await service.refund({
  paymentId: 'pay_xxx',
  amount: { amountMinorUnits: 5000, currency: 'KES' },
  phone: '254712345678',
  reason: 'Customer request',
});

// Reconcile
const { result, report } = service.reconcile({
  dateRange: { start: new Date(), end: new Date() },
  payments: [...],
  invoices: [...],
});
```

## Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| MPESA_CONSUMER_KEY | M-Pesa | Daraja API consumer key |
| MPESA_CONSUMER_SECRET | M-Pesa | Daraja API consumer secret |
| MPESA_SHORTCODE | M-Pesa | Paybill/Till number |
| MPESA_PASSKEY | M-Pesa | STK Push passkey |
| MPESA_SECURITY_CREDENTIAL | M-Pesa | B2C encrypted credential |
| MPESA_CALLBACK_SECRET | M-Pesa | Webhook signature verification |
| AIRTEL_CLIENT_ID | Airtel | API client ID |
| AIRTEL_CLIENT_SECRET | Airtel | API client secret |
| TIGO_API_KEY | Tigo Pesa | Apigee API key |
| TIGO_API_SECRET | Tigo Pesa | Apigee API secret |

## Security

- Secrets from environment variables only
- Callback signature verification (HMAC-SHA256)
- Sensitive fields redacted in logs (phone, tokens, keys)
- Retry logic for transient provider failures
