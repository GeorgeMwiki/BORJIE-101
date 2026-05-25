# Borjie Mobile (Flutter) Codemap

**Last Updated:** 2026-05-22
**Module:** `apps/borjie_app/`
**Public entry:** `apps/borjie_app/lib/main.dart`
**Targets:** iOS, Android, Web (Flutter 3.2+, Dart SDK >=3.2 <4.0)

## Purpose

The Flutter mobile client (with web build target) — the customer +
estate-manager native experience. Single Dart codebase shipping to
iOS App Store, Google Play, and a PWA. Uses `go_router` for
navigation, `provider` for state, `flutter_secure_storage` for
keys, `http` for API, and `intl` for locale.

## Entry points

- `lib/main.dart` — Flutter entry.
- `lib/app.dart` — root widget + theme.
- `lib/router.dart` — `go_router` configuration.
- `lib/screens/` — top-level screens.
- `lib/widgets/` — shared widgets.
- `lib/core/` — services, repositories, models.
- `lib/utils/` — formatters, helpers.

## Internal structure

- `screens/` — one folder per feature (login, properties, payments,
  documents, chat).
- `widgets/` — reusable Flutter widgets matching design tokens.
- `core/` — API client, secure store, auth, repositories.
- `utils/` — currency, date, locale helpers.

## Dependencies

- Upstream (pub): `flutter`, `go_router`, `provider`,
  `flutter_secure_storage`, `http`, `shared_preferences`, `intl`,
  `cupertino_icons`.
- Downstream: api-gateway (REST + SSE).

## Common workflows

- **Login** → OTP via identity service.
- **List properties** → `core/api/property_repo` → API.
- **Pay rent** → STK push via payments service.
- **Run** → `flutter run -d ios | android | chrome`.

## Anti-patterns to avoid

- Never store JWT in `shared_preferences` — use `secure_storage`.
- Never hardcode KES — use `intl` + tenant currency.
- Never bypass `go_router` deep-link logic.
- Never log secrets via `dart:developer`.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — backend
- [customer-app.md](./customer-app.md) — web sibling
- [identity.md](./identity.md) — OTP auth
