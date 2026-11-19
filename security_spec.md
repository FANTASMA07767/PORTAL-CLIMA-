# JMAC-Climatyc Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default Deny Catch-All**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false`).
2. **Verified Identity**: All mutations (`create`, `update`, `delete`) require `request.auth != null && request.auth.token.email_verified == true`.
3. **No PII in Public Reports**: `CitizenReport` stores only `reporterAlias` (2–60 chars) and `authorId` (`request.auth.uid`), never emails, phone numbers, or home addresses.
4. **Strict Keys & Blueprint Synchronicity**: Every `create` and `update` invokes `isValidCitizenReport(incoming())` or `isValidAdminRecord(incoming())` enforcing `hasAll` + `hasOnly` key allowlists, regex IDs (`^[a-zA-Z0-9_\-]+$`), string `.size()` bounds, numeric Ecuador coordinate bounds, and server timestamps (`request.time`).
5. **Immutable Provenance**: `authorId` and `createdAt` can never be mutated during updates.
6. **Terminal State Locking**: Once a `CitizenReport` reaches `status == 'mitigado'`, non-admin users cannot update it (including upvotes).
7. **Secure List Enforcement**: `allow list` never grants blanket `isSignedIn()` access; it strictly checks `resource.data.visibility == 'publico'` (or `resource.data.authorId == request.auth.uid`).
8. **Spoof-Proof Admin RBAC**: `isAdmin()` verifies `request.auth.token.email_verified == true` alongside bootstrapped director email (`lidermancoordinador2@gmail.com`) or `exists(/databases/$(database)/documents/admins/$(request.auth.uid))`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: `auth = null` attempting `create` on `/citizen_reports/rep_1` -> `PERMISSION_DENIED`.
2. **Unverified Admin Email Spoof**: `auth = { uid: 'attacker', email: 'lidermancoordinador2@gmail.com', email_verified: false }` attempting `create` on `/admins/spoof_admin` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Report**: Authenticated user `uid_A` setting `authorId: 'uid_B'` on `/citizen_reports/rep_2` -> `PERMISSION_DENIED`.
4. **Shadow / Ghost Field Injection**: Authenticated user adding `"isVerified": true` to `/citizen_reports/rep_3` -> `PERMISSION_DENIED` (`hasOnly` rejection).
5. **ID Poisoning Attack**: Document ID containing spaces/slashes or >128 chars -> `PERMISSION_DENIED` (`isValidId` guard).
6. **Denial-of-Wallet Oversized String**: `description` with 5,000 chars (`> 500`) -> `PERMISSION_DENIED`.
7. **Out-of-Bounds Coordinates**: `lat: 45.0, lng: 10.0` (outside Ecuador/Galápagos) -> `PERMISSION_DENIED`.
8. **Client Timestamp Forgery**: `createdAt` set to past/future timestamp instead of `serverTimestamp()` (`request.time`) -> `PERMISSION_DENIED`.
9. **Privilege Escalation on Citizen Report Update**: Regular citizen trying to change `status` to `'mitigado'` or edit `adminNote` -> `PERMISSION_DENIED`.
10. **Upvote Manipulation Jump**: Citizen trying to increment `upvotes` by +50 instead of +1 -> `PERMISSION_DENIED`.
11. **Terminal State Bypass**: Citizen attempting to upvote a report already in `'mitigado'` terminal state -> `PERMISSION_DENIED`.
12. **Unfiltered Blanket List Scraping**: Authenticated user running unfiltered `getDocs(collection(db, 'citizen_reports'))` without `where('visibility', '==', 'publico')` when archived docs exist -> `PERMISSION_DENIED`.
