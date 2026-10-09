# Payments and subscriptions

The subscription checkout endpoints are:

- `GET /api/payments/plans` returns the Free, Starter, Pro, and Premium catalog.
- `POST /api/payments/create-order` with `{ "plan": "starter" | "pro" | "premium" }`.
- `POST /api/payments/verify` with the three Razorpay verification fields.
- `POST /api/payments/webhook` for a configured Razorpay webhook.

Required server-side variables are `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` when webhooks are enabled. `OPENAI_API_KEY` is optional and must never be exposed to the browser. Existing Instagram, MongoDB, SMTP, and Meta variables remain required for those features.

The new fields are additive Mongoose schema changes. Existing subscription records should be backfilled with `provider: "manual"`; existing payment records should be backfilled with their plan or reviewed before deployment because new payment records require `plan`. No destructive migration is included.

Plan prices and usage limits are centralized in `src/config/plans.ts`. The server derives Razorpay amounts from this configuration and ignores any client-supplied amount for subscription checkout.

The Free plan includes 10 DMs per calendar month. Starter is ₹99/month and includes 3 automations, 500 leads, and 1,000 DMs/month. Pro is ₹499/month and Premium is ₹999/month.
